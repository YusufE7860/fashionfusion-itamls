using System.Diagnostics;
using System.Management;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;

namespace Itamls.RmmAgent;

public sealed class MetricsSample
{
    public double CpuPct { get; set; }
    public long MemUsedBytes { get; set; }
    public long MemTotalBytes { get; set; }
    public long DiskUsedBytes { get; set; }
    public long DiskTotalBytes { get; set; }
    public long NetRxBytesPerS { get; set; }
    public long NetTxBytesPerS { get; set; }
    public string? LoggedInUser { get; set; }
}

public sealed class MetricsCollector
{
    private readonly PerformanceCounter? _cpu;
    private readonly string _driveLetter;
    private long _lastRx, _lastTx;
    private DateTime _lastNetSampleAt;

    public MetricsCollector()
    {
        try { _cpu = new PerformanceCounter("Processor", "% Processor Time", "_Total"); _cpu.NextValue(); } catch { }
        _driveLetter = Environment.GetEnvironmentVariable("SystemDrive") ?? "C:";
        _lastNetSampleAt = DateTime.UtcNow;
    }

    public MetricsSample Collect()
    {
        var s = new MetricsSample { LoggedInUser = LoggedOnUser() };
        try { s.CpuPct = Math.Round(_cpu?.NextValue() ?? 0, 1); } catch { }

        try
        {
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
            {
                NativeMemoryStatusEx mem = new() { Length = (uint)Marshal.SizeOf<NativeMemoryStatusEx>() };
                if (GlobalMemoryStatusEx(ref mem))
                {
                    s.MemTotalBytes = (long)mem.TotalPhys;
                    s.MemUsedBytes  = (long)(mem.TotalPhys - mem.AvailPhys);
                }
            }
        }
        catch { }

        try
        {
            var info = new DriveInfo(_driveLetter);
            s.DiskTotalBytes = info.TotalSize;
            s.DiskUsedBytes  = info.TotalSize - info.AvailableFreeSpace;
        }
        catch { }

        try
        {
            long rx = 0, tx = 0;
            foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (nic.OperationalStatus != OperationalStatus.Up) continue;
                if (nic.NetworkInterfaceType is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel) continue;
                var stats = nic.GetIPStatistics();
                rx += stats.BytesReceived;
                tx += stats.BytesSent;
            }
            var now = DateTime.UtcNow;
            var dt = (now - _lastNetSampleAt).TotalSeconds;
            if (dt > 0 && _lastRx > 0)
            {
                s.NetRxBytesPerS = (long)((rx - _lastRx) / dt);
                s.NetTxBytesPerS = (long)((tx - _lastTx) / dt);
            }
            _lastRx = rx; _lastTx = tx; _lastNetSampleAt = now;
        }
        catch { }

        return s;
    }

    private static string? LoggedOnUser()
    {
        try
        {
            if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) return Environment.UserName;
            using var searcher = new ManagementObjectSearcher("SELECT UserName FROM Win32_ComputerSystem");
            foreach (var mo in searcher.Get())
            {
                var u = mo["UserName"]?.ToString();
                if (!string.IsNullOrWhiteSpace(u)) return u;
            }
        }
        catch { }
        return null;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeMemoryStatusEx
    {
        public uint Length;
        public uint MemoryLoad;
        public ulong TotalPhys;
        public ulong AvailPhys;
        public ulong TotalPageFile;
        public ulong AvailPageFile;
        public ulong TotalVirtual;
        public ulong AvailVirtual;
        public ulong AvailExtendedVirtual;
    }
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GlobalMemoryStatusEx(ref NativeMemoryStatusEx lpBuffer);
}
