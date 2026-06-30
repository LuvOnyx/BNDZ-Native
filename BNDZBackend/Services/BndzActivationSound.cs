using System;
using System.Diagnostics;
using System.IO;
using System.Media;

namespace BNDZ.Services;

public static class BndzActivationSound
{
    private static SoundPlayer? _openSound;

    public static void PlayOpen()
    {
        try
        {
            foreach (var path in ResolveCandidatePaths())
            {
                if (!File.Exists(path)) continue;
                _openSound ??= new SoundPlayer(path);
                _openSound.Play();
                return;
            }
            SystemSounds.Asterisk.Play();
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[BndzActivationSound] {ex.Message}");
            try { SystemSounds.Asterisk.Play(); } catch { }
        }
    }

    private static IEnumerable<string> ResolveCandidatePaths()
    {
        var baseDir = AppContext.BaseDirectory;
        var launcherDir = BndzFlowLauncherService.Instance.LauncherDirectory;
        yield return Path.Combine(baseDir, "Resources", "open.wav");
        yield return Path.Combine(launcherDir, "Resources", "open.wav");
        yield return Path.Combine(launcherDir, "Sounds", "open.wav");
    }
}
