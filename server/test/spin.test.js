'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { SpinEngine } = require('../src/engine/spin/SpinEngine');
const { buildDeck, makeRng } = require('../src/engine/spin/deck');
const { TYPE } = require('../src/engine/spin/constants');

let _id = 0;
const C = (color, type, value = null) => ({ id: `t${_id++}`, color, type, value });
const num = (c, v) => C(c, TYPE.NUMBER, v);
const spare = () => num('yellow', 0);
const fillers = (n, color = 'red') => Array.from({ length: n }, () => num(color, 1));

function makeEngine(ids) {
  return new SpinEngine({ players: ids.map((id) => ({ id, name: id })), rng: makeRng(1) });
}
function setup(e, { hands, top, activeColor, current = 0, direction = 1, drawPile = [] }) {
  const s = e.state;
  s.status = 'playing';
  s.direction = direction;
  s.current = current;
  s.players.forEach((p, i) => { p.hand = hands[i] || []; });
  s.discardPile = [top];
  s.activeColor = activeColor ?? top.color;
  s.drawPile = drawPile;
  s.pendingPlay = null; s.pendingSpin = false; s.pendingChoice = null; s.race = null; s.spinnerIdx = null;
  return e;
}
const cur = (e) => e.state.players[e.state.current].id;
const hand = (e, id) => e.state.players.find((p) => p.id === id).hand;
// Put the table into "X must spin" and force a specific wheel outcome.
function forceSpin(e, spinnerId, outcomeId) {
  const idx = e.state.players.findIndex((p) => p.id === spinnerId);
  e.state.current = idx;
  e.state.pendingSpin = true;
  e._pickOutcome = () => outcomeId;
  return e.applyIntent(spinnerId, { type: 'SPIN' });
}

// ---- deck -----------------------------------------------------------------

test('spin deck builds to exactly 116 cards', () => {
  const d = buildDeck();
  assert.equal(d.length, 116);
  assert.equal(d.filter((c) => c.type === 'spin').length, 8);
  assert.equal(d.filter((c) => c.type === 'number').length, 76);
  assert.equal(new Set(d.map((c) => c.id)).size, 116);
});

test('start deals 7 and begins on a number', () => {
  const e = makeEngine(['A', 'B', 'C']);
  assert.ok(e.start().ok);
  const v = e.view('A');
  assert.equal(v.topCard.type, 'number');
  assert.equal(v.players.find((p) => p.isYou).hand.length, 7);
  assert.equal(cur(e), 'B');
});

// ---- classic effects (no stacking) ----------------------------------------

test('Draw 2 makes the next player draw 2 and skips them (no stacking)', () => {
  const e = makeEngine(['A', 'B', 'C']);
  const d2 = C('red', TYPE.DRAW2);
  setup(e, { hands: [[d2, spare()], [], []], top: num('red', 5), drawPile: fillers(6) });
  e.applyIntent('A', { type: 'PLAY_CARD', cardId: d2.id });
  assert.equal(hand(e, 'B').length, 2, 'B drew 2');
  assert.equal(cur(e), 'C', 'B is skipped');
});

test('Reverse acts as a Skip with 2 players', () => {
  const e = makeEngine(['A', 'B']);
  const rev = C('red', TYPE.REVERSE);
  setup(e, { hands: [[rev, spare()]], top: num('red', 5) });
  e.applyIntent('A', { type: 'PLAY_CARD', cardId: rev.id });
  assert.equal(cur(e), 'A');
});

// ---- the Spin card forces the next player to spin -------------------------

