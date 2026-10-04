export function shuffled(items, random = Math.random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Missed material returns after two intervening questions, giving it some spacing.
export class LessonQueue {
  constructor(phrases) {
    this.phrases = phrases;
    this.nextIndex = 0;
    this.turn = 0;
    this.reviews = [];
    this.correct = new Set();
    this.attempted = new Set();
  }
  next() {
    const due = this.reviews.findIndex(item => item.due <= this.turn);
    let phrase;
    if (due !== -1) phrase = this.reviews.splice(due, 1)[0].phrase;
    else if (this.nextIndex < this.phrases.length) phrase = this.phrases[this.nextIndex++];
    else if (this.reviews.length) phrase = this.reviews.shift().phrase;
    else return null;
    this.turn++;
    return phrase;
  }
  answer(phrase, correct) {
    this.attempted.add(phrase.id);
    if (correct) this.correct.add(phrase.id);
    else {
      this.correct.delete(phrase.id);
      if (!this.reviews.some(item => item.phrase.id === phrase.id)) {
        this.reviews.push({ phrase, due: this.turn + 2 });
      }
    }
  }
}

export function safeProgress(raw, validIds) {
  try {
    const data = JSON.parse(raw);
    return {
      best: Number.isFinite(data?.best) ? Math.max(0, Math.floor(data.best)) : 0,
      learned: Array.isArray(data?.learned) ? [...new Set(data.learned.filter(id => validIds.includes(id)))] : [],
    };
  } catch { return { best: 0, learned: [] }; }
}

export function obstacleHits(kind, jumpHeight, sliding) {
  return kind === 'barrier' ? jumpHeight < 1.05 : !sliding;
}

const PACES = [
  { label: 'Relaxed', runSpeed: 10, gateSpeed: 7.5, study: 9, sentenceStudy: 12, gate: 10, sentenceGate: 14, correctFeedback: 2, wrongFeedback: 4, spawnInterval: 3.5 },
  { label: 'Steady', runSpeed: 12, gateSpeed: 8, study: 7, sentenceStudy: 10, gate: 8, sentenceGate: 11, correctFeedback: 1.5, wrongFeedback: 3.5, spawnInterval: 3 },
  { label: 'Brisk', runSpeed: 14, gateSpeed: 9, study: 5, sentenceStudy: 7, gate: 6, sentenceGate: 9, correctFeedback: 1, wrongFeedback: 3, spawnInterval: 2.4 },
  { label: 'Fast', runSpeed: 17, gateSpeed: 10, study: 4, sentenceStudy: 6, gate: 5, sentenceGate: 7, correctFeedback: .9, wrongFeedback: 2.5, spawnInterval: 1.9 },
  { label: 'Sprint', runSpeed: 20, gateSpeed: 11, study: 3, sentenceStudy: 5, gate: 4, sentenceGate: 6, correctFeedback: .75, wrongFeedback: 2, spawnInterval: 1.5 },
];

export function normalizePace(value) {
  if (value === null || value === undefined || value === '') return 3;
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(5, Math.max(1, Math.round(number))) : 3;
}

export function getPacing(level, longPhrase = false) {
  const pace = PACES[normalizePace(level) - 1];
  return {
    ...pace,
    studyDuration: longPhrase ? pace.sentenceStudy : pace.study,
    gateDuration: longPhrase ? pace.sentenceGate : pace.gate,
  };
}

// Changing difficulty preserves progress through the current phase, including
// while paused. It cannot reset a nearly completed question to a full timer.
export function retimeRemaining(remaining, oldDuration, newDuration) {
  if (oldDuration <= 0) return newDuration;
  return Math.min(1, Math.max(0, remaining / oldDuration)) * newDuration;
}

export function resolveLesson(course, form = 'masculine') {
  const resolve = item => {
    const variant = item.forms?.[form];
    return { ...item, ...variant, id: item.id, audioId: variant ? `${item.id}-${form}` : item.id };
  };
  return { ...course, story: resolve(course.story), phrases: course.phrases.map(resolve) };
}

export function progressKey(language) {
  // Preserve existing Greek progress from before the language menu was added.
  return language === 'el' ? 'little-odyssey-progress-v1' : `little-odyssey-progress-v1:${language}`;
}
