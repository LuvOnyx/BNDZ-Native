using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace BNDZ.Services;

/// <summary>
/// Unpackaged-desktop Windows toast with a live progress bar (Adaptive progress).
/// Needs a Start Menu shortcut stamped with AppUserModelID BNDZ.FileManager.
/// Failures land in <see cref="Blocker"/> — this never pretends a balloon is a progress toast.
/// </summary>
public static class ToastOsProgress
{
    public const string AppId = "BNDZ.FileManager";
    private const string Tag = "bndz-xfer";
    private const string Group = "transfers";

    private static readonly object Gate = new();
    private static int _seq = 1;
    private static bool _shown;
    private static bool _aumidReady;
    private static string? _blocker;
    private static int _clearGeneration;

    public static string? Blocker => _blocker;

    public static void Apply(string? phase, string? title, string? detail, double? progressPercent, string? valueString, string? status)
    {
        _ = detail;
        var p = (phase ?? "update").Trim().ToLowerInvariant();
        if (p is "clear" or "dismiss")
        {
            Clear();
            return;
        }

        var pct = progressPercent ?? (p == "complete" ? 100 : 0);
        var value = Math.Clamp(pct / 100.0, 0, 1);
        var shownStatus = string.IsNullOrWhiteSpace(status)
            ? (p == "failed" ? "Failed" : p == "complete" ? "Done" : "Working")
            : status.Trim();
        var shownTitle = string.IsNullOrWhiteSpace(title) ? "BNDZ" : title.Trim();
        var shownValue = string.IsNullOrWhiteSpace(valueString) ? $"{Math.Round(pct)}%" : valueString.Trim();
        ShowOrUpdate(shownTitle, shownStatus, value, shownValue, terminal: p is "complete" or "failed", failed: p == "failed", depth: 0);
    }

    public static void Clear()
    {
        lock (Gate)
        {
            _clearGeneration++;
            _shown = false;
        }
        if (!_aumidReady || _blocker != null) return;
        try
        {
            Windows.UI.Notifications.ToastNotificationManager.History.Remove(Tag, Group, AppId);
        }
        catch (Exception ex)
        {
            Debug.WriteLine("[BNDZ toast-progress] clear: " + ex.Message);
        }
    }

    private static void ShowOrUpdate(string title, string status, double value01, string valueString, bool terminal, bool failed, int depth)
    {
        if (_blocker != null) return;
        try
        {
            EnsureAumid();
            if (_blocker != null) return;

            uint seq;
            bool first;
            int generation;
            lock (Gate)
            {
                _seq++;
                if (_seq <= 0) _seq = 1;
                seq = (uint)_seq;
                first = !_shown;
                _shown = true;
                generation = ++_clearGeneration;
            }

            var data = new Windows.UI.Notifications.NotificationData { SequenceNumber = seq };
            data.Values["progressTitle"] = Trunc(title, 100);
            data.Values["progressStatus"] = Trunc(status, 60);
            data.Values["progressValue"] = value01.ToString("0.###", CultureInfo.InvariantCulture);
            data.Values["progressValueString"] = Trunc(valueString, 80);

            var notifier = Windows.UI.Notifications.ToastNotificationManager.CreateToastNotifier(AppId);
            if (first)
            {
                var doc = new Windows.Data.Xml.Dom.XmlDocument();
                doc.LoadXml(ToastXml());
                var toast = new Windows.UI.Notifications.ToastNotification(doc)
                {
                    Tag = Tag,
                    Group = Group,
                    Data = data,
                };
                notifier.Show(toast);
            }
            else
            {
                var result = notifier.Update(data, Tag, Group);
                if (result == Windows.UI.Notifications.NotificationUpdateResult.NotificationNotFound && depth < 1)
                {
                    lock (Gate) { _shown = false; }
                    ShowOrUpdate(title, status, value01, valueString, terminal, failed, depth + 1);
                    return;
                }
            }

            if (terminal && !failed)
            {
                _ = Task.Run(async () =>
                {
                    await Task.Delay(2200).ConfigureAwait(false);
                    lock (Gate)
                    {
                        if (generation != _clearGeneration) return;
                        _shown = false;
                    }
                    try
                    {
                        Windows.UI.Notifications.ToastNotificationManager.History.Remove(Tag, Group, AppId);
                    }
                    catch { /* ignore */ }
                });
            }
        }
        catch (Exception ex)
        {
            NoteBlocker(ex);
        }
    }

    private static void NoteBlocker(Exception ex)
    {
        var msg = $"{ex.GetType().Name}: {ex.Message}";
        if (ex.HResult != 0) msg += $" (0x{ex.HResult:X8})";
        _blocker = msg;
        Debug.WriteLine("[BNDZ toast-progress] " + msg);
        BndzBootLog.Mark("os-toast-blocked " + msg);
    }

