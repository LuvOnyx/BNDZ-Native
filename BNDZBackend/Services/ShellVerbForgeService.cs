using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Win32;

namespace BNDZ.Services;

public sealed class ShellVerbForgeEntry
{
    public string Id { get; set; } = "";
    public string Label { get; set; } = "";
    public string VerbKey { get; set; } = "";
    /// <summary>* | Directory | Directory\Background</summary>
    public string TargetClass { get; set; } = "*";
  public string ArgTemplate { get; set; } = "--open-path \"%1\"";
    public string Icon { get; set; } = "";
    public bool Deployed { get; set; }
}

public sealed class ShellVerbForgeDeployResult
{
    public bool Ok { get; set; }
    public string Message { get; set; } = "";
}

public sealed class ShellVerbForgeService
{
    private const int ShcneAssocChanged = 0x08000000;
    private const uint ShcnfIdList = 0x0000;
    private static readonly JsonSerializerOptions JsonOpts = new() { WriteIndented = true };

    private static readonly Lazy<ShellVerbForgeService> Lazy = new(() => new ShellVerbForgeService());
    public static ShellVerbForgeService Instance => Lazy.Value;

    private readonly string _storePath;
    private List<ShellVerbForgeEntry> _entries = new();
    private readonly object _gate = new();

    private ShellVerbForgeService()
    {
        var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BNDZ");
        Directory.CreateDirectory(dir);
        _storePath = Path.Combine(dir, "verb-forge.json");
        Load();
    }

    [DllImport("shell32.dll")]
    private static extern void SHChangeNotify(int wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);

    public IReadOnlyList<ShellVerbForgeEntry> List() => _entries.ToList();

    public ShellVerbForgeEntry Save(ShellVerbForgeEntry entry)
    {
        lock (_gate)
        {
            entry.Id = string.IsNullOrWhiteSpace(entry.Id) ? Guid.NewGuid().ToString("N") : entry.Id;
            entry.VerbKey = SanitizeVerbKey(entry.VerbKey, entry.Label, entry.Id);
            entry.TargetClass = NormalizeTargetClass(entry.TargetClass);
            if (string.IsNullOrWhiteSpace(entry.ArgTemplate))
                entry.ArgTemplate = "--open-path \"%1\"";

            var idx = _entries.FindIndex(e => e.Id == entry.Id);
            if (idx >= 0)
                _entries[idx] = entry;
            else
                _entries.Add(entry);

            Persist();
            return entry;
        }
    }

    public bool Remove(string id)
    {
        lock (_gate)
        {
            var entry = _entries.FirstOrDefault(e => e.Id == id);
            if (entry == null) return false;
            if (entry.Deployed)
                UnregisterVerb(entry);
            _entries.RemoveAll(e => e.Id == id);
            Persist();
            return true;
        }
    }

    public ShellVerbForgeDeployResult Deploy(string id)
    {
        lock (_gate)
        {
            var entry = _entries.FirstOrDefault(e => e.Id == id);
            if (entry == null)
                return new ShellVerbForgeDeployResult { Ok = false, Message = "Verb not found." };

            try
            {
                RegisterVerb(entry);
                entry.Deployed = true;
                Persist();
                SHChangeNotify(ShcneAssocChanged, ShcnfIdList, IntPtr.Zero, IntPtr.Zero);
                return new ShellVerbForgeDeployResult { Ok = true, Message = $"Deployed {entry.Label} to Explorer." };
            }
            catch (Exception ex)
            {
                return new ShellVerbForgeDeployResult { Ok = false, Message = ex.Message };
            }
        }
    }

    public ShellVerbForgeDeployResult Undeploy(string id)
    {
        lock (_gate)
        {
            var entry = _entries.FirstOrDefault(e => e.Id == id);
            if (entry == null)
                return new ShellVerbForgeDeployResult { Ok = false, Message = "Verb not found." };

            try
            {
                UnregisterVerb(entry);
                entry.Deployed = false;
                Persist();
                SHChangeNotify(ShcneAssocChanged, ShcnfIdList, IntPtr.Zero, IntPtr.Zero);
                return new ShellVerbForgeDeployResult { Ok = true, Message = $"Removed {entry.Label} from Explorer." };
            }
            catch (Exception ex)
            {
                return new ShellVerbForgeDeployResult { Ok = false, Message = ex.Message };
            }
        }
    }

