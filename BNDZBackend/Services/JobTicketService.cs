using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BNDZ.Services;

/// <summary>
/// Production job tickets with SLA due dates — JSON store under %LocalAppData%/BNDZ/JobTickets/.
/// </summary>
public sealed class JobTicketService
{
    private static readonly Lazy<JobTicketService> Lazy = new(() => new JobTicketService());
    public static JobTicketService Instance => Lazy.Value;

    private static readonly JsonSerializerOptions Json = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly string _root;
    private readonly string _storeFile;
    private readonly object _lock = new();
    private List<JobTicket> _tickets = new();

    private JobTicketService()
    {
        _root = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "BNDZ", "JobTickets");
        _storeFile = Path.Combine(_root, "tickets.json");
        Directory.CreateDirectory(_root);
        Load();
    }

    private void Load()
    {
        try
        {
            if (!File.Exists(_storeFile)) return;
            _tickets = JsonSerializer.Deserialize<List<JobTicket>>(File.ReadAllText(_storeFile), Json) ?? new();
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[JobTicket] Load: {ex.Message}");
            _tickets = new();
        }
    }

    private void Persist()
    {
        File.WriteAllText(_storeFile, JsonSerializer.Serialize(_tickets, Json));
    }

    public IReadOnlyList<JobTicket> List(string? folderPath = null)
    {
        lock (_lock)
        {
            if (string.IsNullOrWhiteSpace(folderPath))
                return _tickets.OrderBy(t => t.DueUtc).ToList();

            var norm = NormalizeFolder(folderPath);
            return _tickets
                .Where(t => string.Equals(NormalizeFolder(t.FolderPath), norm, StringComparison.OrdinalIgnoreCase))
                .OrderBy(t => t.DueUtc)
                .ToList();
        }
    }

    public JobTicket Save(JobTicket ticket)
    {
        if (string.IsNullOrWhiteSpace(ticket.FolderPath))
            throw new ArgumentException("folderPath required.");
        if (string.IsNullOrWhiteSpace(ticket.Title))
            throw new ArgumentException("title required.");

        lock (_lock)
        {
            ticket.FolderPath = NormalizeFolder(ticket.FolderPath);
            ticket.UpdatedUtc = DateTime.UtcNow.ToString("o");
            if (string.IsNullOrWhiteSpace(ticket.Id))
            {
                ticket.Id = Guid.NewGuid().ToString("N");
                ticket.CreatedUtc = ticket.UpdatedUtc;
            }
            if (string.IsNullOrWhiteSpace(ticket.Status))
                ticket.Status = "open";

            var idx = _tickets.FindIndex(t => t.Id == ticket.Id);
            if (idx >= 0) _tickets[idx] = ticket;
            else _tickets.Add(ticket);

            Persist();
            return ticket;
        }
    }

    public bool Delete(string ticketId)
    {
        if (string.IsNullOrWhiteSpace(ticketId)) return false;
        lock (_lock)
        {
            var removed = _tickets.RemoveAll(t => t.Id == ticketId) > 0;
            if (removed) Persist();
            return removed;
        }
    }

    public JobTicketOverdueInfo? GetOverdueForFolder(string folderPath)
    {
        var norm = NormalizeFolder(folderPath);
        lock (_lock)
        {
            var now = DateTime.UtcNow;
            var open = _tickets
                .Where(t => string.Equals(NormalizeFolder(t.FolderPath), norm, StringComparison.OrdinalIgnoreCase)
                            && !string.Equals(t.Status, "done", StringComparison.OrdinalIgnoreCase)
                            && !string.Equals(t.Status, "cancelled", StringComparison.OrdinalIgnoreCase))
                .ToList();
            if (open.Count == 0) return null;

            var overdue = open.Where(t => DateTime.TryParse(t.DueUtc, out var due) && due < now).ToList();
            if (overdue.Count == 0) return null;

            var earliest = overdue.OrderBy(t => t.DueUtc).First();
            return new JobTicketOverdueInfo
            {
                FolderPath = norm,
                Count = overdue.Count,
                EarliestDueUtc = earliest.DueUtc,
                Title = earliest.Title,
            };
        }
    }

    public Dictionary<string, JobTicketOverdueInfo> GetOverdueMapForFolders(IEnumerable<string> folderPaths)
    {
        var result = new Dictionary<string, JobTicketOverdueInfo>(StringComparer.OrdinalIgnoreCase);
        foreach (var path in folderPaths ?? Array.Empty<string>())
        {
            var info = GetOverdueForFolder(path);
            if (info != null)
                result[NormalizeFolder(path)] = info;
        }
        return result;
    }

    private static string NormalizeFolder(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return "";
        var p = path.Replace('/', '\\').Trim().TrimEnd('\\');
        try { return Path.GetFullPath(p); }
        catch { return p; }
    }
}

public sealed class JobTicket
{
    public string Id { get; set; } = "";
    public string FolderPath { get; set; } = "";
    public string Title { get; set; } = "";
    public string DueUtc { get; set; } = "";
    public string Status { get; set; } = "open";
    public string? Notes { get; set; }
    public string CreatedUtc { get; set; } = "";
    public string UpdatedUtc { get; set; } = "";
}

public sealed class JobTicketOverdueInfo
{
    public string FolderPath { get; set; } = "";
    public int Count { get; set; }
    public string EarliestDueUtc { get; set; } = "";
    public string Title { get; set; } = "";
}
