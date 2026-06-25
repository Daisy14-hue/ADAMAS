'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { NoMercyEngine } = require('../src/engine/noMercy/NoMercyEngine');
const { makeRng } = require('../src/engine/noMercy/deck');
const { TYPE } = require('../src/engine/noMercy/constants');

let _id = 0;
const C = (color, type, value = null) => ({ id: `r${_id++}`, color, type, value });
const num = (color, v) => C(color, TYPE.NUMBER, v);
const roulette = () => C(null, TYPE.WILD_ROULETTE);
const spare = () => num('yellow', 0);

function makeEngine(ids) {
  return new NoMercyEngine({ players: ids.map((id) => ({ id, name: id })), rng: makeRng(7) });
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
  if (config) s.config = { ...s.config, ...config };
  return e;
}
const cur = (e) => e.state.players[e.state.current].id;
const hand = (e, id) => e.state.players.find((p) => p.id === id).hand;

test('roulette: victim draws non-matching then matching, keeps all, then is skipped', () => {
  const e = makeEngine(['A', 'B', 'C']);
  const rc = roulette();
  // drawPile pops from the end → B will draw green, blue, red in that order.
  const drawPile = [num('red', 5), num('blue', 5), num('green', 5)];
  setup(e, { hands: [[rc, spare()], [spare()], [spare()]], top: num('red', 3), drawPile });
  // A plays the roulette, calling red.
  assert.ok(e.applyIntent('A', { type: 'PLAY_CARD', cardId: rc.id, rouletteColor: 'red' }).ok);
  assert.equal(cur(e), 'B', 'victim B is up to draw');
  assert.ok(e.state.pendingRoulette, 'roulette pending');
  assert.deepEqual(e.view('B').mustDrawRoulette, { color: 'red' });
  const before = hand(e, 'B').length;

  assert.ok(e.applyIntent('B', { type: 'DRAW' }).ok); // green — keep, pending
  assert.ok(e.state.pendingRoulette);
  assert.ok(e.applyIntent('B', { type: 'DRAW' }).ok); // blue — keep, pending
  assert.ok(e.state.pendingRoulette);
  assert.ok(e.applyIntent('B', { type: 'DRAW' }).ok); // red — match → resolve

  assert.equal(e.state.pendingRoulette, null, 'roulette resolved');
  assert.equal(hand(e, 'B').length, before + 3, 'victim kept all 3 drawn cards');
  assert.equal(e.state.activeColor, 'red', 'active colour is the called colour');
  assert.equal(cur(e), 'C', 'victim B is skipped, turn goes to C');
});

test('roulette: matching colour on the FIRST press resolves immediately', () => {
  const e = makeEngine(['A', 'B', 'C']);
  const rc = roulette();
  setup(e, { hands: [[rc, spare()], [spare()], [spare()]], top: num('blue', 3), drawPile: [num('green', 7)] });
  e.applyIntent('A', { type: 'PLAY_CARD', cardId: rc.id, rouletteColor: 'green' });
  assert.equal(cur(e), 'B');
  assert.ok(e.applyIntent('B', { type: 'DRAW' }).ok);
  assert.equal(e.state.pendingRoulette, null);
  assert.equal(hand(e, 'B').length, 2, 'one card kept on top of the spare');
  assert.equal(cur(e), 'C');
});

test('roulette: victim non-DRAW intents rejected; non-victim DRAW rejected', () => {
  const e = makeEngine(['A', 'B', 'C']);
  const rc = roulette();
  setup(e, { hands: [[rc, spare()], [num('red', 9), spare()], [spare()]], top: num('red', 3), drawPile: [num('red', 1), num('green', 1)] });
  e.applyIntent('A', { type: 'PLAY_CARD', cardId: rc.id, rouletteColor: 'red' });
  // victim B cannot play / pass / say-uno while pending
  assert.equal(e.applyIntent('B', { type: 'PLAY_CARD', cardId: hand(e, 'B')[0].id }).error, 'ROULETTE_IN_PROGRESS');
  assert.equal(e.applyIntent('B', { type: 'PLAY_CARDS', cardIds: [hand(e, 'B')[0].id] }).error, 'ROULETTE_IN_PROGRESS');
  assert.equal(e.applyIntent('B', { type: 'PASS' }).error, 'ROULETTE_IN_PROGRESS');
  assert.equal(e.applyIntent('B', { type: 'SAY_UNO' }).error, 'ROULETTE_IN_PROGRESS');
  // non-victim cannot draw (not their turn)
  assert.equal(e.applyIntent('C', { type: 'DRAW' }).error, 'NOT_YOUR_TURN');
  assert.equal(e.applyIntent('A', { type: 'DRAW' }).error, 'NOT_YOUR_TURN');
});

test('roulette: empty draw pile resolves safely (no infinite loop)', () => {
  const e = makeEngine(['A', 'B', 'C']);
  const rc = roulette();
  // empty draw pile; only the single discard card exists → nothing to recycle.
  setup(e, { hands: [[rc, spare()], [spare()], [spare()]], top: num('red', 3), drawPile: [] });
  e.applyIntent('A', { type: 'PLAY_CARD', cardId: rc.id, rouletteColor: 'red' });
  const r = e.applyIntent('B', { type: 'DRAW' });
  assert.ok(r.ok);
  assert.equal(e.state.pendingRoulette, null, 'resolved despite empty pile');
  assert.equal(cur(e), 'C', 'turn still advances past the victim');
});
