using System;
using System.IO;
using System.Media;

namespace Flow.Launcher.Plugin.BNDZ
{
    internal static class BndzActivationSound
    {
        private static SoundPlayer? _openSound;

        public static void PlayOpen()
        {
            try
            {
                var path = Path.Combine(AppContext.BaseDirectory, "Resources", "open.wav");
                if (File.Exists(path))
                {
                    _openSound ??= new SoundPlayer(path);
                    _openSound.Play();
                    return;
                }
                SystemSounds.Asterisk.Play();
            }
            catch
            {
                try { SystemSounds.Asterisk.Play(); } catch { }
            }
        }
    }
}
