using System.Windows.Forms;

namespace ItamlsRmm.Helper;

/// <summary>
/// Thread-safe clipboard access. WinForms' Clipboard requires an STA
/// apartment — every call bounces through a tiny STA thread so helper
/// code can live in its async / ThreadPool world.
/// </summary>
public static class ClipboardBridge
{
    public static string? TryGetText()
    {
        string? text = null;
        RunSta(() => { if (Clipboard.ContainsText()) text = Clipboard.GetText(); });
        return text;
    }

    public static void SetText(string s) => RunSta(() => Clipboard.SetText(s ?? ""));

    private static void RunSta(Action a)
    {
        Exception? err = null;
        var t = new Thread(() => { try { a(); } catch (Exception e) { err = e; } });
        t.SetApartmentState(ApartmentState.STA);
        t.IsBackground = true;
        t.Start();
        t.Join(2_000);
        if (err is not null) throw err;
    }
}
