using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace BNDZ.Services.Mesh;

/// <summary>Spawns a real Windows console (conhost) and embeds it via SetParent.</summary>
internal sealed class BndzEmbeddedOsTerminal : IDisposable
{
    private const int GwlStyle = -16;
    private const int WsChild = 0x40000000;
    private const int WsVisible = 0x10000000;
    private const int WsCaption = 0x00C00000;
    private const int WsThickFrame = 0x00040000;
    private const int WsMinimizeBox = 0x00020000;
    private const int WsMaximizeBox = 0x00010000;
    private const int WsSysMenu = 0x00080000;
    private const int WsBorder = 0x00800000;
    private const int WsClipSiblings = 0x04000000;
    private const int WsClipChildren = 0x02000000;
    private const int SwpFrameChanged = 0x0020;
    private const int SwpShowWindow = 0x0040;
    private const int SwpNoZOrder = 0x0004;
    private const int SwShow = 5;
    private const uint CreateNewConsole = 0x00000010;
    private const int StartfUseShowWindow = 0x00000001;
    private const short SwHide = 0;

    private IntPtr _hostPanel = IntPtr.Zero;
    private IntPtr _consoleHwnd = IntPtr.Zero;
    private Process? _process;
    private readonly string _workingDirectory;

    private BndzEmbeddedOsTerminal(string workingDirectory) =>
        _workingDirectory = workingDirectory;

    public static BndzEmbeddedOsTerminal Start(string workingDirectory, IntPtr parentHwnd, int x, int y, int width, int height)
    {
        var term = new BndzEmbeddedOsTerminal(workingDirectory);
        term.EnsureHostPanel(parentHwnd, x, y, width, height);
        term.SpawnAndEmbed(width, height);
        return term;
    }

    public void Layout(IntPtr parentHwnd, int x, int y, int width, int height, bool visible)
    {
        EnsureHostPanel(parentHwnd, x, y, width, height);
        if (_hostPanel == IntPtr.Zero) return;

        if (!visible)
        {
            ShowWindow(_hostPanel, 0);
            return;
        }

        ShowWindow(_hostPanel, SwShow);
        MoveWindow(_hostPanel, x, y, Math.Max(80, width), Math.Max(60, height), true);
        if (_consoleHwnd != IntPtr.Zero)
            MoveWindow(_consoleHwnd, 0, 0, Math.Max(80, width), Math.Max(60, height), true);
    }

    public void Dispose()
    {
        try
        {
            if (_process is { HasExited: false })
                _process.Kill(entireProcessTree: true);
        }
        catch { /* ignore */ }

        if (_consoleHwnd != IntPtr.Zero)
        {
            try { SetParent(_consoleHwnd, IntPtr.Zero); } catch { /* ignore */ }
            _consoleHwnd = IntPtr.Zero;
        }

        if (_hostPanel != IntPtr.Zero)
        {
            try { DestroyWindow(_hostPanel); } catch { /* ignore */ }
            _hostPanel = IntPtr.Zero;
        }
    }

    private void EnsureHostPanel(IntPtr parentHwnd, int x, int y, int width, int height)
    {
        if (parentHwnd == IntPtr.Zero) return;

        if (_hostPanel == IntPtr.Zero)
        {
            _hostPanel = CreateWindowEx(
                0,
                "Static",
                "",
                WsChild | WsVisible | WsClipSiblings | WsClipChildren,
                x, y, Math.Max(80, width), Math.Max(60, height),
                parentHwnd,
                IntPtr.Zero,
                IntPtr.Zero,
                IntPtr.Zero);
            if (_hostPanel == IntPtr.Zero)
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Failed to create terminal host panel");
        }
        else
        {
            SetParent(_hostPanel, parentHwnd);
        }
    }

