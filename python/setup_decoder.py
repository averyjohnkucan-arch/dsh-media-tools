"""Install pinned media dependencies into a private Python 3.12 environment."""
import hashlib
import json
from pathlib import Path
import os
import platform
import subprocess
import sys
from urllib.request import urlopen
from zipfile import ZipFile

root, venv, requirements = map(Path, sys.argv[1:4])
version = "0.13.3"
if platform.machine().lower() not in {"x86_64", "amd64"} or sys.platform not in {"linux", "win32"}:
    raise RuntimeError("Automatic media runtime setup requires Linux or Windows x64.")

windows = sys.platform == "win32"
tag = "win_amd64" if windows else "manylinux_2_17_x86_64"
executable = "uv.exe" if windows else "uv"
uv = root / "bootstrap" / f"uv-{version}.data" / "scripts" / executable
if not uv.is_file():
    with urlopen(f"https://pypi.org/pypi/uv/{version}/json", timeout=30) as response:
        wheels = json.load(response)["urls"]
    wheel = next(item for item in wheels if tag in item["filename"] and item["filename"].endswith(".whl"))
    with urlopen(wheel["url"], timeout=90) as response:
        payload = response.read(64 * 1024 * 1024 + 1)
    if len(payload) > 64 * 1024 * 1024 or hashlib.sha256(payload).hexdigest() != wheel["digests"]["sha256"]:
        raise RuntimeError("Python bootstrap checksum mismatch.")
    archive = root / "uv.whl"
    archive.write_bytes(payload)
    try:
        with ZipFile(archive) as bundle:
            member = f"uv-{version}.data/scripts/{executable}"
            uv.parent.mkdir(parents=True, exist_ok=True)
            uv.write_bytes(bundle.read(member))
            uv.chmod(0o700)
    finally:
        archive.unlink()

env = dict(os.environ, UV_PYTHON_INSTALL_DIR=str(root / "python"), UV_CACHE_DIR=str(root / "uv-cache"))
python = venv / ("Scripts/python.exe" if windows else "bin/python")
for command in [
    [uv, "python", "install", "3.12", "--no-bin"],
    [uv, "venv", "--managed-python", "--python", "3.12", venv],
    [uv, "pip", "install", "--python", python, "-r", requirements],
    [python, "-c", "import numpy, scipy, matplotlib, soundfile, faster_whisper"],
]:
    subprocess.run(command, check=True, cwd=root, env=env, stdout=sys.stderr)
