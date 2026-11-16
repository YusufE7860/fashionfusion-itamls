using System.Runtime.InteropServices;
using System.Text;

namespace ItamlsRmm.Helper.Capture;

/// <summary>
/// "Is the current input desktop Winlogon?" — the question the Winlogon
/// helper asks ~5 times a second so it knows when to actually capture.
/// Avoids wasting CPU + bandwidth when UAC isn't up.
/// </summary>
public static class SecureDesktopDetector
{
    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool GetUserObjectInformation(IntPtr hObj, int nIndex,
        IntPtr pvInfo, uint nLength, out uint lpnLengthNeeded);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool CloseDesktop(IntPtr hDesktop);

    private const int UOI_NAME = 2;
    private const uint DESKTOP_READOBJECTS = 0x0001;

    /// <summary>True when the user is currently on winlogon (UAC prompt, ctrl+alt+del, login screen).</summary>
    public static bool IsOnSecureDesktop()
    {
        var h = OpenInputDesktop(0, false, DESKTOP_READOBJECTS);
        if (h == IntPtr.Zero) return false;
        try {
            IntPtr buf = Marshal.AllocHGlobal(256);
            try {
                if (!GetUserObjectInformation(h, UOI_NAME, buf, 256, out _)) return false;
                var name = Marshal.PtrToStringUni(buf) ?? "";
                return name.Equals("Winlogon", StringComparison.OrdinalIgnoreCase);
            } finally { Marshal.FreeHGlobal(buf); }
        } finally { CloseDesktop(h); }
    }
}
