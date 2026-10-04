# Greek pronunciation recordings

These nine MP3s were generated with **ElevenLabs Eleven v3**, using **Stavros — Native Greek, Warm & playful** (`3NIJOdpOh5ailCXf4Qmi`), a standard-accent Greek voice from the ElevenLabs Voice Library.

- Input: original Greek text in `lessons.json`, never the Roman pronunciation guide.
- Language: `el`.
- Generation speed: `0.95`, stability: `0.5`, similarity boost: `0.75`.
- Playback: original pitch and speed; no browser speech-synthesis fallback.
- `manifest.json` maps each lesson ID to its public MP3.

The files are generated once and served by GitHub Pages. Visitors do not need an API key and do not trigger paid speech requests.

To regenerate, add the Stavros voice to your ElevenLabs library (or configure a different Greek voice using `ELEVENLABS_VOICE_ID`), set your private key in `.env`, remove only the MP3s you want to replace, and run `python3 scripts/generate_audio.py`. Commit the updated MP3s and manifest, never `.env`.
