'use strict';

const { COLORS, TYPE, DECK_SPEC, DECK_SIZE } = require('./constants');

/**
 * Build the 116-card UNO Spin deck: standard 108-card UNO + 8 Spin cards.
 * Card: { id, color, type, value }. Asserts total === 116 on build.
 */
function buildDeck() {
  const cards = [];
  let nextId = 0;
  const mk = (color, type, value = null) => cards.push({ id: `s${nextId++}`, color, type, value });

  const { numbers, actions } = DECK_SPEC.perColor;
  for (const color of COLORS) {
    for (let z = 0; z < numbers.zeroCount; z++) mk(color, TYPE.NUMBER, 0);
    for (let v = 1; v <= 9; v++) {
      for (let k = 0; k < numbers.oneToNineCount; k++) mk(color, TYPE.NUMBER, v);
    }
    for (const [type, count] of Object.entries(actions)) {
      for (let k = 0; k < count; k++) mk(color, type, null);
    }
  }
  for (const [type, count] of Object.entries(DECK_SPEC.wilds)) {
    for (let k = 0; k < count; k++) mk(null, type, null);
  }

  if (cards.length !== DECK_SIZE) {
    throw new Error(`Spin deck invariant violated: built ${cards.length}, expected ${DECK_SIZE}.`);
  }
  return cards;
}

function shuffle(cards, rng = Math.random) {
  const a = cards.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

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
