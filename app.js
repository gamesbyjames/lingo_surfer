import { LessonQueue, shuffled, safeProgress } from './game-logic.js';

const $ = id => document.getElementById(id);
const show = (id, visible = true) => $(id).classList.toggle('hidden', !visible);
let world, phrases, story, progress, queue;
let state = 'loading', phase = 'study', phrase, answers = [], correctLane = 0;
let lane = 0, jumpHeight = 0, jumpVelocity = 0, slideTime = 0, invincible = 0;
let distance = 0, coins = 0, hearts = 3, streak = 0, rightAnswers = 0, attempts = 0;
let phaseRemaining = 0, gateDuration = 10, spawnTimer = 0, toastRemaining = 0;
let lastFrame = 0, muted = false, audioContext, voiceAvailable = false, currentAudio;
let speechGeneration = 0, voiceRequest;
let recordings = {};
const audioCache = new Map();
const STORAGE_KEY = 'little-odyssey-progress-v1';

function saveProgress() {
  progress.best = Math.max(progress.best, Math.floor(distance));
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(progress)); } catch { /* Session play still works without storage. */ }
  $('best-distance').textContent = `${progress.best.toLocaleString()} m`;
  $('learned-count').textContent = progress.learned.length;
}

function updateHud() {
  $('distance').textContent = Math.floor(distance);
  $('coins').textContent = coins;
  $('hearts').textContent = Array.from({ length: 3 }, (_, i) => i < hearts ? '♥' : '♡').join(' ');
}

function stopVoice() {
  speechGeneration++;
  voiceRequest?.abort();
  voiceRequest = null;
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  window.speechSynthesis?.cancel();
  $('audio-status').textContent = '';
}

async function speak(item, explicit = false) {
  if (muted && !explicit) return;
  stopVoice();
  const generation = speechGeneration;
  if (recordings[item.id]) {
    try {
      currentAudio = new Audio(new URL(recordings[item.id], document.baseURI).href);
      currentAudio.onended = () => { if (generation === speechGeneration) $('audio-status').textContent = ''; };
      await currentAudio.play();
      if (generation === speechGeneration) $('audio-status').textContent = 'Greek recording';
      return;
    } catch {
      if (generation !== speechGeneration) return;
    }
  }
  if (voiceAvailable) {
    $('audio-status').textContent = 'Preparing audio…';
    try {
      if (!audioCache.has(item.id)) {
        voiceRequest = new AbortController();
        const response = await fetch('./api/speech', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: item.id }), signal: voiceRequest.signal,
        });
        if (!response.ok) throw new Error('Speech service unavailable');
        const blob = await response.blob();
        if (generation !== speechGeneration) return;
        audioCache.set(item.id, URL.createObjectURL(blob));
      }
      if (generation !== speechGeneration) return;
      currentAudio = new Audio(audioCache.get(item.id));
      currentAudio.onended = () => { $('audio-status').textContent = ''; };
      await currentAudio.play();
      if (generation === speechGeneration) $('audio-status').textContent = 'ElevenLabs';
      return;
    } catch {
      if (generation !== speechGeneration) return;
      $('audio-status').textContent = 'Trying device audio…';
    }
  }
  if (!window.speechSynthesis) {
    $('audio-status').textContent = 'Audio unavailable on this device';
    return;
  }
  const voice = window.speechSynthesis.getVoices().find(v => v.lang.toLowerCase().startsWith('el'));
  if (!voice) {
    $('audio-status').textContent = explicit ? 'A Greek device voice or recording is needed' : '';
    return;
  }
  const speech = new SpeechSynthesisUtterance(item.greek);
  speech.lang = 'el-GR'; speech.voice = voice; speech.rate = .82;
  speech.onend = () => { if (generation === speechGeneration) $('audio-status').textContent = ''; };
  speech.onerror = () => { if (generation === speechGeneration) $('audio-status').textContent = 'Tap to try audio again'; };
  window.speechSynthesis.speak(speech);
  $('audio-status').textContent = 'Device voice';
}

