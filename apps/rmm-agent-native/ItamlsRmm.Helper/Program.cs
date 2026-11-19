using ItamlsRmm.Helper;

// Spawned by the service via CreateProcessAsUser so we inherit the user's
// desktop + environment. Args:
//    --pipe \\.\pipe\itamls-rmm-<sessionId>
//
// We open the pipe, then run four loops in parallel:
//   1. ReadLoop   - JSON commands coming in from service
//   2. FrameLoop  - when streaming, GDI-grab the primary monitor + send JPEG
//   3. ClipLoop   - watch the clipboard, forward changes
//   4. KeepAlive  - ping every 30s so the service can detect a dead helper
//
// Any exception is caught, written to C:\ProgramData\ITAMLS\logs\rmm-helper.log
// (because the helper runs under the user's token and has no Event Log perms),
// then we exit so the service can respawn us.

// Log file - unlike the service, the helper runs as the user and can't write
// Application Event Log entries. User-session processes also can't write to
// C:\ProgramData\ITAMLS\logs by default (the default ACL only grants SYSTEM,
// Admins, and the creator). %TEMP% is always writable by the user we're
// running as, and we drop the file next to the user's other temp data.
static void WriteLog(string pipeName, string line) {
    try {
        var tempDir = Path.GetTempPath();  // %TEMP% of current user
        var path = Path.Combine(tempDir, "itamls-rmm-helper.log");
        File.AppendAllText(path,
            $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] pid={Environment.ProcessId} user={Environment.UserName} pipe={pipeName} {line}{Environment.NewLine}");
    } catch { /* ignore - no good fallback */ }
}

Console.WriteLine($"[helper] boot pid={Environment.ProcessId} args=[{string.Join(" ", args)}]");

var pipeName = args.SkipWhile(a => a != "--pipe").Skip(1).FirstOrDefault() ?? "(none)";
var secureDesktop = args.Contains("--secure-desktop");

try {
    Console.WriteLine($"[helper] about to write first log entry");
    WriteLog(pipeName, $"startup args=[{string.Join(" ", args)}] secure={secureDesktop}");
    Console.WriteLine($"[helper] first log entry written");

    if (!args.Contains("--pipe") || string.IsNullOrWhiteSpace(pipeName) || pipeName == "(none)") {
        WriteLog(pipeName, "FATAL: --pipe argument missing or empty");
        Environment.Exit(2);
        return;
    }

    var loop = new HelperLoop(pipeName, secureDesktop);
    WriteLog(pipeName, "HelperLoop constructed, running");
    await loop.RunAsync();
    WriteLog(pipeName, "HelperLoop returned cleanly");
} catch (Exception ex) {
    WriteLog(pipeName, $"FATAL: {ex.GetType().Name}: {ex.Message}\n{ex.StackTrace}");
    Environment.Exit(3);
}
