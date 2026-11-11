# DSH compatibility

Supported runtime line: `>=0.2.1-rc.2 <0.3.0-0`.

DSH prereleases participate in its compatibility checks. Patch and prerelease
updates within the 0.2 line can load this plugin without exact-version overrides.
The next minor (including its prereleases) requires review; future APIs cannot
be guaranteed compatible by a version range alone.

The DSH compatibility workflow tests the baseline and npm's `latest` DSH on
pull requests, pushes, manual runs, and weekly. It aligns the actual DSH host
packages, builds the plugin, checks host imports and browser module declarations,
runs the existing behavioral tests, and checks the packed package's exports.
A failure against latest is a request to investigate before upgrading support,
not a reason to disable DSH's compatibility protection.

To reproduce with dependencies installed against the chosen DSH:

```sh
npm run build --if-present
npm run check:dsh
npm test
```

These checks do not download models or prove GPU/engine performance. Existing
native-runtime and hardware validation procedures still apply.

## Reproducing the compatibility matrix

Use Node 22.19 or newer and a fresh checkout for each target. The following
matches the compatibility workflow (repeat with `DSH_VERSION=latest`):

```sh
export DSH_VERSION=0.2.1-rc.2
export DSH_HOME="$PWD/.compat-home"
compat_host=$(mktemp -d)
npm install --ignore-scripts --legacy-peer-deps --package-lock=false --no-audit --no-fund
npm install --prefix "$compat_host" --ignore-scripts --no-audit --no-fund "@deepseek-ai/dsh@$DSH_VERSION"
node scripts/use-dsh-host.mjs "$compat_host"
# On the Ubuntu runner, install ffmpeg with apt first.
python -m pip install -r requirements.txt
mkdir -p "$DSH_HOME"
node --input-type=module -e 'import {writeFileSync} from "node:fs"; writeFileSync(process.env.DSH_HOME + "/media-config.json", JSON.stringify({ffmpeg: "/usr/bin/ffmpeg", ffprobe: "/usr/bin/ffprobe"}));'
export DSH_MEDIA_CONFIG="$DSH_HOME/media-config.json"
export DSH_MEDIA_PYTHON=python
npm run build --if-present
npm run check:dsh
npm test
archive=$(npm pack --ignore-scripts --json | node -e 'let x="";process.stdin.on("data",v=>x+=v).on("end",()=>console.log(JSON.parse(x)[0].filename))')
mkdir -p .compat-packed
tar -xzf "$archive" -C .compat-packed
ln -s "$PWD/node_modules" .compat-packed/package/node_modules
node scripts/check-dsh-compatibility.mjs .compat-packed/package
```

`--ignore-scripts` leaves `ffmpeg-static` without its downloaded executable.
The compatibility workflow uses the existing configuration file mechanism to
select its installed system FFmpeg and FFprobe for tests and MCP subprocesses.
This does not alter production binary selection or enable dependency scripts.

## Setup patch validation (November 10, 2026)

Local environment: Node 24.22.1, Linux. GitHub's Node 22 / Ubuntu 22.04 jobs
must still run; local results are not a claim that Actions is green.

| Check | Result |
| --- | --- |
| Baseline DSH 0.2.1-rc.2 tests | 25 passed, 1 skipped |
| npm latest, resolved to DSH 0.2.2-rc.1 | 23 passed, 2 failed: direct test calls require the new tool executor/batch composition |
| Host imports, browser declarations, packed exports | Passed against both targets |

The original failed Actions run predates these patches. Rerun the compatibility
workflow on the updated draft PR head (both matrix entries, including tests and
packed exports). Keep the existing DSH range and rejection of 0.3 prereleases.
Model downloads and GPU inference were not exercised.
