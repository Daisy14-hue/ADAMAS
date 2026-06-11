'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { FlipEngine } = require('../src/engine/flip/FlipEngine');
const { buildDeck } = require('../src/engine/flip/deck');
const { makeRng } = require('../src/engine/flip/deck');
const { TYPE } = require('../src/engine/flip/constants');

// ---- fixtures: physical double-sided cards --------------------------------
let _id = 0;
const F = (light, dark) => ({ id: `x${_id++}`, light, dark });
const face = (color, type, value = null) => ({ color, type, value });
const spare = () => F(face('blue', TYPE.NUMBER, 0), face('teal', TYPE.NUMBER, 0));

function makeEngine(ids) {
  return new FlipEngine({ players: ids.map((id) => ({ id, name: id })), rng: makeRng(1) });
}
function setup(e, { side = 'light', hands, top, activeColor, current = 0, direction = 1, drawPile = [] }) {
  const s = e.state;
  s.status = 'playing';
  s.side = side;
  s.direction = direction;
  s.current = current;
  s.players.forEach((p, i) => { p.hand = hands[i] || []; });
  s.discardPile = [top];
  s.activeColor = activeColor ?? e._activeFace(top).color;
  s.drawPile = drawPile;
  s.drawStack = null;
  s.pendingPlay = null;
  return e;
}
const cur = (e) => e.state.players[e.state.current].id;
const hand = (e, id) => e.state.players.find((p) => p.id === id).hand;

// ---- deck -----------------------------------------------------------------

test('flip deck builds to exactly 112 double-sided cards', () => {
  const deck = buildDeck();
  assert.equal(deck.length, 112);
  assert.ok(deck.every((c) => c.light && c.dark && c.id), 'each card has light+dark faces and an id');
  assert.equal(new Set(deck.map((c) => c.id)).size, 112, 'unique ids');
});

test('start deals 7, begins on the light side, first card is a light number', () => {
  const e = makeEngine(['A', 'B', 'C']);
  assert.ok(e.start().ok);
  const v = e.view('A');
  assert.equal(v.side, 'light');
  assert.equal(v.topCard.type, 'number');
  assert.equal(v.players.find((p) => p.isYou).hand.length, 7);
  assert.equal(cur(e), 'B');
});

// ---- the Flip card --------------------------------------------------------

test('a Flip card switches the side for ALL players and the piles', () => {
  const e = makeEngine(['A', 'B', 'C']);
  const flip = F(face('red', TYPE.FLIP), face('pink', TYPE.FLIP));
  const known = F(face('red', TYPE.NUMBER, 5), face('teal', TYPE.NUMBER, 8));
  setup(e, {
    side: 'light',
    hands: [[flip, spare()], [known], [spare()]],
    top: F(face('red', TYPE.NUMBER, 3), face('pink', TYPE.NUMBER, 3)),
  });
  const r = e.applyIntent('A', { type: 'PLAY_CARD', cardId: flip.id });
  assert.ok(r.ok);
  assert.equal(e.state.side, 'dark', 'global side flipped to dark');
  assert.equal(e.state.activeColor, 'pink', 'active colour from the flip card’s new face');
  const bView = e.view('B');
  assert.equal(bView.side, 'dark');
  // B's hand now exposes the DARK face of its card
  assert.deepEqual(bView.players.find((p) => p.isYou).hand[0], { id: known.id, color: 'teal', type: 'number', value: 8 });
  assert.equal(cur(e), 'B');
});

// ---- stacking (single-side ascending) -------------------------------------

test('draw cards stack ascending on a single side; descending is rejected', () => {
  const e = makeEngine(['A', 'B', 'C']);
  const aD1 = F(face('red', TYPE.DRAW_ONE, 1), face('pink', TYPE.NUMBER, 1));
  const bW2 = F(face(null, TYPE.WILD_DRAW_TWO, 2), face(null, TYPE.WILD_DRAW_COLOR, 5));
  const cD1 = F(face('green', TYPE.DRAW_ONE, 1), face('teal', TYPE.NUMBER, 1));
  setup(e, {
    side: 'light',
    hands: [[aD1, spare()], [bW2, spare()], [cD1, spare()]],
    top: F(face('red', TYPE.NUMBER, 3), face('pink', TYPE.NUMBER, 3)),
    drawPile: Array.from({ length: 10 }, spare),
  });
  assert.ok(e.applyIntent('A', { type: 'PLAY_CARD', cardId: aD1.id }).ok); // stack 1 → B
  assert.equal(e.state.drawStack.total, 1);
  assert.ok(e.applyIntent('B', { type: 'PLAY_CARD', cardId: bW2.id, chosenColor: 'red' }).ok); // +2 = 3 → C
  assert.equal(e.state.drawStack.total, 3);
  const r = e.applyIntent('C', { type: 'PLAY_CARD', cardId: cD1.id }); // 1 < 2 → reject
  assert.equal(r.error, 'NON_ASCENDING_DRAW');
  assert.equal(e.state.drawStack.total, 3, 'stack unchanged');
});

