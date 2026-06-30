using System;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using System.Threading;

namespace Flow.Launcher.Plugin.BNDZ
{
    internal static class BndzIpcClient
    {
        private const string PipeName = "BNDZ.Launcher.IPC";
        private const int ConnectTimeoutMs = 800;
        private const int MaxAttempts = 6;
        private const int RetryDelayMs = 35;

        public static bool TrySendShowShell() => TrySend(new { action = "show_shell" });

        public static bool TrySendToggleShell() => TrySend(new { action = "toggle_shell" });

        public static bool TrySendHideShell() => TrySend(new { action = "hide_shell" });

        public static bool TrySendShow() => TrySend(new { action = "show" });

        public static bool TrySendOpenPath(string path) => TrySend(new { action = "open_path", path });

        private static bool TrySend(object payload)
        {
            for (var attempt = 0; attempt < MaxAttempts; attempt++)
            {
                if (attempt > 0)
                    Thread.Sleep(RetryDelayMs);

                if (TrySendOnce(payload))
                    return true;
            }
            return false;
        }

        private static bool TrySendOnce(object payload)
        {
            NamedPipeClientStream? client = null;
            try
            {
                client = new NamedPipeClientStream(".", PipeName, PipeDirection.InOut, PipeOptions.None);
                client.Connect(ConnectTimeoutMs);

                var json = JsonSerializer.Serialize(payload);
                var bytes = Encoding.UTF8.GetBytes(json + "\n");
                client.Write(bytes, 0, bytes.Length);
                client.Flush();

                var response = ReadAckLine(client);
                if (string.IsNullOrWhiteSpace(response)) return true;

                using var doc = JsonDocument.Parse(response);
                return !doc.RootElement.TryGetProperty("ok", out var ok) || ok.GetBoolean();
            }
            catch
            {
                return false;
            }
            finally
            {
                client?.Dispose();
            }
        }

        private static string? ReadAckLine(Stream stream)
        {
            var sb = new StringBuilder();
            var buffer = new byte[1];
            var deadline = Environment.TickCount64 + ConnectTimeoutMs;
            while (Environment.TickCount64 < deadline)
            {
                if (stream.Read(buffer, 0, 1) == 0) break;
                var ch = (char)buffer[0];
                if (ch == '\n') break;
                if (ch != '\r') sb.Append(ch);
            }
            return sb.Length == 0 ? null : sb.ToString();
        }
    }
}
