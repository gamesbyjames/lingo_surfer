#!/usr/bin/env python3
"""Build an allowlisted, secret-free GitHub Pages artifact. No npm dependencies."""

import json
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server import PUBLIC_FILES


def build_site(output=ROOT / "_site"):
    output = Path(output).resolve()
    if output == ROOT or ROOT.is_relative_to(output):
        raise ValueError("The site output must not overwrite the source directory.")
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    files = set(PUBLIC_FILES)
    manifest = json.loads((ROOT / "audio/manifest.json").read_text())
    lessons = json.loads((ROOT / "lessons.json").read_text())
    valid_ids = {p["id"] for p in [*lessons["phrases"], lessons["story"]]}
    for phrase_id, filename in manifest.items():
        if phrase_id not in valid_ids or filename != f"audio/{phrase_id}.mp3":
            raise ValueError(f"Invalid recording entry: {phrase_id}")
        files.add(filename)
    for name in sorted(files):
        source = ROOT / name
        if source.is_symlink() or not source.is_file():
            raise ValueError(f"Missing or unsafe public asset: {name}")
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    (output / ".nojekyll").touch()
    # Deployed Pages is always static, regardless of local server configuration.
    (output / "runtime.json").write_text('{"speechApi": false}\n')
    print(f"Built {len(files)} public files in {output}")
    return output


if __name__ == "__main__":
    build_site()