    private void SpawnAndEmbed(int width, int height)
    {
        if (_hostPanel == IntPtr.Zero) return;

        var shell = ResolveShellExecutable();
        var args = BuildShellArguments(_workingDirectory);
        var cmdLine = new StringBuilder($"\"{shell}\" {args}");

        var si = new StartupInfo
        {
            cb = Marshal.SizeOf<StartupInfo>(),
            dwFlags = StartfUseShowWindow,
            wShowWindow = SwHide,
        };

        if (!CreateProcess(
                null,
                cmdLine,
                IntPtr.Zero,
                IntPtr.Zero,
                false,
                CreateNewConsole,
                IntPtr.Zero,
                Directory.Exists(_workingDirectory) ? _workingDirectory : null,
                ref si,
                out var pi))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Failed to start shell process");

        try
        {
            _process = Process.GetProcessById(pi.dwProcessId);
            _process.EnableRaisingEvents = true;
        }
        catch
        {
            _process = null;
        }

        CloseHandle(pi.hThread);
        CloseHandle(pi.hProcess);

        _consoleHwnd = WaitForConsoleWindow(pi.dwProcessId, TimeSpan.FromSeconds(8));
        if (_consoleHwnd == IntPtr.Zero)
            throw new InvalidOperationException("Console window did not appear");

        SetParent(_consoleHwnd, _hostPanel);

        var style = GetWindowLong(_consoleHwnd, GwlStyle);
        style &= ~(WsCaption | WsThickFrame | WsSysMenu | WsMinimizeBox | WsMaximizeBox | WsBorder);
        style |= WsChild | WsVisible;
        SetWindowLong(_consoleHwnd, GwlStyle, style);

        SetWindowPos(_consoleHwnd, IntPtr.Zero, 0, 0, 0, 0, SwpFrameChanged | SwpShowWindow | SwpNoZOrder);
        MoveWindow(_consoleHwnd, 0, 0, Math.Max(80, width), Math.Max(60, height), true);
        ShowWindow(_hostPanel, SwShow);
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

    private static string BuildShellArguments(string workingDirectory)
    {
        if (string.IsNullOrWhiteSpace(workingDirectory) || !Directory.Exists(workingDirectory))
            return "-NoLogo -NoExit";

        var quoted = workingDirectory.Replace("'", "''");
        return $"-NoLogo -NoExit -Command \"Set-Location -LiteralPath '{quoted}'\"";
    }

    private static IntPtr WaitForConsoleWindow(int processId, TimeSpan timeout)
    {
        var sw = Stopwatch.StartNew();
        while (sw.Elapsed < timeout)
        {
            var hwnd = FindConsoleWindowForProcess(processId);
            if (hwnd != IntPtr.Zero) return hwnd;
            Thread.Sleep(50);
        }
        return IntPtr.Zero;
    }

    private static IntPtr FindConsoleWindowForProcess(int processId)
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows((hwnd, lParam) =>
        {
            if (!IsWindowVisible(hwnd)) return true;
            GetWindowThreadProcessId(hwnd, out var pid);
            if ((int)pid != processId) return true;
            var cls = GetClassName(hwnd);
            if (cls.Equals("ConsoleWindowClass", StringComparison.OrdinalIgnoreCase))
            {
                found = hwnd;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    private static string GetClassName(IntPtr hwnd)
    {
        var sb = new StringBuilder(256);
        _ = GetClassName(hwnd, sb, sb.Capacity);
        return sb.ToString();
    }

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public int cb;
        public string? lpReserved;
        public string? lpDesktop;
        public string? lpTitle;
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
    private struct ProcessInformation
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool MoveWindow(IntPtr hWnd, int x, int y, int nWidth, int nHeight, bool bRepaint);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyWindow(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateProcess(
        string? lpApplicationName,
        StringBuilder lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string? lpCurrentDirectory,
        ref StartupInfo lpStartupInfo,
        out ProcessInformation lpProcessInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateWindowEx(
        int dwExStyle,
        string lpClassName,
        string lpWindowName,
        int dwStyle,
        int x, int y, int nWidth, int nHeight,
        IntPtr hWndParent,
        IntPtr hMenu,
        IntPtr hInstance,
        IntPtr lpParam);
}
