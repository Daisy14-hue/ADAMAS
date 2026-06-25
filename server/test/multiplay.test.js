'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { NoMercyEngine } = require('../src/engine/noMercy/NoMercyEngine');
const { makeRng: nmRng } = require('../src/engine/noMercy/deck');
const { TYPE: NM } = require('../src/engine/noMercy/constants');

const { FlipEngine } = require('../src/engine/flip/FlipEngine');
const { makeRng: flipRng } = require('../src/engine/flip/deck');
const { TYPE: FT } = require('../src/engine/flip/constants');

const { validateIntent } = require('../src/rooms');

// ===== No Mercy fixtures =====================================================
let _id = 0;
const C = (color, type, value = null) => ({ id: `m${_id++}`, color, type, value });
const num = (color, v) => C(color, NM.NUMBER, v);
const spare = () => num('yellow', 0);

function nmEngine(ids) {
  return new NoMercyEngine({ players: ids.map((id) => ({ id, name: id })), rng: nmRng(42) });
}
function nmSetup(e, { hands, top, activeColor, current = 0, direction = 1, drawPile = [], drawStack = null }) {
  const s = e.state;
  s.status = 'playing';
  s.direction = direction;
  s.current = current;
  s.players.forEach((p, i) => { p.hand = hands[i] || []; p.eliminated = false; });
  s.discardPile = [top];
  s.activeColor = activeColor ?? (top ? top.color : null);
  s.drawPile = drawPile;
  s.drawStack = drawStack;
  s.pendingPlay = null;
  return e;
}
const cur = (e) => e.state.players[e.state.current].id;
const hand = (e, id) => e.state.players.find((p) => p.id === id).hand;

// ===== No Mercy: valid sets =================================================

test('NM: same-number set plays all; last colour becomes active; hand shrinks', () => {
  const e = nmEngine(['A', 'B', 'C']);
  const a = [num('red', 7), num('green', 7), num('blue', 7), spare()];
  nmSetup(e, { hands: [a, [spare()], [spare()]], top: num('red', 3) });
  const r = e.applyIntent('A', { type: 'PLAY_CARDS', cardIds: [a[0].id, a[1].id, a[2].id] });
  assert.ok(r.ok, r.error);
  assert.equal(hand(e, 'A').length, 1, 'three cards left the hand');
  assert.equal(e.state.activeColor, 'blue', 'last card sets the colour');
  assert.equal(e.state.discardPile[e.state.discardPile.length - 1].color, 'blue');
  assert.equal(cur(e), 'B', 'a number set just advances one seat');
});

test('NM: Skip x2 skips two players', () => {
  const e = nmEngine(['A', 'B', 'C', 'D']);
  const s1 = C('red', NM.SKIP), s2 = C('green', NM.SKIP);
  nmSetup(e, { hands: [[s1, s2, spare()], [spare()], [spare()], [spare()]], top: C('red', NM.SKIP) });
  const r = e.applyIntent('A', { type: 'PLAY_CARDS', cardIds: [s1.id, s2.id] });
  assert.ok(r.ok, r.error);
  assert.equal(cur(e), 'D', 'B and C are both skipped');
});

test('NM: Draw2 x2 adds +4 to the stack', () => {
  const e = nmEngine(['A', 'B', 'C']);
  const d1 = C('red', NM.DRAW2, 2), d2 = C('green', NM.DRAW2, 2);
  nmSetup(e, { hands: [[d1, d2, spare()], [spare()], [spare()]], top: C('red', NM.DRAW2, 2) });
  const r = e.applyIntent('A', { type: 'PLAY_CARDS', cardIds: [d1.id, d2.id] });
  assert.ok(r.ok, r.error);
  assert.ok(e.state.drawStack, 'a draw stack is active');
  assert.equal(e.state.drawStack.total, 4, 'two Draw2s = +4');
  assert.equal(cur(e), 'B', 'next player must respond to the stack');
});

