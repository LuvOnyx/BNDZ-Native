using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;

namespace BNDZ.Services;

/// <summary>Routes WebView2 launcher shell messages to BNDZ services (SuperCmd IPC port).</summary>
public sealed class LauncherShellBridge
{
    private readonly Action<string> _postJson;
    private readonly string _userDataDir;
    private readonly BndzSnippetStore _snippets;
    private readonly BndzQuickLinkStore _quickLinks;
    private readonly BndzNoteStore _notes;
    private readonly BndzLauncherAiChatStore _aiChats;

    public LauncherShellBridge(Action<string> postJson)
    {
        _postJson = postJson;
        _userDataDir = Path.Combine(BndzFlowLauncherService.Instance.LauncherDirectory, "UserData");
        _snippets = new BndzSnippetStore(_userDataDir);
        _quickLinks = new BndzQuickLinkStore(_userDataDir);
        _notes = new BndzNoteStore(_userDataDir);
        _aiChats = new BndzLauncherAiChatStore(_userDataDir);
    }

    public void Handle(JsonElement root)
    {
        var type = root.TryGetProperty("type", out var t) ? t.GetString() : null;
        var requestId = root.TryGetProperty("requestId", out var rid) ? rid.GetString() : "";

        switch (type)
        {
            case "AI_IS_AVAILABLE":
                Reply(requestId, "AI_IS_AVAILABLE_RESULT", new { available = BndzGeminiClient.IsConfigured });
                break;
            case "AI_CHAT_SNAPSHOT":
                Reply(requestId, "AI_CHAT_SNAPSHOT_RESULT", _aiChats.GetSnapshot());
                break;
            case "AI_CHAT_UPSERT":
                if (root.TryGetProperty("conversation", out var convEl))
                {
                    var conv = JsonSerializer.Deserialize<AiConversation>(convEl.GetRawText());
                    if (conv != null) _aiChats.Upsert(conv);
                }
                Reply(requestId, "AI_CHAT_UPSERT_RESULT", new { ok = true });
                break;
            case "AI_CHAT_DELETE":
                if (root.TryGetProperty("conversationId", out var delId))
                    _aiChats.Delete(delId.GetString() ?? "");
                Reply(requestId, "AI_CHAT_DELETE_RESULT", new { ok = true });
                break;
            case "AI_CHAT":
                _ = HandleAiChatAsync(root);
                break;
            case "AI_CANCEL":
                if (root.TryGetProperty("requestId", out var cancelId))
                    BndzGeminiClient.Cancel(cancelId.GetString() ?? "");
                break;
            case "SNIPPET_LIST":
                Reply(requestId, "SNIPPET_LIST_RESULT", _snippets.GetAll());
                break;
            case "SNIPPET_UPSERT":
                HandleSnippetUpsert(root, requestId);
                break;
            case "SNIPPET_DELETE":
                if (root.TryGetProperty("id", out var sid))
                    _snippets.Delete(sid.GetString() ?? "");
                Reply(requestId, "SNIPPET_DELETE_RESULT", new { ok = true });
                break;
            case "QUICKLINK_LIST":
                Reply(requestId, "QUICKLINK_LIST_RESULT", _quickLinks.GetAll());
                break;
            case "QUICKLINK_UPSERT":
                HandleQuickLinkUpsert(root, requestId);
                break;
            case "QUICKLINK_DELETE":
                if (root.TryGetProperty("id", out var qid))
                    _quickLinks.Delete(qid.GetString() ?? "");
                Reply(requestId, "QUICKLINK_DELETE_RESULT", new { ok = true });
                break;
            case "NOTE_LIST":
                Reply(requestId, "NOTE_LIST_RESULT", _notes.GetAll());
                break;
            case "NOTE_UPSERT":
                HandleNoteUpsert(root, requestId);
                break;
            case "NOTE_DELETE":
                if (root.TryGetProperty("id", out var nid))
                    _notes.Delete(nid.GetString() ?? "");
                Reply(requestId, "NOTE_DELETE_RESULT", new { ok = true });
                break;
            case "CLIPBOARD_LIST":
                Reply(requestId, "CLIPBOARD_LIST_RESULT", ReadClipboardHistory());
                break;
            case "CLIPBOARD_PASTE":
                if (root.TryGetProperty("id", out var clipPasteId))
                    PasteClipboard(clipPasteId.GetString() ?? "");
                Reply(requestId, "CLIPBOARD_PASTE_RESULT", new { ok = true });
                break;
            case "CLIPBOARD_DELETE":
                if (root.TryGetProperty("id", out var clipDelId))
                    DeleteClipboard(clipDelId.GetString() ?? "");
                Reply(requestId, "CLIPBOARD_DELETE_RESULT", new { ok = true });
                break;
            case "PLUGIN_LIST":
            {
                var plugins = BndzShellQueryClient.ListPlugins();
                var list = (plugins?.plugins ?? []).Select(p => new
                {
                    p.id,
                    name = BndzBrandingText.Sanitize(p.name),
                    p.version,
                    p.author,
                    description = BndzBrandingText.Sanitize(p.description),
                    p.actionKeyword,
                    p.disabled,
                }).ToList();
                Reply(requestId, "PLUGIN_LIST_RESULT", list);
                break;
            }
            case "OPEN_PLUGIN_STORE":
                BndzShellQueryClient.OpenPluginStore();
                Reply(requestId, "OPEN_PLUGIN_STORE_RESULT", new { ok = true });
                break;
        }
    }

