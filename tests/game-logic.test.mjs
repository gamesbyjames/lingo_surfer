import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LessonQueue, safeProgress, obstacleHits, shuffled } from '../game-logic.js';

const { phrases } = JSON.parse(await readFile(new URL('../lessons.json', import.meta.url)));

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
