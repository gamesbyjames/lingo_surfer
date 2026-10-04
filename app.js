import { LessonQueue, shuffled, safeProgress, getPacing, normalizePace, retimeRemaining, resolveLesson, progressKey } from './game-logic.js';

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
let paceLevel = 3, phaseDuration = 0, lastAnswerCorrect = true, resumeAfterPace = false;
let languages = [], language, lesson, hindiForm = 'masculine', resumeAfterLanguage = false;
const courses = new Map();
const audioCache = new Map();
const PACE_KEY = 'lingo-surfer-pace-v1';
const LANGUAGE_KEY = 'lingo-surfer-language-v1';
const HINDI_FORM_KEY = 'lingo-surfer-hindi-form-v1';

function buildPhrasebook() {
  $('phrasebook-title').textContent = lesson.title;
  $('phrasebook-intro').textContent = lesson.pronunciationGuide;
  $('whole-story-text').textContent = story.roman;
  $('phrasebook-list').replaceChildren(...phrases.map((item, i) => {
    const row = document.createElement('div'); row.className = 'phrasebook-row';
    const number = document.createElement('span'); number.className = 'phrase-index'; number.textContent = String(i + 1).padStart(2, '0');
    const text = document.createElement('div'); const roman = document.createElement('strong'); const english = document.createElement('p');
    roman.textContent = item.roman; english.textContent = item.english; text.append(roman, english);
    if (item.note) { const note = document.createElement('p'); note.className = 'phrase-note'; note.textContent = item.note; text.append(note); }
    const button = document.createElement('button'); button.textContent = '▷'; button.setAttribute('aria-label', `Hear ${item.english} in ${language.name}`);
    button.addEventListener('click', () => speak(item, true)); row.append(number, text, button);
    return row;
  }));
}

function selectLanguage(id, form = hindiForm) {
  const selected = languages.find(item => item.id === id) || languages[0];
  const nextForm = form === 'feminine' ? 'feminine' : 'masculine';
  if (language?.id === selected.id && (selected.id !== 'hi' || nextForm === hindiForm)) return;
  if (progress) saveProgress();
  stopVoice(); resumeAfterLanguage = false;
  language = selected; hindiForm = nextForm;
  lesson = resolveLesson(courses.get(language.id), language.id === 'hi' ? hindiForm : 'masculine');
  ({ phrases, story } = lesson);
  queue = null; lane = 0; jumpHeight = 0; jumpVelocity = 0; slideTime = 0; invincible = 0;
  distance = 0; coins = 0; hearts = 3; streak = 0; rightAnswers = 0; attempts = 0;
  phase = 'study'; phaseRemaining = 0; phaseDuration = 0; toastRemaining = 0;
  if (world) { world.reset(); state = 'ready'; }
  let saved = null;
  try {
    saved = localStorage.getItem(progressKey(language.id));
    localStorage.setItem(LANGUAGE_KEY, language.id);
    localStorage.setItem(HINDI_FORM_KEY, hindiForm);
  } catch { /* Language switching also works without browser storage. */ }
  progress = safeProgress(saved, phrases.map(p => p.id));
  saveProgress(); updateHud(); study(phrases[0]); buildPhrasebook();
  $('language-name').textContent = language.name;
  $('language-flag').textContent = language.flag;
  $('language-button').setAttribute('aria-label', `Learning ${language.name}. Change language`);
  document.querySelectorAll('[data-language-name]').forEach(el => { el.textContent = language.name; });
  document.querySelectorAll('[data-language-choice]').forEach(button => {
    button.classList.toggle('selected', button.dataset.languageChoice === language.id);
    button.setAttribute('aria-pressed', String(button.dataset.languageChoice === language.id));
  });
  $('story-english').textContent = `“${story.english}”`;
  $('pronunciation-tip').textContent = lesson.pronunciationTip;
  $('learned-total').textContent = phrases.length;
  $('start-caption').textContent = `ONE STORY · ${phrases.length} PRACTICE STEPS · YOUR OWN PACE`;
  $('hindi-form-field').classList.toggle('hidden', language.id !== 'hi');
  $('hindi-form').value = hindiForm;
  $('pause-button').disabled = true;
  $('pause-button').textContent = 'Ⅱ'; $('pause-button').setAttribute('aria-label', 'Pause game');
  document.querySelector('.game-card').setAttribute('aria-label', `3D ${language.name} learning runner`);
  document.querySelector('.game-card').classList.remove('playing');
  document.title = `Lingo Surfer · A little ${language.name}. A little further.`;
  ['hud', 'pause-screen', 'end-screen', 'question-panel', 'answer-options', 'toast', 'run-hint'].forEach(id => show(id, false));
  show('start-screen');
}

