using ItamlsRmm.Helper;

// Spawned by the service via CreateProcessAsUser so we inherit the user's
// desktop + environment. Args:
//    --pipe \\.\pipe\itamls-rmm-<sessionId>
//
// We open the pipe, then run four loops in parallel:
//   1. ReadLoop   — JSON commands coming in from service
//   2. FrameLoop  — when streaming, GDI-grab the primary monitor + send JPEG
//   3. ClipLoop   — watch the clipboard, forward changes
//   4. KeepAlive  — ping every 30s so the service can detect a dead helper
//
// Any exception bubbles up to the service, which will respawn us.

var pipeName = args.SkipWhile(a => a != "--pipe").Skip(1).FirstOrDefault();
if (string.IsNullOrWhiteSpace(pipeName)) {
    Environment.Exit(2);
    return;
}
// --secure-desktop tells the helper it was spawned onto winsta0\Winlogon.
// It streams frames only while the input desktop IS Winlogon (UAC up).
// Otherwise it idles — the Default-desktop helper covers everything else.
var secureDesktop = args.Contains("--secure-desktop");

var loop = new HelperLoop(pipeName, secureDesktop);
await loop.RunAsync();
