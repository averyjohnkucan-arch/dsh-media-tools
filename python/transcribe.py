"""Offline CPU Whisper ASR; model paths are explicit and never auto-downloaded."""
import argparse
import json
import math
import wave
import numpy as np
import subprocess
from pathlib import Path
from faster_whisper import WhisperModel

p = argparse.ArgumentParser()
p.add_argument('source'); p.add_argument('output'); p.add_argument('--model', required=True)
p.add_argument('--ffmpeg', default='ffmpeg'); p.add_argument('--language')
a = p.parse_args()
output = Path(a.output)
wav = output/'speech.wav'
try:
    subprocess.run([a.ffmpeg, '-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe',
                    '-i', a.source, '-t', '7200', '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000',
                    '-c:a', 'pcm_s16le', str(wav)], check=True, timeout=180)
    model = WhisperModel(a.model, device='cpu', compute_type='int8', cpu_threads=8,
                         local_files_only=True)
    with wave.open(str(wav), 'rb') as recording:
        samples = np.frombuffer(recording.readframes(recording.getnframes()), dtype='<i2').astype(np.float32) / 32768.0
    segments, info = model.transcribe(samples, beam_size=5, vad_filter=True,
            condition_on_previous_text=False, word_timestamps=True, language=a.language)
    def number(n): return float(n) if n is not None and math.isfinite(float(n)) else None
    rows = []
    for s in segments:
        rows.append(dict(start=s.start, end=s.end, text=s.text.strip(),
            words=[dict(start=w.start, end=w.end, text=w.word, probability=number(w.probability)) for w in s.words or []],
            avg_logprob=number(s.avg_logprob), no_speech_prob=number(s.no_speech_prob),
            compression_ratio=number(s.compression_ratio), temperature=number(s.temperature)))
    result = dict(text='\n'.join(f'[{s["start"]:.2f}–{s["end"]:.2f}] {s["text"]}' for s in rows),
                  segments=rows, duration_seconds=number(info.duration), language=info.language,
                  language_probability=number(info.language_probability),
                  confidence_kind='model_likelihoods_not_calibrated_correctness',
                  max_duration_seconds=7200, truncated_input_possible=True)
    (output/'transcript.json').write_text(json.dumps(result, indent=2, allow_nan=False)+'\n')
    print(json.dumps(result, allow_nan=False))
finally:
    wav.unlink(missing_ok=True)
