'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { MonopolyEngine } = require('../src/engine/monopoly/MonopolyEngine');
const { BOARD, START_MONEY } = require('../src/engine/monopoly/constants');

function makeEngine(ids = ['A', 'B']) {
  return new MonopolyEngine({ players: ids.map((id, i) => ({ id, name: id, isHost: i === 0 })) });
}
// Force the dice: seq is a flat list of die faces consumed in order (cycles).
function dice(e, seq) { let i = 0; e._rollDie = () => seq[i++ % seq.length]; }
const P = (e, id) => e.state.players.find((p) => p.id === id);
const cur = (e) => e.state.players[e.state.current].id;

// ---- board ----------------------------------------------------------------

test('board has 40 spaces in the correct classic order', () => {
  assert.equal(BOARD.length, 40);
  assert.equal(BOARD[0].type, 'go');
  assert.equal(BOARD[1].name, 'Mediterranean Avenue');
  assert.equal(BOARD[5].type, 'railroad');
  assert.equal(BOARD[10].type, 'jail');
  assert.equal(BOARD[20].type, 'freeParking');
  assert.equal(BOARD[30].type, 'goToJail');
  assert.equal(BOARD[39].name, 'Boardwalk');
  assert.deepEqual(BOARD.map((s) => s.index), Array.from({ length: 40 }, (_, i) => i));
});

// ---- start ----------------------------------------------------------------

test('start gives every player $1500 at position 0 and first player to move', () => {
  const e = makeEngine(['A', 'B', 'C']);
  assert.ok(e.start().ok);
  const v = e.view('A');
  assert.equal(v.status, 'playing');
  assert.equal(v.winner, null);
  for (const p of v.players) {
    assert.equal(p.money, START_MONEY);
    assert.equal(p.position, 0);
    assert.equal(p.inJail, false);
  }
  assert.equal(v.currentPlayerId, 'A');
  assert.equal(v.board.length, 40);
});

// ---- movement -------------------------------------------------------------

test('a roll moves the player by the dice total and auto-passes the turn', () => {
  const e = makeEngine(); e.start();
  dice(e, [6, 3]); // total 9, not doubles
  assert.ok(e.applyIntent('A', { type: 'ROLL' }).ok);
  assert.equal(P(e, 'A').position, 9);
  assert.deepEqual(e.view('A').lastRoll, { d1: 6, d2: 3, total: 9 });
  assert.equal(cur(e), 'B', 'non-doubles → turn passes');
});

test('money & position are public — view shows every player', () => {
  const e = makeEngine(['A', 'B']); e.start();
  const v = e.view('B');
  const them = v.players.find((p) => p.id === 'A');
  assert.equal(them.money, 1500);
  assert.equal(them.position, 0);
  assert.equal(typeof them.isYou, 'boolean');
});

// ---- pass Go --------------------------------------------------------------

test('passing Go awards +$200', () => {
  const e = makeEngine(); e.start();
  P(e, 'A').position = 38;
  dice(e, [2, 3]); // 38 + 5 = 43 → wraps to 3, passes Go
  e.applyIntent('A', { type: 'ROLL' });
  assert.equal(P(e, 'A').position, 3);
  assert.equal(P(e, 'A').money, 1700);
});

test('landing exactly on Go also awards $200', () => {
  const e = makeEngine(); e.start();
  P(e, 'A').position = 35;
  dice(e, [2, 3]); // 35 + 5 = 40 → lands on Go (index 0)
  e.applyIntent('A', { type: 'ROLL' });
  assert.equal(P(e, 'A').position, 0);
  assert.equal(P(e, 'A').money, 1700);
});

// ---- doubles --------------------------------------------------------------

test('doubles lets the same player roll again', () => {
  const e = makeEngine(); e.start();
  dice(e, [2, 2, 5, 1]); // doubles then non-doubles
  e.applyIntent('A', { type: 'ROLL' });
  assert.equal(cur(e), 'A', 'still A after doubles');
  assert.equal(P(e, 'A').position, 4);
  e.applyIntent('A', { type: 'ROLL' });
  assert.equal(cur(e), 'B', 'second (non-doubles) roll passes the turn');
  assert.equal(P(e, 'A').position, 10); // 4 + 6
});

test('three doubles in one turn sends the player straight to Jail (no move on the 3rd)', () => {
  const e = makeEngine(); e.start();
  dice(e, [2, 2, 3, 3, 4, 4]);
  e.applyIntent('A', { type: 'ROLL' }); // pos 4
  e.applyIntent('A', { type: 'ROLL' }); // pos 10
  const posBefore = P(e, 'A').position;
  e.applyIntent('A', { type: 'ROLL' }); // 3rd doubles → jail, no move
  const a = P(e, 'A');
  assert.equal(a.inJail, true);
  assert.equal(a.position, 10);
  assert.notEqual(posBefore + 8, a.position, 'did not move on the 3rd doubles');
  assert.equal(cur(e), 'B', 'turn ends');
});

// ---- go to jail space -----------------------------------------------------

test('landing on Go To Jail (index 30) sends the player to Jail', () => {
  const e = makeEngine(); e.start();
  P(e, 'A').position = 27;
  dice(e, [1, 2]); // 27 + 3 = 30 → Go To Jail
  e.applyIntent('A', { type: 'ROLL' });
  const a = P(e, 'A');
  assert.equal(a.position, 10);
  assert.equal(a.inJail, true);
  assert.equal(cur(e), 'B');
});

// ---- jail exit ------------------------------------------------------------

test('jail: doubles releases immediately and moves by the roll', () => {
  const e = makeEngine(); e.start();
  Object.assign(P(e, 'A'), { inJail: true, position: 10, jailTurns: 0 });
  dice(e, [3, 3]); // doubles → leave jail, move 6
  e.applyIntent('A', { type: 'ROLL' });
  const a = P(e, 'A');
  assert.equal(a.inJail, false);
  assert.equal(a.position, 16); // 10 + 6
  assert.equal(a.money, 1500, 'no fee when leaving via doubles');
  assert.equal(cur(e), 'B', 'no bonus re-roll from a jail exit');
});

test('jail: after 3 failed turns the player pays $50 and gets out', () => {
  const e = makeEngine(['A', 'B']); e.start();
  Object.assign(P(e, 'A'), { inJail: true, position: 10, jailTurns: 0 });
  dice(e, [1, 2]); // every roll is 1+2 = 3 (never doubles)
  let guard = 0;
  while (P(e, 'A').inJail && guard++ < 20) {
    e.applyIntent(cur(e), { type: 'ROLL' });
  }
  const a = P(e, 'A');
  assert.equal(a.inJail, false, 'out of jail');
  assert.equal(a.money, 1450, 'paid the $50 jail fee');
  assert.equal(a.position, 13, 'then moved by the roll (10 + 3)');
});

// ---- turn integrity -------------------------------------------------------

test('a non-current player cannot roll', () => {
  const e = makeEngine(); e.start();
  assert.equal(e.applyIntent('B', { type: 'ROLL' }).error, 'NOT_YOUR_TURN');
});

test('winner stays null in Phase 1 (no elimination)', () => {
  const e = makeEngine(); e.start();
  dice(e, [1, 2]);
  e.applyIntent('A', { type: 'ROLL' });
  assert.equal(e.state.winner, null);
  assert.equal(e.state.status, 'playing');
});