function unlockSound() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (AudioCtx && !audioContext) audioContext = new AudioCtx();
  if (audioContext?.state === 'suspended') audioContext.resume().catch(() => {});
}

function tone(kind) {
  if (muted || !audioContext || audioContext.state !== 'running') return;
  const now = audioContext.currentTime;
  const frequencies = kind === 'correct' ? [523, 659, 784] : kind === 'coin' ? [880] : [190, 150];
  frequencies.forEach((freq, i) => {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sine'; osc.frequency.value = freq;
    gain.gain.setValueAtTime(.0001, now + i * .09);
    gain.gain.exponentialRampToValueAtTime(kind === 'coin' ? .025 : .05, now + i * .09 + .01);
    gain.gain.exponentialRampToValueAtTime(.0001, now + i * .09 + .22);
    osc.connect(gain); gain.connect(audioContext.destination);
    osc.start(now + i * .09); osc.stop(now + i * .09 + .23);
  });
}

function study(item) {
  phrase = item;
  $('study-roman').textContent = item.roman;
  $('study-roman').classList.toggle('long', item.roman.length > 22);
  $('study-english').textContent = item.english;
  const index = phrases.indexOf(item);
  $('phrase-number').textContent = `${String(index + 1).padStart(2, '0')} / 08`;
  $('phrase-label').textContent = queue?.attempted.has(item.id) ? 'A LITTLE MORE PRACTICE' : 'TRY SAYING';
  $('lesson-progress').replaceChildren(...phrases.map((p, i) => {
    const el = document.createElement('span');
    el.className = queue?.correct.has(p.id) ? 'done' : i === index ? 'current' : '';
    return el;
  }));
}

function toast(title, message, seconds = 4, review = false) {
  const strong = document.createElement('strong'); strong.textContent = title;
  const text = document.createElement('span'); text.textContent = message;
  $('toast').replaceChildren(strong, text);
  $('toast').classList.toggle('review', review);
  show('toast'); toastRemaining = seconds;
}

function nextPhrase() {
  const next = queue.next();
  if (!next) { finish(true); return; }
  study(next);
  phase = 'study'; phaseRemaining = next.roman.length > 35 ? 18 : 14;
  spawnTimer = 3;
  show('question-panel', false); show('answer-options', false); show('run-hint');
  world.clearGates();
  toast(next.roman, `${next.english} · Read it, say it, then find it at the gates.`, next.roman.length > 35 ? 8 : 6);
  speak(next);
}

function beginGate() {
  phase = 'gate';
  gateDuration = phrase.roman.length > 35 ? 16 : 11;
  phaseRemaining = gateDuration;
  jumpHeight = 0; jumpVelocity = 0; slideTime = 0;
  world.clearEntities();
  world.showGates(gateDuration * 4);
  answers = shuffled([phrase.roman, ...phrase.distractors]);
  correctLane = answers.indexOf(phrase.roman) - 1;
  $('question-text').textContent = `“${phrase.english}”`;
  $('question-kind').textContent = 'WHICH GREEK PHRASE MATCHES?';
  $('answer-options').replaceChildren(...answers.map((answer, i) => {
    const button = document.createElement('button');
    button.className = `answer${answer.length > 25 ? ' long' : ''}`;
    const number = document.createElement('span'); number.textContent = `${i === 0 ? '←' : i === 1 ? '↑' : '→'} LANE ${i + 1}`;
    const text = document.createElement('div'); text.textContent = answer;
    button.append(number, text);
    button.addEventListener('click', () => { if (state === 'running') chooseLane(i - 1); });
    return button;
  }));
  chooseLane(lane);
  show('toast', false); toastRemaining = 0;
  show('run-hint', false); show('question-panel'); show('answer-options');
  updateGateTimer();
}

function updateGateTimer() {
  $('gate-countdown').textContent = `${Math.ceil(Math.max(0, phaseRemaining))}s`;
  $('question-timer-fill').style.transform = `scaleX(${Math.max(0, phaseRemaining / gateDuration)})`;
}