function buildLanguageMenu() {
  $('language-options').replaceChildren(...languages.map(item => {
    const button = document.createElement('button'); button.className = 'language-option'; button.dataset.languageChoice = item.id;
    const flag = document.createElement('span'); flag.className = 'language-option-flag'; flag.textContent = item.flag;
    const name = document.createElement('strong'); name.textContent = item.name;
    const summary = document.createElement('span'); summary.textContent = `${courses.get(item.id).phrases.length} phrases · Beginner`;
    const description = document.createElement('p'); description.textContent = item.description;
    button.append(flag, name, summary, description);
    button.addEventListener('click', () => selectLanguage(item.id));
    return button;
  }));
}

function pacing() { return getPacing(paceLevel, (phrase?.roman.length || 0) > 35); }

function setPace(value) {
  paceLevel = normalizePace(value);
  const pace = pacing();
  $('pace-slider').value = paceLevel;
  $('pace-value').textContent = `${paceLevel} / 5 · ${pace.label}`;
  $('pace-slider').setAttribute('aria-valuetext', `${pace.label}, difficulty ${paceLevel} of 5`);
  $('pace-description').textContent = `${pace.study}s to learn a short phrase · ${pace.gate}s to choose. Longer sentences get extra time. Tap an answer to skip the countdown.`;
  document.querySelectorAll('[data-pace-label]').forEach(el => { el.textContent = pace.label; });
  $('pace-button').title = `Pace: ${pace.label} — change difficulty`;
  if (state === 'running' || state === 'paused') {
    const duration = phase === 'study' ? pace.studyDuration : phase === 'gate' ? pace.gateDuration : lastAnswerCorrect ? pace.correctFeedback : pace.wrongFeedback;
    phaseRemaining = retimeRemaining(phaseRemaining, phaseDuration, duration);
    phaseDuration = duration;
    if (phase === 'gate') {
      gateDuration = duration;
      world.setGateRemaining(phaseRemaining, pace.gateSpeed);
      updateGateTimer();
    }
    if (phase === 'feedback') toastRemaining = phaseRemaining;
    if (phase === 'study') {
      toastRemaining = Math.min(toastRemaining, phaseRemaining);
      // Re-timing may bring a question forward; keep its approach obstacle-free.
      world.clearEntities();
      spawnTimer = .2;
    }
  }
  try { localStorage.setItem(PACE_KEY, String(paceLevel)); } catch { /* Session setting still works. */ }
}

function saveProgress() {
  progress.best = Math.max(progress.best, Math.floor(distance));
  try { localStorage.setItem(progressKey(language.id), JSON.stringify(progress)); } catch { /* Session play still works without storage. */ }
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
  $('audio-status').textContent = '';
}

async function speak(item, explicit = false) {
  if (muted && !explicit) return;
  stopVoice();
  const generation = speechGeneration;
  const audioId = item.audioId || item.id;
  if (recordings[audioId]) {
    try {
      currentAudio = new Audio(new URL(recordings[audioId], document.baseURI).href);
      currentAudio.onended = () => { if (generation === speechGeneration) $('audio-status').textContent = ''; };
      await currentAudio.play();
      if (generation === speechGeneration) $('audio-status').textContent = `ElevenLabs · ${language.name}`;
      return;
    } catch {
      if (generation !== speechGeneration) return;
    }
  }
  if (voiceAvailable) {
    $('audio-status').textContent = 'Preparing audio…';
    try {
      if (!audioCache.has(audioId)) {
        voiceRequest = new AbortController();
        const response = await fetch('./api/speech', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: audioId }), signal: voiceRequest.signal,
        });
        if (!response.ok) throw new Error('Speech service unavailable');
        const blob = await response.blob();
        if (generation !== speechGeneration) return;
        audioCache.set(audioId, URL.createObjectURL(blob));
      }
      if (generation !== speechGeneration) return;
      currentAudio = new Audio(audioCache.get(audioId));
      currentAudio.onended = () => { if (generation === speechGeneration) $('audio-status').textContent = ''; };
      await currentAudio.play();
      if (generation === speechGeneration) $('audio-status').textContent = 'ElevenLabs';
      return;
    } catch {
      if (generation !== speechGeneration) return;
    }
  }
  // Never silently replace a language recording with a device's synthetic
  // voice: its accent and quality vary dramatically across browsers.
  if (generation === speechGeneration) {
    $('audio-status').textContent = explicit ? 'Recording unavailable. Please try again.' : `Tap Hear it in ${language.name} to play audio`;
  }
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
  $('phrase-number').textContent = `${String(index + 1).padStart(2, '0')} / ${String(phrases.length).padStart(2, '0')}`;
  $('study-note').textContent = item.note || '';
  show('study-note', Boolean(item.note));
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
  phase = 'study'; phaseDuration = pacing().studyDuration; phaseRemaining = phaseDuration;
  spawnTimer = .2;
  show('question-panel', false); show('answer-options', false); show('run-hint');
  world.clearGates();
  toast(next.roman, `${next.english} · Read it, say it, then choose.`, Math.min(phaseDuration, next.roman.length > 35 ? 6 : 3));
  speak(next);
}

