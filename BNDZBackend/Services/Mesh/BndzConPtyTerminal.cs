using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace BNDZ.Services.Mesh;

/// <summary>
/// Local PowerShell via Windows ConPTY — same model Windows Terminal uses.
/// Output is VT/UTF-8 streamed to xterm.js through MESH_TERMINAL_OUTPUT (no HWND embed).
/// </summary>
internal sealed class BndzConPtyTerminal : IDisposable
{
    private const uint ProcThreadAttributePseudoConsole = 0x00020016;
    private const uint ExtendedStartupInfoPresent = 0x00080000;

    private readonly object _gate = new();
    private IntPtr _hPC = IntPtr.Zero;
    private IntPtr _attrList = IntPtr.Zero;
    private SafeFileHandle? _inputWrite;
    private SafeFileHandle? _outputRead;
    private SafeFileHandle? _inputRead;   // owned by ConPTY after create
    private SafeFileHandle? _outputWrite; // owned by ConPTY after create
    private Process? _process;
    private FileStream? _inputStream;
    private CancellationTokenSource? _cts;
    private int _disposed;
    private short _cols;
    private short _rows;

    public event Action<byte[]>? OnData;
    public event Action<int>? OnExit;

    private BndzConPtyTerminal() { }

    public static BndzConPtyTerminal Start(
        string workingDirectory,
        uint cols = 120,
        uint rows = 32,
        Action<byte[]>? onData = null,
        Action<int>? onExit = null)
    {
        var term = new BndzConPtyTerminal();
        if (onData != null) term.OnData += onData;
        if (onExit != null) term.OnExit += onExit;
        term._cols = (short)Math.Clamp((int)cols, 20, 400);
        term._rows = (short)Math.Clamp((int)rows, 8, 200);
        term.StartCore(workingDirectory);
        return term;
    }

    public void Write(byte[] data)
    {
        if (data is not { Length: > 0 }) return;
        lock (_gate)
        {
            try
            {
                _inputStream?.Write(data, 0, data.Length);
                _inputStream?.Flush();
            }
            catch { /* process may have exited */ }
        }
    }

    public void Resize(uint cols, uint rows)
    {
        var c = (short)Math.Clamp((int)cols, 20, 400);
        var r = (short)Math.Clamp((int)rows, 8, 200);
        lock (_gate)
        {
            if (_hPC == IntPtr.Zero) return;
            _cols = c;
            _rows = r;
            _ = ResizePseudoConsole(_hPC, new Coord { X = c, Y = r });
        }
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
        try { _cts?.Cancel(); } catch { }
        try
        {
            if (_process is { HasExited: false })
                _process.Kill(entireProcessTree: true);
        }
        catch { /* ignore */ }

        lock (_gate)
        {
            try { _inputStream?.Dispose(); } catch { }
            _inputStream = null;
            try { _inputWrite?.Dispose(); } catch { }
            try { _outputRead?.Dispose(); } catch { }
            // These may already be closed after CreatePseudoConsole owns them.
            try { _inputRead?.Dispose(); } catch { }
            try { _outputWrite?.Dispose(); } catch { }
            _inputWrite = _outputRead = _inputRead = _outputWrite = null;

            if (_attrList != IntPtr.Zero)
            {
                DeleteProcThreadAttributeList(_attrList);
                Marshal.FreeHGlobal(_attrList);
                _attrList = IntPtr.Zero;
            }

            if (_hPC != IntPtr.Zero)
            {
                ClosePseudoConsole(_hPC);
                _hPC = IntPtr.Zero;
            }
        }

        try { _process?.Dispose(); } catch { }
        try { _cts?.Dispose(); } catch { }
    }

