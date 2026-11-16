using System.Diagnostics;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using ItamlsRmm.Service.Wts;

namespace ItamlsRmm.Service.Transport;

/// <summary>
/// Persistent WebSocket to the ITAMLS API. Reconnects on drop. Translates
/// between the server-side protocol (json messages: cmd / metrics / view_frame
/// / cmd_result) and the per-session helpers over named pipes.
/// </summary>
public sealed class WsClient : IDisposable
{
    private readonly ILogger _log;
    private readonly AgentConfig _cfg;
    private readonly PipeHub _pipes;
    private readonly SessionManager _sessions;
    private ClientWebSocket? _ws;

    public WsClient(ILogger log, AgentConfig cfg, PipeHub pipes, SessionManager sessions)
    {
        _log = log; _cfg = cfg; _pipes = pipes; _sessions = sessions;
        _pipes.OnMessage += HelperToServer;
    }

    public async Task RunForeverAsync(CancellationToken stop)
    {
        while (!stop.IsCancellationRequested) {
            try { await SessionAsync(stop); }
            catch (Exception e) { _log.LogInformation("WS session ended: {msg}", e.Message); }
            try { await Task.Delay(TimeSpan.FromSeconds(5), stop); } catch { }
        }
    }

    private async Task SessionAsync(CancellationToken stop)
    {
        var ws = new ClientWebSocket();
        ws.Options.SetRequestHeader("Authorization", $"Bearer {_cfg.AgentKey}");
        ws.Options.KeepAliveInterval = TimeSpan.FromSeconds(30);
        var wsBase = _cfg.ApiBase.Replace("https://", "wss://").Replace("http://", "ws://").TrimEnd('/');
        var uri = new Uri($"{wsBase}/rmm/ws");
        _log.LogInformation("Connecting {uri}", uri);
        await ws.ConnectAsync(uri, stop);
        _ws = ws;

        await SendAsync(new {
            type = "hello",
            agentVersion = "2.0.0-native",
            osName = Environment.OSVersion.VersionString,
            osVersion = Environment.OSVersion.Version.ToString(),
        }, stop);

        // Metrics loop lives in a separate task so a stuck inbound read can't
        // block it.
        var metricsCts = CancellationTokenSource.CreateLinkedTokenSource(stop);
        _ = Task.Run(() => MetricsLoop(metricsCts.Token));

        var buf = new byte[256 * 1024];
        var sb = new StringBuilder();
        while (!stop.IsCancellationRequested && ws.State == WebSocketState.Open) {
            WebSocketReceiveResult r;
            sb.Clear();
            do {
                r = await ws.ReceiveAsync(new ArraySegment<byte>(buf), stop);
                if (r.MessageType == WebSocketMessageType.Close) return;
                sb.Append(Encoding.UTF8.GetString(buf, 0, r.Count));
            } while (!r.EndOfMessage);
            try {
                using var doc = JsonDocument.Parse(sb.ToString());
                await HandleInbound(doc.RootElement, stop);
            } catch (Exception e) {
                _log.LogDebug(e, "bad inbound frame: {s}", sb.ToString().Substring(0, Math.Min(200, sb.Length)));
            }
        }
        metricsCts.Cancel();
    }

    /// <summary>Route an inbound message. Commands addressed to a session go
    /// over the pipe; service-level commands (restart, metrics ping, etc.)
    /// run here.</summary>
    private async Task HandleInbound(JsonElement root, CancellationToken ct)
    {
        var type = root.TryGetProperty("type", out var tp) ? tp.GetString() : null;
        switch (type) {
            case "cmd": {
                var kind = root.GetProperty("kind").GetString() ?? "";
                var payload = root.TryGetProperty("payload", out var pl) ? pl : default;
                var id   = root.GetProperty("id").GetString() ?? "";

                // Delegate anything desktop-related to the active-session
                // helper. Service-level commands (RESTART, ping) handled inline.
                if (kind is "VIEW_START" or "VIEW_STOP" or "SCREENSHOT"
                        or "FILE_PULL" or "FILE_PUSH" or "CLIPBOARD_SET"
                        or "SHELL" or "SCRIPT") {
                    var target = _sessions.ActiveSessions().FirstOrDefault();
                    if (target == 0) {
                        await ReplyResult(id, "FAILED", -1, "", "no active user session", ct);
                        return;
                    }
                    await _pipes.SendAsync(target, root.GetRawText(), ct);
                } else if (kind == "RESTART") {
                    int delay = payload.TryGetProperty("delaySeconds", out var ds) ? ds.GetInt32() : 10;
                    await ReplyResult(id, "DONE", 0, $"restart in {delay}s", "", ct);
                    Process.Start("shutdown.exe", $"/r /f /t {delay} /d p:4:1 /c ITAMLS RMM restart");
                } else {
                    await ReplyResult(id, "FAILED", -1, "", $"unknown kind {kind}", ct);
                }
                break;
            }
            case "remote_input":
                // Live-stream input from the viewer — forward to helper.
                var sidForInput = _sessions.ActiveSessions().FirstOrDefault();
                if (sidForInput != 0)
                    await _pipes.SendAsync(sidForInput, root.GetRawText(), ct);
                break;
            case "ping":
                await SendAsync(new { type = "pong" }, ct);
                break;
        }
    }

