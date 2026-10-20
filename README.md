# dsh-media-tools

Two independent DSH/Cordis plugins, agent skills, a CLI and a stdio MCP server, with included on-demand Omni listening and native temporal video backends. The old Local AI v2 application does not need to run.

| Plugin | Selectable tools |
| --- | --- |
| Audio | `analyze_audio`, `edit_audio`, `convert_audio`, `transcribe_audio`, `listen_audio` |
| Video | `probe_video`, `convert_video`, `analyze_video` |

Audio analysis returns inline waveform/FFT/spectrogram and waterfall plots, measured digital levels, and numerical spectrum data. Editing creates a new WAV. Conversion supports audio extraction plus WAV/FLAC/MP3/M4A/OGG and MP4/WebM/GIF. CPU Whisper supplies timestamped speech. Omni supplies fallible sound descriptions. Native video preserves temporal frames, aligned audio and engine evidence.

## Install

```bash
git clone https://github.com/averyjohnkucan-arch/dsh-media-tools.git
cd dsh-media-tools
npm ci
node src/install.mjs --setup-python \
  --include-backends --local-ai '/path/to/Local AI version 2'
```

This installs both skills into `~/.agents/skills`, copies the runtime into a versioned directory under `~/.local/share/dsh-media-tools`, and configures `~/.config/dsh-media/config.json`. It uses V2 **once as an import source**, copies native executables into its own cache, and reuses the model store. The old V2 application and inference companion can stay stopped. On Linux, an available standalone Python distribution is also imported into package-owned storage when no `--python` is specified. Moving the plugin checkout does not break the installed skills.

FFmpeg and FFprobe binaries install automatically through pinned npm dependencies. Python 3.12 with venv/pip and an NVIDIA driver are host prerequisites. Setup installs the CUDA user-space runtime libraries. The native executable bundle currently targets Linux x64/CUDA 13; Windows/macOS GPU execution is not qualified. CPU tools use the platform FFmpeg dependencies where available.

For a fresh machine with separately selected models, replace `--local-ai` with `--backend-config /path/to/backend-models.json`. Setup downloads and SHA256-verifies this repo's versioned native runtime asset. Model weights are large and remain separate: Omni plus its projector is about 21 GB; native video may need considerably more. See [standalone backend setup](docs/standalone-backends.md).

For CPU tools only, omit `--include-backends` and `--local-ai`; configure `--whisper-model /path/to/faster-whisper-model` for speech. Existing unowned or locally edited skills are preserved; upgrades stop before replacing them. Previous runtime releases remain for rollback. `node src/install.mjs --uninstall` removes only owned, unchanged skills and preserves models, config and workspace outputs.

## DSH

Target: DSH `0.2.1-rc.2` and Cordis `~4.0.5`. Package and install from your chosen DSH profile:

```bash
npm pack
dsh plugin --profile web add /absolute/path/dsh-media-tools-0.2.2.tgz
```

The package inserts `dsh-media-audio` and `dsh-media-video` as independently switchable plugins. They use DSH tool registration, attachments, prompt sections and Cordis lifecycle cleanup; no host source patch is needed. Disabling either cancels its owned work and removes its registrations. It never deletes generated files or models. Individual inserts are also in `audio.patch.yml` and `video.patch.yml`.

Where installed, DSH's `modelScheduler` service handles GPU admission so managed models can unload before media inference and resume afterward. The workers also hold a package-owned lock and refuse to collide with an unrelated GPU owner. MCP clients cannot control another application's private scheduler: unload an unrelated resident model before standalone GPU inference.

Do not register duplicate tool names through both the direct plugins and MCP in one DSH profile. The installer does not modify a live DSH profile or reload DSH.

## MCP

The installer prints the runtime path. Add this server to your MCP client:

```json
{
  "mcpServers": {
    "dsh-media": {
      "command": "node",
      "args": ["/installed/runtime/src/mcp.mjs", "--workspace", "/authorized/workspace"]
    }
  }
}
```

The official MCP SDK server exposes all eight tools and returns plot image blocks, saved files and report JSON. Select tools normally in your client. Audio playback uses returned WAV paths where the client supports it. Allow a long tool timeout for GPU jobs. For Codex, the setup syntax is documented in [official MCP configuration](https://learn.chatgpt.com/docs/extend/mcp).

## CLI

```bash
node src/cli.mjs doctor
node src/cli.mjs analyze_audio --workspace /path/to/workspace \
  --args '{"source_path":"recording.mp3","duration_seconds":30,"fft_size":8192}'
node src/cli.mjs listen_audio --workspace /path/to/workspace \
  --args '{"source_path":"recording.mp3"}'
node src/cli.mjs analyze_video --workspace /path/to/workspace \
  --args '{"source_path":"clip.mp4","question":"Describe the events in timestamp order."}'
```

CLI/MCP paths are relative to the explicitly authorized workspace. DSH can use the latest single media upload or an attachment ID. Outputs are unique `.dsh-media` directories; originals stay unchanged. See [conversion recipes](docs/conversion.md).

**Model requirement:** `analyze_video` is specifically for models with native temporal video support and a compatible engine/projector. User deployment examples include Flash 3.8, Flash Next, Qwen 3.6 35B-A3B and Qwen 27B. These are deployment labels, not a tested compatibility matrix. Each model/engine/projector combination needs qualification. The bundled native path preserves 6 FPS, 15-second windows, 3-second overlap, SVE2 records and M-RoPE traces. It never replaces temporal video with independent still frames.

Numerical audio segments are at most 120 seconds and 25 million channel-samples. Input size is at most 2 GiB. CPU transcription and conversions/edits are bounded to two hours; conversions default to the first 30 seconds. Numerical levels are dBFS, not calibrated SPL. Whisper likelihoods are not correctness percentages. Omni captions can hallucinate; compare descriptions with measured evidence.

## Development and provenance

Run `npm ci && npm test` with the pinned Python requirements; `DSH_MEDIA_PYTHON` selects the interpreter. Optional live inference checks are separate from the normal CPU/MCP/Cordis suite. See [validation](docs/validation.md), [advanced backends](docs/backends.md), [source provenance](provenance.json) and [third-party notices](THIRD_PARTY_NOTICES.md).

The portable CPU runner enforces path checks, not an OS sandbox. The included Linux GPU backend runs owned processes with per-job scratch, bounded inputs and cancellation. Native executable assets and vendored Strata/llama components keep their licenses. Private settings, credentials, chat histories, recordings and model weights are not checked into this repository.
