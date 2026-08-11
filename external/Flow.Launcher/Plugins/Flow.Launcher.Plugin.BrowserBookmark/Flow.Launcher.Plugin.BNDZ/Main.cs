using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Windows;
using Flow.Launcher.Plugin;

namespace Flow.Launcher.Plugin.BNDZ
{
    public class Main : IPlugin, IDisposable
    {
        private static PluginInitContext _context;
        private static BndzClipboardStore? _clipboard;
        private static BndzSnippetStore? _snippets;
        private static BndzQuickLinkStore? _quickLinks;

        public void Init(PluginInitContext context)
        {
            _context = context;
            BndzBranding.ScheduleApply(context);
            BndzShellBridge.ScheduleHandoff(context);
            BndzFlowQueryBridge.Start(context);
            BndzPendingActions.Process(context);
            try
            {
                var userData = ResolveUserDataDir();
                _clipboard = new BndzClipboardStore(userData);
                _snippets = new BndzSnippetStore(userData);
                _quickLinks = new BndzQuickLinkStore(userData);
            }
            catch (Exception ex)
            {
                context.API.LogError(nameof(Main), $"BNDZ store init failed: {ex.Message}");
            }
        }

        public List<Result> Query(Query query)
        {
            BndzPendingActions.Process(_context);
            var search = (query.Search ?? string.Empty).Trim();
            var results = new List<Result>();
            var home = query.IsHomeQuery || string.IsNullOrEmpty(search);
            var qLower = search.ToLowerInvariant();

            if (!home
                && !qLower.Contains("bndz")
                && !qLower.Contains("clip")
                && !qLower.Contains("snippet")
                && !qLower.Contains("quick")
                && !qLower.Contains("link")
                && !BndzSystemCommands.Match(search).Any())
                return results;

            foreach (var cmd in BndzSystemCommands.Match(search))
            {
                if (cmd.Id == "system-clipboard-manager")
                {
                    results.Add(MakeResult(cmd.Title, cmd.Subtitle, "Images\\copylink.png", cmd.Score, () => { }));
                    AppendClipboardResults(results, search);
                    continue;
                }
                if (cmd.Id == "system-open-settings")
                {
                    results.Add(MakeResult(cmd.Title, cmd.Subtitle, "Images\\settings.png", cmd.Score,
                        () => _context?.API.OpenSettingDialog()));
                    continue;
                }
                if (cmd.Id == "system-search-snippets")
                {
                    results.Add(MakeResult(cmd.Title, cmd.Subtitle, "Images\\work.png", cmd.Score, () => { }));
                    AppendSnippetResults(results, search);
                    continue;
                }
                if (cmd.Id == "system-search-quicklinks")
                {
                    results.Add(MakeResult(cmd.Title, cmd.Subtitle, "Images\\Link.png", cmd.Score, () => { }));
                    AppendQuickLinkResults(results, search);
                    continue;
                }
                if (cmd.Id == "system-cursor-prompt" || cmd.Id == "system-ai-chat")
                {
                    results.Add(MakeResult(cmd.Title, cmd.Subtitle, "Images\\bndz.png", cmd.Score, () => { }));
                    continue;
                }
                if (cmd.Id == "system-open-extensions" || cmd.Id == "system-open-plugin-store")
                {
                    results.Add(MakeResult(cmd.Title, cmd.Subtitle, "Images\\plugins.png", cmd.Score,
                        () => _context?.API.OpenSettingDialog()));
                    continue;
                }
                if (cmd.Id == "system-file-search" || cmd.Id == "system-search-files" || cmd.Id == "system-search-notes" || cmd.Id == "system-window-management")
                {
                    results.Add(MakeResult(cmd.Title, cmd.Subtitle, "Images\\bndz.png", cmd.Score, () => { }));
                    continue;
                }
            }

            if (string.IsNullOrEmpty(search) || search.Equals("bndz", StringComparison.OrdinalIgnoreCase))
            {
                results.Add(MakeResult(
                    "Open BNDZ File Manager",
                    "Launch the full dual-pane BNDZ workspace",
                    () => OpenInBndz()));
            }

            if (search.StartsWith("bndz ", StringComparison.OrdinalIgnoreCase))
            {
                var path = search.Substring(5).Trim().Trim('"');
                if (!string.IsNullOrWhiteSpace(path))
                {
                    results.Add(MakeResult(
                        $"Open in BNDZ — {path}",
                        "Navigate to this location in BNDZ File Manager",
                        () => OpenInBndz(path)));
                }
            }

            if (results.Count == 0 && (qLower.Contains("bndz") || qLower.Contains("clip") || qLower.Contains("snippet") || qLower.Contains("quick")))
            {
                if (qLower.Contains("bndz"))
                {
                    results.Add(MakeResult(
                        "Open BNDZ File Manager",
                        "Full workspace for advanced file management",
                        () => OpenInBndz()));
                }
                if (qLower.Contains("clip"))
                    AppendClipboardResults(results, search);
                if (qLower.Contains("snippet"))
                    AppendSnippetResults(results, search);
                if (qLower.Contains("quick") || qLower.Contains("link"))
                    AppendQuickLinkResults(results, search);
            }

            return results;
        }

