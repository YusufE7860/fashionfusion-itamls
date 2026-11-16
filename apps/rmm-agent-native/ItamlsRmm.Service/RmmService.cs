using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using System.IO;
using System.Text.Json;
using ItamlsRmm.Service.Transport;
using ItamlsRmm.Service.Wts;

namespace ItamlsRmm.Service;

/// <summary>
/// Long-running RMM service. Owns one WebSocket to the ITAMLS API and one
/// per-session helper process. Relays commands + stream frames between the
/// two.
///
/// Config is read from C:\ProgramData\ITAMLS\agent.json — same file the
/// inventory + backup scripts use, so the agent key is already in place
/// after the existing enrolment installer runs.
/// </summary>
public sealed class RmmService : BackgroundService
{
    private readonly ILogger<RmmService> _log;
    private SessionManager?  _sessions;
    private WsClient?        _ws;
    private PipeHub?         _pipes;
    private AgentConfig?     _cfg;

    public RmmService(ILogger<RmmService> log) { _log = log; }

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        _cfg = LoadConfig();
        if (_cfg is null) {
            _log.LogError("Config not found or malformed — is Install-ITAMLSAgent finished?");
            return;
        }

        // 1. Named-pipe hub for talking to per-session helpers.
        _pipes = new PipeHub(_log);
        _pipes.Start(stop);

        // 2. Session watcher — spawns a helper into each active user session
        //    whenever one appears, kills it when the session logs off.
        _sessions = new SessionManager(_log);
        _sessions.Start(stop);

        // 3. WebSocket to the API. Any frames coming off a helper are fanned
        //    out over the WS; any command arriving over the WS is routed to
        //    the appropriate helper (or handled service-side if it's one of
        //    the service-level ones like RESTART).
        _ws = new WsClient(_log, _cfg, _pipes, _sessions);
        await _ws.RunForeverAsync(stop);
    }

    public override async Task StopAsync(CancellationToken ct)
    {
        _log.LogInformation("Stopping RMM service");
        try { _sessions?.StopAll(); } catch { /* ignore */ }
        try { _pipes?.Dispose(); } catch { /* ignore */ }
        try { _ws?.Dispose(); } catch { /* ignore */ }
        await base.StopAsync(ct);
    }

    private AgentConfig? LoadConfig()
    {
        var path = Environment.ExpandEnvironmentVariables(@"%ProgramData%\ITAMLS\agent.json");
        if (!File.Exists(path)) return null;
        try {
            var json = File.ReadAllText(path);
            return JsonSerializer.Deserialize<AgentConfig>(json, new JsonSerializerOptions {
                PropertyNameCaseInsensitive = true,
            });
        } catch (Exception e) {
            _log.LogError(e, "Failed to parse agent.json");
            return null;
        }
    }
}

/// <summary>Shape of C:\ProgramData\ITAMLS\agent.json.</summary>
public sealed class AgentConfig
{
    public string ApiBase   { get; set; } = "";
    public string AgentKey  { get; set; } = "";
    public string PcId      { get; set; } = "";
    public string PcName    { get; set; } = "";
    public string StoreCode { get; set; } = "";
}
