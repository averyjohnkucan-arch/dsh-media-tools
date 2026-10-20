# Third-party components

The integration source is MIT licensed. Dependencies and external model/runtime assets retain their own licenses.

- DeepSeek Harness / Cordis: MIT, https://github.com/deepseek-ai/deepseek-harness
- Official Model Context Protocol TypeScript SDK: MIT, https://github.com/modelcontextprotocol/typescript-sdk
- ffmpeg-static: GPL-3.0-or-later binary distribution wrapper and platform binaries, https://github.com/eugeneware/ffmpeg-static
- @ffprobe-installer/ffprobe and platform binary packages: MIT wrapper; FFmpeg binaries GPL-3.0, https://github.com/SavageCore/node-ffprobe-installer
- FFmpeg licensing and source: https://ffmpeg.org/legal.html and https://ffmpeg.org/download.html
- NumPy (BSD), SciPy (BSD), Matplotlib (PSF-based), SoundFile (BSD), libsndfile (LGPL), faster-whisper (MIT), CTranslate2 (MIT), and their transitive dependencies retain their packaged notices.

The bundled Python native backend vendors MIT-licensed Strata serving/tokenizer components; its original license is at `python/backend/vendor/LICENSE.strata`. The native executable release includes Strata and llama.cpp license files. CUDA runtime libraries are installed through NVIDIA's separately licensed Python distributions; they are not placed in our executable archive.

This repository distributes integration source and package manifests. Platform media binaries are installed from their pinned npm packages, which contain their upstream notices and provenance; they are not checked into this repository. Consult the resolved binary packages when redistributing an installed runtime. Models and V2 engine binaries are not distributed here.