        private static void AppendSnippetResults(List<Result> results, string search)
        {
            if (_snippets == null) return;
            var q = search.StartsWith("snippet", StringComparison.OrdinalIgnoreCase)
                ? search.Substring(7).Trim()
                : search;
            foreach (var item in _snippets.Search(q))
            {
                var id = item.Id;
                results.Add(MakeResult(
                    item.Name,
                    string.IsNullOrEmpty(item.Keyword) ? "Snippet · click to paste" : $"Snippet · {item.Keyword}",
                    "Images\\work.png",
                    72,
                    () => _snippets.PasteSnippet(id)));
            }
        }

        private static void AppendQuickLinkResults(List<Result> results, string search)
        {
            if (_quickLinks == null) return;
            var q = search;
            foreach (var item in _quickLinks.Search(q))
            {
                var id = item.Id;
                var queryArg = search.Contains(' ') ? search.Split(' ').Last() : "";
                results.Add(MakeResult(
                    item.Name,
                    item.UrlTemplate,
                    "Images\\Link.png",
                    70,
                    () => _quickLinks.Open(id, queryArg)));
            }
        }

        private static void AppendClipboardResults(List<Result> results, string search)
        {
            if (_clipboard == null) return;
            var clipQ = search.StartsWith("clip", StringComparison.OrdinalIgnoreCase)
                ? search.Substring(4).Trim()
                : search;
            foreach (var item in _clipboard.Search(clipQ))
            {
                var id = item.Id;
                results.Add(MakeResult(
                    item.Preview,
                    "Clipboard · click to paste",
                    "Images\\bndz.png",
                    70,
                    () => _clipboard.CopyToClipboard(id)));
            }
        }

        private static Result MakeResult(string title, string subtitle, Action action) =>
            MakeResult(title, subtitle, "Images\\bndz.png", 120, action);

        private static Result MakeResult(string title, string subtitle, string icon, int score, Action action)
        {
            return new Result
            {
                Title = title,
                SubTitle = subtitle,
                IcoPath = icon,
                Score = score,
                Action = _ =>
                {
                    action();
                    return true;
                }
            };
        }

        private static void ShowComingSoon(string feature)
        {
            _context?.API.ShowMsgBox(
                $"{feature} is being ported from SuperCmd. Available in the next BNDZ Launcher update.",
                "BNDZ Launcher",
                MessageBoxButton.OK,
                MessageBoxImage.Information);
        }

        private static string ResolveUserDataDir()
        {
            var pluginDir = Path.GetDirectoryName(typeof(Main).Assembly.Location) ?? "";
            var launcherDir = Directory.GetParent(pluginDir)?.Parent?.FullName ?? pluginDir;
            return Path.Combine(launcherDir, "UserData");
        }

        private static string ResolveBndzExe()
        {
            var publishRoot = ResolvePublishRoot();
            return Path.Combine(publishRoot, "BNDZ.exe");
        }

        private static string ResolvePublishRoot()
        {
            var pluginDir = Path.GetDirectoryName(typeof(Main).Assembly.Location) ?? "";
            var launcherDir = Directory.GetParent(pluginDir)?.Parent?.FullName ?? pluginDir;
            return Directory.GetParent(launcherDir)?.FullName ?? launcherDir;
        }

        private static void OpenInBndz(string path = null)
        {
            if (!string.IsNullOrWhiteSpace(path))
            {
                if (BndzIpcClient.TrySendOpenPath(path))
                    return;
            }
            else if (BndzIpcClient.TrySendShow())
            {
                return;
            }

            var exe = ResolveBndzExe();
            if (!File.Exists(exe))
            {
                _context?.API.ShowMsgBox(
                    "BNDZ.exe was not found next to the launcher. Reinstall BNDZ or open BNDZ from the Start Menu.",
                    "BNDZ File Manager",
                    MessageBoxButton.OK,
                    MessageBoxImage.Error);
                return;
            }

            var args = string.IsNullOrWhiteSpace(path) ? "" : $"--open-path \"{path}\"";
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = exe,
                    Arguments = args,
                    UseShellExecute = true,
                    WorkingDirectory = Path.GetDirectoryName(exe) ?? ResolvePublishRoot(),
                });
            }
            catch (Exception ex)
            {
                _context?.API.LogError(nameof(Main), $"Failed to start BNDZ: {ex.Message}");
            }
        }

        public void Dispose()
        {
            BndzFlowQueryBridge.Stop();
            _clipboard?.Dispose();
            _clipboard = null;
        }
    }
}
