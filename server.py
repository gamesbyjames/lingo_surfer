#!/usr/bin/env python3
"""Local static game server and optional, server-side ElevenLabs speech proxy."""

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path
import re
import threading
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
PUBLIC_FILES = {
    "index.html", "style.css", "app.js", "world.js", "game-logic.js", "lessons.json",
    "character.js", "atmosphere.js", "visuals.css", "credits.html", "runtime.json",
    "assets/icon.svg", "assets/models/runner.glb", "audio/manifest.json",
}
CACHE = {}
SPEECH_LOCK = threading.Lock()


def load_env():
    """Read only known configuration keys; existing environment values take precedence."""
    env_file = ROOT / ".env"
    if not env_file.is_file():
        return
    lines = env_file.read_text(encoding="utf-8-sig").splitlines()
    values = [line.strip() for line in lines if line.strip() and not line.lstrip().startswith("#")]
    # Also accept a key pasted on its own in this private local file. Never log it.
    if len(values) == 1 and re.fullmatch(r"[A-Za-z0-9_-]{20,}", values[0]):
        os.environ.setdefault("ELEVENLABS_API_KEY", values[0])
        return
    allowed = {"ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID", "ELEVENLABS_MODEL_ID"}
    for line in lines:
        key, sep, value = line.strip().partition("=")
        if sep and key.strip() in allowed:
            os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def speech_for(phrase_id):
    lessons = json.loads((ROOT / "lessons.json").read_text(encoding="utf-8"))
    phrases = {p["id"]: p["greek"] for p in [*lessons["phrases"], lessons["story"]]}
    if phrase_id not in phrases:
        return 400, {"error": "Unknown phrase."}
    key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if not key:
        return 503, {"error": "ElevenLabs is not configured. Published recordings can still be played."}
    voice = os.environ.get("ELEVENLABS_VOICE_ID") or "3NIJOdpOh5ailCXf4Qmi"
    model = os.environ.get("ELEVENLABS_MODEL_ID") or "eleven_v3"
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", voice):
        return 503, {"error": "Check the configured ElevenLabs voice ID."}
    cache_key = (phrase_id, voice, model)
    with SPEECH_LOCK:
        if cache_key in CACHE:
            return 200, CACHE[cache_key]
        body = json.dumps({
            "text": phrases[phrase_id], "model_id": model, "language_code": "el",
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.75, "speed": 0.95},
        }).encode()
        request = Request(
            f"https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_128",
            data=body,
            headers={"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=35) as response:
                audio = response.read(5_000_001)
                if not audio or len(audio) > 5_000_000:
                    return 502, {"error": "The speech service returned an invalid audio response."}
                CACHE[cache_key] = audio
                return 200, audio
        except (HTTPError, URLError, TimeoutError, OSError):
            # Upstream responses can contain account details; keep those off the client.
            return 502, {"error": "Speech is unavailable. Check your ElevenLabs key, quota, and voice."}


class Handler(BaseHTTPRequestHandler):
    server_version = "LittleOdyssey/1.0"

    def send_bytes(self, status, body, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Cache-Control", "no-store" if content_type.startswith("application/json") else "no-cache")
        self.end_headers()
        if self.command != "HEAD":
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass  # The learner moved on while an audio request was in flight.

    def json_response(self, status, data):
        self.send_bytes(status, json.dumps(data).encode(), "application/json; charset=utf-8")

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/api/config":
            self.json_response(200, {"elevenlabs": bool(os.environ.get("ELEVENLABS_API_KEY", "").strip())})
            return
        if path == "/runtime.json":
            self.json_response(200, {"speechApi": True})
            return
        name = "index.html" if path == "/" else path.removeprefix("/")
        # Only generated phrase recordings can be served in addition to the
        # fixed public asset list. This never exposes .env or arbitrary paths.
        audio_file = re.fullmatch(r"audio/[a-z0-9-]+\.mp3", name)
        if (name not in PUBLIC_FILES and not audio_file) or not (ROOT / name).is_file():
            self.json_response(404, {"error": "Not found."})
            return
        content_type = "text/javascript" if name.endswith(".js") else mimetypes.guess_type(name)[0] or "application/octet-stream"
        if content_type.startswith("text/") or content_type == "application/json":
            content_type += "; charset=utf-8"
        self.send_bytes(200, (ROOT / name).read_bytes(), content_type)

    def do_HEAD(self):
        self.do_GET()

    def do_POST(self):
        if urlsplit(self.path).path != "/api/speech":
            self.json_response(404, {"error": "Not found."})
            return
        origin = self.headers.get("Origin")
        if (origin and urlsplit(origin).netloc != self.headers.get("Host")) or self.headers.get("Sec-Fetch-Site") == "cross-site":
            self.json_response(403, {"error": "Same-origin requests only."})
            return
        if self.headers.get_content_type() != "application/json":
            self.json_response(415, {"error": "Use application/json."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 1024:
                raise ValueError
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict) or not isinstance(payload.get("id"), str):
                raise ValueError
        except (ValueError, UnicodeDecodeError):
            self.json_response(400, {"error": "Provide a valid lesson phrase ID."})
            return
        status, result = speech_for(payload["id"])
        if isinstance(result, bytes):
            self.send_bytes(status, result, "audio/mpeg")
        else:
            self.json_response(status, result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()
    load_env()
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Little Odyssey is ready at http://{args.host}:{args.port}", flush=True)
    print("ElevenLabs audio: " + ("enabled" if os.environ.get("ELEVENLABS_API_KEY") else "optional — add your key in .env"), flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
