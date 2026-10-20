# Validation

Linux qualification on 2026-10-20: Node 22.22.1, Python 3.12.14, npm-provided FFmpeg 7.0.2 and FFprobe N-66595-gc2b38619c0. DSH packages are unmodified registry releases at 0.2.1-rc.2 with Cordis 4.0.5.

`npm test`: **16 passed, 0 failed**, including the optional real CPU Whisper fixture when `DSH_MEDIA_WHISPER_MODEL` names an existing faster-whisper-small model and `espeak-ng` is installed. Normal CI skips that optional ASR test without model assets.

Verified:

- Real 440 Hz WAV analysis, frequency-bin oracle, non-clipping measurements and both PNG outputs.
- Actual MP4 AAC decoding with nonzero seek, original timestamps and measured frequency.
- Independent sample/duration check of a trimmed, -6 dB WAV edit.
- Audio extraction/conversion and MP4, WebM and GIF generation using the npm binaries.
- Explicit metadata-only video inspection.
- Traversal, symlink escapes, invalid bounds and malformed inputs rejected.
- Cancellation reaps the worker before failed-output cleanup.
- Actual registry DSH ToolRuntime plus Cordis registers eight tools, returns two inline image blocks, disables audio/video independently and re-enables them.
- Cordis effect disposal aborts an active media call and waits for the owned worker.
- Official MCP SDK client discovers all eight tools, receives actual image blocks and sees safe error results.
- Installer creates a separate runtime, repeats upgrades, preserves unrelated/edited skills and uninstalls only its own unchanged skills.
- Real CPU Whisper recognizes the generated phrase “The blue car turns left” with timestamps. FFmpeg supplies PCM directly to avoid a PyAV decoding API incompatibility.

The initial suite checks configuration errors, static-frame rejection and the result contract. Version 0.2 additionally passed real standalone GPU inference with the V2 router stopped:

- Omni listening + CPU Whisper recovered “The blue car turns left” from a generated 2.5-second speech fixture, with a nonempty sound caption; 87.0 seconds including model load.
- Native temporal video correctly reported red then blue and those exact spoken words from a generated 3-second MP4. The engine consumed 1,728 video-pad tokens with M-RoPE, within a 2,671-token prompt; 160.9 seconds including audio/model loading.
- Native executables, Omni shared libraries and CUDA user-space dependencies came from the package-owned cache/environment. Python worker code was shipped inside this repository; the V2 HTTP service was not running.
- Two scheduler tests cover release/unload on success/error and cancellation before admission.
- A real GPU worker cancellation check reaped its process group and removed job scratch. A subsequent one-second, no-audio native-video check returned “Red” with 576 video-pad tokens and M-RoPE in 53.2 seconds.
- The local install imports a relocatable Python distribution into package-owned storage and creates its own venv; it does not need the old V2 Python runtime directory at inference time.

These fixtures validate this Linux/CUDA/Atomic model combination. They are not a broad caption accuracy benchmark, DSH GUI activation test, Windows qualification, or proof for every model label. Qualify each new model/engine/projector combination separately.

The V2 historical integration had observed Omni sound-caption hallucinations. Keep captions separate from measured signal properties and do not interpret model likelihoods as truth probabilities.

To reproduce:

```bash
npm ci
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
DSH_MEDIA_PYTHON="$PWD/.venv/bin/python" npm test
# Optional: set DSH_MEDIA_WHISPER_MODEL to a local model and install espeak-ng.
```

See `provenance.json` for source adaptation hashes. CI runs the non-model Linux suite and npm packaging check.
