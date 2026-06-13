'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildDeck, shuffle, makeRng } = require('../src/engine/noMercy/deck');
const { DECK_SIZE, TYPE } = require('../src/engine/noMercy/constants');

test('deck builds to exactly 168 cards', () => {
  const deck = buildDeck();
  assert.equal(deck.length, DECK_SIZE);
  assert.equal(deck.length, 168);
});

test('deck has unique ids', () => {
  const deck = buildDeck();
  const ids = new Set(deck.map((c) => c.id));
  assert.equal(ids.size, deck.length);
});

test('number cards: 76 total, 0 and 7 present as plain numbers', () => {
  const deck = buildDeck();
  const numbers = deck.filter((c) => c.type === TYPE.NUMBER);
  assert.equal(numbers.length, 76);
  // one 0 per color (4), two 7s per color (8)
  assert.equal(numbers.filter((c) => c.value === 0).length, 4);
  assert.equal(numbers.filter((c) => c.value === 7).length, 8);
});

test('only Draw 2 is a colored draw; 4/6/10/reverse+4 are wild', () => {
  const deck = buildDeck();
  assert.equal(deck.filter((c) => c.type === TYPE.DRAW2).length, 12); // 3 per color
  assert.equal(deck.filter((c) => c.color !== null && c.type === TYPE.WILD_DRAW4).length, 0);
  assert.ok(deck.filter((c) => c.type === TYPE.WILD_DRAW4).every((c) => c.color === null));
});

test('type composition sums to 168', () => {
  const deck = buildDeck();
  const counts = {};
  for (const c of deck) counts[c.type] = (counts[c.type] || 0) + 1;
  const sum = Object.values(counts).reduce((a, b) => a + b, 0);
  assert.equal(sum, 168);
});

test('shuffle is a permutation (same multiset, deterministic with seed)', () => {
  const deck = buildDeck();
  const a = shuffle(deck, makeRng(7));
  const b = shuffle(deck, makeRng(7));
  assert.equal(a.length, deck.length);
  assert.deepEqual(
    a.map((c) => c.id),
    b.map((c) => c.id),
    'same seed → same order',
  );
  assert.deepEqual(
    new Set(a.map((c) => c.id)),
    new Set(deck.map((c) => c.id)),
    'no cards lost or duplicated',
  );
});