// ---- reverse deflection on colored draws ----------------------------------

test('reverse deflection bounces a colored Draw One back (2 players)', () => {
  const e = makeEngine(['A', 'B']);
  const aD1 = F(face('red', TYPE.DRAW_ONE, 1), face('pink', TYPE.NUMBER, 1));
  const bRev = F(face('red', TYPE.REVERSE), face('pink', TYPE.NUMBER, 2));
  setup(e, {
    side: 'light',
    hands: [[aD1, spare()], [bRev, spare()]],
    top: F(face('red', TYPE.NUMBER, 3), face('pink', TYPE.NUMBER, 3)),
    drawPile: Array.from({ length: 6 }, spare),
  });
  assert.ok(e.applyIntent('A', { type: 'PLAY_CARD', cardId: aD1.id }).ok); // stack 1 → B
  const r = e.applyIntent('B', { type: 'PLAY_CARD', cardId: bRev.id }); // deflect
  assert.ok(r.ok);
  assert.equal(e.state.drawStack.total, 1, 'value unchanged');
  assert.equal(e.state.drawStack.chainActive, true);
  assert.equal(cur(e), 'A', 'penalty redirected to A');
  const before = hand(e, 'A').length;
  e.applyIntent('A', { type: 'DRAW' }); // A has no reverse → takes it
  assert.equal(hand(e, 'A').length, before + 1);
});

test('wild draws cannot be deflected', () => {
  const e = makeEngine(['A', 'B']);
  const aW2 = F(face(null, TYPE.WILD_DRAW_TWO, 2), face(null, TYPE.WILD_DRAW_COLOR, 5));
  const bRev = F(face('red', TYPE.REVERSE), face('pink', TYPE.NUMBER, 2));
  setup(e, {
    side: 'light',
    hands: [[aW2, spare()], [bRev, spare()]],
    top: F(face('red', TYPE.NUMBER, 3), face('pink', TYPE.NUMBER, 3)),
    drawPile: Array.from({ length: 6 }, spare),
  });
  e.applyIntent('A', { type: 'PLAY_CARD', cardId: aW2.id, chosenColor: 'red' });
  assert.equal(e.applyIntent('B', { type: 'PLAY_CARD', cardId: bRev.id }).error, 'CANNOT_DEFLECT_WILD_DRAW');
});

// ---- Flip cannot interrupt a stack ----------------------------------------

test('Flip cannot be played onto an active draw-stack', () => {
  const e = makeEngine(['A', 'B', 'C']);
  const aD1 = F(face('red', TYPE.DRAW_ONE, 1), face('pink', TYPE.NUMBER, 1));
  const bFlip = F(face('red', TYPE.FLIP), face('pink', TYPE.FLIP));
  setup(e, {
    side: 'light',
    hands: [[aD1, spare()], [bFlip, spare()]],
    top: F(face('red', TYPE.NUMBER, 3), face('pink', TYPE.NUMBER, 3)),
    drawPile: Array.from({ length: 6 }, spare),
  });
  e.applyIntent('A', { type: 'PLAY_CARD', cardId: aD1.id }); // stack → B
  assert.equal(e.applyIntent('B', { type: 'PLAY_CARD', cardId: bFlip.id }).error, 'ILLEGAL_STACK_RESPONSE');
});

// ---- shared draw rule + PASS ----------------------------------------------

test('voluntary draw of a playable card lets you PASS (keep it, end turn)', () => {
  const e = makeEngine(['A', 'B', 'C']);
  setup(e, {
    side: 'light',
    hands: [[F(face('green', TYPE.NUMBER, 9), face('teal', TYPE.NUMBER, 9))]],
    top: F(face('red', TYPE.NUMBER, 5), face('pink', TYPE.NUMBER, 5)),
    drawPile: [F(face('red', TYPE.NUMBER, 3), face('pink', TYPE.NUMBER, 3))], // playable red 3
  });
  assert.ok(e.applyIntent('A', { type: 'DRAW' }).ok);
  assert.equal(cur(e), 'A', 'still your turn after drawing a playable card');
  assert.equal(e.view('A').canPass, true);
  assert.ok(e.applyIntent('A', { type: 'PASS' }).ok);
  assert.equal(hand(e, 'A').length, 2, 'kept the drawn card');
  assert.equal(cur(e), 'B', 'turn passed');
});

test('win by emptying your hand', () => {
  const e = makeEngine(['A', 'B']);
  const last = F(face('red', TYPE.NUMBER, 9), face('pink', TYPE.NUMBER, 9));
  setup(e, { side: 'light', hands: [[last]], top: F(face('red', TYPE.NUMBER, 5), face('pink', TYPE.NUMBER, 5)) });
  assert.ok(e.applyIntent('A', { type: 'PLAY_CARD', cardId: last.id }).ok);
  assert.equal(e.state.status, 'finished');
  assert.equal(e.state.winner, 'A');
});