function resolveGate() {
  const correct = lane === correctLane;
  attempts++;
  queue.answer(phrase, correct);
  if (correct) {
    streak++; rightAnswers++; coins += 10 + Math.min(streak - 1, 5) * 2;
    if (!progress.learned.includes(phrase.id)) progress.learned.push(phrase.id);
    toast(streak > 1 ? `${streak} in a row. Look at you!` : 'That’s it. A little more Greek.', `${phrase.roman} — ${phrase.english}`, 5);
    tone('correct');
    world.celebrate();
  } else {
    streak = 0;
    toast('A little practice is all it takes.', `${phrase.roman} means “${phrase.english}”. We’ll try it again shortly.`, 6, true);
    tone('review');
  }
  study(phrase);
  saveProgress(); updateHud();
  show('question-panel', false); show('answer-options', false);
  phase = 'feedback'; phaseRemaining = correct ? 5 : 6;
}

function start() {
  unlockSound(); stopVoice();
  queue = new LessonQueue(phrases);
  state = 'running'; lane = 0; jumpHeight = 0; jumpVelocity = 0; slideTime = 0; invincible = 0;
  distance = 0; coins = 0; hearts = 3; streak = 0; rightAnswers = 0; attempts = 0;
  world.reset(); updateHud();
  $('pause-button').textContent = 'Ⅱ';
  $('pause-button').setAttribute('aria-label', 'Pause game');
  ['start-screen', 'end-screen', 'pause-screen'].forEach(id => show(id, false));
  show('hud'); $('pause-button').disabled = false;
  document.querySelector('.game-card').classList.add('playing');
  nextPhrase();
  $('game-viewport').focus({ preventScroll: true });
}

function chooseLane(next) {
  lane = Math.max(-1, Math.min(1, next));
  [...$('answer-options').children].forEach((button, i) => {
    button.classList.toggle('selected', i - 1 === lane);
    button.setAttribute('aria-pressed', String(i - 1 === lane));
  });
}

function move(action) {
  if (state !== 'running' || $('phrasebook').open) return;
  if (action === 'left') chooseLane(lane - 1);
  if (action === 'right') chooseLane(lane + 1);
  if (action === 'jump' && phase !== 'gate' && jumpHeight === 0 && slideTime <= 0) jumpVelocity = 8.3;
  if (action === 'slide' && phase !== 'gate' && jumpHeight === 0) slideTime = .95;
}

function pause() {
  if (state !== 'running') return;
  state = 'paused'; stopVoice(); show('pause-screen');
  $('pause-button').setAttribute('aria-label', 'Resume game');
  $('pause-button').textContent = '▷';
}
function resume() {
  if (state !== 'paused' || $('phrasebook').open) return;
  state = 'running'; show('pause-screen', false);
  $('pause-button').setAttribute('aria-label', 'Pause game'); $('pause-button').textContent = 'Ⅱ';
  $('game-viewport').focus({ preventScroll: true });
}
function finish(completed = false) {
  state = 'ended'; stopVoice(); saveProgress();
  ['pause-screen', 'question-panel', 'answer-options', 'toast', 'run-hint'].forEach(id => show(id, false));
  $('pause-button').disabled = true;
  $('pause-button').textContent = 'Ⅱ'; $('pause-button').setAttribute('aria-label', 'Pause game');
  $('end-title').textContent = completed ? 'You have a story to tell.' : 'Look how far you came.';
  $('end-summary').textContent = completed ? 'Yesterday you decided. Today you can say a whole little story in Greek.' : 'Every attempt counts. Take those new words into your next run.';
  $('end-stats').replaceChildren(...[[`${Math.floor(distance)} m`, 'DISTANCE'], [coins, 'COINS'], [`${rightAnswers}/${attempts}`, 'ANSWERS']].map(([value, label]) => {
    const div = document.createElement('div'); const strong = document.createElement('strong'); const span = document.createElement('span');
    strong.textContent = value; span.textContent = label; div.append(strong, span); return div;
  }));
  const missed = phrases.filter(p => queue.attempted.has(p.id) && !queue.correct.has(p.id));
  $('end-review').replaceChildren();
  if (missed.length) {
    const heading = document.createElement('b'); heading.textContent = 'A few words to come back to:'; $('end-review').append(heading);
    missed.forEach(p => { const row = document.createElement('div'); row.textContent = `${p.roman} — ${p.english}`; $('end-review').append(row); });
  } else if (completed) {
    $('end-review').textContent = story.roman;
  }
  show('end-screen');
}

