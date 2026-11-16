using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace ItamlsRmm.Helper.Audio;

/// <summary>
/// WASAPI loopback capture of the default render device — i.e. "what the
/// user is hearing". Down-sampled on the fly to 24 kHz mono 16-bit PCM so
/// browser bandwidth stays sensible (~48 KB/s). Browser decodes with the
/// Web Audio API; no codec negotiation required.
///
/// Call <see cref="Start"/> when a viewer opts in to audio and
/// <see cref="Stop"/> when they stop. Chunks fire through <see cref="OnChunk"/>
/// roughly every 100 ms (configurable via buffer size).
/// </summary>
public sealed class LoopbackAudio : IDisposable
{
    public event Action<byte[]>? OnChunk;

    private WasapiLoopbackCapture? _cap;
    private WaveFormat _outFmt = new WaveFormat(24_000, 16, 1);
    private readonly object _lock = new();

    public int SampleRate => _outFmt.SampleRate;
    public int Channels   => _outFmt.Channels;

    public void Start()
    {
        lock (_lock) {
            if (_cap is not null) return;
            _cap = new WasapiLoopbackCapture { ShareMode = AudioClientShareMode.Shared };
            _cap.DataAvailable += (_, e) => Resample(e.Buffer, e.BytesRecorded, _cap!.WaveFormat);
            try { _cap.StartRecording(); }
            catch { Stop(); }
        }
    }

    public void Stop()
    {
        lock (_lock) {
            try { _cap?.StopRecording(); } catch { }
            try { _cap?.Dispose(); } catch { }
            _cap = null;
        }
    }

    public void Dispose() => Stop();

    /// <summary>
    /// Down-mix + down-sample incoming audio to our 24 kHz mono 16-bit
    /// target format. Browsers don't natively decode arbitrary WASAPI
    /// formats (usually 48 kHz float stereo); this keeps the wire format
    /// stable and tiny.
    /// </summary>
    private void Resample(byte[] buffer, int count, WaveFormat srcFmt)
    {
        if (count <= 0) return;
        // Fast path: already 16-bit PCM and the right sample rate / channels.
        if (srcFmt.Encoding == WaveFormatEncoding.Pcm &&
            srcFmt.BitsPerSample == 16 &&
            srcFmt.Channels == _outFmt.Channels &&
            srcFmt.SampleRate == _outFmt.SampleRate) {
            var copy = new byte[count];
            Buffer.BlockCopy(buffer, 0, copy, 0, count);
            OnChunk?.Invoke(copy);
            return;
        }

        // Slow path: convert via NAudio's provider pipeline. We instance a
        // reader per chunk — not the fastest option, but WasapiLoopback hands
        // us 100 ms at a time so the allocation cost stays trivial.
        using var mem = new RawSourceWaveStream(buffer, 0, count, srcFmt);
        ISampleProvider sampleProv = mem.ToSampleProvider();
        if (srcFmt.Channels == 2 && _outFmt.Channels == 1)
            sampleProv = sampleProv.ToMono();
        if (sampleProv.WaveFormat.SampleRate != _outFmt.SampleRate)
            sampleProv = new NAudio.Dsp.WdlResamplingSampleProvider(sampleProv, _outFmt.SampleRate);

        // Back to 16-bit PCM bytes.
        var pcm = new SampleToWaveProvider16(sampleProv);
        using var ms = new MemoryStream();
        var tmp = new byte[4096];
        int n;
        while ((n = pcm.Read(tmp, 0, tmp.Length)) > 0) ms.Write(tmp, 0, n);
        OnChunk?.Invoke(ms.ToArray());
    }
}
