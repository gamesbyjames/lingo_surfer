# Greek and Hindi pronunciation recordings

These nine MP3s were generated with **ElevenLabs Eleven v3**, using **Stavros — Native Greek, Warm & playful** (`3NIJOdpOh5ailCXf4Qmi`), a standard-accent Greek voice from the ElevenLabs Voice Library.

The additional **21 `hi-*.mp3` files** use **Sanchit K — Real, Warm Healthcare Agent** (`9w95y5s4Oaw0nGMYD6AB`), a standard-accent Hindi voice. They cover 16 practice steps, the full story, and feminine variants of the three gender-dependent phrases and story. Hindi input is the Devanagari text in `lessons-hi.json`, with language code `hi`.

- Input: original Greek text in `lessons.json`, never the Roman pronunciation guide.
- Language: `el`.
- Generation speed: `0.95`, stability: `0.5`, similarity boost: `0.75`.
- Playback: original pitch and speed; no browser speech-synthesis fallback.
- `manifest.json` maps each lesson ID to its public MP3.

The files are generated once and served by GitHub Pages. Visitors do not need an API key and do not trigger paid speech requests.

To regenerate, add the relevant voice to your ElevenLabs library (or configure a different voice using `ELEVENLABS_VOICE_ID` for Greek or `ELEVENLABS_HINDI_VOICE_ID` for Hindi), set your private key in `.env`, remove only the MP3s you want to replace, and run `python3 scripts/generate_audio.py`. Use `--language hi` or `--language el` to limit generation to one language. Commit the updated MP3s and manifest, never `.env`.
