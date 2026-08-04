using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace BNDZ.Services;

/// <summary>
/// Everything search via SDK IPC DLL (Everything64.dll / Everything.dll).
/// Replaces spawning es.exe.
/// </summary>
public static class EverythingIpcClient
{
    private static readonly object Gate = new();
    private static IntPtr _module = IntPtr.Zero;
    private static Delegates? _api;

    private const uint RequestFullPathAndFileName = 0x00000004;
    private const uint RequestSize = 0x00000010;

    private sealed class Delegates
    {
        public required SetSearchW SetSearch;
        public required SetBool SetMatchPath;
        public required SetBool SetMatchCase;
        public required SetUInt SetMax;
        public required SetUInt SetOffset;
        public required SetUInt SetRequestFlags;
        public required QueryW Query;
        public required GetNum GetNumResults;
        public required GetFullPath GetResultFullPathName;
        public required GetSize GetResultSize;
        public required Action Reset;
    }

    [UnmanagedFunctionPointer(CallingConvention.StdCall, CharSet = CharSet.Unicode)]
    private delegate uint SetSearchW(string lpSearchString);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate void SetBool(bool value);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate void SetUInt(uint value);
    [UnmanagedFunctionPointer(CallingConvention.StdCall, CharSet = CharSet.Unicode)]
    private delegate bool QueryW(bool wait);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate uint GetNum();
    [UnmanagedFunctionPointer(CallingConvention.StdCall, CharSet = CharSet.Unicode)]
    private delegate void GetFullPath(uint index, StringBuilder buf, uint size);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate bool GetSize(uint index, out ulong size);

    public static bool TrySearch(string query, int limit, string? rootPath, List<object> results)
    {
        if (string.IsNullOrWhiteSpace(query)) return false;
        if (!EnsureLoaded()) return false;
        var api = _api!;
        limit = Math.Clamp(limit, 1, 10_000);

        lock (Gate)
        {
            try
            {
                var search = BuildQuery(query, rootPath);
                api.Reset();
                api.SetMax((uint)limit);
                api.SetOffset(0);
                api.SetMatchPath(false);
                api.SetMatchCase(false);
                api.SetRequestFlags(RequestFullPathAndFileName | RequestSize);
                api.SetSearch(search);

                if (!api.Query(true))
                {
                    api.Reset();
                    return false;
                }

                var count = api.GetNumResults();
                if (count == 0)
                {
                    api.Reset();
                    return false;
                }

                var buf = new StringBuilder(4096);
                var before = results.Count;
                for (uint i = 0; i < count && results.Count < limit; i++)
                {
                    buf.Clear();
                    api.GetResultFullPathName(i, buf, (uint)buf.Capacity);
                    var full = buf.ToString();
                    if (string.IsNullOrWhiteSpace(full)) continue;
                    if (!File.Exists(full) && !Directory.Exists(full)) continue;

                    var isDir = Directory.Exists(full);
                    var name = Path.GetFileName(full.TrimEnd('\\', '/'));
                    if (string.IsNullOrEmpty(name)) name = full;
                    var panePath = "/" + full.Replace("\\", "/");

                    if (isDir)
                    {
                        results.Add(new { name, path = panePath, isDirectory = true });
                    }
                    else
                    {
                        long size = 0;
                        if (api.GetResultSize(i, out var sz) && sz > 0) size = (long)sz;
                        else try { size = new FileInfo(full).Length; } catch { }
                        results.Add(new { name, path = panePath, size });
                    }
                }

                api.Reset();
                return results.Count > before;
            }
            catch
            {
                try { api.Reset(); } catch { }
                return false;
            }
        }
    }

    private static string BuildQuery(string query, string? rootPath)
    {
        var escaped = query.Replace("\"", "");
        if (string.IsNullOrWhiteSpace(rootPath)) return escaped;

        var normalized = rootPath.Replace("/", "\\").Trim();
        if (normalized.StartsWith("\\") && normalized.Length > 2 && normalized[1] != ':')
            normalized = normalized.TrimStart('\\');
        if (normalized.Length >= 2 && normalized[1] == ':')
            normalized = normalized.TrimEnd('\\') + "\\";

        return $"\"{normalized}\" {escaped}";
    }

    private static bool EnsureLoaded()
    {
        if (_api != null) return true;
        lock (Gate)
        {
            if (_api != null) return true;
            foreach (var path in CandidateDllPaths())
            {
                if (!File.Exists(path)) continue;
                var mod = LoadLibrary(path);
                if (mod == IntPtr.Zero) continue;

                try
                {
                    _api = new Delegates
                    {
                        SetSearch = Load<SetSearchW>(mod, "Everything_SetSearchW"),
                        SetMatchPath = Load<SetBool>(mod, "Everything_SetMatchPath"),
                        SetMatchCase = Load<SetBool>(mod, "Everything_SetMatchCase"),
                        SetMax = Load<SetUInt>(mod, "Everything_SetMax"),
                        SetOffset = Load<SetUInt>(mod, "Everything_SetOffset"),
                        SetRequestFlags = Load<SetUInt>(mod, "Everything_SetRequestFlags"),
                        Query = Load<QueryW>(mod, "Everything_QueryW"),
                        GetNumResults = Load<GetNum>(mod, "Everything_GetNumResults"),
                        GetResultFullPathName = Load<GetFullPath>(mod, "Everything_GetResultFullPathNameW"),
                        GetResultSize = Load<GetSize>(mod, "Everything_GetResultSize"),
                        Reset = Load<Action>(mod, "Everything_Reset"),
                    };
                    _module = mod;
                    return true;
                }
                catch
                {
                    FreeLibrary(mod);
                    _api = null;
                }
            }
            return false;
        }
    }

    private static T Load<T>(IntPtr mod, string name) where T : Delegate
    {
        var p = GetProcAddress(mod, name);
        if (p == IntPtr.Zero) throw new EntryPointNotFoundException(name);
        return Marshal.GetDelegateForFunctionPointer<T>(p);
    }

    private static IEnumerable<string> CandidateDllPaths()
    {
        var names = Environment.Is64BitProcess
            ? new[] { "Everything64.dll", "Everything.dll" }
            : new[] { "Everything32.dll", "Everything.dll" };
        var dirs = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Everything"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Everything"),
            @"C:\Program Files\Everything",
            @"C:\Program Files (x86)\Everything",
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Everything"),
            AppContext.BaseDirectory,
        };
        foreach (var dir in dirs)
        {
            if (string.IsNullOrEmpty(dir)) continue;
            foreach (var name in names)
                yield return Path.Combine(dir, name);
        }
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr LoadLibrary(string lpFileName);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool FreeLibrary(IntPtr hModule);

    [DllImport("kernel32.dll", CharSet = CharSet.Ansi, SetLastError = true)]
    private static extern IntPtr GetProcAddress(IntPtr hModule, string procName);
}
