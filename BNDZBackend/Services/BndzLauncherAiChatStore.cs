using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace BNDZ.Services;

/// <summary>SuperCmd ai-chat persistence — conversations under launcher UserData.</summary>
public sealed class BndzLauncherAiChatStore
{
    private readonly string _path;
    private AiChatSnapshot _snapshot = new();

    public BndzLauncherAiChatStore(string launcherUserDataDir)
    {
        var dir = Path.Combine(launcherUserDataDir, "BNDZ");
        Directory.CreateDirectory(dir);
        _path = Path.Combine(dir, "ai-chats.json");
        Load();
    }

    public AiChatSnapshot GetSnapshot() => _snapshot;

    public void Upsert(AiConversation conversation)
    {
        _snapshot.Conversations.RemoveAll(c => c.Id == conversation.Id);
        _snapshot.Conversations.Insert(0, conversation);
        _snapshot.Conversations = _snapshot.Conversations.Take(50).ToList();
        Save();
    }

    public void Delete(string id)
    {
        _snapshot.Conversations.RemoveAll(c => c.Id == id);
        Save();
    }

    private void Load()
    {
        if (!File.Exists(_path)) return;
        try
        {
            var snap = JsonSerializer.Deserialize<AiChatSnapshot>(File.ReadAllText(_path));
            if (snap != null) _snapshot = snap;
        }
        catch { }
    }

    private void Save()
    {
        File.WriteAllText(_path, JsonSerializer.Serialize(_snapshot, new JsonSerializerOptions { WriteIndented = true }));
    }
}

public sealed class AiChatSnapshot
{
    public List<AiConversation> Conversations { get; set; } = [];
}

public sealed class AiConversation
{
    public string Id { get; set; } = "";
    public string Title { get; set; } = "";
    public List<AiChatMessage> Messages { get; set; } = [];
    public long CreatedAt { get; set; }
    public long UpdatedAt { get; set; }
    public string Source { get; set; } = "local";
}

public sealed class AiChatMessage
{
    public string Id { get; set; } = "";
    public string Role { get; set; } = "user";
    public string Content { get; set; } = "";
    public long CreatedAt { get; set; }
    public bool Cancelled { get; set; }
}
