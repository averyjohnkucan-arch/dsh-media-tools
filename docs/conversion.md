# Conversion and editing

FFmpeg and FFprobe binaries are installed by npm using pinned `ffmpeg-static` and `@ffprobe-installer/ffprobe` dependencies. The resolver chooses those binaries automatically; override `ffmpeg` or `ffprobe` in config to use your own build. Run `dsh-media doctor` to see the versions that execute. Unsupported platforms can use explicit host binaries. The binary packages retain their own FFmpeg licenses and provenance; they are dependencies, not checked-in executables.

Select these tools directly in DSH or your MCP client:

| Tool | Purpose | Main options |
| --- | --- | --- |
| `convert_audio` | Convert or extract a video's audio track | `format`: wav/flac/mp3/m4a/ogg |
| `convert_video` | Convert video, or make a 640px/10FPS preview GIF | `format`: mp4/webm/gif |
| `edit_audio` | Trim, adjust gain, normalize, fade | `gain_db`, `normalize`, `fade_seconds` |
| `probe_video` | Inspect streams/container metadata | `source_path` |

All conversion/edit tools accept `start_seconds` and `duration_seconds`. Default duration is **30 seconds**; maximum is two hours. Specify the intended duration explicitly for a longer file. The source stays unchanged; every call writes a new result directory. Normalization uses a single-pass FFmpeg loudnorm target of -16 LUFS / -1.5 dBTP / 11 LU LRA; verify the resulting levels when exact compliance matters.

Example CLI use:

```bash
node src/cli.mjs convert_audio --workspace /path/to/workspace \
  --args '{"source_path":"video.mp4","format":"flac","duration_seconds":60}'
node src/cli.mjs convert_video --workspace /path/to/workspace \
  --args '{"source_path":"video.mov","format":"mp4","duration_seconds":60}'
node src/cli.mjs convert_video --workspace /path/to/workspace \
  --args '{"source_path":"video.mp4","format":"gif","start_seconds":3,"duration_seconds":5}'
```

The bundled FFmpeg can also be used directly for an advanced operation. Resolve its path with `node -p "require('ffmpeg-static')"` from the installed runtime directory, then run that executable with normal FFmpeg arguments. Direct invocation is outside this package's workspace checks; choose source/output paths deliberately.

FFmpeg upstream documentation: https://ffmpeg.org/ffmpeg.html . Binary package documentation: https://github.com/eugeneware/ffmpeg-static and https://github.com/SavageCore/node-ffprobe-installer .