    private List<ClipboardJsonEntry> ReadClipboardHistory()
    {
        var path = Path.Combine(_userDataDir, "BNDZ", "clipboard-history.json");
        if (!File.Exists(path)) return [];
        try
        {
            return JsonSerializer.Deserialize<List<ClipboardJsonEntry>>(File.ReadAllText(path)) ?? [];
        }
        catch { return []; }
    }

    private void PasteClipboard(string id)
    {
        var item = ReadClipboardHistory().FirstOrDefault(i => i.Id == id);
        if (item == null) return;
        try
        {
            if (item.Kind == "files" && item.FilePaths?.Count > 0)
            {
                var col = new System.Collections.Specialized.StringCollection();
                foreach (var p in item.FilePaths) col.Add(p);
                System.Windows.Forms.Clipboard.SetFileDropList(col);
                return;
            }
            if (item.Kind == "image" && !string.IsNullOrEmpty(item.ImagePath) && File.Exists(item.ImagePath))
            {
                using var img = System.Drawing.Image.FromFile(item.ImagePath);
                System.Windows.Forms.Clipboard.SetImage(img);
                return;
            }
            System.Windows.Forms.Clipboard.SetText(item.Content);
        }
        catch { }
    }

    private void DeleteClipboard(string id)
    {
        var path = Path.Combine(_userDataDir, "BNDZ", "clipboard-history.json");
        if (!File.Exists(path)) return;
        try
        {
            var list = JsonSerializer.Deserialize<List<ClipboardJsonEntry>>(File.ReadAllText(path)) ?? [];
            list.RemoveAll(i => i.Id == id);
            File.WriteAllText(path, JsonSerializer.Serialize(list, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch { }
    }

    private void HandleSnippetUpsert(JsonElement root, string? requestId)
    {
        string? id = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
        var name = root.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "";
        var content = root.TryGetProperty("content", out var c) ? c.GetString() ?? "" : "";
        var keyword = root.TryGetProperty("keyword", out var k) ? k.GetString() : null;
        var entry = _snippets.Upsert(id, name, content, keyword);
        Reply(requestId, "SNIPPET_UPSERT_RESULT", entry);
    }

    private void HandleQuickLinkUpsert(JsonElement root, string? requestId)
    {
        string? id = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
        var name = root.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "";
        var url = root.TryGetProperty("urlTemplate", out var u) ? u.GetString() ?? "" : "";
        var entry = _quickLinks.Upsert(id, name, url);
        Reply(requestId, "QUICKLINK_UPSERT_RESULT", entry);
    }

    private void HandleNoteUpsert(JsonElement root, string? requestId)
    {
        string? id = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
        var title = root.TryGetProperty("title", out var t) ? t.GetString() ?? "" : "";
        var content = root.TryGetProperty("content", out var c) ? c.GetString() ?? "" : "";
        var entry = _notes.Upsert(id, title, content);
        Reply(requestId, "NOTE_UPSERT_RESULT", entry);
    }

    private async Task HandleAiChatAsync(JsonElement root)
    {
        var requestId = root.TryGetProperty("requestId", out var rid) ? rid.GetString() ?? "" : "";
        if (string.IsNullOrEmpty(requestId)) return;

        var messages = new List<GeminiChatMessage>();
        if (root.TryGetProperty("messages", out var msgsEl) && msgsEl.ValueKind == JsonValueKind.Array)
        {
            foreach (var m in msgsEl.EnumerateArray())
            {
                messages.Add(new GeminiChatMessage
                {
                    Role = m.TryGetProperty("role", out var r) ? r.GetString() ?? "user" : "user",
                    Content = m.TryGetProperty("content", out var c) ? c.GetString() ?? "" : "",
                });
            }
        }

        await BndzGeminiClient.StreamChatAsync(
            requestId,
            messages,
            chunk => _postJson(JsonSerializer.Serialize(new { type = "AI_STREAM_CHUNK", requestId, chunk })),
            error => _postJson(JsonSerializer.Serialize(new { type = "AI_STREAM_ERROR", requestId, error })));

        _postJson(JsonSerializer.Serialize(new { type = "AI_STREAM_DONE", requestId }));
    }

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    private void Reply(string? requestId, string type, object? payload)
    {
        _postJson(JsonSerializer.Serialize(new { type, requestId, payload }, JsonOpts));
    }

    private sealed class ClipboardJsonEntry
    {
        public string Id { get; set; } = "";
        public string Kind { get; set; } = "text";
        public string Content { get; set; } = "";
        public string Preview { get; set; } = "";
        public List<string> FilePaths { get; set; } = [];
        public string? ImagePath { get; set; }
        public bool Pinned { get; set; }
        public long Timestamp { get; set; }
    }
}