function simulate(dt) {
  if (state === 'running') {
    const speed = phase === 'gate' ? 4 : phase === 'feedback' ? 6 : Math.min(17, 11 + distance / 500);
    distance += speed * dt;
    phaseRemaining -= dt;
    invincible = Math.max(0, invincible - dt);
    slideTime = Math.max(0, slideTime - dt);
    if (jumpVelocity !== 0 || jumpHeight > 0) {
      jumpVelocity -= 20 * dt; jumpHeight = Math.max(0, jumpHeight + jumpVelocity * dt);
      if (jumpHeight === 0) jumpVelocity = 0;
    }
    if (toastRemaining > 0) { toastRemaining -= dt; if (toastRemaining <= 0) show('toast', false); }
    if (phase === 'study') {
      spawnTimer -= dt;
      // Stop spawning early enough that the track is clear before an answer gate.
      if (spawnTimer <= 0 && phaseRemaining > 6) {
        const obstacleLane = Math.floor(Math.random() * 3) - 1;
        world.spawnObstacle(obstacleLane, Math.random() > .5 ? 'barrier' : 'arch');
        const coinLane = [-1, 0, 1].filter(l => l !== obstacleLane)[Math.floor(Math.random() * 2)];
        world.spawnCoins(coinLane);
        spawnTimer = 3.1;
      }
    }
    const events = world.update(dt, speed, { lane, jumpHeight, sliding: slideTime > 0, running: true, invincible });
    for (const event of events) {
      if (event === 'coin') { coins++; tone('coin'); }
      if (event === 'hit' && invincible <= 0) {
        hearts--; invincible = 2.2; tone('review');
        if (hearts <= 0) { finish(); break; }
        toast('Keep your feet moving.', '↑ Jump over crates · ↓ Slide under blue barriers · ← → Dodge', 3, true);
      }
    }
    updateHud();
    if (state === 'running') {
      if (phase === 'gate') updateGateTimer();
      if (phaseRemaining <= 0) {
        if (phase === 'study') beginGate();
        else if (phase === 'gate') resolveGate();
        else nextPhrase();
      }
    }
  } else if (state === 'ready') {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    world.update(reduced ? 0 : dt, reduced ? 0 : 1.8, { lane: 0, jumpHeight: 0, sliding: false, running: false, invincible: 0 });
  }
}

let accumulator = 0;
function frame(timestamp) {
  // Keep time and physics consistent on slower GPUs; render only once per frame.
  accumulator += Math.min((timestamp - (lastFrame || timestamp)) / 1000, .2);
  lastFrame = timestamp;
  while (accumulator >= 1 / 60) { simulate(1 / 60); accumulator -= 1 / 60; }
  world.render();
  requestAnimationFrame(frame);
}

