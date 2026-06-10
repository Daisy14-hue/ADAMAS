'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { NoMercyEngine } = require('../src/engine/NoMercyEngine');
const { makeRng } = require('../src/engine/deck');
const { TYPE } = require('../src/engine/constants');

// ---- test fixtures --------------------------------------------------------

let _id = 0;
const C = (color, type, value = null) => ({ id: `t${_id++}`, color, type, value });
const num = (color, v) => C(color, TYPE.NUMBER, v);
const fillers = (n, color = 'red') => Array.from({ length: n }, () => num(color, 1));
// A spare card so a player doesn't win by emptying their hand on the played action card.
const spare = () => num('yellow', 0);

function makeEngine(ids) {
  return new NoMercyEngine({
    players: ids.map((id) => ({ id, name: id })),
    rng: makeRng(42),
  });
}

/** Hand-craft a mid-game scenario without dealing. */
function setup(engine, { hands, top, activeColor, current = 0, direction = 1, drawPile = [], config }) {
  const s = engine.state;
  s.status = 'playing';
  s.direction = direction;
  s.current = current;
  s.players.forEach((p, i) => {
    p.hand = hands[i] || [];
    p.eliminated = false;
  });
  s.discardPile = [top];
  s.activeColor = activeColor ?? (top ? top.color : null);
  s.drawPile = drawPile;
  s.drawStack = null;
  s.pendingPlay = null;
  if (config) s.config = { ...s.config, ...config };
  return engine;
}

const cur = (e) => e.state.players[e.state.current].id;
const hand = (e, id) => e.state.players.find((p) => p.id === id).hand;

// ---- setup / dealing ------------------------------------------------------

test('start deals 7 each, flips a number, sets first player left of dealer', () => {
  const e = makeEngine(['A', 'B', 'C', 'D']);
  const r = e.start();
  assert.ok(r.ok);
  const s = e.state;
  for (const p of s.players) assert.equal(p.hand.length, 7);
  assert.equal(s.discardPile.length, 1);
  assert.equal(s.discardPile[0].type, TYPE.NUMBER, 'starting card is a number');
  assert.equal(s.drawPile.length, 168 - 28 - 1);
  assert.equal(cur(e), 'B', 'player left of dealer (idx 0) starts');
  // total card conservation
  const total = s.players.reduce((a, p) => a + p.hand.length, 0) + s.drawPile.length + s.discardPile.length;
  assert.equal(total, 168);
});

test('cannot start with fewer than 2 players', () => {
  const e = makeEngine(['A']);
  assert.equal(e.start().ok, false);
});

// ---- plain numbers & house overrides --------------------------------------

test('7 and 0 are plain numbers (no swap, no pass)', () => {
  const e = makeEngine(['A', 'B', 'C']);
  const seven = num('red', 7);
  setup(e, {
    hands: [[seven, num('blue', 2)], [num('green', 3)], [num('yellow', 4)]],
    top: num('red', 5),
  });
  const bHandBefore = hand(e, 'B').length;
  const r = e.applyIntent('A', { type: 'PLAY_CARD', cardId: seven.id });
  assert.ok(r.ok);
  assert.equal(hand(e, 'B').length, bHandBefore, 'no hand swap from 7');
  assert.equal(cur(e), 'B', 'turn just advances');
  assert.equal(e.state.activeColor, 'red');
});

// ---- basic action cards ---------------------------------------------------

test('skip makes the next player lose their turn', () => {
  const e = makeEngine(['A', 'B', 'C']);
  const skip = C('red', TYPE.SKIP);
  setup(e, { hands: [[skip, spare()]], top: num('red', 5) });
  e.applyIntent('A', { type: 'PLAY_CARD', cardId: skip.id });
  assert.equal(cur(e), 'C');
});

test('reverse flips direction (3 players)', () => {
  const e = makeEngine(['A', 'B', 'C']);
  const rev = C('red', TYPE.REVERSE);
  setup(e, { hands: [[rev, spare()]], top: num('red', 5) });
  e.applyIntent('A', { type: 'PLAY_CARD', cardId: rev.id });
  assert.equal(e.state.direction, -1);
  assert.equal(cur(e), 'C', 'goes counter-clockwise to C');
});

test('reverse acts as a skip in a 2-player game', () => {
  const e = makeEngine(['A', 'B']);
  const rev = C('red', TYPE.REVERSE);
  setup(e, { hands: [[rev, num('red', 1)]], top: num('red', 5) });
  e.applyIntent('A', { type: 'PLAY_CARD', cardId: rev.id });
  assert.equal(cur(e), 'A', 'A plays again');
});

