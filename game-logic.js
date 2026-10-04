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
