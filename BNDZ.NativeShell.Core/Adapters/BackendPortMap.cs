namespace BNDZ.NativeShell.Core.Adapters;

/// <summary>
/// Port map from spike adapters → existing BNDZBackend services.
/// Keep the WinUI/WPF shell bound to Core contracts; swap implementations here.
/// </summary>
public static class BackendPortMap
{
    // Module 2 — Navigation
    // IFolderCatalog  → BNDZBackend.Services.ShellFolderEnumerator (+ DirListingSharedBuffer)
    // IDriveCatalog   → BNDZBackend.Services.BndzNamespaceService / NetworkLocationsService

    // Module 3 — Preview
    // IPreviewBuilder → FilePreviewMetaService + NativeShellService property store batch

    // Module 4 — File ops
    // (new) IFileOps   → NativeShellFileOperationService / FileTransferQueueService

    // Module 5 — Search
    // (new) ISearch    → EverythingSearchService / WindowsSearchService / BndzFileIndexService

    // Module 6+ — Plugins / pillars
    // Bind each service behind a Core contract before adding XAML chrome.
}
