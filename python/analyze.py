"""Bounded local signal analysis. Numerical DSP only; no model inference."""
import argparse
import json
import math
import os
from pathlib import Path
import sys

WORKSPACE = Path(os.environ['DSH_MEDIA_WORKSPACE']).resolve()
os.environ.setdefault('MPLCONFIGDIR', str(WORKSPACE/'.dsh-media/cache/matplotlib'))
import numpy as np
from scipy import signal
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from audio_source import read_segment


def analyze(source, destination, *, start=0.0, duration=30.0, channel=0, fft_size=2048, scratch=None):
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if not source.is_relative_to(WORKSPACE) or not destination.is_relative_to(WORKSPACE):
        raise ValueError('Input and output must remain inside the authorized workspace')
    if not math.isfinite(start) or not math.isfinite(duration) or start < 0 or not 0 < duration <= 120:
        raise ValueError('Choose a finite positive segment of at most 120 seconds')
    if fft_size not in (256, 512, 1024, 2048, 4096, 8192):
        raise ValueError('FFT size must be a supported power of two, 256–8192')
    scratch = Path(scratch or os.environ.get('TMPDIR', WORKSPACE/'.tmp')).resolve()
    if not scratch.is_relative_to(WORKSPACE) or not scratch.is_dir():
        raise ValueError('Decoder scratch must be an existing workspace directory')
    samples, rate, channels, first, decoder = read_segment(source, start=start,
        duration=duration, channel=channel, fft_size=fft_size, scratch=scratch)
    if not np.isfinite(samples).all():
        raise ValueError('Audio contains non-finite samples')
    x = samples[:, channel].astype(np.float64)
    hop = fft_size//4
    # One-sided magnitude: 0 dBFS corresponds to a full-scale bin-centred sine peak.
    frequency, times, spectrum = signal.stft(x, fs=rate, window='hann', nperseg=fft_size,
                                            noverlap=fft_size-hop, boundary=None, padded=False,
                                            scaling='spectrum')
    amplitude = np.abs(spectrum)*2
    amplitude[0] /= 2
    amplitude[-1] /= 2
    db = 20*np.log10(np.maximum(amplitude, 1e-6))
    average_amplitude = np.sqrt(np.mean(amplitude**2, axis=1))
    average_db = 20*np.log10(np.maximum(average_amplitude, 1e-6))
    peak_index = int(np.argmax(average_amplitude))
    rms = float(np.sqrt(np.mean(x*x)))
    result = {'source':str(source.relative_to(WORKSPACE)), 'decoder':decoder, 'sample_rate_hz':rate, 'channels':channels,
              'selected_channel':channel, 'start_seconds':first/rate, 'analyzed_seconds':len(x)/rate,
              'fft_size':fft_size, 'hop_samples':hop, 'window':'periodic Hann',
              'frequency_resolution_hz':rate/fft_size,
              'level_reference':'dBFS peak sine amplitude; floor -120 dBFS; not calibrated SPL',
              'peak_sample':float(np.max(np.abs(x))), 'rms':rms,
              'rms_dbfs':20*math.log10(max(rms,1e-6)),
              'clipped_sample_count':int(np.count_nonzero(np.abs(x)>=1)),
              'dominant_frequency_hz':float(frequency[peak_index]) if rms else None,
              'dominant_amplitude_dbfs':float(average_db[peak_index]) if rms else None}
    # A fresh job directory prevents accidental replacement of user files.
    destination.mkdir(parents=True, exist_ok=False)
    np.savez_compressed(destination/'spectrum.npz', frequency_hz=frequency,
                        time_seconds=times+first/rate, amplitude_dbfs=db)
    fig, axes = plt.subplots(3,1,figsize=(12,10),layout='constrained')
    stride = max(1,len(x)//50000)
    axes[0].plot(np.arange(0,len(x),stride)/rate+first/rate,x[::stride],lw=.6)
    axes[0].set(title=f'Waveform — channel {channel+1}',xlabel='Time (s)',ylabel='Amplitude (FS)')
    axes[1].plot(frequency,average_db,lw=.8)
    axes[1].set(title='RMS-averaged FFT magnitude',xlabel='Frequency (Hz)',ylabel='dBFS',ylim=(-120,5))
    # Downsample display only; preserve every analysis frame in the numeric artifact.
    display_stride=max(1,len(times)//1200)
    mesh=axes[2].pcolormesh(times[::display_stride]+first/rate,frequency,db[:,::display_stride],
                          shading='auto',vmin=-120,vmax=0,cmap='magma')
    axes[2].set(title='Spectrogram',xlabel='Time (s)',ylabel='Frequency (Hz)')
    fig.colorbar(mesh,ax=axes[2],label='dBFS')
    fig.savefig(destination/'analysis.png',dpi=130);plt.close(fig)
    fig=plt.figure(figsize=(12,7),layout='constrained');ax=fig.add_subplot(projection='3d')
    for idx in np.linspace(0,len(times)-1,min(60,len(times)),dtype=int):
        ax.plot(frequency,np.full_like(frequency,times[idx]+first/rate),db[:,idx],lw=.7)
    ax.set(title='Spectral waterfall',xlabel='Frequency (Hz)',ylabel='Time (s)',zlabel='dBFS',zlim=(-120,5))
    fig.savefig(destination/'waterfall.png',dpi=130);plt.close(fig)
    result['artifacts']=['analysis.png','waterfall.png','spectrum.npz','report.json']
    (destination/'report.json').write_text(json.dumps(result,indent=2,allow_nan=False)+'\n')
    return result


if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('source');p.add_argument('destination')
    p.add_argument('--start',type=float,default=0);p.add_argument('--duration',type=float,default=30)
    p.add_argument('--channel',type=int,default=0);p.add_argument('--fft-size',type=int,default=2048)
    p.add_argument('--scratch')
    args=p.parse_args()
    try:
        result = analyze(args.source,args.destination,start=args.start,duration=args.duration,
                         channel=args.channel,fft_size=args.fft_size,scratch=args.scratch)
    except ValueError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
    print(json.dumps(result,allow_nan=False))
