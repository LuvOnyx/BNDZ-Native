namespace BNDZ.Services.Mesh;

/// <summary>Lazy singleton for mesh orchestrator (wired from MainWindow).</summary>
public static class BndzMeshOrchestratorHolder
{
    private static BndzMeshOrchestrator? _instance;

    public static BndzMeshOrchestrator Instance => _instance ??= new BndzMeshOrchestrator();

    public static void Reset(BndzMeshOrchestrator? orchestrator = null) => _instance = orchestrator;
}
