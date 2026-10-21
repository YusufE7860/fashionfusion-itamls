using System.Diagnostics;
using System.Text.Json;

namespace Itamls.RmmAgent;

/// <summary>
/// Writes a config.json skeleton (if missing), installs the Windows service via sc.exe,
/// and starts it. Called by `itamls-rmm-agent.exe install [token]`.
/// </summary>
public static class Installer
{
    private const string ServiceName = "ITAMLSRmmAgent";
    private const string DisplayName = "ITAMLS RMM Agent";
    private const string Description = "Keeps a connection to ITAMLS so techs can remote in, run scripts and see live metrics.";

    public static void InstallService(string tokenMaybe)
    {
        var exe = Environment.ProcessPath ?? "";
        if (string.IsNullOrEmpty(exe)) { Console.Error.WriteLine("Could not determine exe path"); return; }

        var cfgDir = Environment.ExpandEnvironmentVariables(@"%ProgramData%\ITAMLS\rmm-agent");
        Directory.CreateDirectory(cfgDir);
        var cfgPath = Path.Combine(cfgDir, "config.json");

        if (!File.Exists(cfgPath) || !string.IsNullOrWhiteSpace(tokenMaybe))
        {
            var cfg = new
            {
                serverUrl = Environment.GetEnvironmentVariable("ITAMLS_RMM_URL")
                         ?? "wss://it.ffgsa.co.za:41235/api/v1/rmm/ws",
                agentToken = string.IsNullOrWhiteSpace(tokenMaybe)
                           ? Environment.GetEnvironmentVariable("ITAMLS_RMM_TOKEN") ?? ""
                           : tokenMaybe,
                metricsIntervalSeconds   = 10,
                heartbeatIntervalSeconds = 30,
            };
            File.WriteAllText(cfgPath, JsonSerializer.Serialize(cfg, new JsonSerializerOptions { WriteIndented = true }));
            Console.WriteLine($"Wrote {cfgPath}");
        }

        // Remove existing service first (idempotent install)
        Run("sc.exe", $"stop {ServiceName}");
        Run("sc.exe", $"delete {ServiceName}");

        var createArgs = $"create {ServiceName} binPath= \"\\\"{exe}\\\"\" start= auto DisplayName= \"{DisplayName}\"";
        Run("sc.exe", createArgs);
        Run("sc.exe", $"description {ServiceName} \"{Description}\"");
        // Restart on failure: 3 restarts, then every 5 min
        Run("sc.exe", $"failure {ServiceName} reset= 86400 actions= restart/5000/restart/10000/restart/60000");

        Run("sc.exe", $"start {ServiceName}");
        Console.WriteLine("Service installed and started.");
    }

    public static void UninstallService()
    {
        Run("sc.exe", $"stop {ServiceName}");
        Run("sc.exe", $"delete {ServiceName}");
        Console.WriteLine("Service removed.");
    }

    private static void Run(string file, string args)
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = file, Arguments = args,
                RedirectStandardOutput = true, RedirectStandardError = true,
                UseShellExecute = false, CreateNoWindow = true,
            };
            using var p = Process.Start(psi);
            p?.WaitForExit(10_000);
        }
        catch { }
    }
}