    private void StartCore(string workingDirectory)
    {
        // ConPTY requires inheritable pipe ends (Windows Terminal / MiniTerm pattern).
        var sa = new SECURITY_ATTRIBUTES
        {
            nLength = Marshal.SizeOf<SECURITY_ATTRIBUTES>(),
            lpSecurityDescriptor = IntPtr.Zero,
            bInheritHandle = true,
        };
        if (!CreatePipe(out var inputRead, out var inputWrite, ref sa, 0))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "ConPTY input pipe failed");
        if (!CreatePipe(out var outputRead, out var outputWrite, ref sa, 0))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "ConPTY output pipe failed");

        // Keep our ends non-inheritable; only ConPTY's duplicated ends stay inheritable.
        _ = SetHandleInformation(inputWrite, HandleFlagInherit, 0);
        _ = SetHandleInformation(outputRead, HandleFlagInherit, 0);

        _inputRead = inputRead;
        _inputWrite = inputWrite;
        _outputRead = outputRead;
        _outputWrite = outputWrite;

        var hr = CreatePseudoConsole(
            new Coord { X = _cols, Y = _rows },
            inputRead,
            outputWrite,
            0,
            out _hPC);
        if (hr != 0 || _hPC == IntPtr.Zero)
            throw new Win32Exception(hr != 0 ? hr : Marshal.GetLastWin32Error(), "CreatePseudoConsole failed");

        // ConPTY duplicates these; we must close our copies (MiniTerm pattern).
        inputRead.Dispose();
        outputWrite.Dispose();
        _inputRead = null;
        _outputWrite = null;

        // FileStream takes ownership of the SafeFileHandle.
        _inputStream = new FileStream(_inputWrite, FileAccess.Write);
        _inputWrite = null;
        var cmdLine = BuildShellCommandLine(workingDirectory);
        var dir = Directory.Exists(workingDirectory) ? workingDirectory : null;
        StartProcessAttachedToConPty(cmdLine, dir);

        // Kick ConPTY with an explicit resize to the same size — some hosts delay
        // the first paint / DA handshake until WINSIZE is confirmed.
        try { Resize((uint)_cols, (uint)_rows); } catch { /* ignore */ }

        _cts = new CancellationTokenSource();
        _ = Task.Run(() => PumpOutputAsync(_cts.Token));
    }

    private void StartProcessAttachedToConPty(string commandLine, string? workingDirectory)
    {
        var size = IntPtr.Zero;
        InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
        if (size == IntPtr.Zero)
            throw new InvalidOperationException("InitializeProcThreadAttributeList size failed");

        _attrList = Marshal.AllocHGlobal(size);
        if (!InitializeProcThreadAttributeList(_attrList, 1, 0, ref size))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "InitializeProcThreadAttributeList failed");

        // Cascadia/MiniTerm: pass HPCON handle value as lpValue with cbSize = IntPtr.Size.
        if (!UpdateProcThreadAttribute(
                _attrList,
                0,
                (IntPtr)ProcThreadAttributePseudoConsole,
                _hPC,
                (IntPtr)IntPtr.Size,
                IntPtr.Zero,
                IntPtr.Zero))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "UpdateProcThreadAttribute PSEUDOCONSOLE failed");

        // STARTF_USESTDHANDLES with null std handles is required for ConPTY attachment when the
        // parent is a GUI / redirected process. Without it, CreateProcess still duplicates the
        // parent's std handles into the child — PowerShell never binds to the PTY and the host
        // only receives a few invisible VT mode bytes (blank xterm with a cursor). See
        // microsoft/terminal#15814 and MiniTerm / Windows Terminal host patterns.
        const int startfUseShowWindow = 0x00000001;
        const int startfUseStdHandles = 0x00000100;
        var si = new StartupInfoEx
        {
            StartupInfo = new StartupInfo
            {
                cb = Marshal.SizeOf<StartupInfoEx>(),
                dwFlags = startfUseShowWindow | startfUseStdHandles,
                wShowWindow = 0, // SW_HIDE — avoid a flash of a real console
                hStdInput = IntPtr.Zero,
                hStdOutput = IntPtr.Zero,
                hStdError = IntPtr.Zero,
            },
            lpAttributeList = _attrList,
        };

        var cmd = new System.Text.StringBuilder(commandLine);
        var envBlock = BuildConPtyEnvironmentBlock();
        var envPtr = IntPtr.Zero;
        try
        {
            envPtr = Marshal.StringToHGlobalUni(envBlock);
            const uint createUnicodeEnvironment = 0x00000400;
            if (!CreateProcess(
                    null,
                    cmd,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    false,
                    ExtendedStartupInfoPresent | createUnicodeEnvironment,
                    envPtr,
                    workingDirectory,
                    ref si,
                    out var pi))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateProcess for ConPTY shell failed");

            try
            {
                _process = Process.GetProcessById(pi.dwProcessId);
                _process.EnableRaisingEvents = true;
                _process.Exited += (_, _) =>
                {
                    try { OnExit?.Invoke(_process.HasExited ? _process.ExitCode : -1); }
                    catch { /* ignore */ }
                };
            }
            catch
            {
                _process = null;
            }

            CloseHandle(pi.hThread);
            CloseHandle(pi.hProcess);
        }
        finally
        {
            if (envPtr != IntPtr.Zero) Marshal.FreeHGlobal(envPtr);
        }
    }

    private async Task PumpOutputAsync(CancellationToken ct)
    {
        var read = _outputRead;
        if (read == null || read.IsInvalid) return;
        _outputRead = null; // FileStream owns the handle for the pump lifetime
        // Anonymous ConPTY pipes do not reliably support overlapped I/O — sync Read on a worker.
        await using var stream = new FileStream(read, FileAccess.Read, 4096, isAsync: false);
        var buf = new byte[4096];
        try
        {
            while (!ct.IsCancellationRequested)
            {
                int n;
                try
                {
                    n = await Task.Run(() => stream.Read(buf, 0, buf.Length), ct).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                if (n <= 0) break;
                var chunk = new byte[n];
                Buffer.BlockCopy(buf, 0, chunk, 0, n);
                try { OnData?.Invoke(chunk); }
                catch { /* ignore */ }
            }
        }
        catch (OperationCanceledException) { /* expected */ }
        catch { /* pipe closed */ }
    }

    private static string BuildShellCommandLine(string workingDirectory)
    {
        var shell = ResolveShellExecutable();
        // -NoLogo keeps the pane clean; ConPTY provides a real interactive console.
        // pwsh supports -WorkingDirectory; Windows PowerShell relies on CreateProcess cwd.
        var isPwsh = shell.EndsWith("pwsh.exe", StringComparison.OrdinalIgnoreCase);
        if (isPwsh && !string.IsNullOrWhiteSpace(workingDirectory) && Directory.Exists(workingDirectory))
        {
            var quotedDir = workingDirectory.Replace("\"", "\\\"");
            return $"\"{shell}\" -NoLogo -WorkingDirectory \"{quotedDir}\"";
        }
        return $"\"{shell}\" -NoLogo";
    }

    /// <summary>
    /// Unicode environment block for CreateProcess — inherit process env and force
    /// xterm-capable TERM so ConPTY / PowerShell negotiate like Windows Terminal.
    /// </summary>
    private static string BuildConPtyEnvironmentBlock()
    {
        var map = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (System.Collections.DictionaryEntry entry in Environment.GetEnvironmentVariables())
        {
            var key = entry.Key?.ToString();
            if (string.IsNullOrEmpty(key)) continue;
            map[key] = entry.Value?.ToString() ?? "";
        }
        map["TERM"] = "xterm-256color";
        map["COLORTERM"] = "truecolor";
        map["TERM_PROGRAM"] = "BNDZ";
        // Avoid WT-specific vars confusing nested shells; ensure ConPTY path is clear.
        map.Remove("WT_SESSION");
        map.Remove("WT_PROFILE_ID");

        var sb = new System.Text.StringBuilder(map.Count * 32);
        foreach (var kv in map)
        {
            sb.Append(kv.Key);
            sb.Append('=');
            sb.Append(kv.Value);
            sb.Append('\0');
        }
        sb.Append('\0');
        return sb.ToString();
    }

    private static string ResolveShellExecutable()
    {
        var pwsh = Environment.GetEnvironmentVariable("ProgramFiles") is { } pf
            ? Path.Combine(pf, "PowerShell", "7", "pwsh.exe")
            : null;
        if (!string.IsNullOrEmpty(pwsh) && File.Exists(pwsh)) return pwsh;

        var winPs = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.System),
            "WindowsPowerShell", "v1.0", "powershell.exe");
        if (File.Exists(winPs)) return winPs;

        return "powershell.exe";
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Coord
    {
        public short X;
        public short Y;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public int cb;
        public IntPtr lpReserved;
        public IntPtr lpDesktop;
        public IntPtr lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct StartupInfoEx
    {
        public StartupInfo StartupInfo;
        public IntPtr lpAttributeList;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern int CreatePseudoConsole(Coord size, SafeFileHandle hInput, SafeFileHandle hOutput, uint dwFlags, out IntPtr phPC);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern int ResizePseudoConsole(IntPtr hPC, Coord size);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern void ClosePseudoConsole(IntPtr hPC);

    [StructLayout(LayoutKind.Sequential)]
    private struct SECURITY_ATTRIBUTES
    {
        public int nLength;
        public IntPtr lpSecurityDescriptor;
        [MarshalAs(UnmanagedType.Bool)]
        public bool bInheritHandle;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CreatePipe(
        out SafeFileHandle hReadPipe,
        out SafeFileHandle hWritePipe,
        ref SECURITY_ATTRIBUTES lpPipeAttributes,
        int nSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetHandleInformation(SafeFileHandle hObject, uint dwMask, uint dwFlags);

    private const uint HandleFlagInherit = 0x00000001;

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool InitializeProcThreadAttributeList(IntPtr lpAttributeList, int dwAttributeCount, int dwFlags, ref IntPtr lpSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UpdateProcThreadAttribute(
        IntPtr lpAttributeList,
        uint dwFlags,
        IntPtr attribute,
        IntPtr lpValue,
        IntPtr cbSize,
        IntPtr lpPreviousValue,
        IntPtr lpReturnSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern void DeleteProcThreadAttributeList(IntPtr lpAttributeList);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateProcess(
        string? lpApplicationName,
        System.Text.StringBuilder lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string? lpCurrentDirectory,
        ref StartupInfoEx lpStartupInfo,
        out ProcessInformation lpProcessInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);
}