function setupControls() {
  $('start-button').addEventListener('click', start);
  $('restart-button').addEventListener('click', start);
  $('fullscreen-button').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.querySelector('.game-card').requestFullscreen();
    } catch { toast('A little more room.', 'Use your browser’s full-screen option to expand the view.', 4); }
  });
  document.addEventListener('fullscreenchange', () => {
    $('fullscreen-button').setAttribute('aria-label', document.fullscreenElement ? 'Exit full screen' : 'Expand game');
  });
  $('pause-button').addEventListener('click', () => state === 'paused' ? resume() : pause());
  $('resume-button').addEventListener('click', resume);
  $('end-run-button').addEventListener('click', () => finish());
  $('listen-button').addEventListener('click', () => { unlockSound(); speak(phrase || phrases[0], true); });
  $('story-listen').addEventListener('click', () => speak(story, true));
  $('sound-button').addEventListener('click', () => {
    muted = !muted; unlockSound();
    if (muted) stopVoice();
    $('sound-button').textContent = muted ? '♪̸' : '♫';
    $('sound-button').setAttribute('aria-label', muted ? 'Enable game sounds' : 'Mute game sounds');
  });
  $('phrasebook-button').addEventListener('click', () => { pause(); $('phrasebook').showModal(); });
  $('close-phrasebook').addEventListener('click', () => $('phrasebook').close());
  $('phrasebook').addEventListener('close', stopVoice);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('blur', pause);
  window.addEventListener('keydown', event => {
    if ($('phrasebook').open || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
    if (event.key.toLowerCase() === 'p' || event.key === 'Escape') {
      event.preventDefault(); state === 'paused' ? resume() : pause(); return;
    }
    if (state !== 'running') return;
    const actions = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'jump', w: 'jump', W: 'jump', ArrowDown: 'slide', s: 'slide', S: 'slide', ' ': 'jump' };
    if (actions[event.key]) { event.preventDefault(); if (!event.repeat) move(actions[event.key]); }
    if (phase === 'gate' && ['1', '2', '3'].includes(event.key)) chooseLane(Number(event.key) - 2);
  });
  let touch = null;
  const viewport = $('game-viewport');
  viewport.addEventListener('pointerdown', event => {
    touch = { x: event.clientX, y: event.clientY, id: event.pointerId };
    viewport.setPointerCapture(event.pointerId);
  });
  viewport.addEventListener('pointerup', event => {
    if (!touch || touch.id !== event.pointerId) return;
    const dx = event.clientX - touch.x, dy = event.clientY - touch.y;
    touch = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return;
    move(Math.abs(dx) > Math.abs(dy) ? dx > 0 ? 'right' : 'left' : dy > 0 ? 'slide' : 'jump');
  });
  viewport.addEventListener('pointercancel', () => { touch = null; });
}

async function init() {
  try {
    const response = await fetch('./lessons.json');
    if (!response.ok) throw new Error('The lesson file could not be loaded.');
    ({ phrases, story } = await response.json());
    let saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch { /* Private mode can disable storage. */ }
    progress = safeProgress(saved, phrases.map(p => p.id)); saveProgress();
    study(phrases[0]);
    phrases.forEach((item, i) => {
      const row = document.createElement('div'); row.className = 'phrasebook-row';
      const number = document.createElement('span'); number.className = 'phrase-index'; number.textContent = String(i + 1).padStart(2, '0');
      const text = document.createElement('div'); const roman = document.createElement('strong'); const english = document.createElement('p');
      roman.textContent = item.roman; english.textContent = item.english; text.append(roman, english);
      const button = document.createElement('button'); button.textContent = '▷'; button.setAttribute('aria-label', `Hear ${item.english}`);
      button.addEventListener('click', () => speak(item, true)); row.append(number, text, button); $('phrasebook-list').append(row);
    });
    setupControls();
    const audioSetup = Promise.all([
      fetch('./audio/manifest.json').then(r => r.ok ? r.json() : {}).then(manifest => { recordings = manifest; }).catch(() => {}),
      fetch('./runtime.json').then(r => r.ok ? r.json() : {}).then(async runtime => {
        if (!runtime.speechApi) return;
        const response = await fetch('./api/config');
        if (response.ok) voiceAvailable = (await response.json()).elevenlabs === true;
      }).catch(() => {}),
    ]);
    window.speechSynthesis?.getVoices();
    const { CoastWorld } = await import('./world.js');
    world = new CoastWorld($('game-viewport'));
    world.render();
    await Promise.all([world.ready, audioSetup]);
    $('character-status').textContent = 'MIXAMO RUNNER · READY FOR THE COAST';
    state = 'ready';
    $('start-button').disabled = false;
    $('start-button').replaceChildren(document.createTextNode('Let’s take the first step '), Object.assign(document.createElement('span'), { textContent: '↗' }));
    requestAnimationFrame(frame);
  } catch (error) {
    console.error(error);
    $('load-error-message').textContent = 'The coast or its animated runner couldn’t load. Check your connection and refresh to try again.';
    show('start-screen', false); show('load-error');
  }
}
init();
