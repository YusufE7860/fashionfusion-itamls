using System.Diagnostics;
using System.Text;

namespace Itamls.RmmAgent;

public sealed class ShellResult
{
    public int ExitCode { get; set; }
    public string Stdout { get; set; } = "";
    public string Stderr { get; set; } = "";
    public bool TimedOut { get; set; }
}

public sealed class ShellRunner
{
    /// <summary>
    /// Runs a shell command. interpreter: "POWERSHELL" | "CMD" | "BASH" (bash only on Linux).
    /// Streams stdout/stderr as chunks via onChunk; also returns the full output.
    /// </summary>
    public async Task<ShellResult> RunAsync(string script, string interpreter, int timeoutMs,
        Func<string, string, Task> onChunk, CancellationToken ct)
    {
        var psi = BuildStartInfo(script, interpreter);
        var p = new Process { StartInfo = psi, EnableRaisingEvents = true };
        var stdout = new StringBuilder();
        var stderr = new StringBuilder();
        var stdoutDone = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var stderrDone = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

        p.OutputDataReceived += async (_, e) =>
        {
            if (e.Data is null) { stdoutDone.TrySetResult(true); return; }
            stdout.AppendLine(e.Data);
            try { await onChunk("stdout", e.Data + "\n"); } catch { }
        };
        p.ErrorDataReceived += async (_, e) =>
        {
            if (e.Data is null) { stderrDone.TrySetResult(true); return; }
            stderr.AppendLine(e.Data);
            try { await onChunk("stderr", e.Data + "\n"); } catch { }
        };

        p.Start();
        p.BeginOutputReadLine();
        p.BeginErrorReadLine();

        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeoutCts.CancelAfter(timeoutMs);

        try
        {
            await p.WaitForExitAsync(timeoutCts.Token);
            await Task.WhenAll(stdoutDone.Task, stderrDone.Task);
        }
        catch (OperationCanceledException)
        {
            try { p.Kill(entireProcessTree: true); } catch { }
            return new ShellResult { TimedOut = true, ExitCode = -1,
                Stdout = stdout.ToString(), Stderr = stderr.ToString() + "\n[timed out]" };
        }

        return new ShellResult { ExitCode = p.ExitCode, Stdout = stdout.ToString(), Stderr = stderr.ToString() };
    }

    private static ProcessStartInfo BuildStartInfo(string script, string interpreter)
    {
        if (OperatingSystem.IsWindows() && interpreter.Equals("CMD", StringComparison.OrdinalIgnoreCase))
        {
            return new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = "/c " + script.Replace("\n", " & "),
                RedirectStandardOutput = true, RedirectStandardError = true,
                UseShellExecute = false, CreateNoWindow = true,
            };
        }
        if (OperatingSystem.IsWindows())
        {
            // PowerShell 5 (ships with Windows). Use -EncodedCommand so arbitrary
            // scripts with quotes / newlines pass through cleanly without
            // shell-escape wars.
            var utf16 = System.Text.Encoding.Unicode.GetBytes(script);
            var b64   = Convert.ToBase64String(utf16);
            return new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = $"-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand {b64}",
                RedirectStandardOutput = true, RedirectStandardError = true,
                UseShellExecute = false, CreateNoWindow = true,
            };
        }
        // Non-Windows (unlikely in RMM, but allowed for testing)
        return new ProcessStartInfo
        {
            FileName = "/bin/bash",
            Arguments = "-c \"" + script.Replace("\"", "\\\"") + "\"",
            RedirectStandardOutput = true, RedirectStandardError = true,
            UseShellExecute = false, CreateNoWindow = true,
        };
    }

}