test('NM: Draw2 set stacks onto an existing draw stack (+4 over +2)', () => {
  const e = nmEngine(['A', 'B', 'C']);
  const d1 = C('red', NM.DRAW2, 2), d2 = C('green', NM.DRAW2, 2);
  nmSetup(e, {
    hands: [[d1, d2, spare()], [spare()], [spare()]],
    top: C('blue', NM.DRAW2, 2), activeColor: 'blue',
    drawStack: { total: 2, lastValue: 2, lastWasColoredDraw: true, chainActive: false },
  });
  const r = e.applyIntent('A', { type: 'PLAY_CARDS', cardIds: [d1.id, d2.id] });
  assert.ok(r.ok, r.error);
  assert.equal(e.state.drawStack.total, 6, '2 existing + 4 from the set');
});

test('NM: Reverse x2 nets the same direction (3+ players)', () => {
  const e = nmEngine(['A', 'B', 'C']);
  const r1 = C('red', NM.REVERSE), r2 = C('green', NM.REVERSE);
  nmSetup(e, { hands: [[r1, r2, spare()], [spare()], [spare()]], top: C('red', NM.REVERSE), direction: 1 });
  const r = e.applyIntent('A', { type: 'PLAY_CARDS', cardIds: [r1.id, r2.id] });
  assert.ok(r.ok, r.error);
  assert.equal(e.state.direction, 1, 'two reverses cancel out');
  assert.equal(cur(e), 'B', 'advances forward one seat');
});

test('NM: Reverse x1 (odd) flips direction', () => {
  const e = nmEngine(['A', 'B', 'C']);
  const r1 = C('red', NM.REVERSE), r2 = C('green', NM.REVERSE), r3 = C('blue', NM.REVERSE);
  nmSetup(e, { hands: [[r1, r2, r3, spare()], [spare()], [spare()]], top: C('red', NM.REVERSE), direction: 1 });
  const r = e.applyIntent('A', { type: 'PLAY_CARDS', cardIds: [r1.id, r2.id, r3.id] });
  assert.ok(r.ok, r.error);
  assert.equal(e.state.direction, -1, 'three reverses = reversed');
  assert.equal(cur(e), 'C', 'goes the other way');
});

// ===== No Mercy: rejections (atomic — state unchanged) ======================

function nmSnapshot(e) {
  return JSON.stringify({ hands: e.state.players.map((p) => p.hand.map((c) => c.id)), cur: e.state.current, dir: e.state.direction, color: e.state.activeColor, stack: e.state.drawStack });
}

test('NM: first card illegal vs discard → rejected, state unchanged', () => {
  const e = nmEngine(['A', 'B']);
  const a = [num('green', 5), num('blue', 5), spare()];
  nmSetup(e, { hands: [a, [spare()]], top: num('red', 9), activeColor: 'red' });
  const before = nmSnapshot(e);
  const r = e.applyIntent('A', { type: 'PLAY_CARDS', cardIds: [a[0].id, a[1].id] });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'ILLEGAL_MOVE');
  assert.equal(nmSnapshot(e), before);
});

test('NM: mixed faces rejected, state unchanged', () => {
  const e = nmEngine(['A', 'B']);
  const a = [num('red', 7), num('red', 8), spare()];
  nmSetup(e, { hands: [a, [spare()]], top: num('red', 3) });
  const before = nmSnapshot(e);
  const r = e.applyIntent('A', { type: 'PLAY_CARDS', cardIds: [a[0].id, a[1].id] });
  assert.equal(r.error, 'MIXED_FACES');
  assert.equal(nmSnapshot(e), before);
});

test('NM: wild included rejected, state unchanged', () => {
  const e = nmEngine(['A', 'B']);
  const a = [num('red', 7), C(null, NM.WILD), spare()];
  nmSetup(e, { hands: [a, [spare()]], top: num('red', 3) });
  const before = nmSnapshot(e);
  const r = e.applyIntent('A', { type: 'PLAY_CARDS', cardIds: [a[0].id, a[1].id] });
  assert.equal(r.error, 'WILD_IN_SET');
  assert.equal(nmSnapshot(e), before);
});

test('NM: card not in hand rejected; empty set rejected; state unchanged', () => {
  const e = nmEngine(['A', 'B']);
  const a = [num('red', 7), num('green', 7), spare()];
  nmSetup(e, { hands: [a, [spare()]], top: num('red', 3) });
  const before = nmSnapshot(e);
  assert.equal(e.applyIntent('A', { type: 'PLAY_CARDS', cardIds: [a[0].id, 'nope'] }).error, 'CARD_NOT_IN_HAND');
  assert.equal(e.applyIntent('A', { type: 'PLAY_CARDS', cardIds: [] }).error, 'EMPTY_SET');
  assert.equal(nmSnapshot(e), before);
});

