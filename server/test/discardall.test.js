'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { NoMercyEngine } = require('../src/engine/noMercy/NoMercyEngine');
const { makeRng } = require('../src/engine/noMercy/deck');
const { TYPE } = require('../src/engine/noMercy/constants');
const { validateIntent } = require('../src/rooms');

let _id = 0;
const C = (color, type, value = null) => ({ id: `d${_id++}`, color, type, value });
const num = (color, v) => C(color, TYPE.NUMBER, v);
const discardAll = (color) => C(color, TYPE.DISCARD_ALL);
const spare = () => num('yellow', 0);

function makeEngine(ids) {
  return new NoMercyEngine({ players: ids.map((id) => ({ id, name: id })), rng: makeRng(11) });
}
function setup(e, { hands, top, activeColor, current = 0, direction = 1, drawPile = [], config }) {
  const s = e.state;
  s.status = 'playing';
  s.direction = direction;
  s.current = current;
  s.players.forEach((p, i) => { p.hand = hands[i] || []; p.eliminated = false; });
  s.discardPile = [top];
  s.activeColor = activeColor ?? (top ? top.color : null);
  s.drawPile = drawPile;
  s.drawStack = null;
  s.pendingPlay = null;
  s.pendingRoulette = null;
  s.pendingDiscardAll = null;
  if (config) s.config = { ...s.config, ...config };
  return e;
}
const cur = (e) => e.state.players[e.state.current].id;
const hand = (e, id) => e.state.players.find((p) => p.id === id).hand;
const snap = (e) => JSON.stringify({ hands: e.state.players.map((p) => p.hand.map((c) => c.id)), cur: e.state.current, color: e.state.activeColor, top: e.state.discardPile.map((c) => c.id) });

test('playing Discard All sets pending (colour set, turn not advanced)', () => {
  const e = makeEngine(['A', 'B', 'C']);
  const da = discardAll('blue');
  setup(e, { hands: [[da, num('blue', 1), num('red', 2)], [spare()], [spare()]], top: num('blue', 5), activeColor: 'blue' });
  const r = e.applyIntent('A', { type: 'PLAY_CARD', cardId: da.id });
  assert.ok(r.ok, r.error);
  assert.ok(e.state.pendingDiscardAll, 'pending set');
  assert.equal(e.state.activeColor, 'blue');
  assert.equal(cur(e), 'A', 'turn not advanced — A still chooses');
  assert.deepEqual(e.view('A').mustChooseDiscardAll, { color: 'blue' });
});

test('Discard All: shed a SUBSET — only chosen leave (under the card), turn advances', () => {
  const e = makeEngine(['A', 'B', 'C']);
  const da = discardAll('blue');
  const b1 = num('blue', 1); const b2 = num('blue', 2); const r2 = num('red', 2);
  setup(e, { hands: [[da, b1, b2, r2], [spare()], [spare()]], top: num('blue', 5), activeColor: 'blue' });
  e.applyIntent('A', { type: 'PLAY_CARD', cardId: da.id });
  const res = e.applyIntent('A', { type: 'DISCARD_ALL_CHOOSE', cardIds: [b1.id] });
  assert.ok(res.ok, res.error);
  const h = hand(e, 'A').map((c) => c.id);
  assert.ok(!h.includes(b1.id), 'b1 shed');
  assert.ok(h.includes(b2.id) && h.includes(r2.id), 'b2 and red kept');
  assert.equal(e.state.pendingDiscardAll, null);
  assert.equal(e.state.activeColor, 'blue');
  assert.equal(cur(e), 'B', 'turn advances');
  // shed card sits UNDER the Discard All (which is top)
  assert.equal(e.state.discardPile[e.state.discardPile.length - 1].id, da.id, 'Discard All on top');
  assert.equal(e.state.discardPile[e.state.discardPile.length - 2].id, b1.id, 'shed card underneath');
});

test('Discard All: shedding everything empties the hand → win', () => {
  const e = makeEngine(['A', 'B', 'C']);
  const da = discardAll('blue');
  const b1 = num('blue', 1); const b2 = num('blue', 2);
  setup(e, { hands: [[da, b1, b2], [spare()], [spare()]], top: num('blue', 5), activeColor: 'blue' });
  e.applyIntent('A', { type: 'PLAY_CARD', cardId: da.id });
  const res = e.applyIntent('A', { type: 'DISCARD_ALL_CHOOSE', cardIds: [b1.id, b2.id] });
  assert.ok(res.ok, res.error);
  assert.equal(e.state.status, 'finished');
  assert.equal(e.state.winner, 'A');
});

