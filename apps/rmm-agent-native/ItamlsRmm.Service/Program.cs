using ItamlsRmm.Service;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Hosting.WindowsServices;
using Microsoft.Extensions.Logging;

var builder = Host.CreateApplicationBuilder(args);

// When started by the Service Control Manager we hook into the Windows
// Service lifetime (RequestAdditionalTime, SC_STOP, etc.). When run from a
// console (e.g. during development), the generic host just runs as a normal
// console app. Same code path either way.
builder.Services.AddWindowsService(o =>
{
    o.ServiceName = "ItamlsRmm";
});

builder.Logging.AddEventLog(settings =>
{
    settings.SourceName = "ItamlsRmm";
});
// EventLog provider defaults to Warning-and-above; we want Info so we can
// see session-spawn + WS-connect lifecycle in Event Viewer.
builder.Logging.AddFilter<Microsoft.Extensions.Logging.EventLog.EventLogLoggerProvider>(
    null, LogLevel.Information);

builder.Services.AddHostedService<RmmService>();

await builder.Build().RunAsync();
