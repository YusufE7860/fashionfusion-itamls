using System.Drawing;
using System.Drawing.Imaging;
using System.Windows.Forms;

namespace ItamlsRmm.Helper.Capture;

/// <summary>
/// GDI fallback. Slower than DXGI (~10-15 fps on a busy desktop) but works
/// everywhere — RDP sessions, Hyper-V consoles, virtual displays, the lot.
/// Used when DXGI construction fails.
/// </summary>
public sealed class GdiCapture : IScreenCapture
{
    public string Name => "GDI";
    public IReadOnlyList<MonitorInfo> Monitors { get; }

    public GdiCapture()
    {
        var mons = new List<MonitorInfo>();
        for (int i = 0; i < Screen.AllScreens.Length; i++) {
            var s = Screen.AllScreens[i];
            mons.Add(new MonitorInfo(
                i, s.DeviceName, s.Bounds.Width, s.Bounds.Height,
                s.Bounds.X, s.Bounds.Y, s.Primary));
        }
        Monitors = mons;
    }

    public CaptureFrame? Capture(int monitorIndex, int quality, double scale)
    {
        if (monitorIndex < 0 || monitorIndex >= Monitors.Count) monitorIndex = 0;
        var m = Monitors[monitorIndex];
        int w = Math.Max(1, (int)(m.Width  * scale));
        int h = Math.Max(1, (int)(m.Height * scale));

        using var bmp = new Bitmap(w, h, PixelFormat.Format24bppRgb);
        using var g   = Graphics.FromImage(bmp);
        if (scale < 1.0) {
            g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBilinear;
            using var native = new Bitmap(m.Width, m.Height, PixelFormat.Format24bppRgb);
            using (var ng = Graphics.FromImage(native))
                ng.CopyFromScreen(m.X, m.Y, 0, 0, new Size(m.Width, m.Height));
            g.DrawImage(native, 0, 0, w, h);
        } else {
            g.CopyFromScreen(m.X, m.Y, 0, 0, new Size(m.Width, m.Height));
        }

        using var ms = new MemoryStream();
        var codec = ImageCodecInfo.GetImageEncoders().First(c => c.MimeType == "image/jpeg");
        var parms = new EncoderParameters(1);
        parms.Param[0] = new EncoderParameter(Encoder.Quality, (long)quality);
        bmp.Save(ms, codec, parms);
        return new CaptureFrame(ms.ToArray(), m.Width, m.Height, monitorIndex);
    }

    public void Dispose() { }
}