test('skip everyone returns the turn to the player', () => {
  const e = makeEngine(['A', 'B', 'C']);
  const se = C('red', TYPE.SKIP_EVERYONE);
  setup(e, { hands: [[se, num('red', 1)]], top: num('red', 5) });
  e.applyIntent('A', { type: 'PLAY_CARD', cardId: se.id });
  assert.equal(cur(e), 'A');
});

test('discard all dumps every card of the played color', () => {
  const e = makeEngine(['A', 'B', 'C']);
  const da = C('red', TYPE.DISCARD_ALL);
  setup(e, {
    hands: [[da, num('red', 3), num('red', 8), num('blue', 2)]],
    top: num('red', 5),
  });
  e.applyIntent('A', { type: 'PLAY_CARD', cardId: da.id });
  const h = hand(e, 'A');
  assert.equal(h.length, 1, 'only the non-red card remains');
  assert.equal(h[0].color, 'blue');
  assert.equal(e.state.discardPile[e.state.discardPile.length - 1].type, TYPE.DISCARD_ALL);
  assert.equal(cur(e), 'B');
});

// ---- draw stacking (ascending) -------------------------------------------

test('Draw 2 starts a stack targeting the next player', () => {
  const e = makeEngine(['A', 'B', 'C']);
  const d2 = C('red', TYPE.DRAW2);
  setup(e, { hands: [[d2, num('red', 1)]], top: num('red', 5) });
  e.applyIntent('A', { type: 'PLAY_CARD', cardId: d2.id });
  assert.equal(e.state.drawStack.total, 2);
  assert.equal(cur(e), 'B');
});

test('ascending stack accumulates: Draw2 -> Draw2 -> WildDraw4 = 8', () => {
  const e = makeEngine(['A', 'B', 'C']);
  const aD2 = C('red', TYPE.DRAW2);
  const bD2 = C('green', TYPE.DRAW2);
  const cW4 = C(null, TYPE.WILD_DRAW4);
  setup(e, {
    hands: [[aD2, spare()], [bD2, num('green', 1)], [cW4, num('blue', 1)]],
    top: num('red', 5),
  });
  assert.ok(e.applyIntent('A', { type: 'PLAY_CARD', cardId: aD2.id }).ok);
  assert.ok(e.applyIntent('B', { type: 'PLAY_CARD', cardId: bD2.id }).ok);
  assert.ok(
    e.applyIntent('C', { type: 'PLAY_CARD', cardId: cW4.id, chosenColor: 'blue' }).ok,
  );
  assert.equal(e.state.drawStack.total, 8);
  assert.equal(cur(e), 'A');
});

test('descending stack is rejected (Wild Draw 4 then Draw 2)', () => {
  const e = makeEngine(['A', 'B', 'C']);
  const aW4 = C(null, TYPE.WILD_DRAW4);
  const bD2 = C('red', TYPE.DRAW2);
  setup(e, { hands: [[aW4, spare()], [bD2, num('red', 1)]], top: num('red', 5) });
  e.applyIntent('A', { type: 'PLAY_CARD', cardId: aW4.id, chosenColor: 'red' });
  const r = e.applyIntent('B', { type: 'PLAY_CARD', cardId: bD2.id });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'NON_ASCENDING_DRAW');
  assert.equal(e.state.drawStack.total, 4, 'stack unchanged');
});

test('taking the penalty draws the total and skips the player', () => {
  const e = makeEngine(['A', 'B', 'C']);
  const d2 = C('red', TYPE.DRAW2);
  setup(e, {
    hands: [[d2, spare()], [num('blue', 9)], []],
    top: num('red', 5),
    drawPile: fillers(10),
  });
  e.applyIntent('A', { type: 'PLAY_CARD', cardId: d2.id }); // stack 2, target B
  const before = hand(e, 'B').length;
  const r = e.applyIntent('B', { type: 'DRAW' });
  assert.ok(r.ok);
  assert.equal(hand(e, 'B').length, before + 2);
  assert.equal(e.state.drawStack, null);
  assert.equal(cur(e), 'C', 'B is skipped after taking the penalty');
});

