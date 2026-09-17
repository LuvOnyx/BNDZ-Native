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
    public const int ERROR_SHARING_VIOLATION = 32;
    public const int ERROR_DISK_FULL = 112;
    public const int ERROR_FILENAME_EXCED_RANGE = 206;
    public const int ERROR_WRITE_PROTECT = 19;
    public const int ERROR_INVALID_NAME = 123;
    public const int E_ACCESSDENIED = unchecked((int)0x80070005);
    public const int HRESULT_DISK_FULL = unchecked((int)0x80070070);
    public const int HRESULT_WRITE_PROTECT = unchecked((int)0x80070013);
    public const int HRESULT_INVALID_NAME = unchecked((int)0x8007007B);

    public sealed class Classification
    {
        public bool NeedsElevation { get; init; }
        public bool UserCancelled { get; init; }
        /// <summary>diskFull | sharingViolation | pathTooLong | accessDenied | readOnly | invalidName | other</summary>
        public string Kind { get; init; } = "other";
        public string Message { get; init; } = "";
        public string Code { get; init; } = "";
    }

    public static Classification Classify(Exception? ex, string? context = null)
    {
        if (ex == null)
            return new Classification { Message = context ?? "Unknown error", Kind = "other" };

        if (ex is Win32Exception w32)
        {
            if (w32.NativeErrorCode == ERROR_CANCELLED)
                return new Classification { UserCancelled = true, Message = "Administrator approval was cancelled.", Code = "1223", Kind = "other" };
            if (w32.NativeErrorCode == ERROR_DISK_FULL)
                return OpsFail(context, "diskFull", "112", "Not enough free space on the destination volume.");
            if (w32.NativeErrorCode == ERROR_SHARING_VIOLATION)
                return OpsFail(context, "sharingViolation", "32", "The file is in use by another program.");
            if (w32.NativeErrorCode == ERROR_FILENAME_EXCED_RANGE)
                return OpsFail(context, "pathTooLong", "206", "The path or file name is too long.");
            if (w32.NativeErrorCode == ERROR_WRITE_PROTECT)
                return OpsFail(context, "readOnly", "19", "The destination media is write protected.");
            if (w32.NativeErrorCode == ERROR_INVALID_NAME)
                return OpsFail(context, "invalidName", "123", "The file or folder name is not valid on Windows.");
            if (w32.NativeErrorCode == ERROR_ACCESS_DENIED || w32.NativeErrorCode == ERROR_PRIVILEGE_NOT_HELD)
                return NeedsElev(context, w32.NativeErrorCode.ToString());
        }

        if (ex is PathTooLongException)
            return OpsFail(context, "pathTooLong", "PathTooLong", "The path or file name is too long.");

        if (ex is UnauthorizedAccessException or SecurityException)
        {
            var uaMsg = ex.Message ?? "";
            if (LooksReadOnly(uaMsg))
                return OpsFail(context, "readOnly", "UnauthorizedAccess_ReadOnly", uaMsg);
            return NeedsElev(context, "UnauthorizedAccess");
        }

        if (ex is IOException io)
        {
            var hr = Marshal.GetHRForException(io);
            if (hr == HRESULT_DISK_FULL)
                return OpsFail(context, "diskFull", "0x80070070", io.Message);
            if (hr == HRESULT_WRITE_PROTECT)
                return OpsFail(context, "readOnly", "0x80070013", io.Message);
            if (hr == HRESULT_INVALID_NAME)
                return OpsFail(context, "invalidName", "0x8007007B", io.Message);
            if (hr == E_ACCESSDENIED)
            {
                if (LooksReadOnly(io.Message))
                    return OpsFail(context, "readOnly", "E_ACCESSDENIED_ReadOnly", io.Message);
                return NeedsElev(context, "E_ACCESSDENIED");
            }
            var msg = io.Message ?? "";
            if (msg.Contains("Not enough free space", StringComparison.OrdinalIgnoreCase)
                || msg.Contains("disk full", StringComparison.OrdinalIgnoreCase))
                return OpsFail(context, "diskFull", "IO_DiskFull", msg);
            if (msg.Contains("being used by another process", StringComparison.OrdinalIgnoreCase)
                || msg.Contains("sharing violation", StringComparison.OrdinalIgnoreCase))
                return OpsFail(context, "sharingViolation", "IO_Sharing", msg);
            if (msg.Contains("path too long", StringComparison.OrdinalIgnoreCase)
                || msg.Contains("filename", StringComparison.OrdinalIgnoreCase) && msg.Contains("long", StringComparison.OrdinalIgnoreCase))
                return OpsFail(context, "pathTooLong", "IO_PathTooLong", msg);
            if (LooksReadOnly(msg))
                return OpsFail(context, "readOnly", "IO_ReadOnly", msg);
            if (LooksInvalidName(msg))
                return OpsFail(context, "invalidName", "IO_InvalidName", msg);
            if (msg.Contains("Access is denied", StringComparison.OrdinalIgnoreCase)
                || msg.Contains("access denied", StringComparison.OrdinalIgnoreCase))
                return NeedsElev(context, "IO_AccessDenied");
        }

        if (ex is ArgumentException argEx && LooksInvalidName(argEx.Message))
            return OpsFail(context, "invalidName", "Argument_InvalidName", argEx.Message);

        // Unwrap AggregateException
        if (ex is AggregateException agg)
        {
            foreach (var inner in agg.InnerExceptions)
            {
                var c = Classify(inner, context);
                if (c.NeedsElevation || c.UserCancelled || c.Kind is not ("other" or "")) return c;
            }
        }

        if (ex.InnerException != null)
        {
            var inner = Classify(ex.InnerException, context);
            if (inner.NeedsElevation || inner.UserCancelled || inner.Kind is not ("other" or "")) return inner;
        }

        return new Classification { Message = ex.Message ?? context ?? "Operation failed", Kind = "other" };
    }

    private static bool LooksReadOnly(string? message)
    {
        if (string.IsNullOrWhiteSpace(message)) return false;
        return message.Contains("write protect", StringComparison.OrdinalIgnoreCase)
            || message.Contains("write-protected", StringComparison.OrdinalIgnoreCase)
            || message.Contains("read-only", StringComparison.OrdinalIgnoreCase)
            || message.Contains("read only", StringComparison.OrdinalIgnoreCase)
            || message.Contains("not writable", StringComparison.OrdinalIgnoreCase);
    }

    private static bool LooksInvalidName(string? message)
    {
        if (string.IsNullOrWhiteSpace(message)) return false;
        return message.Contains("invalid name", StringComparison.OrdinalIgnoreCase)
            || message.Contains("illegal character", StringComparison.OrdinalIgnoreCase)
            || message.Contains("filename, directory name, or volume label syntax", StringComparison.OrdinalIgnoreCase)
            || message.Contains("reserved", StringComparison.OrdinalIgnoreCase)
               && message.Contains("name", StringComparison.OrdinalIgnoreCase);
    }

    private static Classification OpsFail(string? context, string kind, string code, string fallbackMessage) => new()
    {
        Kind = kind,
        Code = code,
        Message = string.IsNullOrWhiteSpace(context)
            ? fallbackMessage
            : $"{context.Trim()}: {fallbackMessage}",
    };

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
        Kind = "accessDenied",
        Code = code,
        Message = string.IsNullOrWhiteSpace(context)
            ? "This action requires administrator approval."
            : $"{context.Trim()} requires administrator approval.",
    };
}
