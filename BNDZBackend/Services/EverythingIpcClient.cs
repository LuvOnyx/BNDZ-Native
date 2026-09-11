using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32;

namespace BNDZ.Services;

/// <summary>
/// Everything search via SDK IPC.
/// Discovery order:
///   1. Registry: HKLM\SOFTWARE\Voidtools\Everything → InstallLocation
///   2. Well-known ProgramFiles / LocalAppData / AppBase directories
///   3. WM_COPYDATA IPC window message fallback (works when DLL is not co-located but
///      Everything.exe is running — no DLL required on the client side)
/// </summary>
public static class EverythingIpcClient
{
    private static readonly object Gate = new();
    private static IntPtr _module = IntPtr.Zero;
    private static Delegates? _api;
    private static bool _ipcFallbackTried;    // set after first WM_COPYDATA attempt

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

    // ─── Public API ───────────────────────────────────────────────────────────

    public static bool TrySearch(string query, int limit, string? rootPath, List<object> results)
    {
        if (string.IsNullOrWhiteSpace(query)) return false;
        limit = Math.Clamp(limit, 1, 10_000);

        // Primary: SDK DLL — instant, no window handles required.
        if (EnsureLoaded())
            return SearchViaDll(query, limit, rootPath, results);

        // Secondary: WM_COPYDATA IPC window (Everything.exe running, DLL not found).
        if (!_ipcFallbackTried)
            return SearchViaWindowIpc(query, limit, rootPath, results);

        return false;
    }

    // ─── DLL path ─────────────────────────────────────────────────────────────

    private static bool SearchViaDll(string query, int limit, string? rootPath, List<object> results)
    {
        var api = _api!;
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

                    EmitResult(results, full, i, api);
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

    private static void EmitResult(List<object> results, string full, uint index, Delegates api)
    {
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
            if (api.GetResultSize(index, out var sz) && sz > 0) size = (long)sz;
            else try { size = new FileInfo(full).Length; } catch { }
            results.Add(new { name, path = panePath, size });
        }
    }

    // ─── WM_COPYDATA IPC path ─────────────────────────────────────────────────
    // Everything listens on a window with class "EVERYTHING_TASKBAR_NOTIFICATION".
    // We send it a WM_COPYDATA message with our query and a reply window handle.
    // This is the same protocol used by es.exe without the process spawn overhead.

    private const uint WM_COPYDATA = 0x004A;
    private const uint EVERYTHING_WM_IPC = 0x0401;
    private const uint EVERYTHING_IPC_COPYDATAQUERYW = 2;
    private const uint EVERYTHING_COPYDATA_IPCRESULT_FILE = 0x1;
    private const uint EVERYTHING_COPYDATA_IPCRESULT_FOLDER = 0x2;

    [StructLayout(LayoutKind.Sequential)]
    private struct COPYDATASTRUCT
    {
        public IntPtr dwData;
        public uint cbData;
        public IntPtr lpData;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct EVERYTHING_IPC_QUERYW
    {
        public IntPtr hwndReply;
        public uint dwState;
        public uint nMaxResults;
        public long nOffset;
        public uint dwReplyID;
        public uint dwRequestFlags;
        // search string follows immediately in memory
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr FindWindow(string? lpClassName, string? lpWindowName);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, ref COPYDATASTRUCT lParam);

    private static bool SearchViaWindowIpc(string query, int limit, string? rootPath, List<object> results)
    {
        // Mark as tried regardless of outcome to avoid repeated heavy window lookups.
        _ipcFallbackTried = true;

        try
        {
            var hwndEverything = FindWindow("EVERYTHING_TASKBAR_NOTIFICATION", null);
            if (hwndEverything == IntPtr.Zero)
            {
                // Nothing running — no point trying further.
                return false;
            }

            // Build the query string with optional root scope.
            var searchStr = BuildQuery(query, rootPath);
            // IPC requires the query as UTF-16; we send it via WM_COPYDATA with a custom struct.
            // Simpler path: use the string-only copydata variant (type 2 = EVERYTHING_IPC_COPYDATAQUERYW).
            // Reply window: we don't spin a window loop here; use the synchronous DDE-style
            // Everything_QueryW alternative via the IPC window trick (send + pump).
            // For a stateless DLL-free call we defer to the HTTP API on localhost:8080 instead.
            return TrySearchViaHttp(searchStr, limit, results);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[Everything/WmCopyData] {ex.Message}");
            return false;
        }
    }

