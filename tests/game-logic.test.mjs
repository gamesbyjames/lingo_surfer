import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LessonQueue, safeProgress, obstacleHits, shuffled, normalizePace, getPacing, retimeRemaining, resolveLesson, progressKey } from '../game-logic.js';

const { phrases } = JSON.parse(await readFile(new URL('../lessons.json', import.meta.url)));
const hindi = JSON.parse(await readFile(new URL('../lessons-hi.json', import.meta.url)));

test('a missed phrase returns after two intervening questions', () => {
  const queue = new LessonQueue(phrases);
  const first = queue.next(); queue.answer(first, false);
  assert.equal(queue.next().id, phrases[1].id);
  assert.equal(queue.next().id, phrases[2].id);
  assert.equal(queue.next().id, first.id);
  queue.answer(first, true);
  assert.equal(queue.correct.has(first.id), true);
});

test('answering the complete story correctly ends the lesson', () => {
  const queue = new LessonQueue(phrases);
  let phrase;
  while ((phrase = queue.next())) queue.answer(phrase, true);
  assert.equal(queue.correct.size, 8);
  assert.equal(queue.attempted.size, 8);
  assert.equal(queue.next(), null);
});

test('a miss on the final question is reviewed rather than lost', () => {
  const queue = new LessonQueue(phrases);
  for (let i = 0; i < 7; i++) queue.answer(queue.next(), true);
  const final = queue.next(); queue.answer(final, false);
  assert.equal(queue.next().id, final.id);
  queue.answer(final, true);
  assert.equal(queue.next(), null);
});

test('saved progress survives corrupt data and removes invalid phrase IDs', () => {
  assert.deepEqual(safeProgress('broken', []), { best: 0, learned: [] });
  assert.deepEqual(safeProgress('null', []), { best: 0, learned: [] });
  assert.deepEqual(safeProgress('{"best":-2,"learned":["yesterday","bad","yesterday"]}', ['yesterday']), { best: 0, learned: ['yesterday'] });
});

test('jumping clears crates and sliding clears overhead obstacles', () => {
  assert.equal(obstacleHits('barrier', 0, false), true);
  assert.equal(obstacleHits('barrier', 1.3, false), false);
  assert.equal(obstacleHits('arch', 0, false), true);
  assert.equal(obstacleHits('arch', 0, true), false);
  assert.equal(obstacleHits('arch', 1.3, false), true);
});

test('answer shuffling preserves all options and never mutates the lesson', () => {
  const choices = ['correct', 'wrong1', 'wrong2'];
  assert.deepEqual(shuffled(choices, () => .1).sort(), [...choices].sort());
  assert.deepEqual(choices, ['correct', 'wrong1', 'wrong2']);
});

test('pace preferences default safely and stay within slider bounds', () => {
  for (const invalid of [null, undefined, '', 'broken', Infinity]) assert.equal(normalizePace(invalid), 3);
  assert.equal(normalizePace('5'), 5);
  assert.equal(normalizePace(99), 5);
  assert.equal(normalizePace(-2), 1);
  assert.equal(normalizePace(2.7), 3);
});

test('higher difficulty speeds up movement and reduces waiting without cutting reading to zero', () => {
  let previous;
  for (let level = 1; level <= 5; level++) {
    const short = getPacing(level), long = getPacing(level, true);
    assert.ok(short.gateSpeed >= 7, 'questions use running rather than walking speed');
    assert.ok(short.studyDuration >= 3, 'short recordings have time to finish');
    assert.ok(long.studyDuration > short.studyDuration);
    assert.ok(long.gateDuration > short.gateDuration);
    assert.ok(short.wrongFeedback > short.correctFeedback);
    if (previous) {
      assert.ok(short.runSpeed > previous.runSpeed);
      assert.ok(short.gateDuration < previous.gateDuration);
      assert.ok(short.studyDuration < previous.studyDuration);
      assert.ok(short.spawnInterval < previous.spawnInterval);
    }
    previous = short;
  }
  assert.equal(getPacing(3).studyDuration, 5);
  assert.equal(getPacing(3).correctFeedback, 1);
});

test('changing pace preserves phase progress instead of resetting the clock', () => {
  assert.equal(retimeRemaining(3, 6, 10), 5);
  assert.equal(retimeRemaining(5, 10, 6), 3);
  assert.equal(retimeRemaining(0, 6, 10), 0);
  assert.equal(retimeRemaining(-1, 6, 10), 0);
  assert.equal(retimeRemaining(12, 6, 10), 10);
  assert.equal(retimeRemaining(0, 0, 5), 5);
});

test('Hindi grammatical forms change text, options, and audio without changing progress IDs', () => {
  const masculine = resolveLesson(hindi, 'masculine');
  const feminine = resolveLesson(hindi, 'feminine');
  const male = masculine.phrases.find(p => p.id === 'hi-want-learn');
  const female = feminine.phrases.find(p => p.id === 'hi-want-learn');
  assert.ok(male.roman.includes('chAAhtaa'));
  assert.ok(female.roman.includes('chAAhtee'));
  assert.equal(male.id, female.id);
  assert.equal(male.audioId, 'hi-want-learn');
  assert.equal(female.audioId, 'hi-want-learn-feminine');
  assert.ok(female.distractors.every(text => !text.includes('chAAhtaa')));
  assert.ok(feminine.story.native.includes('सकती'));
  assert.equal(feminine.story.audioId, 'hi-story-feminine');
  assert.equal(feminine.phrases[0].audioId, masculine.phrases[0].audioId);
  assert.ok(hindi.phrases.find(p => p.id === male.id).roman.includes('chAAhtaa'), 'source lesson is not mutated');
});

test('Hindi completes all sixteen phrases and retains existing Greek storage', () => {
  const queue = new LessonQueue(resolveLesson(hindi, 'feminine').phrases);
  let phrase;
  while ((phrase = queue.next())) queue.answer(phrase, true);
  assert.equal(queue.correct.size, 16);
  assert.equal(progressKey('el'), 'little-odyssey-progress-v1');
  assert.notEqual(progressKey('el'), progressKey('hi'));
  const greekSave = JSON.stringify({ best: 120, learned: ['yesterday'] });
  assert.deepEqual(safeProgress(greekSave, hindi.phrases.map(p => p.id)).learned, []);
});
