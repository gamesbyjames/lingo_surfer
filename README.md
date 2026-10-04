# Lingo Surfer

A 3D browser runner for learning Greek, one small sentence at a time. Run along a sunlit Aegean coast as an animated Mixamo character, dodge crates, slide under blue barriers, and choose the right phrase at three-lane answer gates.

Animated water, golden-hour lighting, stone and plaster textures, balconies, bougainvillea, seaside ruins, seagulls, and coin particles bring the coast to life. The game supports keyboard, touch, and full-screen play.

**GitHub Pages destination:** https://gamesbyjames.github.io/lingo_surfer/

## Deploy to GitHub Pages

The game runs entirely as a static site on Pages; Python is only used to build it and for optional local speech generation.

1. Push this project to the `main` branch of `gamesbyjames/lingo_surfer`.
2. In **Settings → Pages → Build and deployment**, choose **GitHub Actions**.
3. The **Test and deploy GitHub Pages** workflow runs the tests, builds an allowlisted `_site` artifact, and deploys it. Future pushes to `main` redeploy automatically; it can also be run manually from Actions.

All game, model, and recording paths are relative, so `/lingo_surfer/` works correctly. The published artifact excludes Python files, `.env`, tests, Git metadata, and build scripts. The site's `runtime.json` disables backend API requests.

Build and preview a local Pages artifact:

```bash
python3 scripts/build_site.py
python3 -m http.server 8001 --directory _site
```

Then open http://localhost:8001. The build requires no npm packages.

## Play locally

Requires **Python 3.10+**. No package installation or build step is needed.

```bash
python3 server.py
```

Open **http://localhost:8000** in a modern WebGL-capable browser. The first load needs an internet connection for Three.js and optional Google Fonts. The interface has system-font fallbacks.

For a phone on the same Wi-Fi, run `python3 server.py --host 0.0.0.0`, then open `http://YOUR_COMPUTER_LAN_IP:8000` on the phone. Keep this development server on your own network.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Change lane | Left/right arrows or A/D | Swipe left/right |
| Jump over a crate | Up arrow, W, or Space | Swipe up |
| Slide under a blue barrier | Down arrow or S | Swipe down |
| Choose an answer lane | Move normally, or press 1/2/3 | Tap an answer |
| Pause / resume | P or Escape | Pause button |

The game also pauses when you leave the tab or open the phrasebook. Close the phrasebook and choose **Keep going** to resume.

## The first story

> Yesterday I decided to learn Greek. And today I can already speak a little.
>
> **ehtEs apofAsisa na mAtho ellinikA. Ke sImera borO Idhi na milAo lIgo.**

Greek is shown in **Roman letters, with stressed vowels capitalized**. The initial `e` of `ehtEs` intentionally stays lowercase: it is not stressed. `th` is like English “think”; `dh` is like “this”; `h` represents the Greek χ sound, similar to the “ch” in Scottish “loch”. This is a beginner-oriented pronunciation aid rather than a formal transliteration standard.

The story is split into six short pieces and two full-sentence reviews. A phrase appears before its gate; the run slows down for 11 seconds at short gates and 16 seconds for full sentences. Wrong answers give feedback and return after a short spacing interval. They do not cost hearts. Track collisions cost hearts, with brief protection against repeated hits. Answer all eight phrases correctly to finish the story.

The phrasebook lets you read and listen without running. Your best distance and phrases answered correctly are saved in this browser’s local storage. This tracks practice, not a claim of fluency.

## Optional ElevenLabs pronunciation

1. Copy `.env.example` to a file named `.env` in this folder.
2. Put your API key after `ELEVENLABS_API_KEY=` in `.env`.
3. Optionally replace `ELEVENLABS_VOICE_ID` with a voice from your account.
4. Add **Stavros — Native Greek, Warm & playful** (`3NIJOdpOh5ailCXf4Qmi`) to your ElevenLabs voice library if using the default voice.
5. Restart `python3 server.py` and refresh the page.

The default model is `eleven_v3`, using a native Greek voice at a gently reduced generation speed. The original Greek text is sent for speech, not the Roman pronunciation guide. The server accepts only the built-in phrase IDs, keeps the key private, and caches generated audio in memory for the server session. The `.env` file is excluded from Git and cannot be downloaded through the local server. Environment variables can be used instead of `.env`; a key pasted by itself into `.env` is also accepted.

### ElevenLabs on GitHub Pages

The site includes **nine pre-generated ElevenLabs Greek recordings**, so visitors get consistent pronunciation without a key or a Greek device voice. Pages cannot run a private speech proxy. To regenerate recordings locally, then publish only the MP3s:

```bash
python3 scripts/generate_audio.py
python3 scripts/build_site.py
```

The first command uses your local `.env` key to generate the nine built-in phrases/story recordings in `audio/` and updates `audio/manifest.json`. It reuses existing MP3s to avoid repeated API charges. Commit those audio files and the manifest with the next deployment. The API key is never included in the website. To regenerate a phrase after editing it, remove its MP3 before running the generator again.

The player tries published recordings first, then the local speech API when running `server.py`. It never falls back to browser speech synthesis: those voices vary too much in quality and accent. If a recording cannot play, a short retry message is shown. The music-note button toggles automatic phrase audio and game sound effects; an explicit listen-button click still plays the selected phrase. Recording details are in `audio/README.md`.

## Mixamo character

The player uses the real, skinned **Mixamo Xbot** GLB from the official Three.js r170 example, with 67 bones and embedded idle/walk/run animation clips. The controller blends between clips and adds jump and slide joint poses. The model is bundled with the site rather than hotlinked to another application.

See `assets/models/README.md` and the in-game **Credits** page for provenance and usage terms. The downloaded model is unchanged; the game applies its coral-and-navy material colors at runtime.

## Files

- `index.html`, `style.css`, `visuals.css` — responsive interface and phrasebook.
- `app.js` — game states, controls, learning flow, audio, and progress.
- `world.js` — Three.js scenery, obstacles, and collisions.
- `character.js`, `assets/models/runner.glb` — Mixamo player and animation controller.
- `atmosphere.js` — animated water, sky, procedural textures, birds, and particles.
- `game-logic.js` — spaced review queue and pure game logic.
- `lessons.json` — editable English, Roman-letter Greek, original Greek, and answer choices.
- `server.py` — standard-library static server and optional ElevenLabs proxy.
- `scripts/build_site.py`, `.github/workflows/pages.yml` — static build and deployment.
- `scripts/generate_audio.py` — optional offline ElevenLabs recording generation.
- `test_server.py`, `tests/game-logic.test.mjs` — server, asset, deployment, and learning checks.

## Checks

```bash
python3 -m unittest -v test_server.py
node --test tests/game-logic.test.mjs
```

The checks exercise static serving, private-file protection, audio with mocked ElevenLabs responses, stress marks, the skinned character and its animation clips, the Pages artifact, review spacing, progression, and collision rules. Node 22+ is used for the JavaScript checks; it is not required to play locally.
