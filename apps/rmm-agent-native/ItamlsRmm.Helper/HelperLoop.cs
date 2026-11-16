using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using ItamlsRmm.Helper.Audio;
using ItamlsRmm.Helper.Capture;

namespace ItamlsRmm.Helper;

public sealed class HelperLoop
{
    private readonly string _pipeName;
    private readonly bool   _secureDesktopMode;    // Winlogon helper, see Program.cs
    private NamedPipeClientStream? _pipe;
    private StreamWriter? _writer;
    private int  _frameSeq;
    private bool _streaming;
    private int  _quality = 55;
    private double _scale = 1.0;
    private int  _frameIntervalMs = 100;
    private int  _monitorIndex = 0;
    private DateTime _lastFrame = DateTime.MinValue;
    private string? _lastClipboard;
    private IScreenCapture? _capture;
    private LoopbackAudio? _audio;

    public HelperLoop(string pipeName, bool secureDesktopMode = false)
    {
        _pipeName = pipeName.Replace(@"\\.\pipe\", "");
        _secureDesktopMode = secureDesktopMode;
        // The Winlogon helper should auto-stream any time the input desktop
        // IS Winlogon — it doesn't wait for a VIEW_START. That way the admin
        // viewer sees the UAC prompt the moment it appears.
        if (secureDesktopMode) _streaming = true;
    }

    public async Task RunAsync()
    {
        _capture = CaptureFactory.Create();
        _pipe = new NamedPipeClientStream(".", _pipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
        await _pipe.ConnectAsync(10_000);
        _writer = new StreamWriter(_pipe, Encoding.UTF8) { AutoFlush = true, NewLine = "\n" };

        // Tell the service which capture backend + monitors we have so the
        // viewer can offer a monitor picker + a quality-vs-fps slider that
        // matches what the backend can actually deliver.
        await SendAsync(new {
            type         = "helper_hello",
            sessionId    = Environment.ProcessId,
            captureName  = _capture.Name,
            monitors     = _capture.Monitors.Select(m => new { m.Index, m.Name, m.Width, m.Height, m.Primary }),
        });

        var cts = new CancellationTokenSource();
        var reader = Task.Run(() => ReadLoopAsync(cts.Token));
        var frames = Task.Run(() => FrameLoopAsync(cts.Token));
        var clip   = Task.Run(() => ClipboardLoopAsync(cts.Token));

        await Task.WhenAny(reader, frames, clip);
        cts.Cancel();
        _capture.Dispose();
        _audio?.Dispose();
    }

    private async Task ReadLoopAsync(CancellationToken ct)
    {
        using var r = new StreamReader(_pipe!, Encoding.UTF8);
        while (!ct.IsCancellationRequested) {
            var line = await r.ReadLineAsync(ct);
            if (line is null) break;
            try {
                using var doc = JsonDocument.Parse(line);
                await HandleInbound(doc.RootElement);
            } catch { /* keep going */ }
        }
    }

    private async Task HandleInbound(JsonElement root)
    {
        var type = root.TryGetProperty("type", out var tp) ? tp.GetString() : null;
        if (type == "cmd") {
            var kind    = root.GetProperty("kind").GetString() ?? "";
            var id      = root.GetProperty("id").GetString() ?? "";
            var payload = root.TryGetProperty("payload", out var p) ? p : default;

            switch (kind) {
                case "VIEW_START":
                    _streaming       = true;
                    _frameSeq        = 0;
                    _quality         = payload.TryGetProperty("quality", out var q) ? q.GetInt32() : 55;
                    _scale           = payload.TryGetProperty("scale",   out var s) ? s.GetDouble() : 1.0;
                    _frameIntervalMs = payload.TryGetProperty("fps",     out var f) ? (int)(1000 / Math.Max(1, f.GetDouble())) : 100;
                    _monitorIndex    = payload.TryGetProperty("monitor", out var mi) ? mi.GetInt32() : 0;
                    await Result(id, "DONE", 0, $"view start q={_quality} s={_scale} mon={_monitorIndex}", "");
                    break;
                case "VIEW_STOP":
                    _streaming = false;
                    await Result(id, "DONE", 0, "view stop", "");
                    break;
                case "VIEW_MONITOR":
                    _monitorIndex = payload.GetProperty("monitor").GetInt32();
                    await Result(id, "DONE", 0, $"monitor={_monitorIndex}", "");
                    break;
                case "AUDIO_START":
                    if (_audio is null) {
                        _audio = new LoopbackAudio();
                        _audio.OnChunk += async (bytes) => {
                            try {
                                await SendAsync(new {
                                    type       = "audio_chunk",
                                    sampleRate = _audio!.SampleRate,
                                    channels   = _audio!.Channels,
                                    pcm16      = Convert.ToBase64String(bytes),
                                });
                            } catch { }
                        };
                    }
                    _audio.Start();
                    await Result(id, "DONE", 0, "audio started", "");
                    break;
                case "AUDIO_STOP":
                    _audio?.Stop();
                    await Result(id, "DONE", 0, "audio stopped", "");
                    break;
                case "SCREENSHOT": {
                    var f0 = _capture?.Capture(_monitorIndex, 80, 1.0);
                    if (f0 is null) { await Result(id, "FAILED", -1, "", "capture failed"); break; }
                    await Result(id, "DONE", 0, "screenshotKey=inline:" + Convert.ToBase64String(f0.JpegBytes), "");
                    break;
                }
                case "CLIPBOARD_SET":
                    try {
                        var text = payload.GetProperty("text").GetString() ?? "";
                        ClipboardBridge.SetText(text);
                        _lastClipboard = text;
                        await Result(id, "DONE", 0, "clipboard set", "");
                    } catch (Exception e) { await Result(id, "FAILED", -1, "", e.Message); }
                    break;
                case "SHELL":
                case "SCRIPT": {
                    var script = payload.GetProperty("script").GetString() ?? "";
                    var interp = payload.TryGetProperty("interpreter", out var ip) ? ip.GetString() : "POWERSHELL";
                    var timeoutMs = payload.TryGetProperty("timeoutMs", out var t) ? t.GetInt32() : 60_000;
                    var r = Shell.Run(script, interp ?? "POWERSHELL", timeoutMs);
                    await Result(id, r.ExitCode == 0 ? "DONE" : "FAILED", r.ExitCode, r.Stdout, r.Stderr);
                    break;
                }
                default:
                    await Result(id, "FAILED", -1, "", $"unknown kind {kind}");
                    break;
            }
        } else if (type == "remote_input") {
            try {
                if (root.TryGetProperty("payload", out var p)) InputInjection.Dispatch(p);
            } catch { /* swallow */ }
        }
    }

    private async Task FrameLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested) {
            try {
                var shouldStream = _streaming;
                // Secure-desktop helper: only stream while the user actually
                // IS on Winlogon (UAC up / Ctrl+Alt+Del). The rest of the
                // time, the Default-desktop helper is covering things and
                // we'd just be burning CPU on a redundant black screen.
                if (_secureDesktopMode)
                    shouldStream = shouldStream && SecureDesktopDetector.IsOnSecureDesktop();

                if (shouldStream && _capture is not null
                    && (DateTime.UtcNow - _lastFrame).TotalMilliseconds >= _frameIntervalMs) {
                    var fr = _capture.Capture(_monitorIndex, _quality, _scale);
                    if (fr is not null) {
                        _frameSeq++;
                        await SendAsync(new {
                            type    = "view_frame",
                            seq     = _frameSeq,
                            w       = fr.NativeWidth,
                            h       = fr.NativeHeight,
                            monitor = fr.MonitorIndex,
                            jpeg    = Convert.ToBase64String(fr.JpegBytes),
                            secure  = _secureDesktopMode,
                        });
                        _lastFrame = DateTime.UtcNow;
                    }
                }
            } catch { /* swallow — one bad frame shouldn't stop the stream */ }
            await Task.Delay(10, ct);
        }
    }

    private async Task ClipboardLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested) {
            try {
                var txt = ClipboardBridge.TryGetText();
                if (txt is not null && txt != _lastClipboard) {
                    _lastClipboard = txt;
                    await SendAsync(new { type = "clipboard_change", text = txt });
                }
            } catch { }
            await Task.Delay(500, ct);
        }
    }

    private Task Result(string id, string status, int exitCode, string stdout, string stderr) =>
        SendAsync(new { type = "cmd_result", id, status, exitCode, stdout, stderr });

    private async Task SendAsync(object o)
    {
        var w = _writer; if (w is null) return;
        var json = JsonSerializer.Serialize(o);
        try { await w.WriteLineAsync(json.AsMemory()); } catch { }
    }
}
