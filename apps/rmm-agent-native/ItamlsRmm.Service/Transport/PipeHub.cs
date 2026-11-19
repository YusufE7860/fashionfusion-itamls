using System.Collections.Concurrent;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using Microsoft.Extensions.Logging;

namespace ItamlsRmm.Service.Transport;

/// <summary>
/// Hosts one named pipe per user session (pattern: \\.\pipe\itamls-rmm-{sid})
/// so helper processes can stream frames / clipboard / input ACKs back to
/// the service. All messages are newline-delimited JSON — same wire format
/// the WS speaks.
///
/// Why pipes and not a WS between helper and service? Pipes are the fast
/// path on Windows (shared-memory ring, no TCP stack, no auth round-trip),
/// and the trust boundary is the local machine anyway.
/// </summary>
public sealed class PipeHub : IDisposable
{
    private readonly ILogger _log;
    private readonly ConcurrentDictionary<uint, PipeServer> _pipes = new();
    private CancellationTokenSource? _cts;

    /// <summary>Broadcast delegate: PipeHub → outside world (WsClient).</summary>
    public event Action<uint, string>? OnMessage;

    public PipeHub(ILogger log) { _log = log; }

    public void Start(CancellationToken stop)
    {
        _cts = CancellationTokenSource.CreateLinkedTokenSource(stop);
        _ = Task.Run(() => AcceptLoopAsync(_cts.Token));
    }

    /// <summary>Send a message to a specific helper (routes by session id).</summary>
    public async Task<bool> SendAsync(uint sessionId, string json, CancellationToken ct)
    {
        if (!_pipes.TryGetValue(sessionId, out var p)) return false;
        return await p.SendAsync(json, ct);
    }

    /// <summary>Broadcast to every helper.</summary>
    public async Task BroadcastAsync(string json, CancellationToken ct)
    {
        foreach (var p in _pipes.Values)
            try { await p.SendAsync(json, ct); } catch { /* best effort */ }
    }

    private async Task AcceptLoopAsync(CancellationToken ct)
    {
        // Two parallel pipe patterns, one per helper flavour:
        //   itamls-rmm-<sid>             — Default-desktop helper
        //   itamls-rmm-secure-<sid>      — Winlogon-desktop helper
        // We pre-arm listeners for a reasonable range of session ids up
        // front; helpers connect when they spawn.
        while (!ct.IsCancellationRequested) {
            try {
                foreach (uint sid in Enumerable.Range(1, 32).Select(i => (uint)i)) {
                    if (!_pipes.ContainsKey(sid)) {
                        var p = new PipeServer(_log, sid, this, $"itamls-rmm-{sid}");
                        if (p.Start(ct)) _pipes[sid] = p;
                    }
                    var secureKey = 10_000u + sid;  // separate dictionary slot
                    if (!_pipes.ContainsKey(secureKey)) {
                        var p = new PipeServer(_log, sid, this, $"itamls-rmm-secure-{sid}");
                        if (p.Start(ct)) _pipes[secureKey] = p;
                    }
                }
                await Task.Delay(TimeSpan.FromSeconds(5), ct);
            } catch { }
        }
    }

    internal void Emit(uint sid, string json) => OnMessage?.Invoke(sid, json);

    public void Dispose()
    {
        _cts?.Cancel();
        foreach (var p in _pipes.Values) try { p.Dispose(); } catch { }
    }
}

internal sealed class PipeServer : IDisposable
{
    private readonly ILogger _log;
    private readonly uint _sid;
    private readonly PipeHub _hub;
    private readonly string _pipeName;
    private NamedPipeServerStream? _pipe;
    private StreamWriter?  _writer;
    private CancellationTokenSource? _cts;

    public PipeServer(ILogger log, uint sid, PipeHub hub, string pipeName)
    {
        _log = log; _sid = sid; _hub = hub; _pipeName = pipeName;
    }

    public bool Start(CancellationToken stop)
    {
        try {
            _cts = CancellationTokenSource.CreateLinkedTokenSource(stop);

            // When a SYSTEM-owned service creates a named pipe with the default
            // DACL, user-session processes (even admins) can't CONNECT to it.
            // Explicitly grant Authenticated Users RW so the helper running
            // under the interactive user's token can open the pipe. Local
            // machine only - no network access to this pipe.
            var security = new PipeSecurity();
            var authUsers = new SecurityIdentifier(WellKnownSidType.AuthenticatedUserSid, null);
            security.AddAccessRule(new PipeAccessRule(
                authUsers,
                PipeAccessRights.ReadWrite | PipeAccessRights.CreateNewInstance,
                AccessControlType.Allow));
            var systemSid = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
            security.AddAccessRule(new PipeAccessRule(
                systemSid, PipeAccessRights.FullControl, AccessControlType.Allow));

            _pipe = NamedPipeServerStreamAcl.Create(
                _pipeName,
                PipeDirection.InOut,
                maxNumberOfServerInstances: 1,
                PipeTransmissionMode.Byte,
                PipeOptions.Asynchronous,
                inBufferSize: 64 * 1024,
                outBufferSize: 64 * 1024,
                pipeSecurity: security);

            _ = Task.Run(() => ServeAsync(_cts.Token));
            return true;
        } catch (Exception e) {
            _log.LogWarning(e, "PipeServer start failed {name}", _pipeName);
            return false;
        }
    }

    private async Task ServeAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested) {
            try {
                await _pipe!.WaitForConnectionAsync(ct);
                _writer = new StreamWriter(_pipe, Encoding.UTF8) { AutoFlush = true, NewLine = "\n" };
                using var reader = new StreamReader(_pipe, Encoding.UTF8);
                while (!ct.IsCancellationRequested) {
                    var line = await reader.ReadLineAsync(ct);
                    if (line is null) break;
                    _hub.Emit(_sid, line);
                }
            } catch (OperationCanceledException) { break; }
            catch (Exception e) {
                _log.LogDebug(e, "pipe {sid} disconnected", _sid);
            } finally {
                try { _pipe!.Disconnect(); } catch { }
                _writer = null;
            }
        }
    }

    public async Task<bool> SendAsync(string json, CancellationToken ct)
    {
        var w = _writer; if (w is null) return false;
        try { await w.WriteLineAsync(json.AsMemory(), ct); return true; }
        catch { return false; }
    }

    public void Dispose()
    {
        _cts?.Cancel();
        try { _pipe?.Dispose(); } catch { }
    }
}
