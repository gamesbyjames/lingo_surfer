#!/usr/bin/env python3
"""Generate the lesson's Greek MP3s once, then publish them as static assets."""

import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server import load_env, speech_for


def main():
    load_env()
    if not os.environ.get("ELEVENLABS_API_KEY", "").strip():
        raise SystemExit("Set ELEVENLABS_API_KEY in .env or your environment first.")
    lessons = json.loads((ROOT / "lessons.json").read_text())
    output = ROOT / "audio"
    output.mkdir(exist_ok=True)
    manifest_path = output / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    for phrase in [*lessons["phrases"], lessons["story"]]:
        filename = f"{phrase['id']}.mp3"
        target = output / filename
        if not target.exists():
            status, result = speech_for(phrase["id"])
            if status != 200:
                raise SystemExit(f"Could not record {phrase['id']}: {result['error']}")
            target.write_bytes(result)
            print(f"Recorded {phrase['id']}")
        else:
            print(f"Reusing {phrase['id']}")
        manifest[phrase["id"]] = f"audio/{filename}"
        # Preserve successful phrases if the service fails midway through.
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print("Recordings ready. Build the site to include them in GitHub Pages.")


if __name__ == "__main__":
    main()
