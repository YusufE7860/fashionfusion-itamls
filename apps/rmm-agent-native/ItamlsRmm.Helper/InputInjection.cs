using System.Runtime.InteropServices;
using System.Text.Json;

namespace ItamlsRmm.Helper;

/// <summary>
/// Synthetic mouse + keyboard via user32. Payload shape matches what the
/// browser viewer sends:
///
///   kind: mouse_move | mouse_down | mouse_up | wheel | key_down | key_up
///   x, y          — screen coords (for mouse)
///   button        — left | middle | right
///   delta         — wheel notch (±120)
///   vk            — Windows virtual-key code
/// </summary>
public static class InputInjection
{
    public static void Dispatch(JsonElement payload)
    {
        var kind = payload.GetProperty("kind").GetString();
        switch (kind) {
            case "mouse_move": SetCursorPos(payload.GetProperty("x").GetInt32(), payload.GetProperty("y").GetInt32()); break;
            case "mouse_down": MouseButton(payload, down: true);  break;
            case "mouse_up":   MouseButton(payload, down: false); break;
            case "wheel":
                mouse_event(MOUSEEVENTF_WHEEL, 0, 0, (uint)payload.GetProperty("delta").GetInt32(), UIntPtr.Zero);
                break;
            case "key_down":
                keybd_event((byte)payload.GetProperty("vk").GetInt32(), 0, 0, UIntPtr.Zero);
                break;
            case "key_up":
                keybd_event((byte)payload.GetProperty("vk").GetInt32(), 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
                break;
        }
    }

    private static void MouseButton(JsonElement p, bool down)
    {
        if (p.TryGetProperty("x", out var xp) && p.TryGetProperty("y", out var yp))
            SetCursorPos(xp.GetInt32(), yp.GetInt32());

        string button = p.TryGetProperty("button", out var bp) ? (bp.GetString() ?? "left") : "left";
        uint flag = button switch {
            "right"  => down ? MOUSEEVENTF_RIGHTDOWN  : MOUSEEVENTF_RIGHTUP,
            "middle" => down ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_MIDDLEUP,
            _        => down ? MOUSEEVENTF_LEFTDOWN   : MOUSEEVENTF_LEFTUP,
        };
        mouse_event(flag, 0, 0, 0, UIntPtr.Zero);
    }

    private const uint MOUSEEVENTF_LEFTDOWN   = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP     = 0x0004;
    private const uint MOUSEEVENTF_RIGHTDOWN  = 0x0008;
    private const uint MOUSEEVENTF_RIGHTUP    = 0x0010;
    private const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    private const uint MOUSEEVENTF_MIDDLEUP   = 0x0040;
    private const uint MOUSEEVENTF_WHEEL      = 0x0800;
    private const uint KEYEVENTF_KEYUP        = 0x0002;

    [DllImport("user32.dll")] private static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] private static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
    [DllImport("user32.dll")] private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