test('skip everyone / number cannot interrupt a live stack', () => {
  const e = makeEngine(['A', 'B', 'C']);
  const d2 = C('red', TYPE.DRAW2);
  const bSE = C('red', TYPE.SKIP_EVERYONE);
  const bNum = num('red', 5);
  setup(e, { hands: [[d2, spare()], [bSE, bNum]], top: num('red', 5), drawPile: fillers(10) });
  e.applyIntent('A', { type: 'PLAY_CARD', cardId: d2.id });
  assert.equal(e.applyIntent('B', { type: 'PLAY_CARD', cardId: bSE.id }).error, 'ILLEGAL_STACK_RESPONSE');
  assert.equal(e.applyIntent('B', { type: 'PLAY_CARD', cardId: bNum.id }).error, 'ILLEGAL_STACK_RESPONSE');
});

// ---- reverse deflection (4.6) --------------------------------------------

test('reverse deflection sends a Draw 2 back (2 players)', () => {
  const e = makeEngine(['A', 'B']);
  const aD2 = C('red', TYPE.DRAW2);
  const bRev = C('red', TYPE.REVERSE);
  setup(e, { hands: [[aD2, num('red', 1)], [bRev, num('red', 2)]], top: num('red', 5), drawPile: fillers(10) });
  e.applyIntent('A', { type: 'PLAY_CARD', cardId: aD2.id }); // stack 2, target B
  const r = e.applyIntent('B', { type: 'PLAY_CARD', cardId: bRev.id }); // deflect
  assert.ok(r.ok);
  assert.equal(e.state.drawStack.total, 2, 'value unchanged');
  assert.equal(e.state.drawStack.chainActive, true);
  assert.equal(cur(e), 'A', 'penalty redirected to A');
  const aBefore = hand(e, 'A').length;
  e.applyIntent('A', { type: 'DRAW' }); // A has no reverse → takes it
  assert.equal(hand(e, 'A').length, aBefore + 2);
});

test('reverse deflection must match the active color', () => {
  const e = makeEngine(['A', 'B']);
  const aD2 = C('red', TYPE.DRAW2);
  const bRev = C('blue', TYPE.REVERSE);
  setup(e, { hands: [[aD2, spare()], [bRev, num('red', 2)]], top: num('red', 5), drawPile: fillers(5) });
  e.applyIntent('A', { type: 'PLAY_CARD', cardId: aD2.id });
  const r = e.applyIntent('B', { type: 'PLAY_CARD', cardId: bRev.id });
  assert.equal(r.error, 'REVERSE_MUST_MATCH_COLOR');
});

test('wild draws cannot be deflected with a reverse', () => {
  const e = makeEngine(['A', 'B']);
  const aW4 = C(null, TYPE.WILD_DRAW4);
  const bRev = C('red', TYPE.REVERSE);
  setup(e, { hands: [[aW4, spare()], [bRev, num('red', 2)]], top: num('red', 5), drawPile: fillers(8) });
  e.applyIntent('A', { type: 'PLAY_CARD', cardId: aW4.id, chosenColor: 'red' });
  const r = e.applyIntent('B', { type: 'PLAY_CARD', cardId: bRev.id });
  assert.equal(r.error, 'CANNOT_DEFLECT_WILD_DRAW');
});

// ---- reverse chain (4.8) ping-pong ---------------------------------------

test('reverse chain ping-pongs between the two duellists only (4 players)', () => {
  const e = makeEngine(['A', 'B', 'C', 'D']);
  const aD2 = C('red', TYPE.DRAW2);
  const bRev = C('red', TYPE.REVERSE);
  const aRev = C('blue', TYPE.REVERSE); // color ignored during chain
  setup(e, {
    hands: [[aD2, aRev, spare()], [bRev, num('green', 1)], [num('yellow', 1)], [num('blue', 1)]],
    top: num('red', 5),
    drawPile: fillers(10),
  });
  assert.ok(e.applyIntent('A', { type: 'PLAY_CARD', cardId: aD2.id }).ok); // target B
  assert.ok(e.applyIntent('B', { type: 'PLAY_CARD', cardId: bRev.id }).ok); // deflect → A
  assert.equal(cur(e), 'A');
  assert.ok(e.applyIntent('A', { type: 'PLAY_CARD', cardId: aRev.id }).ok); // chain → B
  assert.equal(cur(e), 'B');
  assert.equal(e.state.drawStack.total, 2, 'value never changes through the chain');
  const bBefore = hand(e, 'B').length;
  e.applyIntent('B', { type: 'DRAW' }); // B can't continue → draws 2
  assert.equal(hand(e, 'B').length, bBefore + 2);
  assert.equal(cur(e), 'C', 'B skipped; resumes with C, not pulled-in neighbors');
});

// ---- wild draw reverse +4 (4.9) ------------------------------------------

