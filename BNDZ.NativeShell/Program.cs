using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using WinRT;

namespace BNDZ.NativeShell;

/// <summary>Custom main for unpackaged WinUI (DISABLE_XAML_GENERATED_MAIN).</summary>
public static class Program
{
    [STAThread]
    public static void Main(string[] args)
    {
        _ = args;
        ComWrappersSupport.InitializeComWrappers();
        Application.Start(static p =>
        {
            var context = new DispatcherQueueSynchronizationContext(
                DispatcherQueue.GetForCurrentThread());
            SynchronizationContext.SetSynchronizationContext(context);
            _ = new App();
        });
    }
}