test('NM: single-element PLAY_CARDS == a normal single play', () => {
  const e = nmEngine(['A', 'B', 'C']);
  const a = [num('red', 7), spare()];
  nmSetup(e, { hands: [a, [spare()], [spare()]], top: num('red', 3) });
  const r = e.applyIntent('A', { type: 'PLAY_CARDS', cardIds: [a[0].id] });
  assert.ok(r.ok, r.error);
  assert.equal(hand(e, 'A').length, 1);
  assert.equal(e.state.activeColor, 'red');
  assert.equal(cur(e), 'B');
});

// ===== Flip ================================================================
const F = (light, dark) => ({ id: `f${_id++}`, light, dark });
const face = (color, type, value = null) => ({ color, type, value });
const fspare = () => F(face('blue', FT.NUMBER, 0), face('teal', FT.NUMBER, 0));

function flipEngine(ids) {
  return new FlipEngine({ players: ids.map((id) => ({ id, name: id })), rng: flipRng(1) });
}
function flipSetup(e, { side = 'light', hands, top, activeColor, current = 0, direction = 1, drawPile = [], drawStack = null }) {
  const s = e.state;
  s.status = 'playing';
  s.side = side;
  s.direction = direction;
  s.current = current;
  s.players.forEach((p, i) => { p.hand = hands[i] || []; });
  s.discardPile = [top];
  s.activeColor = activeColor ?? e._activeFace(top).color;
  s.drawPile = drawPile;
  s.drawStack = drawStack;
  s.pendingPlay = null;
  return e;
}

test('Flip: same-number set (active side) plays all; last colour active', () => {
  const e = flipEngine(['A', 'B', 'C']);
  const a = [
    F(face('red', FT.NUMBER, 7), face('teal', FT.NUMBER, 1)),
    F(face('green', FT.NUMBER, 7), face('pink', FT.NUMBER, 2)),
    fspare(),
  ];
  flipSetup(e, { side: 'light', hands: [a, [fspare()], [fspare()]], top: F(face('red', FT.NUMBER, 3), face('teal', FT.NUMBER, 4)) });
  const r = e.applyIntent('A', { type: 'PLAY_CARDS', cardIds: [a[0].id, a[1].id] });
  assert.ok(r.ok, r.error);
  assert.equal(hand(e, 'A').length, 1);
  assert.equal(e.state.activeColor, 'green');
  assert.equal(cur(e), 'B');
});

test('Flip: Skip x2 skips two players', () => {
  const e = flipEngine(['A', 'B', 'C', 'D']);
  const s1 = F(face('red', FT.SKIP), face('teal', FT.NUMBER, 0));
  const s2 = F(face('green', FT.SKIP), face('pink', FT.NUMBER, 0));
  flipSetup(e, { side: 'light', hands: [[s1, s2, fspare()], [fspare()], [fspare()], [fspare()]], top: F(face('red', FT.SKIP), face('teal', FT.NUMBER, 1)) });
  const r = e.applyIntent('A', { type: 'PLAY_CARDS', cardIds: [s1.id, s2.id] });
  assert.ok(r.ok, r.error);
  assert.equal(cur(e), 'D');
});

test('Flip: DrawOne x2 = +2 to the stack (light side)', () => {
  const e = flipEngine(['A', 'B', 'C']);
  const d1 = F(face('red', FT.DRAW_ONE, 1), face('teal', FT.NUMBER, 0));
  const d2 = F(face('green', FT.DRAW_ONE, 1), face('pink', FT.NUMBER, 0));
  flipSetup(e, { side: 'light', hands: [[d1, d2, fspare()], [fspare()], [fspare()]], top: F(face('red', FT.DRAW_ONE, 1), face('teal', FT.NUMBER, 2)) });
  const r = e.applyIntent('A', { type: 'PLAY_CARDS', cardIds: [d1.id, d2.id] });
  assert.ok(r.ok, r.error);
  assert.equal(e.state.drawStack.total, 2, 'two DrawOnes = +2');
  assert.equal(cur(e), 'B');
});

