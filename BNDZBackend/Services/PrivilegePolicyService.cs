using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security;

namespace BNDZ.Services;

/// <summary>
/// Classifies filesystem / security failures that require Windows elevation (UAC).
/// </summary>
public static class PrivilegePolicyService
{
    public const int ERROR_ACCESS_DENIED = 5;
    public const int ERROR_PRIVILEGE_NOT_HELD = 1314;
    public const int ERROR_CANCELLED = 1223;
    public const int E_ACCESSDENIED = unchecked((int)0x80070005);

    public sealed class Classification
    {
        public bool NeedsElevation { get; init; }
        public bool UserCancelled { get; init; }
        public string Message { get; init; } = "";
        public string Code { get; init; } = "";
    }

    public static Classification Classify(Exception? ex, string? context = null)
    {
        if (ex == null)
            return new Classification { Message = context ?? "Unknown error" };

        if (ex is Win32Exception w32)
        {
            if (w32.NativeErrorCode == ERROR_CANCELLED)
                return new Classification { UserCancelled = true, Message = "Administrator approval was cancelled.", Code = "1223" };
            if (w32.NativeErrorCode == ERROR_ACCESS_DENIED || w32.NativeErrorCode == ERROR_PRIVILEGE_NOT_HELD)
                return NeedsElev(context, w32.NativeErrorCode.ToString());
        }

        if (ex is UnauthorizedAccessException or SecurityException)
            return NeedsElev(context, "UnauthorizedAccess");

        if (ex is IOException io)
        {
            var hr = Marshal.GetHRForException(io);
            if (hr == E_ACCESSDENIED)
                return NeedsElev(context, "E_ACCESSDENIED");
            var msg = io.Message ?? "";
            if (msg.Contains("Access is denied", StringComparison.OrdinalIgnoreCase)
                || msg.Contains("access denied", StringComparison.OrdinalIgnoreCase))
                return NeedsElev(context, "IO_AccessDenied");
        }

        // Unwrap AggregateException
        if (ex is AggregateException agg)
        {
            foreach (var inner in agg.InnerExceptions)
            {
                var c = Classify(inner, context);
                if (c.NeedsElevation || c.UserCancelled) return c;
            }
        }

        if (ex.InnerException != null)
        {
            var inner = Classify(ex.InnerException, context);
            if (inner.NeedsElevation || inner.UserCancelled) return inner;
        }

        return new Classification { Message = ex.Message ?? context ?? "Operation failed" };
    }

    public static bool IsAccessDeniedMessage(string? message)
    {
        if (string.IsNullOrWhiteSpace(message)) return false;
        return message.Contains("Access is denied", StringComparison.OrdinalIgnoreCase)
            || message.Contains("access denied", StringComparison.OrdinalIgnoreCase)
            || message.Contains("UnauthorizedAccess", StringComparison.OrdinalIgnoreCase)
            || message.Contains("requires administrator", StringComparison.OrdinalIgnoreCase)
            || message.Contains("elevation", StringComparison.OrdinalIgnoreCase);
    }

    private static Classification NeedsElev(string? context, string code) => new()
    {
        NeedsElevation = true,
        Code = code,
        Message = string.IsNullOrWhiteSpace(context)
            ? "This action requires administrator approval."
            : $"{context.Trim()} requires administrator approval.",
    };
}
