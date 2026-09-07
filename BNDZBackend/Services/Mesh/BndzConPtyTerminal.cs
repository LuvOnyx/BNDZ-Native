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
        if (!CreatePipe(out var inputRead, out var inputWrite, IntPtr.Zero, 0))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "ConPTY input pipe failed");
        if (!CreatePipe(out var outputRead, out var outputWrite, IntPtr.Zero, 0))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "ConPTY output pipe failed");

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

        if (!UpdateProcThreadAttribute(
                _attrList,
                0,
                (IntPtr)ProcThreadAttributePseudoConsole,
                _hPC,
                (IntPtr)IntPtr.Size,
                IntPtr.Zero,
                IntPtr.Zero))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "UpdateProcThreadAttribute PSEUDOCONSOLE failed");

        var si = new StartupInfoEx
        {
            StartupInfo = new StartupInfo
            {
                cb = Marshal.SizeOf<StartupInfoEx>(),
            },
            lpAttributeList = _attrList,
        };

        var cmd = new System.Text.StringBuilder(commandLine);
        const uint createUnicodeEnvironment = 0x00000400;
        if (!CreateProcess(
                null,
                cmd,
                IntPtr.Zero,
                IntPtr.Zero,
                false,
                ExtendedStartupInfoPresent | createUnicodeEnvironment,
                IntPtr.Zero,
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

    private async Task PumpOutputAsync(CancellationToken ct)
    {
        var read = _outputRead;
        if (read == null || read.IsInvalid) return;
        _outputRead = null; // FileStream owns the handle for the pump lifetime
        await using var stream = new FileStream(read, FileAccess.Read, 4096, isAsync: true);
        var buf = new byte[4096];
        try
        {
            while (!ct.IsCancellationRequested)
            {
                var n = await stream.ReadAsync(buf.AsMemory(0, buf.Length), ct).ConfigureAwait(false);
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
        return $"\"{shell}\" -NoLogo";
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

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CreatePipe(out SafeFileHandle hReadPipe, out SafeFileHandle hWritePipe, IntPtr lpPipeAttributes, int nSize);

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
