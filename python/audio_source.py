"""Bounded container decoding; existing recordings keep the libsndfile path."""
import json
import os
from pathlib import Path
import subprocess
import tempfile

import soundfile as sf

SAMPLE_BUDGET = 25_000_000
CONTAINERS = 'mov,matroska,webm,avi,mpeg,mpegts,asf,aac,mp3,flac,wav,aiff,ogg'


def _limits(rate, channels, channel, count, fft_size):
    if not 8000 <= rate <= 192000 or not 1 <= channels <= 32:
        raise ValueError('Supported rates are 8–192 kHz and at most 32 channels')
    if not 0 <= channel < channels:
        raise ValueError('Channel index outside file channels')
    if count < fft_size:
        raise ValueError('Segment must contain at least one FFT window')
    if count * channels > SAMPLE_BUDGET:
        raise ValueError('Selected segment exceeds sample budget; use a shorter duration')


def _run(command, timeout):
    try:
        return subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                              check=True, timeout=timeout).stdout
    except FileNotFoundError:
        raise ValueError('Container audio decoding requires FFmpeg and FFprobe') from None
    except subprocess.TimeoutExpired:
        raise ValueError('Container audio decoding timed out; try a shorter segment') from None
    except subprocess.CalledProcessError:
        raise ValueError('Cannot decode an audio track from this file') from None


def read_segment(source, *, start, duration, channel, fft_size, scratch):
    """Return samples, rate, channel count, original first sample and decoder."""
    try:
        audio = sf.SoundFile(source)
    except sf.LibsndfileError:
        audio = None
    if audio is not None:
        with audio:
            rate, channels = audio.samplerate, audio.channels
            first = round(start * rate)
            count = min(round(duration * rate), len(audio) - first)
            _limits(rate, channels, channel, count, fft_size)
            audio.seek(first)
            samples = audio.read(count, dtype='float32', always_2d=True)
        return samples, rate, channels, first, 'libsndfile'

    protocol = ['-protocol_whitelist', 'file,pipe', '-format_whitelist', CONTAINERS]
    raw = _run([os.environ.get('DSH_MEDIA_FFPROBE', 'ffprobe'), '-v', 'error', *protocol, '-select_streams', 'a:0',
                '-show_entries', 'stream=sample_rate,channels,duration', '-of', 'json', str(source)], 15)
    try:
        streams = json.loads(raw)['streams']
        if not streams:
            raise ValueError('This file has no audio track')
        stream = streams[0]
        rate, channels = int(stream['sample_rate']), int(stream['channels'])
    except (KeyError, TypeError, json.JSONDecodeError):
        raise ValueError('Invalid audio stream metadata') from None
    # Enforce allocation limits before running the decoder, even without duration metadata.
    _limits(rate, channels, channel, round(duration * rate), fft_size)
    first = round(start * rate)
    with tempfile.TemporaryDirectory(prefix='container-', dir=scratch) as folder:
        wav = Path(folder) / 'segment.wav'
        byte_limit = SAMPLE_BUDGET * 4 + 65536
        _run([os.environ.get('DSH_MEDIA_FFMPEG', 'ffmpeg'), '-nostdin', '-v', 'error', '-y', *protocol,
              '-ss', str(first / rate), '-i', str(source), '-t', str(duration),
              '-map', '0:a:0', '-vn', '-sn', '-dn', '-threads', '1',
              '-c:a', 'pcm_f32le', '-ar', str(rate), '-fs', str(byte_limit), str(wav)], 60)
        if wav.stat().st_size >= byte_limit:
            raise ValueError('Decoded audio exceeds sample budget')
        with sf.SoundFile(wav) as decoded:
            if decoded.samplerate != rate or decoded.channels != channels:
                raise ValueError('Decoded audio stream metadata changed')
            _limits(rate, channels, channel, len(decoded), fft_size)
            samples = decoded.read(dtype='float32', always_2d=True)
    return samples, rate, channels, first, 'ffmpeg'