function beginGate() {
  phase = 'gate';
  gateDuration = pacing().gateDuration;
  phaseDuration = gateDuration; phaseRemaining = gateDuration;
  jumpHeight = 0; jumpVelocity = 0; slideTime = 0;
  world.clearEntities();
  world.showGates(gateDuration * pacing().gateSpeed);
  answers = shuffled([phrase.roman, ...phrase.distractors]);
  correctLane = answers.indexOf(phrase.roman) - 1;
  $('question-text').textContent = `“${phrase.english}”`;
  $('question-kind').textContent = `WHICH ${language.name.toUpperCase()} PHRASE MATCHES?`;
  $('answer-options').replaceChildren(...answers.map((answer, i) => {
    const button = document.createElement('button');
    button.className = `answer${answer.length > 25 ? ' long' : ''}`;
    const number = document.createElement('span'); number.textContent = `${i + 1} · ${['LEFT', 'MIDDLE', 'RIGHT'][i]}`;
    const text = document.createElement('div'); text.textContent = answer;
    button.append(number, text);
    button.addEventListener('click', () => confirmAnswer(i - 1));
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
  if (state !== 'running' || phase !== 'gate') return;
  const correct = lane === correctLane;
  // Lock the answer synchronously so double taps/key repeats cannot score twice.
  phase = 'feedback'; lastAnswerCorrect = correct;
  phaseDuration = correct ? pacing().correctFeedback : pacing().wrongFeedback;
  phaseRemaining = phaseDuration;
  world.passGate();
  attempts++;
  queue.answer(phrase, correct);
  if (correct) {
    streak++; rightAnswers++; coins += 10 + Math.min(streak - 1, 5) * 2;
    if (!progress.learned.includes(phrase.id)) progress.learned.push(phrase.id);
    toast(streak > 1 ? `${streak} in a row. Look at you!` : `That’s it. A little more ${language.name}.`, `${phrase.roman} — ${phrase.english}`, phaseDuration);
    tone('correct');
    world.celebrate();
  } else {
    streak = 0;
    toast('A little practice is all it takes.', `${phrase.roman} means “${phrase.english}”. We’ll try it again shortly.`, phaseDuration, true);
    tone('review');
  }
  study(phrase);
  saveProgress(); updateHud();
  show('question-panel', false); show('answer-options', false);
  show('run-hint');
}

function confirmAnswer(selectedLane = lane) {
  if (state !== 'running' || phase !== 'gate' || $('pace-settings').open || $('language-menu').open || $('phrasebook').open) return;
  chooseLane(selectedLane);
  resolveGate();
  $('game-viewport').focus({ preventScroll: true });
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
  if (state !== 'paused' || $('phrasebook').open || $('pace-settings').open || $('language-menu').open) return;
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
  $('end-summary').textContent = completed ? `A story and new words to make your own. Look how much ${language.name} you can say.` : 'Every attempt counts. Take those new words into your next run.';
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
    const pace = pacing();
    const speed = phase === 'gate' ? pace.gateSpeed : Math.min(pace.runSpeed + 4, pace.runSpeed + distance / 750);
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
      // Give at least 1.8 seconds of reaction time, even in a short Sprint phase.
      // The final coin clears in under 2.7s at the slowest speed.
      if (spawnTimer <= 0 && phaseRemaining > 2.7) {
        const obstacleLane = Math.floor(Math.random() * 3) - 1;
        const spawnZ = 6 - speed * 1.8;
        world.spawnObstacle(obstacleLane, Math.random() > .5 ? 'barrier' : 'arch', spawnZ);
        const coinLane = [-1, 0, 1].filter(l => l !== obstacleLane)[Math.floor(Math.random() * 2)];
        world.spawnCoins(coinLane, false, spawnZ + 2);
        spawnTimer = pace.spawnInterval;
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
  document.querySelectorAll('[data-open-languages]').forEach(button => button.addEventListener('click', () => {
    resumeAfterLanguage = state === 'running';
    pause();
    $('language-menu').showModal();
  }));
  $('close-languages').addEventListener('click', () => $('language-menu').close());
  $('hindi-form').addEventListener('change', event => selectLanguage('hi', event.target.value));
  $('language-menu').addEventListener('close', () => {
    if (resumeAfterLanguage && !document.hidden) resume();
    resumeAfterLanguage = false;
  });
  document.querySelectorAll('[data-open-pace]').forEach(button => button.addEventListener('click', () => {
    resumeAfterPace = state === 'running';
    pause();
    $('pace-settings').showModal();
  }));
  $('pace-slider').addEventListener('input', event => setPace(event.target.value));
  $('close-pace').addEventListener('click', () => $('pace-settings').close());
  $('pace-settings').addEventListener('close', () => {
    if (resumeAfterPace && !document.hidden) resume();
    resumeAfterPace = false;
  });
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
    if ($('phrasebook').open || $('pace-settings').open || $('language-menu').open || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
    if (event.key.toLowerCase() === 'p' || event.key === 'Escape') {
      event.preventDefault(); state === 'paused' ? resume() : pause(); return;
    }
    if (state !== 'running') return;
    // Preserve native Enter/Space activation for focused interface buttons.
    if (['Enter', ' '].includes(event.key) && event.target.closest('button')) return;
    if (phase === 'gate' && ['1', '2', '3', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      if (!event.repeat) confirmAnswer(['1', '2', '3'].includes(event.key) ? Number(event.key) - 2 : lane);
      return;
    }
    const actions = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'jump', w: 'jump', W: 'jump', ArrowDown: 'slide', s: 'slide', S: 'slide', ' ': 'jump' };
    if (actions[event.key]) { event.preventDefault(); if (!event.repeat) move(actions[event.key]); }
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
    const response = await fetch('./languages.json');
    if (!response.ok) throw new Error('The language menu could not be loaded.');
    languages = await response.json();
    await Promise.all(languages.map(async item => {
      const response = await fetch(`./${item.lesson}`);
      if (!response.ok) throw new Error(`The ${item.name} lesson could not be loaded.`);
      courses.set(item.id, await response.json());
    }));
    buildLanguageMenu();
    let savedLanguage = null;
    try {
      savedLanguage = localStorage.getItem(LANGUAGE_KEY);
      hindiForm = localStorage.getItem(HINDI_FORM_KEY) === 'feminine' ? 'feminine' : 'masculine';
    } catch { /* Private browsing. */ }
    selectLanguage(savedLanguage || 'el', hindiForm);
    let savedPace = null;
    try { savedPace = localStorage.getItem(PACE_KEY); } catch { /* Private browsing. */ }
    setPace(savedPace);
    setupControls();
    const audioSetup = Promise.all([
      fetch('./audio/manifest.json').then(r => r.ok ? r.json() : {}).then(manifest => { recordings = manifest; }).catch(() => {}),
      fetch('./runtime.json').then(r => r.ok ? r.json() : {}).then(async runtime => {
        if (!runtime.speechApi) return;
        const response = await fetch('./api/config');
        if (response.ok) voiceAvailable = (await response.json()).elevenlabs === true;
      }).catch(() => {}),
    ]);
    const { CoastWorld } = await import('./world.js');
    world = new CoastWorld($('game-viewport'));
    world.render();
    await Promise.all([world.ready, audioSetup]);
    $('character-status').textContent = 'MIXAMO RUNNER · READY FOR THE COAST';
    state = 'ready';
    $('start-button').disabled = false;
    document.querySelectorAll('[data-open-languages]').forEach(button => { button.disabled = false; });
    $('start-button').replaceChildren(document.createTextNode('Let’s take the first step '), Object.assign(document.createElement('span'), { textContent: '↗' }));
    requestAnimationFrame(frame);
  } catch (error) {
    console.error(error);
    $('load-error-message').textContent = 'The coast or its animated runner couldn’t load. Check your connection and refresh to try again.';
    show('start-screen', false); show('load-error');
  }
}
init();