test('Flip: Reverse x2 in a 2-player game = play again (net direction same)', () => {
  const e = flipEngine(['A', 'B']);
  const r1 = F(face('red', FT.REVERSE), face('teal', FT.NUMBER, 0));
  const r2 = F(face('green', FT.REVERSE), face('pink', FT.NUMBER, 0));
  flipSetup(e, { side: 'light', hands: [[r1, r2, fspare()], [fspare()]], top: F(face('red', FT.REVERSE), face('teal', FT.NUMBER, 1)), direction: 1 });
  const r = e.applyIntent('A', { type: 'PLAY_CARDS', cardIds: [r1.id, r2.id] });
  assert.ok(r.ok, r.error);
  assert.equal(e.state.direction, 1, 'even reverses net same direction');
  assert.equal(cur(e), 'A', '2-player reverse acts as skip → A plays again');
});

test('Flip: first card illegal → rejected, state unchanged; mixed/wild rejected', () => {
  const e = flipEngine(['A', 'B']);
  const a = [
    F(face('green', FT.NUMBER, 5), face('teal', FT.NUMBER, 0)),
    F(face('blue', FT.NUMBER, 5), face('pink', FT.NUMBER, 0)),
    fspare(),
  ];
  flipSetup(e, { side: 'light', hands: [a, [fspare()]], top: F(face('red', FT.NUMBER, 9), face('teal', FT.NUMBER, 1)), activeColor: 'red' });
  const before = JSON.stringify(e.state.players.map((p) => p.hand.map((c) => c.id)));
  const r = e.applyIntent('A', { type: 'PLAY_CARDS', cardIds: [a[0].id, a[1].id] });
  assert.equal(r.error, 'ILLEGAL_MOVE');
  assert.equal(JSON.stringify(e.state.players.map((p) => p.hand.map((c) => c.id))), before);

  const w = [F(face('red', FT.NUMBER, 7), face('teal', FT.NUMBER, 0)), F(face(null, FT.WILD), face(null, FT.WILD)), fspare()];
  flipSetup(e, { side: 'light', hands: [w, [fspare()]], top: F(face('red', FT.NUMBER, 3), face('teal', FT.NUMBER, 1)) });
  assert.equal(e.applyIntent('A', { type: 'PLAY_CARDS', cardIds: [w[0].id, w[1].id] }).error, 'WILD_IN_SET');
});

test('Flip: single-element PLAY_CARDS == normal single play', () => {
  const e = flipEngine(['A', 'B', 'C']);
  const a = [F(face('red', FT.NUMBER, 7), face('teal', FT.NUMBER, 0)), fspare()];
  flipSetup(e, { side: 'light', hands: [a, [fspare()], [fspare()]], top: F(face('red', FT.NUMBER, 3), face('teal', FT.NUMBER, 1)) });
  const r = e.applyIntent('A', { type: 'PLAY_CARDS', cardIds: [a[0].id] });
  assert.ok(r.ok, r.error);
  assert.equal(hand(e, 'A').length, 1);
  assert.equal(cur(e), 'B');
});

// ===== validateIntent =======================================================

test('validateIntent accepts well-formed PLAY_CARDS and rejects malformed', () => {
  assert.equal(validateIntent({ type: 'PLAY_CARDS', cardIds: ['a', 'b'] }), true);
  assert.equal(validateIntent({ type: 'PLAY_CARDS', cardIds: ['a'], chosenColor: 'red' }), true);
  assert.equal(validateIntent({ type: 'PLAY_CARDS', cardIds: [] }), false, 'empty');
  assert.equal(validateIntent({ type: 'PLAY_CARDS', cardIds: 'a' }), false, 'not an array');
  assert.equal(validateIntent({ type: 'PLAY_CARDS', cardIds: [1, 2] }), false, 'non-string ids');
  assert.equal(validateIntent({ type: 'PLAY_CARDS', cardIds: ['a'], chosenColor: 'mauve' }), false, 'bad colour');
  assert.equal(validateIntent({ type: 'PLAY_CARDS', cardIds: Array.from({ length: 15 }, (_, i) => `c${i}`) }), false, 'too large');
  // existing PLAY_CARD still validates
  assert.equal(validateIntent({ type: 'PLAY_CARD', cardId: 'x' }), true);
});