test('Wild Draw Reverse +4 reverses, adds 4, and cannot be deflected', () => {
  const e = makeEngine(['A', 'B', 'C']);
  const aWR4 = C(null, TYPE.WILD_REVERSE_DRAW4);
  const cRev = C('red', TYPE.REVERSE);
  const cW4 = C(null, TYPE.WILD_DRAW4);
  setup(e, {
    hands: [[aWR4, spare()], [num('red', 1)], [cRev, cW4]],
    top: num('red', 5),
    drawPile: fillers(10),
  });
  e.applyIntent('A', { type: 'PLAY_CARD', cardId: aWR4.id, chosenColor: 'green' });
  assert.equal(e.state.direction, -1, 'direction reversed');
  assert.equal(e.state.drawStack.total, 4);
  assert.equal(cur(e), 'C', 'target is next in the NEW direction');
  assert.equal(e.applyIntent('C', { type: 'PLAY_CARD', cardId: cRev.id }).error, 'CANNOT_DEFLECT_WILD_DRAW');
  assert.ok(e.applyIntent('C', { type: 'PLAY_CARD', cardId: cW4.id, chosenColor: 'blue' }).ok);
  assert.equal(e.state.drawStack.total, 8);
  assert.equal(cur(e), 'B', 'continues in the reversed direction');
});

// ---- wild color roulette --------------------------------------------------

test('roulette: next player draws until the called color, then loses their turn', () => {
  const e = makeEngine(['A', 'B', 'C']);
  const roul = C(null, TYPE.WILD_ROULETTE);
  // drawPile pops from the END: blue, then red, then green.
  const drawPile = [num('green', 1), num('red', 2), num('blue', 3)];
  setup(e, { hands: [[roul, num('red', 1)]], top: num('red', 5), drawPile });
  const before = hand(e, 'B').length;
  const r = e.applyIntent('A', { type: 'PLAY_CARD', cardId: roul.id, rouletteColor: 'green' });
  assert.ok(r.ok);
  assert.equal(hand(e, 'B').length, before + 3, 'drew blue, red, green');
  assert.ok(hand(e, 'B').some((c) => c.color === 'green'));
  assert.equal(e.state.activeColor, 'green');
  assert.equal(cur(e), 'C', 'B loses their turn');
});

// ---- mercy elimination ----------------------------------------------------

test('a penalty that reaches the limit eliminates the player', () => {
  const e = makeEngine(['A', 'B', 'C']);
  const d2 = C('red', TYPE.DRAW2);
  setup(e, {
    hands: [[d2, spare()], [num('blue', 1), num('blue', 2), num('blue', 3)], [num('green', 1)]],
    top: num('red', 5),
    drawPile: fillers(10),
    config: { eliminationLimit: 5 },
  });
  // Elimination limit set so a single penalty crosses it: B has 3 cards; +2 = 5 ≥ limit.
  e.applyIntent('A', { type: 'PLAY_CARD', cardId: d2.id }); // target B, stack 2
  e.applyIntent('B', { type: 'DRAW' });
  const B = e.state.players.find((p) => p.id === 'B');
  assert.equal(B.eliminated, true);
  assert.equal(B.hand.length, 0, 'eliminated hand is set aside');
  assert.equal(e.state.status, 'playing', 'two players remain');
});

test('eliminating the second-to-last player wins the game', () => {
  const e = makeEngine(['A', 'B']);
  const d2 = C('red', TYPE.DRAW2);
  setup(e, {
    hands: [[d2, spare()], [num('blue', 1), num('blue', 2), num('blue', 3)]],
    top: num('red', 5),
    drawPile: fillers(10),
    config: { eliminationLimit: 5 },
  });
  e.applyIntent('A', { type: 'PLAY_CARD', cardId: d2.id });
  e.applyIntent('B', { type: 'DRAW' }); // B → 5 cards, eliminated
  assert.equal(e.state.status, 'finished');
  assert.equal(e.state.winner, 'A');
});

// ---- winning by emptying hand --------------------------------------------

test('playing your last card wins', () => {
  const e = makeEngine(['A', 'B', 'C']);
  const last = num('red', 9);
  setup(e, { hands: [[last]], top: num('red', 5) });
  const r = e.applyIntent('A', { type: 'PLAY_CARD', cardId: last.id });
  assert.ok(r.ok);
  assert.equal(e.state.status, 'finished');
  assert.equal(e.state.winner, 'A');
});

// ---- invalid moves / turn integrity --------------------------------------

