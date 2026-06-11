'use strict';

const { DECK_SPEC, DECK_SIZE, DRAW_VALUE, TYPE } = require('./constants');

/**
 * Build the 112-card double-sided UNO Flip deck.
 *
 * Each physical card: { id, light: {color,type,value}, dark: {color,type,value} }.
 * We generate the light and dark faces in four matched category buckets
 * (numbers / actions / flips / wilds) — both sides have identical bucket sizes
 * (76 / 24 / 4 / 8) — then pair index-wise within each bucket. So every physical
 * card pairs like-with-like (number↔number, action↔action, flip↔flip,
 * wild↔wild), exactly like the real product, and a Flip card is a Flip on BOTH
 * faces. Asserts the deck totals exactly 112 (mirrors the No Mercy invariant).
 */
function faceValue(type, n) {
  if (type === TYPE.NUMBER) return n;
  return DRAW_VALUE[type] ?? null;
}

function buildSideBuckets(sideSpec) {
  const numbers = [];
  const actions = [];
  const flips = [];
  const wilds = [];
  const { colors, numbers: numSpec, actions: actSpec, wilds: wildSpec } = sideSpec;

  for (const color of colors) {
    for (let z = 0; z < numSpec.zeroCount; z++) numbers.push({ color, type: TYPE.NUMBER, value: 0 });
    for (let v = 1; v <= 9; v++) {
      for (let k = 0; k < numSpec.oneToNineCount; k++) numbers.push({ color, type: TYPE.NUMBER, value: v });
    }
    for (const [type, count] of Object.entries(actSpec)) {
      const bucket = type === TYPE.FLIP ? flips : actions;
      for (let k = 0; k < count; k++) bucket.push({ color, type, value: faceValue(type, null) });
    }
  }
  for (const [type, count] of Object.entries(wildSpec)) {
    for (let k = 0; k < count; k++) wilds.push({ color: null, type, value: faceValue(type, null) });
  }
  return { numbers, actions, flips, wilds };
}

function buildDeck() {
  const light = buildSideBuckets(DECK_SPEC.light);
  const dark = buildSideBuckets(DECK_SPEC.dark);

  const cards = [];
  let nextId = 0;
  const pair = (lightBucket, darkBucket) => {
    if (lightBucket.length !== darkBucket.length) {
      throw new Error(`Flip deck bucket mismatch: ${lightBucket.length} light vs ${darkBucket.length} dark`);
    }
    for (let i = 0; i < lightBucket.length; i++) {
      cards.push({ id: `f${nextId++}`, light: lightBucket[i], dark: darkBucket[i] });
    }
  };
  pair(light.numbers, dark.numbers);
  pair(light.actions, dark.actions);
  pair(light.flips, dark.flips);
  pair(light.wilds, dark.wilds);

  if (cards.length !== DECK_SIZE) {
    throw new Error(`Flip deck invariant violated: built ${cards.length}, expected ${DECK_SIZE}.`);
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
