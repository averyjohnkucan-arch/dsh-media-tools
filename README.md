# dsh-media-tools

Two DSH/Cordis plugins in one repository, plus agent skills, a CLI and a stdio MCP server. Adapted from the configured audio/video integrations in Local AI v2.

| Plugin | Tools |
| --- | --- |
| Audio | `analyze_audio`, `edit_audio`, `convert_audio`, `transcribe_audio`, `listen_audio` |
| Video | `probe_video`, `convert_video`, `analyze_video` |

Audio analysis produces waveform, FFT, spectrogram and waterfall PNGs, numerical spectrum data and digital-level measurements. DSH and MCP return the plot images inline. Edits create a new WAV. Local CPU Whisper produces timestamped speech; Local AI v2 supplies Omni sound descriptions and native temporal video with aligned speech/audio.

## Install skills and runtime

Requirements: Node 22.19+, Python 3.10–3.12 with venv/pip, FFmpeg and FFprobe binaries are installed automatically as npm dependencies for supported platforms. Explicit `ffmpeg` / `ffprobe` config paths override them. Python requirements are pinned for Python 3.12. Windows is a portability target; it has not been qualified. The optional Local AI v2 adapter is Linux-only.

```bash
git clone https://github.com/averyjohnkucan-arch/dsh-media-tools.git dsh-media-tools
cd dsh-media-tools
npm ci
node src/install.mjs --setup-python --python python3
```

This installs both skills into `~/.agents/skills`, copies the runtime into a versioned directory under `~/.local/share/dsh-media-tools`, and writes a per-user config at `~/.config/dsh-media/config.json`. Moving the checkout afterward does not break the installed skills. Existing unowned skills and locally edited installed skills are preserved; the installer stops before replacing them. Repeat the command to upgrade. Previous runtime directories remain for rollback; uninstall preserves them, configuration, models and generated files.

For your existing Local AI v2 deployment, add:

```bash
node src/install.mjs --setup-python --python python3 \
  --local-ai /path/to/active/local-ai-v2 \
  --whisper-model /path/to/faster-whisper-model
```

The root must be the **active** V2 deployment, whose configured scheduler and runtime paths remain valid. A copied archive alone is not a running backend. The adapter retains V2's worker sandbox and scheduler; it does not boot another GPU model or modify/restart DSH. Full inference weights and native engine builds are external prerequisites.

The installer prints the installed runtime path and MCP command. Run that runtime's `src/cli.mjs doctor` to inspect prerequisites. `doctor` reports configured inference backends separately from live qualification.

## DSH plugins

Target: stock DSH `0.2.1-rc.2` and Cordis `~4.0.5`. DSH is in developer preview; other versions require compatibility testing.

Install the npm tarball using DSH's plugin manager, or run its plugin-add command from your chosen profile:

```bash
npm pack
# In the DSH profile directory:
dsh plugin --profile web add /absolute/path/dsh-media-tools-0.1.0.tgz
```

The package's `dsh.bundle.patch` inserts two independent plugins. Each registers through `defineTool`, uses attachment services and system-prompt sections, and hooks Cordis disposal to cancel its own work. No host source patches are required. Disable `dsh-media-audio` or `dsh-media-video` independently through DSH's Cordis controls; scoped registrations/prompt sections disappear and in-flight owned calls are cancelled. Enabling restores the registrations. Disabling never removes outputs, models or config.

For manual profile composition, `audio.patch.yml` and `video.patch.yml` contain the individual inserts. Both read the shared per-user config or `DSH_MEDIA_CONFIG`; per-plugin `config` values override that file. Avoid registering the same tools through both the direct plugins and MCP in one DSH profile.

The install script installs agent skills; it does **not** edit a live DSH profile or reload DSH. Keep any active indexing jobs running while you choose a safe profile activation time.

See [conversion recipes](docs/conversion.md) for extraction, transcoding and editing.

## CLI

```bash
node src/cli.mjs doctor
node src/cli.mjs analyze_audio --workspace /path/to/workspace \
  --args '{"source_path":"recording.mp3","duration_seconds":30,"fft_size":8192}'
node src/cli.mjs edit_audio --workspace /path/to/workspace \
  --args '{"source_path":"recording.mp3","start_seconds":2,"duration_seconds":10,"gain_db":-3,"fade_seconds":0.2}'
node src/cli.mjs transcribe_audio --workspace /path/to/workspace \
  --args '{"source_path":"speech.wav"}'
node src/cli.mjs analyze_video --workspace /path/to/workspace \
  --args '{"source_path":"clip.mp4","question":"Describe the events in timestamp order."}'
```

CLI source paths must be relative to the explicitly authorized workspace. DSH additionally accepts the latest single media upload or an attachment ID. Outputs are unique directories under `<workspace>/.dsh-media`; original media is never overwritten. The path checks prevent accidental traversal/symlink escapes; the portable CPU runner is not an OS security sandbox. Local AI v2 retains its own sandbox.

Audio numerical segments are at most 120 seconds and 25 million channel-samples. Input size is at most 2 GiB. CPU speech transcription is limited to the first two hours. Edits are bounded to two hours. Raw Whisper likelihoods are not calibrated correctness percentages. Numerical levels are dBFS, not calibrated SPL. Sound descriptions can hallucinate.

## MCP

```json
{
  "mcpServers": {
    "dsh-media": {
      "command": "node",
      "args": ["/absolute/installed/runtime/src/mcp.mjs", "--workspace", "/authorized/workspace"]
    }
  }
}
```

The server requires an explicit workspace, uses the official MCP SDK, and returns plot image blocks plus file paths and report JSON. The client renders audio playback from the returned WAV path where supported. It does not silently change any MCP client configuration.

## Backends, tests and limitations

See [backend configuration](docs/backends.md) and [validation](docs/validation.md). Run `npm ci && npm test` with the pinned Python packages installed; `DSH_MEDIA_PYTHON` selects the test interpreter.

**Model requirement:** `analyze_video` is specifically for models with native temporal video support and a compatible temporal engine/projector. User deployment examples: Flash 3.8, Flash Next, Qwen 3.6 35B-A3B and Qwen 27B. These names are examples, not a tested compatibility matrix; validate each deployed model/engine/projector combination.

Native video never falls back to independent still frames. The V2 adapter preserves its 6 FPS / 15-second / 3-second-overlap path and requires native temporal tokens plus M-RoPE evidence. A portable command adapter supports other deployments with the same evidence contract. The package is independently installable; native inference requires one of those configured backends.

The local package does not include private settings, tokens, chat histories, recordings, models, or production runtime binaries. Source adaptation hashes are recorded in `provenance.json`. DSH/MCP and Python dependencies retain their respective licenses.
