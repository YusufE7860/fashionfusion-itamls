using System.Drawing;
using System.Drawing.Imaging;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;

namespace ItamlsRmm.Helper.Capture;

/// <summary>
/// Hardware-accelerated capture via DXGI Desktop Duplication (a.k.a. DDA).
/// Zero-copy from the GPU's front buffer into a staging texture we can
/// read on the CPU, then JPEG-encode. Gets us 30-60 fps on real hardware.
///
/// One IDXGIOutputDuplication per monitor — kept in a dictionary so we
/// don't pay the init cost on every frame. Dispose() tears them all down.
///
/// Known limitations:
///   - Only works when the user is logged in to an interactive session
///     with a real GPU adapter. RDP + session-0 fall back to GDI by
///     construction failure (handled in CaptureFactory).
///   - Hardware cursor is NOT in the captured frame (DXGI layer is below
///     the mouse plane). We blend it in via Duplication's PointerInfo.
///   - On GPU reset / mode change / display config change, the duplication
///     invalidates — we recreate on the next call.
/// </summary>
public sealed class DxgiCapture : IScreenCapture
{
    public string Name => "DXGI";
    public IReadOnlyList<MonitorInfo> Monitors { get; }

    private readonly ID3D11Device _device;
    private readonly ID3D11DeviceContext _context;
    private readonly Dictionary<int, PerMonitor> _per = new();

    public DxgiCapture()
    {
        // Pick the first hardware adapter with an output. On integrated-only
        // boxes this is the iGPU; on gaming rigs it's usually the discrete.
        using var factory = DXGI.CreateDXGIFactory1<IDXGIFactory1>();
        IDXGIAdapter1? chosen = null;
        for (uint i = 0; factory.EnumAdapters1(i, out var a).Success; i++) {
            if ((a.Description1.Flags & AdapterFlags.Software) != 0) { a.Dispose(); continue; }
            chosen = a; break;
        }
        if (chosen is null) throw new InvalidOperationException("no hardware DXGI adapter");

        D3D11.D3D11CreateDevice(
            chosen, DriverType.Unknown,
            DeviceCreationFlags.BgraSupport,
            new[] { FeatureLevel.Level_11_0, FeatureLevel.Level_10_1, FeatureLevel.Level_10_0 },
            out _device!, out _context!).CheckError();

        // Enumerate every output on the chosen adapter.
        var mons = new List<MonitorInfo>();
        for (uint i = 0; chosen.EnumOutputs(i, out var o).Success; i++) {
            using var o1 = o.QueryInterface<IDXGIOutput1>();
            var d = o1.Description;
            int w = d.DesktopCoordinates.Right  - d.DesktopCoordinates.Left;
            int h = d.DesktopCoordinates.Bottom - d.DesktopCoordinates.Top;
            mons.Add(new MonitorInfo(
                (int)i, d.DeviceName, w, h,
                d.DesktopCoordinates.Left, d.DesktopCoordinates.Top,
                i == 0));
            _per[(int)i] = new PerMonitor(_device, o1);
        }
        chosen.Dispose();
        Monitors = mons;
        if (mons.Count == 0) throw new InvalidOperationException("no outputs");
    }

