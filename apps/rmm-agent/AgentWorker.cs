using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Itamls.RmmAgent;

/// <summary>
/// Main worker — keeps a WebSocket connection open to ITAMLS, with exponential
/// backoff reconnect, and dispatches server messages to the right handler.
/// </summary>
public sealed class AgentWorker : BackgroundService
{
    private readonly ILogger<AgentWorker> _log;
    private readonly AgentConfig _cfg;
    private readonly MetricsCollector _metrics;
    private readonly ShellRunner _shell;

    public AgentWorker(ILogger<AgentWorker> log, AgentConfig cfg, MetricsCollector metrics, ShellRunner shell)
    {
        _log = log; _cfg = cfg; _metrics = metrics; _shell = shell;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (string.IsNullOrWhiteSpace(_cfg.AgentToken))
        {
            _log.LogError("No agent token configured. Set ITAMLS_RMM_TOKEN or populate config.json.");
            // Keep the service alive so an admin can push a token and we'll pick it up next reload.
            while (!stoppingToken.IsCancellationRequested) await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);
            return;
        }

        var backoff = _cfg.ReconnectBaseMs;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RunOneSession(stoppingToken);
                backoff = _cfg.ReconnectBaseMs; // reset after a clean run
            }
            catch (OperationCanceledException) { break; }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Session ended with error");
            }
            try { await Task.Delay(backoff, stoppingToken); } catch { }
            backoff = Math.Min(backoff * 2, _cfg.ReconnectMaxMs);
        }
    }

    private async Task RunOneSession(CancellationToken ct)
    {
        using var ws = new ClientWebSocket();
        ws.Options.SetRequestHeader("Authorization", $"Bearer {_cfg.AgentToken}");
        ws.Options.KeepAliveInterval = TimeSpan.FromSeconds(30);

        _log.LogInformation("Connecting to {Url}", _cfg.ServerUrl);
        await ws.ConnectAsync(new Uri(_cfg.ServerUrl), ct);
        _log.LogInformation("Connected");

        // Say hello
        await SendAsync(ws, new {
            type = "hello",
            agentVersion = typeof(AgentWorker).Assembly.GetName().Version?.ToString() ?? "1.0.0",
            osName = $"{Environment.OSVersion.Platform} {Environment.OSVersion.VersionString}",
            osVersion = Environment.OSVersion.Version.ToString(),
            localIp = NetUtils.GetLocalIp(),
        }, ct);

        // Start metrics loop in the background
        using var metricsCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var metricsTask = Task.Run(() => MetricsLoop(ws, metricsCts.Token), metricsCts.Token);
        var pingTask    = Task.Run(() => PingLoop(ws, metricsCts.Token), metricsCts.Token);

        var buffer = new byte[32 * 1024];
        var sb = new StringBuilder();
        while (ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
        {
            sb.Clear();
            WebSocketReceiveResult result;
            do
            {
                result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), ct);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    _log.LogInformation("Server closed the socket");
                    metricsCts.Cancel();
                    return;
                }
                sb.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));
            } while (!result.EndOfMessage);

            _ = Task.Run(() => Dispatch(ws, sb.ToString(), ct));
        }

        metricsCts.Cancel();
        try { await metricsTask; } catch { }
        try { await pingTask; } catch { }
    }

    private async Task MetricsLoop(ClientWebSocket ws, CancellationToken ct)
    {
        while (ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
        {
            try
            {
                var m = _metrics.Collect();
                await SendAsync(ws, new
                {
                    type = "metrics",
                    cpuPct = m.CpuPct,
                    memUsedBytes = m.MemUsedBytes,
                    memTotalBytes = m.MemTotalBytes,
                    diskUsedBytes = m.DiskUsedBytes,
                    diskTotalBytes = m.DiskTotalBytes,
                    netRxBytesPerS = m.NetRxBytesPerS,
                    netTxBytesPerS = m.NetTxBytesPerS,
                    loggedInUser = m.LoggedInUser,
                }, ct);
            }
            catch (Exception ex) { _log.LogDebug(ex, "metrics tick failed"); }
            try { await Task.Delay(TimeSpan.FromSeconds(_cfg.MetricsIntervalSeconds), ct); } catch { break; }
        }
    }

    private async Task PingLoop(ClientWebSocket ws, CancellationToken ct)
    {
        while (ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
        {
            try { await SendAsync(ws, new { type = "ping" }, ct); }
            catch { }
            try { await Task.Delay(TimeSpan.FromSeconds(_cfg.HeartbeatIntervalSeconds), ct); } catch { break; }
        }
    }

    private async Task Dispatch(ClientWebSocket ws, string json, CancellationToken ct)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var type = doc.RootElement.GetProperty("type").GetString();
            switch (type)
            {
                case "pong":
                    break;
                case "cmd":
                    await HandleCommand(ws, doc.RootElement, ct);
                    break;
                default:
                    _log.LogDebug("Unknown server msg: {Type}", type);
                    break;
            }
        }
        catch (Exception ex) { _log.LogWarning(ex, "dispatch failed"); }
    }

    private async Task HandleCommand(ClientWebSocket ws, JsonElement root, CancellationToken ct)
    {
        var id = root.GetProperty("id").GetString() ?? "";
        var kind = root.GetProperty("kind").GetString() ?? "";
        var payload = root.TryGetProperty("payload", out var p) ? p : default;

        switch (kind)
        {
            case "SHELL":
            case "SCRIPT":
            {
                var script = payload.TryGetProperty("script", out var s) ? s.GetString() ?? "" : "";
                var interpreter = payload.TryGetProperty("interpreter", out var i) ? i.GetString() ?? "POWERSHELL" : "POWERSHELL";
                var timeoutMs = payload.TryGetProperty("timeoutMs", out var tm) ? tm.GetInt32() : 60_000;

                var r = await _shell.RunAsync(script, interpreter, timeoutMs, async (stream, chunk) =>
                {
                    await SendAsync(ws, new { type = "cmd_output", id, stream, chunk }, ct);
                }, ct);

                await SendAsync(ws, new
                {
                    type = "cmd_result",
                    id,
                    exitCode = r.ExitCode,
                    stdout = r.Stdout,
                    stderr = r.Stderr,
                    status = r.ExitCode == 0 ? "DONE" : "FAILED",
                }, ct);
                break;
            }
            case "RESTART":
            {
                var delay = payload.TryGetProperty("delaySeconds", out var d) ? d.GetInt32() : 10;
                _ = Task.Run(() =>
                {
                    try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                    {
                        FileName = "shutdown",
                        Arguments = $"/r /t {delay} /c \"Restart requested by ITAMLS RMM\"",
                        UseShellExecute = false,
                        CreateNoWindow = true,
                    }); } catch { }
                });
                await SendAsync(ws, new { type = "cmd_result", id, exitCode = 0, stdout = $"Restart scheduled in {delay}s", status = "DONE" }, ct);
                break;
            }
            default:
                await SendAsync(ws, new { type = "cmd_result", id, exitCode = 1, stderr = $"Unknown kind: {kind}", status = "FAILED" }, ct);
                break;
        }
    }

    private static async Task SendAsync(ClientWebSocket ws, object payload, CancellationToken ct)
    {
        var json = JsonSerializer.Serialize(payload);
        var bytes = Encoding.UTF8.GetBytes(json);
        await ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, ct);
    }
}
