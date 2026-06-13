'use strict';

const {
  COLORS,
  TYPE,
  DECK_SPEC,
  DECK_SIZE,
  DRAW_VALUE,
} = require('./constants');

/**
 * Build the canonical 168-card UNO No Mercy deck (ADAMAS variant).
 *
 * Each card: { id, color, type, value }
 *   - color: 'red'|'yellow'|'green'|'blue' for colored cards, null for wilds
 *   - type:  one of constants.TYPE
 *   - value: number value (0-9) for number cards; stacking value for draw
 *            cards; null otherwise
 *
 * Asserts the deck totals exactly DECK_SIZE (168) on build — a structural
 * invariant required by the spec (4.3).
 */
function buildDeck() {
  const cards = [];
  let nextId = 0;
  const mk = (color, type, value = null) => {
    cards.push({ id: `c${nextId++}`, color, type, value });
  };

  const { numbers, actions } = DECK_SPEC.perColor;

  for (const color of COLORS) {
    // Number cards: one 0, two each of 1-9 (0 and 7 are plain numbers here).
    for (let n = 0; n < numbers.zeroCount; n++) mk(color, TYPE.NUMBER, 0);
    for (let v = 1; v <= 9; v++) {
      for (let n = 0; n < numbers.oneToNineCount; n++) mk(color, TYPE.NUMBER, v);
    }
    // Colored action cards.
    for (const [type, count] of Object.entries(actions)) {
      for (let n = 0; n < count; n++) {
        mk(color, type, DRAW_VALUE[type] ?? null);
      }
    }
  }

  // Wild cards (no color until played).
  for (const [type, count] of Object.entries(DECK_SPEC.wilds)) {
    for (let n = 0; n < count; n++) {
      mk(null, type, DRAW_VALUE[type] ?? null);
    }
  }

  if (cards.length !== DECK_SIZE) {
    throw new Error(
      `Deck composition invariant violated: built ${cards.length} cards, expected ${DECK_SIZE}. ` +
        `Check DECK_SPEC in constants.js.`,
    );
  }

  return cards;
}

/**
 * Fisher–Yates shuffle. Pure: returns a new array, does not mutate input.
 * `rng` must return a float in [0, 1) (defaults to Math.random) — inject a
 * seeded rng for deterministic tests.
 */
function shuffle(cards, rng = Math.random) {
  const a = cards.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Tiny seeded PRNG (mulberry32) so tests/deals are reproducible.
 * Returns a function compatible with `rng` above.
 */
function makeRng(seed = 1) {
  let s = seed >>> 0;
  return function rng() {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = { buildDeck, shuffle, makeRng };
