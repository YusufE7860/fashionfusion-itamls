using System.Text.Json;

namespace Itamls.RmmAgent;

/// <summary>
/// Agent configuration. Looks in these places, in order:
///   1. Env vars  (ITAMLS_RMM_URL, ITAMLS_RMM_TOKEN)
///   2. %ProgramData%\ITAMLS\rmm-agent\config.json
///   3. Alongside the exe:  config.json
/// </summary>
public sealed class AgentConfig
{
    public string ServerUrl { get; init; } = "wss://it.ffgsa.co.za:41235/api/v1/rmm/ws";
    public string AgentToken { get; init; } = "";
    public int MetricsIntervalSeconds { get; init; } = 10;
    public int HeartbeatIntervalSeconds { get; init; } = 30;
    public int ReconnectBaseMs { get; init; } = 1000;
    public int ReconnectMaxMs { get; init; } = 60000;

    public static AgentConfig Load()
    {
        var paths = new[]
        {
            Environment.ExpandEnvironmentVariables(@"%ProgramData%\ITAMLS\rmm-agent\config.json"),
            Path.Combine(AppContext.BaseDirectory, "config.json"),
        };

        AgentConfig? fromFile = null;
        foreach (var p in paths)
        {
            if (File.Exists(p))
            {
                try
                {
                    var json = File.ReadAllText(p);
                    fromFile = JsonSerializer.Deserialize<AgentConfig>(json, new JsonSerializerOptions
                    {
                        PropertyNameCaseInsensitive = true,
                    });
                    if (fromFile is not null) break;
                }
                catch { /* ignore malformed file; env vars still work */ }
            }
        }

        // Env vars override anything in the file
        var envUrl   = Environment.GetEnvironmentVariable("ITAMLS_RMM_URL");
        var envToken = Environment.GetEnvironmentVariable("ITAMLS_RMM_TOKEN");

        return new AgentConfig
        {
            ServerUrl                 = envUrl   ?? fromFile?.ServerUrl   ?? "wss://it.ffgsa.co.za:41235/api/v1/rmm/ws",
            AgentToken                = envToken ?? fromFile?.AgentToken  ?? "",
            MetricsIntervalSeconds    = fromFile?.MetricsIntervalSeconds  ?? 10,
            HeartbeatIntervalSeconds  = fromFile?.HeartbeatIntervalSeconds?? 30,
            ReconnectBaseMs           = fromFile?.ReconnectBaseMs         ?? 1000,
            ReconnectMaxMs            = fromFile?.ReconnectMaxMs          ?? 60000,
        };
    }
}
