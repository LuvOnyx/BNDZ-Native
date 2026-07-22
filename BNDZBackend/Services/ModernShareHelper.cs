using System.Runtime.InteropServices;
using System.Windows.Interop;
using Windows.ApplicationModel.DataTransfer;
using Windows.Storage;
using WinRT;

namespace BNDZ.Services;

/// <summary>
/// Hosts the Windows 10+ Share UI for one or more filesystem paths (WPF hwnd).
/// </summary>
internal static class ModernShareHelper
{
    [ComImport]
    [Guid("3A3DCD6C-3EAB-43DC-BCDE-45671CE800C8")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IDataTransferManagerInterop
    {
        IntPtr GetForWindow(IntPtr appWindow, ref Guid riid);
        void ShowShareUIForWindow(IntPtr appWindow);
    }

    public static bool TryShowShareUi(IntPtr hwnd, IReadOnlyList<string> paths)
    {
        if (hwnd == IntPtr.Zero || paths == null || paths.Count == 0)
            return false;

        var existing = paths
            .Where(p => !string.IsNullOrWhiteSpace(p) && (File.Exists(p) || Directory.Exists(p)))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(32)
            .ToList();
        if (existing.Count == 0) return false;

        try
        {
            var interop = DataTransferManager.As<IDataTransferManagerInterop>();
            var dtmIid = new Guid("a5caee9b-8708-49d1-8d36-67d25a8da00c");
            var abi = interop.GetForWindow(hwnd, ref dtmIid);
            var manager = MarshalInterface<DataTransferManager>.FromAbi(abi);

            void OnDataRequested(DataTransferManager sender, DataRequestedEventArgs args)
            {
                try
                {
                    var request = args.Request;
                    var deferral = request.GetDeferral();
                    try
                    {
                        var data = request.Data;
                        data.Properties.Title = existing.Count == 1
                            ? Path.GetFileName(existing[0].TrimEnd('\\'))
                            : $"{existing.Count} items";
                        data.Properties.Description = "Shared from BNDZ";

                        var storageItems = new List<IStorageItem>();
                        foreach (var path in existing)
                        {
                            try
                            {
                                if (File.Exists(path))
                                    storageItems.Add(StorageFile.GetFileFromPathAsync(path).AsTask().GetAwaiter().GetResult());
                                else if (Directory.Exists(path))
                                    storageItems.Add(StorageFolder.GetFolderFromPathAsync(path).AsTask().GetAwaiter().GetResult());
                            }
                            catch
                            {
                                // Skip items the Share broker cannot open.
                            }
                        }

                        if (storageItems.Count == 0)
                        {
                            request.FailWithDisplayText("Nothing available to share.");
                            return;
                        }

                        data.SetStorageItems(storageItems, readOnly: true);
                    }
                    finally
                    {
                        deferral.Complete();
                    }
                }
                catch (Exception ex)
                {
                    System.Diagnostics.Debug.WriteLine($"[Share] DataRequested failed: {ex.Message}");
                    try { args.Request.FailWithDisplayText("Could not prepare share payload."); } catch { }
                }
                finally
                {
                    manager.DataRequested -= OnDataRequested;
                }
            }

            manager.DataRequested += OnDataRequested;
            interop.ShowShareUIForWindow(hwnd);
            return true;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[Share] ShowShareUI failed: {ex.Message}");
            return false;
        }
    }

    public static bool TryShowShareUiForActiveWindow(IReadOnlyList<string> paths)
    {
        var hwnd = IntPtr.Zero;
        try
        {
            if (System.Windows.Application.Current?.MainWindow is System.Windows.Window win)
                hwnd = new WindowInteropHelper(win).Handle;
        }
        catch { /* headless / tearing down */ }
        return TryShowShareUi(hwnd, paths);
    }
}
