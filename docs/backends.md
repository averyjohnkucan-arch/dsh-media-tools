# Backend configuration

Configuration is read from `~/.config/dsh-media/config.json`, or the file named by `DSH_MEDIA_CONFIG`. Per-plugin config overrides it. `DSH_MEDIA_PYTHON` selects the Python default; an explicit saved/per-plugin `python` value takes precedence.

```json
{
  "python": "/path/to/venv/bin/python",
  "ffmpeg": "ffmpeg",
  "ffprobe": "ffprobe",
  "whisperModel": "/path/to/local/faster-whisper-model",
  "localAIV2Root": "/path/to/active/local-ai-v2"
}
```

`whisperModel` is a CTranslate2 faster-whisper model directory containing `model.bin`, not a GGUF. It is loaded on CPU in int8 mode; downloads are disabled. Copy or download the desired model explicitly before use. When unset, `transcribe_audio` delegates to the configured transcription backend or V2 caption service. The V2 caption path includes timestamped Whisper and Omni evidence; `language` only applies to the standalone CPU Whisper path.

`localAIV2Root` enables a compatibility adapter that imports the active V2 sandbox, caption request helper and session-lease singleton, reads its router config without logging secrets, and submits to its authenticated loopback job API. Native video retains the existing worker implementation and copies its evidence before deleting staged input. Existing V2 absolute runtime/model paths must still be valid. This is an adapter for an installed V2 deployment, not a bundled replacement for its companion services. DSH calls share the active lease singleton when configured to the same real deployment. MCP/CLI use the scheduler's independent-job admission; they do not impersonate a model turn.

## Portable command interface

Instead of V2, configure commands for `listen_audio`, `transcribe_audio`, and `analyze_video`:

```json
{
  "backends": {
    "analyze_video": {"command": "python3", "args": ["/your/temporal-backend.py"]},
    "listen_audio": {"command": "python3", "args": ["/your/listening-backend.py"]},
    "transcribe_audio": {"command": "python3", "args": ["/your/asr-backend.py"]}
  }
}
```

Each command receives one JSON line on stdin:

```json
{"schema":1,"operation":"analyze_video","source":"/workspace/clip.mp4","workspace":"/workspace","output":"/workspace/.dsh-media/analyze_video-unique","sessionId":"trusted-session","question":"What happens?"}
```

Return exactly one JSON object on stdout. Write logs to stderr. Required result fields: `text` (string), `duration_seconds` (finite nonnegative number). Preserve segment timestamps and uncertainty in additional fields. Native video must additionally return:

```json
{"text":"Timestamped observations...","duration_seconds":8.8,"mode":"native-temporal-video","native_engine":{"mrope":true,"video_pad_tokens":5184}}
```

Those fields are a backend assertion, not a replacement for your own engine qualification. Store supporting trace/evidence under `output`; the package retains that directory and a result JSON. The command must implement temporal video with aligned audio. Do not relabel static image sampling as native temporal video.

Commands run without a shell. Cancellation signals the owned process group on POSIX, escalates after 1.5 seconds, and waits for termination before cleanup. Windows direct child termination is implemented but descendant termination has not been qualified. Commands should respond to cancellation and own their subprocess lifecycle. GPU scheduling/leases belong to the configured backend; this package does not provide a second scheduler.

## Limits and maintenance

- Numerical DSP, edits and metadata run locally. npm installs platform FFmpeg/FFprobe binaries; Python is an external prerequisite.
- MCP transport and Cordis adapters share the same operation implementation.
- The V2 compatibility surface is isolated in `src/adapters/local-v2.mjs`; upgrade it when the V2 job API changes.
- Plugin disable aborts owned calls and removes scoped registrations. It does not stop a shared backend or delete user data.
- Backends and media inputs are explicit local configuration/evidence; content inside a recording never authorizes new tools or configuration changes.