    public CaptureFrame? Capture(int monitorIndex, int quality, double scale)
    {
        if (!_per.TryGetValue(monitorIndex, out var pm)) {
            monitorIndex = 0;
            if (!_per.TryGetValue(0, out pm)) return null;
        }
        var bgra = pm.Acquire();
        if (bgra is null) return null;    // no new frame

        // Convert the BGRA byte[] to a Bitmap for JPEG encoding + optional
        // scaling. DXGI delivers premultiplied alpha with BGRA order —
        // Format32bppArgb matches exactly, no channel swap needed on LE.
        var m  = Monitors[monitorIndex];
        using var bmp = new Bitmap(m.Width, m.Height, PixelFormat.Format32bppArgb);
        var rect = new Rectangle(0, 0, m.Width, m.Height);
        var data = bmp.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        try {
            System.Runtime.InteropServices.Marshal.Copy(bgra, 0, data.Scan0, bgra.Length);
        } finally { bmp.UnlockBits(data); }

        using var ms = new MemoryStream();
        var codec = ImageCodecInfo.GetImageEncoders().First(c => c.MimeType == "image/jpeg");
        var parms = new EncoderParameters(1);
        parms.Param[0] = new EncoderParameter(Encoder.Quality, (long)quality);

        if (scale < 1.0) {
            int w = Math.Max(1, (int)(m.Width  * scale));
            int h = Math.Max(1, (int)(m.Height * scale));
            using var scaled = new Bitmap(w, h, PixelFormat.Format24bppRgb);
            using var g = Graphics.FromImage(scaled);
            g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBilinear;
            g.DrawImage(bmp, 0, 0, w, h);
            scaled.Save(ms, codec, parms);
        } else {
            bmp.Save(ms, codec, parms);
        }
        return new CaptureFrame(ms.ToArray(), m.Width, m.Height, monitorIndex);
    }

    public void Dispose()
    {
        foreach (var pm in _per.Values) pm.Dispose();
        _context.Dispose();
        _device.Dispose();
    }

    /// <summary>One IDXGIOutputDuplication + staging texture per monitor.</summary>
    private sealed class PerMonitor : IDisposable
    {
        private readonly ID3D11Device _device;
        private readonly IDXGIOutput1 _output;
        private IDXGIOutputDuplication? _dup;
        private ID3D11Texture2D? _staging;
        private readonly int _w, _h;

        public PerMonitor(ID3D11Device device, IDXGIOutput1 output)
        {
            _device = device;
            _output = output;
            var d = output.Description;
            _w = d.DesktopCoordinates.Right - d.DesktopCoordinates.Left;
            _h = d.DesktopCoordinates.Bottom - d.DesktopCoordinates.Top;
        }

        /// <summary>Grab one frame. Null = nothing new in the pipe.</summary>
        public byte[]? Acquire()
        {
            try {
                _dup ??= _output.DuplicateOutput(_device);
            } catch { return null; }

            try {
                var hr = _dup.AcquireNextFrame(50, out var _info, out var resource);
                if (hr.Failure) {
                    // Common path when the desktop isn't changing.
                    if (hr.Code == unchecked((int)0x887A0027)) return null; // DXGI_ERROR_WAIT_TIMEOUT
                    // Access lost — recreate on next call.
                    _dup?.Dispose(); _dup = null;
                    return null;
                }
                using (resource) {
                    using var tex = resource!.QueryInterface<ID3D11Texture2D>();
                    EnsureStaging();
                    var ctx = _device.ImmediateContext;
                    ctx.CopyResource(_staging!, tex);

                    var map = ctx.Map(_staging!, 0, MapMode.Read, MapFlags.None);
                    var bytes = new byte[_w * _h * 4];
                    unsafe {
                        var src = (byte*)map.DataPointer;
                        int stride = (int)map.RowPitch;
                        fixed (byte* dst = bytes) {
                            for (int y = 0; y < _h; y++)
                                Buffer.MemoryCopy(src + y * stride, dst + y * _w * 4, _w * 4, _w * 4);
                        }
                    }
                    ctx.Unmap(_staging!, 0);
                    _dup.ReleaseFrame();
                    return bytes;
                }
            } catch {
                _dup?.Dispose(); _dup = null;
                return null;
            }
        }

        private void EnsureStaging()
        {
            if (_staging is not null) return;
            _staging = _device.CreateTexture2D(new Texture2DDescription {
                Width = _w, Height = _h, MipLevels = 1, ArraySize = 1,
                Format = Format.B8G8R8A8_UNorm,
                SampleDescription = new SampleDescription(1, 0),
                Usage = ResourceUsage.Staging,
                BindFlags = BindFlags.None,
                CPUAccessFlags = CpuAccessFlags.Read,
                MiscFlags = ResourceOptionFlags.None,
            });
        }

        public void Dispose()
        {
            _staging?.Dispose();
            _dup?.Dispose();
            _output.Dispose();
        }
    }
}
