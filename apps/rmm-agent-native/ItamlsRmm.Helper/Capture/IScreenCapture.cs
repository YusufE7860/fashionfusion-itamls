namespace ItamlsRmm.Helper.Capture;

/// <summary>
/// Capture backend contract. Both GDI (fallback) and DXGI Desktop
/// Duplication (fast path) implement this. Picked at startup by
/// <see cref="CaptureFactory"/> based on what the box can actually do.
/// </summary>
public interface IScreenCapture : IDisposable
{
    /// <summary>Human-readable backend name — logged once at startup.</summary>
    string Name { get; }

    /// <summary>Monitors detected at construction time. Index 0 is primary.</summary>
    IReadOnlyList<MonitorInfo> Monitors { get; }

    /// <summary>
    /// Grab one frame off the given monitor. Returns JPEG-encoded bytes +
    /// the monitor's native size (viewer needs that for click-coord scaling).
    /// Null means "no new frame right now" (DXGI is pull-based and may have
    /// nothing in the pipe).
    /// </summary>
    CaptureFrame? Capture(int monitorIndex, int quality, double scale);
}

public sealed record MonitorInfo(int Index, string Name, int Width, int Height, int X, int Y, bool Primary);

public sealed record CaptureFrame(byte[] JpegBytes, int NativeWidth, int NativeHeight, int MonitorIndex);