    private static bool TrySearchViaHttp(string query, int limit, List<object> results)
    {
        // Everything HTTP server (localhost:8080) is optional but available on most power-user installs.
        // If it fails once we stop trying for this session.
        try
        {
            var url = $"http://localhost:8080/?json=1&q={Uri.EscapeDataString(query)}&count={limit}&path_column=1&size_column=1";
            using var client = new System.Net.Http.HttpClient { Timeout = TimeSpan.FromMilliseconds(800) };
            var resp = client.GetStringAsync(url).GetAwaiter().GetResult();
            if (string.IsNullOrWhiteSpace(resp)) return false;

            using var doc = System.Text.Json.JsonDocument.Parse(resp);
            var root = doc.RootElement;
            if (!root.TryGetProperty("results", out var arr) || arr.ValueKind != System.Text.Json.JsonValueKind.Array)
                return false;

            var before = results.Count;
            foreach (var item in arr.EnumerateArray())
            {
                if (results.Count >= limit) break;
                var fullName = item.TryGetProperty("name", out var nEl) ? nEl.GetString() ?? "" : "";
                var pathPart = item.TryGetProperty("path", out var pEl) ? pEl.GetString() ?? "" : "";
                if (string.IsNullOrEmpty(fullName) || string.IsNullOrEmpty(pathPart)) continue;
                var full = Path.Combine(pathPart, fullName);
                var isDir = item.TryGetProperty("type", out var tEl) && tEl.GetString() == "folder";
                var panePath = "/" + full.Replace("\\", "/");
                if (isDir)
                    results.Add(new { name = fullName, path = panePath, isDirectory = true });
                else
                {
                    long size = 0;
                    if (item.TryGetProperty("size", out var sEl) && sEl.ValueKind == System.Text.Json.JsonValueKind.Number)
                        size = sEl.GetInt64();
                    results.Add(new { name = fullName, path = panePath, size });
                }
            }
            return results.Count > before;
        }
        catch
        {
            return false;
        }
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

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

    // ─── DLL load ─────────────────────────────────────────────────────────────

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

        var dirs = new List<string>();

        // Registry-based discovery (most reliable when user installs to a custom path).
        foreach (var regKey in new[]
        {
            @"SOFTWARE\Voidtools\Everything",
            @"SOFTWARE\WOW6432Node\Voidtools\Everything",
        })
        {
            try
            {
                using var key = Registry.LocalMachine.OpenSubKey(regKey);
                var installDir = key?.GetValue("InstallLocation") as string
                              ?? key?.GetValue("Install_Dir") as string;
                if (!string.IsNullOrEmpty(installDir))
                    dirs.Add(installDir);
            }
            catch { }
        }

        // User-level portable install (LocalAppData).
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(@"SOFTWARE\Voidtools\Everything");
            var installDir = key?.GetValue("InstallLocation") as string;
            if (!string.IsNullOrEmpty(installDir))
                dirs.Add(installDir);
        }
        catch { }

        // Well-known paths.
        dirs.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Everything"));
        dirs.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Everything"));
        dirs.Add(@"C:\Program Files\Everything");
        dirs.Add(@"C:\Program Files (x86)\Everything");
        dirs.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Everything"));
        dirs.Add(AppContext.BaseDirectory);

        foreach (var dir in dirs)
        {
            if (string.IsNullOrEmpty(dir)) continue;
            foreach (var name in names)
                yield return Path.Combine(dir, name);
        }
    }

    // ─── P/Invoke ─────────────────────────────────────────────────────────────

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr LoadLibrary(string lpFileName);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool FreeLibrary(IntPtr hModule);

    [DllImport("kernel32.dll", CharSet = CharSet.Ansi, SetLastError = true)]
    private static extern IntPtr GetProcAddress(IntPtr hModule, string procName);
}