    private void Load()
    {
        try
        {
            if (!File.Exists(_storePath)) return;
            var json = File.ReadAllText(_storePath);
            var list = JsonSerializer.Deserialize<List<ShellVerbForgeEntry>>(json);
            if (list != null)
                _entries = list;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[VerbForge] load: {ex.Message}");
            _entries = new List<ShellVerbForgeEntry>();
        }
    }

    private void Persist()
    {
        try
        {
            File.WriteAllText(_storePath, JsonSerializer.Serialize(_entries, JsonOpts));
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[VerbForge] persist: {ex.Message}");
        }
    }

    private static string SanitizeVerbKey(string verbKey, string label, string id)
    {
        if (!string.IsNullOrWhiteSpace(verbKey))
        {
            var k = verbKey.Trim();
            foreach (var c in Path.GetInvalidFileNameChars())
                k = k.Replace(c, '_');
            return k.Length > 48 ? k[..48] : k;
        }
        var fromLabel = label.Trim().Replace(' ', '_');
        if (string.IsNullOrWhiteSpace(fromLabel))
            return "BNDZ_Verb_" + id[..8];
        return fromLabel.Length > 48 ? fromLabel[..48] : fromLabel;
    }

    private static string NormalizeTargetClass(string target)
    {
        if (string.Equals(target, "directory", StringComparison.OrdinalIgnoreCase)
            || string.Equals(target, "folder", StringComparison.OrdinalIgnoreCase))
            return "Directory";
        if (string.Equals(target, "background", StringComparison.OrdinalIgnoreCase))
            return "Directory\\Background";
        return "*";
    }

    private static string ExePath() =>
        Process.GetCurrentProcess().MainModule?.FileName
        ?? Environment.ProcessPath
        ?? AppDomain.CurrentDomain.FriendlyName;

    private static string RegistryShellPath(ShellVerbForgeEntry entry) =>
        $"{entry.TargetClass}\\shell\\BNDZ_VerbForge_{entry.VerbKey}";

    private void RegisterVerb(ShellVerbForgeEntry entry)
    {
        var exe = ExePath();
        var shellPath = RegistryShellPath(entry);
        using var classes = Registry.CurrentUser.CreateSubKey(@"Software\Classes");
        using var verbKey = classes.CreateSubKey(shellPath);
        verbKey.SetValue("MUIVerb", entry.Label);
        if (!string.IsNullOrWhiteSpace(entry.Icon) && File.Exists(entry.Icon.Split(',')[0]))
            verbKey.SetValue("Icon", entry.Icon);
        else
            verbKey.SetValue("Icon", $"\"{exe}\",0");

        var cmd = BuildCommand(exe, entry);
        using var openKey = verbKey.CreateSubKey("command");
        openKey.SetValue("", cmd);
    }

    private void UnregisterVerb(ShellVerbForgeEntry entry)
    {
        var shellPath = RegistryShellPath(entry);
        using var classes = Registry.CurrentUser.OpenSubKey(@"Software\Classes", writable: true);
        if (classes == null) return;
        try { classes.DeleteSubKeyTree(shellPath, false); } catch { }
    }

    private static string BuildCommand(string exe, ShellVerbForgeEntry entry)
    {
        var template = entry.ArgTemplate;
        if (entry.TargetClass.Equals("Directory\\Background", StringComparison.OrdinalIgnoreCase))
            template = template.Replace("\"%1\"", "\"%V\"").Replace("%1", "%V");
        if (!template.Contains("%1") && !template.Contains("%V"))
            template = template.TrimEnd() + " \"%1\"";
        return $"\"{exe}\" {template}";
    }
}
