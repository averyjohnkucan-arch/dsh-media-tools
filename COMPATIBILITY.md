# DeepSeek Harness RC4

This build targets DSH 0.2.2-rc.4 and Node.js 24.9 or newer. The following notes describe validation of the previous release.

# DSH compatibility — 0.2.3

Reviewed on November 14, 2026 against DSH **0.2.2-rc.1**, Cordis **4.1.0** and Schemastery **3.19.0**. Dependency declarations and lockfiles target the current host instead of pulling in the older DSH/Cordis API generation.

Updated host constraints and migrated integration dispatch to the current native batch API. Tested audio/video processing, inline image output, cancellation, plugin disposal and MCP SDK discovery with real FFmpeg and Python processing.

DSH 0.2.2 declares Node 24.9 or newer. Compatibility checks cover the existing Node 22.22 installation as well as an isolated Node 24 runtime; the user’s system runtime was not changed. CI uses Node 24. Model servers, CUDA kernels and optional large model downloads are outside this source/API compatibility check; request serialization and scheduler tests use controlled local fixtures where appropriate.

The GitHub update does not replace an already-installed plugin automatically. Update the plugin through DSH to use this release, preserving its saved settings and model profiles.

Packaged FFmpeg/FFprobe paths are used only when executable files exist. Installations that skip npm build scripts can use the system executables instead of failing on a nonexistent packaged binary. CI exercises this path explicitly.