test('playing a Spin card forces the NEXT player to spin; their turn ends after resolving', () => {
  const e = makeEngine(['A', 'B', 'C']);
  const spin = C('red', TYPE.SPIN);
  setup(e, { hands: [[spin, spare()], [num('blue', 1)], [num('green', 2)]], top: num('red', 5), drawPile: fillers(8) });
  assert.ok(e.applyIntent('A', { type: 'PLAY_CARD', cardId: spin.id }).ok);
  assert.equal(cur(e), 'B', 'next player is up');
  assert.equal(e.view('B').mustSpin, true, 'and must spin');
  // B cannot play/draw — must spin
  assert.equal(e.applyIntent('B', { type: 'DRAW' }).error, 'MUST_SPIN');
  assert.equal(e.applyIntent('B', { type: 'PLAY_CARD', cardId: hand(e, 'B')[0].id }).error, 'MUST_SPIN');
  // force Draw 4 outcome
  const before = hand(e, 'B').length;
  e._pickOutcome = () => 12;
  assert.ok(e.applyIntent('B', { type: 'SPIN' }).ok);
  assert.equal(hand(e, 'B').length, before + 4);
  assert.equal(cur(e), 'C', 'spinner B turn ended → C');
});

// ---- spot-check outcomes --------------------------------------------------

test('outcome: Everyone Draws 1 (custom)', () => {
  const e = makeEngine(['A', 'B', 'C']);
  setup(e, { hands: [[num('red', 1)], [num('blue', 1)], [num('green', 1)]], top: num('red', 5), drawPile: fillers(10) });
  forceSpin(e, 'A', 10);
  assert.equal(hand(e, 'A').length, 2);
  assert.equal(hand(e, 'B').length, 2);
  assert.equal(hand(e, 'C').length, 2);
  assert.equal(cur(e), 'B', 'spinner A turn ended');
});

test('outcome: Draw 4 (custom punishment)', () => {
  const e = makeEngine(['A', 'B']);
  setup(e, { hands: [[num('red', 1)], [num('blue', 1)]], top: num('red', 5), drawPile: fillers(10) });
  forceSpin(e, 'A', 12);
  assert.equal(hand(e, 'A').length, 5);
});

test('outcome: Swap with Leader (custom)', () => {
  const e = makeEngine(['A', 'B', 'C']);
  // A has many, C has fewest → A swaps with C
  setup(e, {
    hands: [[num('red', 1), num('red', 2), num('red', 3)], [num('blue', 1), num('blue', 2)], [num('green', 1)]],
    top: num('red', 5), drawPile: fillers(10),
  });
  forceSpin(e, 'A', 11);
  assert.equal(hand(e, 'A').length, 1, 'A took the leader’s single card');
  assert.equal(hand(e, 'C').length, 3, 'C got A’s big hand');
});

test('outcome: Trade Hands passes hands one seat in the current direction', () => {
  const e = makeEngine(['A', 'B', 'C']);
  setup(e, {
    hands: [[num('red', 1)], [num('blue', 1), num('blue', 2)], [num('green', 1), num('green', 2), num('green', 3)]],
    top: num('red', 5), drawPile: fillers(4),
  });
  forceSpin(e, 'A', 8); // direction 1: A→B, B→C, C→A
  assert.equal(hand(e, 'B').length, 1, 'B received A’s hand');
  assert.equal(hand(e, 'C').length, 2, 'C received B’s hand');
  assert.equal(hand(e, 'A').length, 3, 'A received C’s hand');
});

test('outcome: Draw until Green stops on green (or wild)', () => {
  const e = makeEngine(['A', 'B']);
  // drawPile pops from end: red, red, green → stop on green
  setup(e, { hands: [[num('red', 1)]], top: num('red', 5), drawPile: [num('green', 4), num('red', 7), num('red', 8)] });
  forceSpin(e, 'A', 6); // drawGreen
  const h = hand(e, 'A');
  assert.equal(h.length, 4, 'drew red, red, green');
  assert.equal(h[h.length - 1].color, 'green');
});

