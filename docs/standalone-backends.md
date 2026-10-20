# Included inference backends

Version 0.2 includes the audio/Omni and native temporal video worker code. They start on demand, process the job, close their models, and exit. No V2 service or application needs to be running.

The package installs FFmpeg/FFprobe, Python dependencies and CUDA user-space runtime libraries. A matching NVIDIA driver remains a host prerequisite. The published native executable bundle is Linux x64/CUDA 13; other platforms are not qualified.

## Reuse existing models on this machine

```bash
npm ci
node src/install.mjs --setup-python --include-backends --local-ai '/path/to/Local AI version 2'
```

V2 is used **once as an import source**. On Linux, if no explicit `--python` is given, its relocatable Python distribution is also copied into the package-owned installation before creating the venv. Setup copies Strata, the temporal encoder and the Omni server/libraries into a package-owned cache. It resolves model, projector, tokenizer and runtime-pack references into the model store, copies the small expert-profile seed, and writes standalone configuration. It removes the V2 service-adapter setting. The old application can stay stopped. The old source/runtime directories are not loaded at inference time; the referenced model-store files must remain available.

For an already installed Python environment:

```bash
node src/cli.mjs setup-backends --import-v2 '/path/to/Local AI version 2'
node src/cli.mjs doctor
```

## Install on a fresh machine

Select the model weights and Strata pack/tokenizer appropriate to a qualified temporal engine. Configure them in a JSON manifest with the same shape as `backend` in your generated config, excluding machine-specific executable/library paths. Then:

```bash
node src/cli.mjs setup-backends --backend-config /path/to/backend-models.json
```

Setup downloads the package's versioned native executable bundle and verifies its pinned SHA256 before extraction. The worker code is shipped in the npm package. Model weights are separate assets: Omni Q4_K_M plus its BF16 projector alone total roughly 21 GB, and the native video model/pack can be much larger. Reusing weights avoids duplicating them or putting them into a tiny plugin tarball. Setup does not silently select a different model family or treat a model name as a compatibility guarantee.

## GPU ownership

The workers serialize their jobs with a package-owned device lock and refuse to start if an unrelated GPU model is resident. They never kill unrelated processes. The DSH adapter optionally uses the installed `modelScheduler` service to wait for the current managed model to unload, run the media job, and release ownership before the chat resumes. Standalone MCP clients have no access to another application's private scheduler; unload an unrelated resident model before using GPU inference there.

Omni finishes and unloads before the native vision engine starts. All child processes belong to the job's process group; cancellation terminates and reaps them. Speech recognition remains CPU Whisper. The native video path preserves 6 FPS, 15-second windows, 3-second overlap, SVE2 temporal records and engine M-RoPE evidence. It does not fall back to still-image analysis.

Omni captions remain fallible. Packaging the backend does not fix known model hallucinations; distinguish recognized speech, sound descriptions and numerical measurements.
