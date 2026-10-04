"""Run with python3 -m unittest -v test_server.py. No external API calls."""

import http.client
import json
import os
from pathlib import Path
import struct
import tempfile
import threading
import unittest
from unittest.mock import patch, MagicMock
from urllib.error import HTTPError

import server
from scripts.build_site import build_site


class QuietHandler(server.Handler):
    def log_message(self, *args):
        pass


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        cls.port = cls.httpd.server_port
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join()

    def setUp(self):
        server.CACHE.clear()

    def request(self, path, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.request("POST" if body is not None else "GET", path, body, headers or {})
        response = conn.getresponse()
        result = response.status, response.getheader("Content-Type"), response.read()
        conn.close()
        return result

    def post(self, payload, **headers):
        return self.request("/api/speech", json.dumps(payload), {"Content-Type": "application/json", **headers})

    def test_static_assets_and_module_mime_types(self):
        for path in ["/", "/style.css", "/app.js", "/world.js", "/character.js", "/atmosphere.js", "/game-logic.js", "/lessons.json", "/visuals.css", "/assets/models/runner.glb", "/assets/icon.svg"]:
            with self.subTest(path=path):
                status, content_type, body = self.request(path)
                self.assertEqual(status, 200)
                self.assertTrue(body)
                if path.endswith(".js"):
                    self.assertTrue(content_type.startswith("text/javascript"))
                if path.endswith(".glb"):
                    self.assertNotIn("charset", content_type)

    def test_secrets_and_nonpublic_files_cannot_be_served(self):
        for path in ["/.env", "/.env.example", "/server.py", "/../.env", "/%2eenv", "/README.md", "/assets/../.env", "/audio/../../.env", "/"]:
            if path == "/":
                continue
            with self.subTest(path=path):
                self.assertEqual(self.request(path)[0], 404)

    def test_local_runtime_enables_only_the_local_speech_api(self):
        self.assertEqual(json.loads(self.request("/runtime.json")[2]), {"speechApi": True})

    def test_recordings_manifest_is_valid(self):
        status, _, data = self.request("/audio/manifest.json")
        self.assertEqual(status, 200)
        self.assertIsInstance(json.loads(data), dict)

    def test_all_lesson_recordings_are_served_as_mp3(self):
        lessons = json.loads((server.ROOT / "lessons.json").read_text())
        ids = {p["id"] for p in [*lessons["phrases"], lessons["story"]]}
        manifest = json.loads((server.ROOT / "audio/manifest.json").read_text())
        self.assertEqual(set(manifest), ids)
        for phrase_id, path in manifest.items():
            with self.subTest(phrase=phrase_id):
                status, content_type, audio = self.request('/' + path)
                self.assertEqual(status, 200)
                self.assertEqual(content_type, "audio/mpeg")
                self.assertGreater(len(audio), 3000)

    @patch.dict(os.environ, {"ELEVENLABS_API_KEY": ""})
    def test_no_key_mode(self):
        self.assertEqual(json.loads(self.request("/api/config")[2]), {"elevenlabs": False})
        self.assertEqual(self.post({"id": "yesterday"})[0], 503)

    @patch.dict(os.environ, {"ELEVENLABS_API_KEY": "secret-test-key"})
    def test_config_only_exposes_availability(self):
        result = self.request("/api/config")[2]
        self.assertEqual(json.loads(result), {"elevenlabs": True})
        self.assertNotIn(b"secret-test-key", result)

    def test_only_known_phrase_ids_are_accepted(self):
        self.assertEqual(self.post({"id": "arbitrary-text"})[0], 400)
        self.assertEqual(self.post({"text": "Anything I want"})[0], 400)
        self.assertEqual(self.post({"id": ["yesterday"]})[0], 400)
        self.assertEqual(self.post([])[0], 400)

    def test_rejects_cross_origin_and_non_json_requests(self):
        self.assertEqual(self.post({"id": "yesterday"}, Origin="https://other.example")[0], 403)
        self.assertEqual(self.post({"id": "yesterday"}, **{"Sec-Fetch-Site": "cross-site"})[0], 403)
        self.assertEqual(self.request("/api/speech", "id=yesterday")[0], 415)

    @patch.dict(os.environ, {"ELEVENLABS_API_KEY": "secret-test-key", "ELEVENLABS_VOICE_ID": "testvoice", "ELEVENLABS_MODEL_ID": "eleven_v3"})
    @patch("server.urlopen")
    def test_speech_sends_original_greek_and_caches_audio(self, urlopen):
        upstream = MagicMock()
        upstream.read.return_value = b"test-mp3-audio"
        urlopen.return_value.__enter__.return_value = upstream
        for _ in range(2):
            status, content_type, body = self.post({"id": "yesterday"})
            self.assertEqual((status, content_type, body), (200, "audio/mpeg", b"test-mp3-audio"))
        urlopen.assert_called_once()
        request = urlopen.call_args.args[0]
        payload = json.loads(request.data)
        self.assertEqual(payload["text"], "Εχτές")
        self.assertEqual(payload["language_code"], "el")
        self.assertEqual(payload["model_id"], "eleven_v3")
        self.assertEqual(payload["voice_settings"]["speed"], 0.95)
        self.assertEqual(request.get_header("Xi-api-key"), "secret-test-key")

    @patch.dict(os.environ, {"ELEVENLABS_API_KEY": "secret-test-key"})
    @patch("server.urlopen", side_effect=HTTPError("url", 401, "private account details", {}, None))
    def test_upstream_errors_are_sanitized(self, _):
        status, _, body = self.post({"id": "yesterday"})
        self.assertEqual(status, 502)
        self.assertNotIn(b"secret-test-key", body)
        self.assertNotIn(b"private account", body)


class LessonTests(unittest.TestCase):
    def test_roman_pronunciations_and_stress(self):
        data = json.loads((server.ROOT / "lessons.json").read_text())
        self.assertEqual(len(data["phrases"]), 8)
        ids = set()
        for phrase in data["phrases"]:
            self.assertNotIn(phrase["id"], ids)
            ids.add(phrase["id"])
            self.assertTrue(phrase["roman"].isascii())
            self.assertNotIn(phrase["roman"], phrase["distractors"])
            self.assertEqual(len(set(phrase["distractors"])), 2)
            # Every accented Greek vowel has exactly one marked Roman vowel.
            greek_stresses = sum(c in "άέήίόύώΆΈΉΊΌΎΏ" for c in phrase["greek"])
            roman_stresses = sum(c in "AEIOU" for c in phrase["roman"])
            self.assertEqual(greek_stresses, roman_stresses, phrase["id"])
        self.assertTrue(data["story"]["roman"].startswith("ehtEs"))


class EnvironmentTests(unittest.TestCase):
    @patch.dict(os.environ, {}, clear=True)
    def test_key_pasted_alone_in_private_env_file(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / ".env").write_text("# My local speech key\nsk_example_not_a_real_key_12345\n")
            with patch.object(server, "ROOT", root):
                server.load_env()
            self.assertEqual(os.environ["ELEVENLABS_API_KEY"], "sk_example_not_a_real_key_12345")

    @patch.dict(os.environ, {"ELEVENLABS_API_KEY": "existing-value"}, clear=True)
    def test_env_file_does_not_override_existing_configuration(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / ".env").write_text('\ufeffELEVENLABS_API_KEY="local-value"\nELEVENLABS_VOICE_ID=myvoice\nUNRELATED=ignored\n')
            with patch.object(server, "ROOT", root):
                server.load_env()
            self.assertEqual(os.environ["ELEVENLABS_API_KEY"], "existing-value")
            self.assertEqual(os.environ["ELEVENLABS_VOICE_ID"], "myvoice")
            self.assertNotIn("UNRELATED", os.environ)


class DeploymentTests(unittest.TestCase):
    def test_pages_artifact_contains_only_public_files(self):
        with tempfile.TemporaryDirectory() as temp:
            output = build_site(Path(temp) / "site")
            self.assertEqual(json.loads((output / "runtime.json").read_text()), {"speechApi": False})
            for required in ["index.html", "character.js", "assets/models/runner.glb", "audio/manifest.json", ".nojekyll"]:
                self.assertTrue((output / required).is_file(), required)
            for forbidden in [".env", ".env.example", "server.py", ".git", "scripts", ".github"]:
                self.assertFalse((output / forbidden).exists(), forbidden)

    def test_runner_is_a_real_skinned_model_with_locomotion_clips(self):
        glb = (server.ROOT / "assets/models/runner.glb").read_bytes()
        magic, version, length = struct.unpack_from("<4sII", glb)
        self.assertEqual((magic, version, length), (b"glTF", 2, len(glb)))
        json_length, chunk_type = struct.unpack_from("<II", glb, 12)
        self.assertEqual(chunk_type, 0x4E4F534A)
        model = json.loads(glb[20:20 + json_length])
        self.assertTrue(model["skins"])
        self.assertTrue({"idle", "walk", "run"}.issubset({clip["name"] for clip in model["animations"]}))


if __name__ == "__main__":
    unittest.main()