test('Discard All: choosing NONE (empty) is valid; nothing shed; turn advances', () => {
  const e = makeEngine(['A', 'B', 'C']);
  const da = discardAll('blue');
  const b1 = num('blue', 1);
  setup(e, { hands: [[da, b1], [spare()], [spare()]], top: num('blue', 5), activeColor: 'blue' });
  e.applyIntent('A', { type: 'PLAY_CARD', cardId: da.id });
  const before = hand(e, 'A').length;
  const res = e.applyIntent('A', { type: 'DISCARD_ALL_CHOOSE', cardIds: [] });
  assert.ok(res.ok, res.error);
  assert.equal(hand(e, 'A').length, before, 'nothing shed');
  assert.equal(e.state.pendingDiscardAll, null);
  assert.equal(cur(e), 'B');
});

test('Discard All: shed power card fires NO effect (no draw stack)', () => {
  const e = makeEngine(['A', 'B', 'C']);
  const da = discardAll('blue');
  const bDraw2 = C('blue', TYPE.DRAW2);
  setup(e, { hands: [[da, bDraw2, num('red', 1)], [spare()], [spare()]], top: num('blue', 5), activeColor: 'blue' });
  e.applyIntent('A', { type: 'PLAY_CARD', cardId: da.id });
  const res = e.applyIntent('A', { type: 'DISCARD_ALL_CHOOSE', cardIds: [bDraw2.id] });
  assert.ok(res.ok, res.error);
  assert.equal(e.state.drawStack, null, 'shed Draw2 did not start a stack');
  assert.equal(cur(e), 'B');
});

test('Discard All: reject not-in-hand / wrong-color / wild atomically', () => {
  const e = makeEngine(['A', 'B', 'C']);
  const da = discardAll('blue');
  const b1 = num('blue', 1); const r2 = num('red', 2); const w = C(null, TYPE.WILD);
  setup(e, { hands: [[da, b1, r2, w], [spare()], [spare()]], top: num('blue', 5), activeColor: 'blue' });
  e.applyIntent('A', { type: 'PLAY_CARD', cardId: da.id });
  const before = snap(e);
  assert.equal(e.applyIntent('A', { type: 'DISCARD_ALL_CHOOSE', cardIds: ['nope'] }).error, 'CARD_NOT_IN_HAND');
  assert.equal(e.applyIntent('A', { type: 'DISCARD_ALL_CHOOSE', cardIds: [r2.id] }).error, 'WRONG_DISCARD_COLOR');
  assert.equal(e.applyIntent('A', { type: 'DISCARD_ALL_CHOOSE', cardIds: [w.id] }).error, 'WILD_IN_DISCARD_ALL');
  assert.equal(snap(e), before, 'state unchanged after each rejection');
  assert.ok(e.state.pendingDiscardAll, 'still pending');
});

test('Discard All: pending blocks other intents; non-pending player cannot choose', () => {
  const e = makeEngine(['A', 'B', 'C']);
  const da = discardAll('blue');
  const b1 = num('blue', 1);
  setup(e, { hands: [[da, b1, num('blue', 7)], [num('blue', 9)], [spare()]], top: num('blue', 5), activeColor: 'blue' });
  e.applyIntent('A', { type: 'PLAY_CARD', cardId: da.id });
  assert.equal(e.applyIntent('A', { type: 'DRAW' }).error, 'DISCARD_ALL_IN_PROGRESS');
  assert.equal(e.applyIntent('A', { type: 'PLAY_CARD', cardId: b1.id }).error, 'DISCARD_ALL_IN_PROGRESS');
  assert.equal(e.applyIntent('A', { type: 'PASS' }).error, 'DISCARD_ALL_IN_PROGRESS');
  assert.equal(e.applyIntent('A', { type: 'SAY_UNO' }).error, 'DISCARD_ALL_IN_PROGRESS');
  // non-pending player B is not current → rejected
  assert.equal(e.applyIntent('B', { type: 'DISCARD_ALL_CHOOSE', cardIds: [] }).error, 'NOT_YOUR_TURN');
});

test('validateIntent accepts DISCARD_ALL_CHOOSE (incl. empty) and rejects malformed', () => {
  assert.equal(validateIntent({ type: 'DISCARD_ALL_CHOOSE', cardIds: [] }), true);
  assert.equal(validateIntent({ type: 'DISCARD_ALL_CHOOSE', cardIds: ['a', 'b'] }), true);
  assert.equal(validateIntent({ type: 'DISCARD_ALL_CHOOSE' }), false, 'missing cardIds');
  assert.equal(validateIntent({ type: 'DISCARD_ALL_CHOOSE', cardIds: 'x' }), false, 'not array');
  assert.equal(validateIntent({ type: 'DISCARD_ALL_CHOOSE', cardIds: [1] }), false, 'non-string id');
  assert.equal(validateIntent({ type: 'DISCARD_ALL_CHOOSE', cardIds: Array.from({ length: 31 }, (_, i) => `c${i}`) }), false, 'too large');
});
