using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Windows;
using Flow.Launcher.Plugin;

namespace Flow.Launcher.Plugin.BNDZ
{
    public class Main : IPlugin
    {
        private static PluginInitContext _context;

        public void Init(PluginInitContext context)
        {
            _context = context;
            BndzBranding.ScheduleApply(context);
        }

        public List<Result> Query(Query query)
        {
            var search = (query.Search ?? string.Empty).Trim();
            var results = new List<Result>();

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

            if (results.Count == 0 && search.Contains("bndz", StringComparison.OrdinalIgnoreCase))
            {
                results.Add(MakeResult(
                    "Open BNDZ File Manager",
                    "Full workspace for advanced file management",
                    () => OpenInBndz()));
            }

            return results;
        }

        private static Result MakeResult(string title, string subtitle, Action action)
        {
            return new Result
            {
                Title = title,
                SubTitle = subtitle,
                IcoPath = "Images\\bndz.png",
                Score = 120,
                Action = _ =>
                {
                    action();
                    return true;
                }
            };
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

    }
}
