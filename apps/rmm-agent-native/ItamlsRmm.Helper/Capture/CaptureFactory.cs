namespace ItamlsRmm.Helper.Capture;

/// <summary>
/// Picks the best capture backend at startup. DXGI first; on any failure
/// (RDP session, hypervisor without a GPU adapter, obscure "DXGI 0x887A"
/// errors) falls back to GDI so the helper is never dead in the water.
/// </summary>
public static class CaptureFactory
{
    public static IScreenCapture Create()
    {
        try { return new DxgiCapture(); }
        catch { return new GdiCapture(); }
    }
}
