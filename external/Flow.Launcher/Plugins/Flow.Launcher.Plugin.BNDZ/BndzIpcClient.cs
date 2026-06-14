using System;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;

namespace Flow.Launcher.Plugin.BNDZ
{
    internal static class BndzIpcClient
    {
        private const string PipeName = "BNDZ.Launcher.IPC";
        private const int ConnectTimeoutMs = 2000;

        public static bool TrySendShow()
        {
            return TrySend(new { action = "show" });
        }

        public static bool TrySendOpenPath(string path)
        {
            return TrySend(new { action = "open_path", path });
        }

        private static bool TrySend(object payload)
        {
            try
            {
                using var client = new NamedPipeClientStream(".", PipeName, PipeDirection.Out);
                client.Connect(ConnectTimeoutMs);
                var json = JsonSerializer.Serialize(payload);
                var bytes = Encoding.UTF8.GetBytes(json + "\n");
                client.Write(bytes, 0, bytes.Length);
                client.Flush();
                return true;
            }
            catch
            {
                return false;
            }
        }
    }
}