test('outcome: Discard a Color clears that color and can win', () => {
  const e = makeEngine(['A', 'B']);
  const r1 = num('red', 1), r2 = num('red', 2);
  setup(e, { hands: [[r1, r2]], top: num('red', 5), drawPile: fillers(4) });
  forceSpin(e, 'A', 3); // discardColor → choice
  assert.equal(e.view('A').choice.type, 'discardColor');
  const r = e.applyIntent('A', { type: 'SPIN_CHOICE', color: 'red', discardIds: [r1.id, r2.id], topCardId: r1.id });
  assert.ok(r.ok);
  assert.equal(e.state.status, 'finished');
  assert.equal(e.state.winner, 'A', 'emptying via discard wins');
});

test('outcome: Almost UNO leaves the spinner with exactly 2 chosen cards', () => {
  const e = makeEngine(['A', 'B']);
  const a = num('red', 1), b = num('blue', 2), c = num('green', 3), d = num('yellow', 4);
  setup(e, { hands: [[a, b, c, d]], top: num('red', 5), drawPile: fillers(4) });
  forceSpin(e, 'A', 1);
  assert.equal(e.view('A').choice.type, 'almostUno');
  assert.ok(e.applyIntent('A', { type: 'SPIN_CHOICE', keepIds: [a.id, b.id], topCardId: c.id }).ok);
  assert.equal(hand(e, 'A').length, 2);
  assert.equal(cur(e), 'B');
});

// ---- the UNO Spin race ----------------------------------------------------

test('UNO Spin race resolves to the FIRST tapper, who discards one card', () => {
  const e = makeEngine(['A', 'B', 'C']);
  const bCard = num('blue', 7);
  setup(e, { hands: [[num('red', 1)], [bCard, num('blue', 8)], [num('green', 1)]], top: num('red', 5), drawPile: fillers(4) });
  forceSpin(e, 'A', 9); // unoSpinRace
  assert.equal(e.view('A').race.active, true, 'race window open to all');
  // B taps first; C is too late
  assert.ok(e.applyIntent('B', { type: 'RACE_TAP' }).ok);
  assert.equal(e.applyIntent('C', { type: 'RACE_TAP' }).error, 'RACE_OVER');
  assert.equal(e.view('B').choice.type, 'raceDiscard', 'winner B chooses a card to dump');
  e.applyIntent('B', { type: 'SPIN_CHOICE', cardId: bCard.id });
  assert.equal(hand(e, 'B').length, 1, 'B dumped one card');
  assert.equal(cur(e), 'B', 'spinner A’s turn ended → next is B');
});

test('race timeout hands the free discard to the spinner', () => {
  const e = makeEngine(['A', 'B']);
  setup(e, { hands: [[num('red', 1), num('red', 2)], [num('blue', 1)]], top: num('red', 5), drawPile: fillers(4) });
  forceSpin(e, 'A', 9);
  assert.ok(e.applyIntent('A', { type: 'RACE_TIMEOUT' }).ok);
  assert.equal(e.view('A').choice.type, 'raceDiscard', 'spinner gets the discard by default');
});

// ---- shared draw / pass + win ---------------------------------------------

test('draw one playable → may PASS (keep it, end turn)', () => {
  const e = makeEngine(['A', 'B']);
  setup(e, { hands: [[num('green', 9)]], top: num('red', 5), drawPile: [num('red', 3)] });
  assert.ok(e.applyIntent('A', { type: 'DRAW' }).ok);
  assert.equal(e.view('A').canPass, true);
  assert.ok(e.applyIntent('A', { type: 'PASS' }).ok);
  assert.equal(hand(e, 'A').length, 2);
  assert.equal(cur(e), 'B');
});

test('win by emptying your hand', () => {
  const e = makeEngine(['A', 'B']);
  const last = num('red', 9);
  setup(e, { hands: [[last]], top: num('red', 5) });
  assert.ok(e.applyIntent('A', { type: 'PLAY_CARD', cardId: last.id }).ok);
  assert.equal(e.state.status, 'finished');
  assert.equal(e.state.winner, 'A');
});