    /// <summary>Helper → service → WS: forward helper messages (view_frame,
    /// cmd_result, clipboard_change) straight to the server.</summary>
    private void HelperToServer(uint sid, string json)
    {
        _ = Task.Run(async () => {
            try { await SendRawAsync(json, CancellationToken.None); }
            catch (Exception e) { _log.LogDebug(e, "fwd fail"); }
        });
    }

    private async Task MetricsLoop(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested) {
            try {
                var m = MetricsSampler.Sample();
                m["type"] = "metrics";
                await SendAsync(m, ct);
            } catch { }
            try { await Task.Delay(TimeSpan.FromSeconds(30), ct); } catch { }
        }
    }

    private Task ReplyResult(string id, string status, int exitCode, string stdout, string stderr, CancellationToken ct) =>
        SendAsync(new { type = "cmd_result", id, status, exitCode, stdout, stderr }, ct);

    private Task SendAsync(object o, CancellationToken ct) =>
        SendRawAsync(JsonSerializer.Serialize(o), ct);

    private async Task SendRawAsync(string json, CancellationToken ct)
    {
        var ws = _ws; if (ws is null || ws.State != WebSocketState.Open) return;
        var bytes = Encoding.UTF8.GetBytes(json);
        await ws.SendAsync(bytes, WebSocketMessageType.Text, true, ct);
    }

    public void Dispose()
    {
        _pipes.OnMessage -= HelperToServer;
        try { _ws?.Dispose(); } catch { }
    }
}

internal static class MetricsSampler
{
    private static System.Diagnostics.PerformanceCounter? _cpu;

    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential, CharSet = System.Runtime.InteropServices.CharSet.Auto)]
    private class MEMORYSTATUSEX {
        public uint   dwLength = (uint)System.Runtime.InteropServices.Marshal.SizeOf(typeof(MEMORYSTATUSEX));
        public uint   dwMemoryLoad;
        public ulong  ullTotalPhys, ullAvailPhys;
        public ulong  ullTotalPageFile, ullAvailPageFile;
        public ulong  ullTotalVirtual,  ullAvailVirtual, ullAvailExtendedVirtual;
    }

    [System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
    [return: System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.Bool)]
    private static extern bool GlobalMemoryStatusEx(MEMORYSTATUSEX lpBuffer);

    public static Dictionary<string, object> Sample()
    {
        _cpu ??= new System.Diagnostics.PerformanceCounter("Processor", "% Processor Time", "_Total");
        var d = new Dictionary<string, object>();
        try { d["cpuPct"] = Math.Round(_cpu.NextValue(), 1); } catch { }
        try {
            var m = new MEMORYSTATUSEX();
            if (GlobalMemoryStatusEx(m)) {
                d["memTotalBytes"] = (long)m.ullTotalPhys;
                d["memUsedBytes"]  = (long)(m.ullTotalPhys - m.ullAvailPhys);
            }
        } catch { }
        try {
            var drv = DriveInfo.GetDrives().FirstOrDefault(x => x.Name.StartsWith("C"));
            if (drv is not null) {
                d["diskTotalBytes"] = drv.TotalSize;
                d["diskUsedBytes"]  = drv.TotalSize - drv.AvailableFreeSpace;
            }
        } catch { }
        return d;
    }
}