test('illegal move is rejected and leaves state unchanged', () => {
  const e = makeEngine(['A', 'B', 'C']);
  const bad = num('blue', 9); // not playable on red 5
  setup(e, { hands: [[bad, num('red', 1)]], top: num('red', 5) });
  const r = e.applyIntent('A', { type: 'PLAY_CARD', cardId: bad.id });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'ILLEGAL_MOVE');
  assert.equal(cur(e), 'A', 'still A turn');
  assert.equal(hand(e, 'A').length, 2, 'hand unchanged');
});

test('acting out of turn is rejected', () => {
  const e = makeEngine(['A', 'B', 'C']);
  setup(e, { hands: [[num('red', 1)], [num('red', 2)]], top: num('red', 5) });
  const r = e.applyIntent('B', { type: 'PLAY_CARD', cardId: hand(e, 'B')[0].id });
  assert.equal(r.error, 'NOT_YOUR_TURN');
});

test('voluntary draw is blocked when a playable card is held', () => {
  const e = makeEngine(['A', 'B', 'C']);
  setup(e, { hands: [[num('red', 1)]], top: num('red', 5), drawPile: fillers(5) });
  const r = e.applyIntent('A', { type: 'DRAW' });
  assert.equal(r.error, 'YOU_HAVE_A_PLAYABLE_CARD');
});

test('drawing an unplayable card keeps the turn; a playable one must be played', () => {
  const e = makeEngine(['A', 'B', 'C']);
  // A holds only mismatched cards; top is red 5; drawPile top (popped) is blue (unplayable), then red (playable).
  setup(e, {
    hands: [[num('green', 9)]],
    top: num('red', 5),
    drawPile: [num('red', 3), num('blue', 7)], // pops blue first, then red
  });
  const r1 = e.applyIntent('A', { type: 'DRAW' });
  assert.ok(r1.ok);
  assert.equal(cur(e), 'A', 'unplayable draw keeps the turn');
  const r2 = e.applyIntent('A', { type: 'DRAW' });
  assert.ok(r2.ok);
  assert.equal(e.state.pendingPlay.idx, 0, 'playable draw must now be played');
  // trying to play a different card is rejected
  const other = hand(e, 'A').find((c) => c.color === 'green');
  assert.equal(e.applyIntent('A', { type: 'PLAY_CARD', cardId: other.id }).error, 'MUST_PLAY_DRAWN_CARD');
});

// ---- recycling ------------------------------------------------------------

test('empty draw pile recycles from the discard pile', () => {
  const e = makeEngine(['A', 'B', 'C']);
  setup(e, {
    hands: [[num('green', 9)]], // A can't play on red 5 → must draw
    top: num('red', 5),
    drawPile: [],
  });
  // Seed a discard history under the top so there is something to recycle.
  e.state.discardPile = [num('yellow', 1), num('yellow', 2), num('yellow', 3), num('red', 5)];
  const r = e.applyIntent('A', { type: 'DRAW' });
  assert.ok(r.ok);
  assert.ok(r.events.some((ev) => ev.type === 'DECK_RECYCLED'));
  assert.equal(e.state.discardPile[e.state.discardPile.length - 1].value, 5, 'top preserved');
});

test('discard pile threshold triggers an auto-recycle', () => {
  const e = makeEngine(['A', 'B', 'C']);
  const playable = num('red', 6);
  setup(e, {
    hands: [[playable]],
    top: num('red', 5),
    drawPile: fillers(3),
    config: { recycleThreshold: 3 },
  });
  // Pad discard so that after playing, it crosses the threshold of 3.
  e.state.discardPile = [num('yellow', 1), num('yellow', 2), num('red', 5)];
  const r = e.applyIntent('A', { type: 'PLAY_CARD', cardId: playable.id });
  assert.ok(r.ok);
  assert.ok(r.events.some((ev) => ev.type === 'DECK_RECYCLED'));
});

// ---- redacted views -------------------------------------------------------

test('view hides other players hands but shows counts', () => {
  const e = makeEngine(['A', 'B']);
  setup(e, { hands: [[num('red', 1), num('red', 2)], [num('blue', 1)]], top: num('red', 5) });
  const v = e.view('A');
  const me = v.players.find((p) => p.id === 'A');
  const them = v.players.find((p) => p.id === 'B');
  assert.ok(Array.isArray(me.hand));
  assert.equal(me.hand.length, 2);
  assert.equal(them.hand, undefined, 'opponent hand hidden');
  assert.equal(them.handCount, 1);
});
