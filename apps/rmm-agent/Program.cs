using Itamls.RmmAgent;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

var builder = Host.CreateApplicationBuilder(args);

// Install mode: `itamls-rmm-agent install` → write a config.json skeleton and
// register the Windows service. Useful during enrolment.
if (args.Length > 0 && args[0].Equals("install", StringComparison.OrdinalIgnoreCase))
{
    Installer.InstallService(args.Length > 1 ? args[1] : "");
    return;
}
if (args.Length > 0 && args[0].Equals("uninstall", StringComparison.OrdinalIgnoreCase))
{
    Installer.UninstallService();
    return;
}

builder.Services.AddWindowsService(options => options.ServiceName = "ITAMLSRmmAgent");
builder.Services.AddSingleton<AgentConfig>(_ => AgentConfig.Load());
builder.Services.AddSingleton<MetricsCollector>();
builder.Services.AddSingleton<ShellRunner>();
builder.Services.AddHostedService<AgentWorker>();

builder.Logging.AddEventLog(settings =>
{
    settings.SourceName = "ITAMLSRmmAgent";
});

await builder.Build().RunAsync();