    private static string ToastXml() =>
        "<toast duration=\"long\"><visual><binding template=\"ToastGeneric\">" +
        "<text>BNDZ</text>" +
        "<progress title=\"{progressTitle}\" status=\"{progressStatus}\" value=\"{progressValue}\" valueStringOverride=\"{progressValueString}\"/>" +
        "</binding></visual></toast>";

    private static string Trunc(string value, int max) =>
        value.Length <= max ? value : value[..max];

    private static void EnsureAumid()
    {
        if (_aumidReady) return;
        var hr = SetCurrentProcessExplicitAppUserModelID(AppId);
        if (hr < 0)
            Marshal.ThrowExceptionForHR(hr);
        EnsureStartMenuShortcut();
        _aumidReady = _blocker == null;
    }

    private static void EnsureStartMenuShortcut()
    {
        var exe = Environment.ProcessPath;
        if (string.IsNullOrWhiteSpace(exe) || exe.EndsWith("dotnet.exe", StringComparison.OrdinalIgnoreCase))
        {
            _blocker = "Unpackaged host is not BNDZ.exe. Windows toast progress needs a Start Menu shortcut with AppUserModelID BNDZ.FileManager. WinUI AppNotification does not use this shortcut.";
            BndzBootLog.Mark("os-toast-blocked " + _blocker);
            return;
        }

        var programs = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
        Directory.CreateDirectory(programs);
        var lnk = Path.Combine(programs, "BNDZ File Manager.lnk");

        var link = (IShellLinkW)new CShellLink();
        link.SetPath(exe);
        var work = Path.GetDirectoryName(exe);
        if (!string.IsNullOrEmpty(work))
            link.SetWorkingDirectory(work);
        link.SetDescription("BNDZ File Manager");

        var store = (IPropertyStore)link;
        var key = PkeyAppUserModelId;
        var pv = new PropVariant { vt = 31, pointerValue = Marshal.StringToCoTaskMemUni(AppId) };
        try
        {
            store.SetValue(ref key, ref pv);
            store.Commit();
        }
        finally
        {
            if (pv.pointerValue != IntPtr.Zero)
                Marshal.FreeCoTaskMem(pv.pointerValue);
        }

        ((IPersistFile)link).Save(lnk, true);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int SetCurrentProcessExplicitAppUserModelID([MarshalAs(UnmanagedType.LPWStr)] string appId);

    private static readonly PropertyKey PkeyAppUserModelId = new()
    {
        fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),
        pid = 5,
    };

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    private struct PropertyKey
    {
        public Guid fmtid;
        public uint pid;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct PropVariant
    {
        [FieldOffset(0)] public ushort vt;
        [FieldOffset(8)] public IntPtr pointerValue;
    }

    [ComImport]
    [Guid("00021401-0000-0000-C000-000000000046")]
    private class CShellLink
    {
    }

    [ComImport]
    [Guid("000214F9-0000-0000-C000-000000000046")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellLinkW
    {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszFile, int cch, IntPtr pfd, uint fFlags);
        void GetIDList(out IntPtr ppidl);
        void SetIDList(IntPtr pidl);
        void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszName, int cch);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string pszName);
        void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszDir, int cch);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string pszDir);
        void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszArgs, int cch);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string pszArgs);
        void GetHotkey(out short pwHotkey);
        void SetHotkey(short wHotkey);
        void GetShowCmd(out int piShowCmd);
        void SetShowCmd(int iShowCmd);
        void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszIconPath, int cch, out int piIcon);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string pszIconPath, int iIcon);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string pszPathRel, uint dwReserved);
        void Resolve(IntPtr hwnd, uint fFlags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string pszFile);
    }

    [ComImport]
    [Guid("0000010b-0000-0000-C000-000000000046")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPersistFile
    {
        void GetClassID(out Guid pClassID);
        [PreserveSig] int IsDirty();
        void Load([MarshalAs(UnmanagedType.LPWStr)] string pszFileName, uint dwMode);
        void Save([MarshalAs(UnmanagedType.LPWStr)] string? pszFileName, bool fRemember);
        void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string pszFileName);
        void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string ppszFileName);
    }

    [ComImport]
    [Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPropertyStore
    {
        uint GetCount();
        void GetAt(uint iProp, out PropertyKey pkey);
        void GetValue(ref PropertyKey key, out PropVariant pv);
        void SetValue(ref PropertyKey key, ref PropVariant pv);
        void Commit();
    }
}
