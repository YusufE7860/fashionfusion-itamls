using System.Diagnostics;

namespace ItamlsRmm.Helper;

public static class Shell
{
    public record Result(int ExitCode, string Stdout, string Stderr);

    public static Result Run(string script, string interpreter, int timeoutMs)
    {
        var tmp = Path.Combine(Path.GetTempPath(), $"itamls-rmm-{Guid.NewGuid()}.ps1");
        try {
            File.WriteAllText(tmp, script);
            var isCmd = interpreter.Equals("CMD", StringComparison.OrdinalIgnoreCase);
            var psi = new ProcessStartInfo {
                FileName = isCmd ? "cmd.exe" : "powershell.exe",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError  = true,
                CreateNoWindow = true,
            };
            if (isCmd) {
                psi.ArgumentList.Add("/c");
                psi.ArgumentList.Add(script);
            } else {
                psi.ArgumentList.Add("-NoProfile");
                psi.ArgumentList.Add("-ExecutionPolicy"); psi.ArgumentList.Add("Bypass");
                psi.ArgumentList.Add("-File"); psi.ArgumentList.Add(tmp);
            }
            using var p = Process.Start(psi)!;
            if (!p.WaitForExit(timeoutMs)) {
                try { p.Kill(entireProcessTree: true); } catch { }
                return new(124, p.StandardOutput.ReadToEnd(), $"Timed out after {timeoutMs} ms");
            }
            return new(p.ExitCode,
                p.StandardOutput.ReadToEnd(),
                p.StandardError.ReadToEnd());
        } finally { try { File.Delete(tmp); } catch { } }
    }
}
