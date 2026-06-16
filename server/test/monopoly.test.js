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
  dice(e, [1, 3]); // total 4 → Income Tax (non-ownable, announce-only), not doubles
  assert.ok(e.applyIntent('A', { type: 'ROLL' }).ok);
  assert.equal(P(e, 'A').position, 4);
  assert.deepEqual(e.view('A').lastRoll, { d1: 1, d2: 3, total: 4 });
  assert.ok(e.applyIntent('A', { type: 'END_TURN' }).ok); // Phase 4 management window
  assert.equal(cur(e), 'B', 'after End Turn, a non-doubles turn passes');
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
  assert.equal(P(e, 'A').position, 10); // 4 + 6
  assert.ok(e.applyIntent('A', { type: 'END_TURN' }).ok);
  assert.equal(cur(e), 'B', 'second (non-doubles) roll then End Turn passes the turn');
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
  dice(e, [5, 5]); // doubles → leave jail, move 10 to Free Parking (non-ownable)
  e.applyIntent('A', { type: 'ROLL' });
  const a = P(e, 'A');
  assert.equal(a.inJail, false);
  assert.equal(a.position, 20); // 10 + 10
  assert.equal(a.money, 1500, 'no fee when leaving via doubles');
  assert.ok(e.applyIntent('A', { type: 'END_TURN' }).ok);
  assert.equal(cur(e), 'B', 'no bonus re-roll from a jail exit (End Turn passes)');
});

test('jail: after 3 failed turns the player pays $50 and gets out', () => {
  const e = makeEngine(['A', 'B']); e.start();
  Object.assign(P(e, 'A'), { inJail: true, position: 10, jailTurns: 0 });
  dice(e, [1, 2]); // 1+2 = 3, never doubles
  for (let i = 0; i < 3; i++) {
    e.state.current = 0; // isolate A's jail turns for a focused jail test
    e.applyIntent('A', { type: 'ROLL' });
  }
  const a = P(e, 'A');
  assert.equal(a.inJail, false, 'out of jail after the 3rd turn');
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


// ===== Phase 2: buying + rent =====

test('buying deducts the price and sets public ownership', () => {
  const e = makeEngine(); e.start();
  dice(e, [1, 2]); // A: 0 → Baltic Avenue (index 3, $60)
  e.applyIntent('A', { type: 'ROLL' });
  assert.equal(e.view('A').pendingPurchase.spaceIndex, 3, 'paused for a buy decision');
  assert.ok(e.applyIntent('A', { type: 'BUY_PROPERTY' }).ok);
  assert.equal(P(e, 'A').money, 1440); // 1500 - 60
  assert.equal(e.state.owners[3], 'A');
  const v = e.view('A');
  assert.deepEqual(v.players.find((p) => p.id === 'A').properties, [3]);
  assert.equal(v.board[3].ownerId, 'A');
  assert.ok(e.applyIntent('A', { type: 'END_TURN' }).ok);
  assert.equal(cur(e), 'B', 'after buying and ending the turn → passes');
});

test('landing on your OWN property does nothing', () => {
  const e = makeEngine(); e.start();
  e.state.owners[3] = 'A';
  Object.assign(P(e, 'A'), { position: 0, money: 1000 });
  e.state.current = 0;
  dice(e, [1, 2]); // → Baltic (own)
  e.applyIntent('A', { type: 'ROLL' });
  assert.equal(e.view('A').pendingPurchase, null);
  assert.equal(P(e, 'A').money, 1000, 'no charge on your own space');
});

test('landing on another player\'s property pays the base rent', () => {
  const e = makeEngine(['A', 'B']); e.start();
  e.state.owners[3] = 'A'; // A owns Baltic (base rent 4), not the whole brown group
  Object.assign(P(e, 'B'), { position: 0 });
  e.state.current = 1;
  const aBefore = P(e, 'A').money;
  const bBefore = P(e, 'B').money;
  dice(e, [1, 2]); // B → Baltic
  e.applyIntent('B', { type: 'ROLL' });
  assert.equal(P(e, 'B').money, bBefore - 4);
  assert.equal(P(e, 'A').money, aBefore + 4);
});

test('owning the full color group doubles the base rent (unbuilt)', () => {
  const e = makeEngine(['A', 'B']); e.start();
  e.state.owners[1] = 'A'; e.state.owners[3] = 'A'; // both browns
  Object.assign(P(e, 'B'), { position: 0 });
  e.state.current = 1;
  const aBefore = P(e, 'A').money;
  const bBefore = P(e, 'B').money;
  dice(e, [1, 2]); // B → Baltic, doubled rent 8
  e.applyIntent('B', { type: 'ROLL' });
  assert.equal(bBefore - P(e, 'B').money, 8);
  assert.equal(P(e, 'A').money - aBefore, 8);
});

test('railroad rent scales 25/50/100/200 with the number owned', () => {
  const e = makeEngine(['A', 'B']); e.start();
  const rentOnReading = () => {
    Object.assign(P(e, 'B'), { position: 2 });
    e.state.current = 1;
    e.state.awaitingEnd = false; // reset Phase-4 management window for the focused harness
    const before = P(e, 'B').money;
    dice(e, [1, 2]); // 2 + 3 → index 5 (Reading Railroad)
    e.applyIntent('B', { type: 'ROLL' });
    return before - P(e, 'B').money;
  };
  e.state.owners[5] = 'A'; assert.equal(rentOnReading(), 25);
  e.state.owners[15] = 'A'; assert.equal(rentOnReading(), 50);
  e.state.owners[25] = 'A'; assert.equal(rentOnReading(), 100);
  e.state.owners[35] = 'A'; assert.equal(rentOnReading(), 200);
});

test('utility rent = dice total ×4 (one) or ×10 (both)', () => {
  const e = makeEngine(['A', 'B']); e.start();
  e.state.owners[12] = 'A'; // Electric Company
  const rentOnElectric = () => {
    Object.assign(P(e, 'B'), { position: 9 });
    e.state.current = 1;
    e.state.awaitingEnd = false; // reset Phase-4 management window for the focused harness
    const before = P(e, 'B').money;
    dice(e, [1, 2]); // 1 + 2 = 3 → index 12 (Electric), dice total 3
    e.applyIntent('B', { type: 'ROLL' });
    return before - P(e, 'B').money;
  };
  assert.equal(rentOnElectric(), 12); // 3 × 4
  e.state.owners[28] = 'A'; // now owns both utilities
  assert.equal(rentOnElectric(), 30); // 3 × 10
});

test('declining leaves the property unowned', () => {
  const e = makeEngine(); e.start();
  dice(e, [1, 2]); // A → Baltic
  e.applyIntent('A', { type: 'ROLL' });
  assert.ok(e.view('A').pendingPurchase);
  assert.ok(e.applyIntent('A', { type: 'DECLINE_PROPERTY' }).ok);
  assert.equal(e.state.owners[3], null);
  assert.equal(e.view('A').pendingPurchase, null);
  assert.ok(e.applyIntent('A', { type: 'END_TURN' }).ok);
  assert.equal(cur(e), 'B');
});

test('rent can drive a balance negative and is logged (no bankruptcy)', () => {
  const e = makeEngine(['A', 'B']); e.start();
  e.state.owners[39] = 'A'; // Boardwalk, base rent 50
  Object.assign(P(e, 'B'), { position: 36, money: 20 });
  e.state.current = 1;
  dice(e, [1, 2]); // 36 + 3 → index 39 (Boardwalk)
  e.applyIntent('B', { type: 'ROLL' });
  assert.equal(P(e, 'B').money, -30, 'balance went negative, no bankruptcy');
  const v = e.view('B');
  assert.ok(v.log.some((l) => /rent/i.test(l.msg) && l.msg.includes('-30')), 'negative-balance rent is logged');
});

test('cannot ROLL again while a purchase decision is pending', () => {
  const e = makeEngine(); e.start();
  dice(e, [1, 2]);
  e.applyIntent('A', { type: 'ROLL' });
  assert.equal(e.applyIntent('A', { type: 'ROLL' }).error, 'MUST_RESOLVE_PURCHASE');
});

// ===== Phase 3: cards + tax + jail options =====

const { CHANCE_CARDS, COMMUNITY_CARDS } = require('../src/engine/monopoly/constants');
const cardById = (id) =>
  ({ ...[...CHANCE_CARDS, ...COMMUNITY_CARDS].find((c) => c.id === id) });
// Replace the top card of a deck in place (keeps deck length stable).
const setChanceTop = (e, id) => { e.state.chanceDeck[0] = cardById(id); };
const setCommunityTop = (e, id) => { e.state.communityDeck[0] = cardById(id); };
// seeded PRNG so deck shuffles are reproducible in tests
function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

test('Income Tax charges $200 and Luxury Tax charges $100 (to the bank)', () => {
  let e = makeEngine(); e.start();
  P(e, 'A').position = 0; dice(e, [1, 3]); // → index 4 Income Tax
  e.applyIntent('A', { type: 'ROLL' });
  assert.equal(P(e, 'A').money, 1300);

  e = makeEngine(); e.start();
  P(e, 'A').position = 35; dice(e, [1, 2]); // → index 38 Luxury Tax
  e.applyIntent('A', { type: 'ROLL' });
  assert.equal(P(e, 'A').money, 1400);
});

test('decks are shuffled deterministically from the seeded rng', () => {
  const a = new MonopolyEngine({ players: [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }], rng: seeded(42) });
  const b = new MonopolyEngine({ players: [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }], rng: seeded(42) });
  a.start(); b.start();
  assert.deepEqual(a.state.chanceDeck.map((c) => c.id), b.state.chanceDeck.map((c) => c.id));
  assert.deepEqual(a.state.communityDeck.map((c) => c.id), b.state.communityDeck.map((c) => c.id));
  assert.equal(a.state.chanceDeck.length, 16);
});

test('a drawn (non-jail) card is applied and returns to the bottom of its deck', () => {
  const e = makeEngine(); e.start();
  setChanceTop(e, 'CH7'); // Bank pays dividend $50
  P(e, 'A').position = 4; dice(e, [1, 2]); // → index 7 Chance
  e.applyIntent('A', { type: 'ROLL' });
  assert.equal(P(e, 'A').money, 1550);
  assert.equal(e.state.chanceDeck.length, 16, 'deck size unchanged');
  assert.equal(e.state.chanceDeck[e.state.chanceDeck.length - 1].id, 'CH7', 'card went to the bottom');
  assert.equal(e.view('A').lastCard.deck, 'chance');
});

test('collect / pay cards adjust money', () => {
  const e = makeEngine(); e.start();
  setCommunityTop(e, 'CC2'); // collect $200
  P(e, 'A').position = 14; dice(e, [1, 2]); // → 17 Community Chest
  e.applyIntent('A', { type: 'ROLL' });
  assert.equal(P(e, 'A').money, 1700);
});

test('collectFromEach takes from every other player', () => {
  const e = makeEngine(['A', 'B', 'C']); e.start();
  setCommunityTop(e, 'CC9'); // collect $10 from each
  P(e, 'A').position = 14; dice(e, [1, 2]); // → 17 CC
  e.applyIntent('A', { type: 'ROLL' });
  assert.equal(P(e, 'A').money, 1500 + 20);
  assert.equal(P(e, 'B').money, 1490);
  assert.equal(P(e, 'C').money, 1490);
});

test('payEach pays every other player', () => {
  const e = makeEngine(['A', 'B', 'C']); e.start();
  setChanceTop(e, 'CH15'); // pay each player $50
  P(e, 'A').position = 4; dice(e, [1, 2]); // → 7 Chance
  e.applyIntent('A', { type: 'ROLL' });
  assert.equal(P(e, 'A').money, 1500 - 100);
  assert.equal(P(e, 'B').money, 1550);
  assert.equal(P(e, 'C').money, 1550);
});

test('Go To Jail card sends the player to Jail (no pass-Go)', () => {
  const e = makeEngine(); e.start();
  setChanceTop(e, 'CH10');
  P(e, 'A').position = 4; dice(e, [1, 2]); // → 7 Chance
  e.applyIntent('A', { type: 'ROLL' });
  assert.equal(P(e, 'A').inJail, true);
  assert.equal(P(e, 'A').position, 10);
  assert.equal(cur(e), 'B', 'turn ends');
});

test('moveTo Advance-to-Go collects $200 and lands there', () => {
  const e = makeEngine(); e.start();
  setChanceTop(e, 'CH1'); // Advance to Go
  P(e, 'A').position = 4; dice(e, [1, 2]); // → 7 Chance
  e.applyIntent('A', { type: 'ROLL' });
  assert.equal(P(e, 'A').position, 0);
  assert.equal(P(e, 'A').money, 1700);
});

test('moveTo onto an unowned property opens a purchase decision', () => {
  const e = makeEngine(); e.start();
  setChanceTop(e, 'CH3'); // Advance to St. Charles Place (index 11), unowned
  P(e, 'A').position = 4; dice(e, [1, 2]); // → 7 Chance
  e.applyIntent('A', { type: 'ROLL' });
  assert.equal(P(e, 'A').position, 11);
  assert.equal(e.view('A').pendingPurchase.spaceIndex, 11);
});

test('moveTo onto a property owned by another pays rent', () => {
  const e = makeEngine(['A', 'B']); e.start();
  e.state.owners[24] = 'B'; // B owns Illinois Avenue (base rent 20)
  setChanceTop(e, 'CH2'); // Advance to Illinois (24)
  P(e, 'A').position = 19; dice(e, [1, 2]); // → 22 Chance
  const bBefore = P(e, 'B').money;
  e.applyIntent('A', { type: 'ROLL' });
  assert.equal(P(e, 'A').position, 24);
  assert.equal(1500 - P(e, 'A').money, 20);
  assert.equal(P(e, 'B').money - bBefore, 20);
});

test('Get Out of Jail Free is held, then JAIL_USE_CARD frees the player', () => {
  const e = makeEngine(); e.start();
  setChanceTop(e, 'CH8'); // Get Out of Jail Free
  P(e, 'A').position = 4; dice(e, [1, 2]); // → 7 Chance
  e.applyIntent('A', { type: 'ROLL' });
  assert.equal(e.view('A').players.find((p) => p.isYou).jailCards, 1);

  // now jail A and use the card
  Object.assign(P(e, 'A'), { inJail: true, position: 10, jailTurns: 0 });
  e.state.current = 0;
  e.state.awaitingEnd = false;
  setCommunityTop(e, 'CC15'); // index 17 is Community Chest; CC15 is a harmless +$10 (no move)
  dice(e, [6, 1]); // 7, non-doubles → index 17
  const r = e.applyIntent('A', { type: 'JAIL_USE_CARD' });
  assert.ok(r.ok);
  assert.equal(P(e, 'A').inJail, false);
  assert.equal(e.view('A').players.find((p) => p.isYou).jailCards, 0);
  assert.equal(P(e, 'A').position, 17); // 10 + 7
});

test('JAIL_PAY deducts $50 and frees the player, then they move', () => {
  const e = makeEngine(); e.start();
  Object.assign(P(e, 'A'), { inJail: true, position: 10, jailTurns: 0, money: 1000 });
  e.state.current = 0;
  setCommunityTop(e, 'CC15'); // if they land on a CC space, a harmless +$10 (17 is CC)
  dice(e, [6, 1]); // 7 → index 17 (Community Chest)
  const r = e.applyIntent('A', { type: 'JAIL_PAY' });
  assert.ok(r.ok);
  assert.equal(P(e, 'A').inJail, false);
  assert.equal(P(e, 'A').position, 17);
  // 1000 - 50 jail + 10 CC (beauty contest) = 960
  assert.equal(P(e, 'A').money, 960);
});

test('JAIL_USE_CARD without a card, or jail intents out of jail, are rejected', () => {
  const e = makeEngine(); e.start();
  Object.assign(P(e, 'A'), { inJail: true, position: 10 }); e.state.current = 0;
  assert.equal(e.applyIntent('A', { type: 'JAIL_USE_CARD' }).error, 'NO_JAIL_CARD');
  Object.assign(P(e, 'A'), { inJail: false, position: 0 });
  assert.equal(e.applyIntent('A', { type: 'JAIL_PAY' }).error, 'NOT_IN_JAIL');
});

test('repair card charges $0 with no houses (formula ready for Phase 4)', () => {
  const e = makeEngine(); e.start();
  setChanceTop(e, 'CH11'); // repairs $25/house, $100/hotel
  P(e, 'A').position = 4; dice(e, [1, 2]); // → 7 Chance
  const before = P(e, 'A').money;
  e.applyIntent('A', { type: 'ROLL' });
  assert.equal(before - P(e, 'A').money, 0);
});

// ===== Phase 4: houses & hotels =====

test('cannot build without the full color group', () => {
  const e = makeEngine(); e.start();
  e.state.owners[1] = 'A'; // only Mediterranean (brown group needs Baltic too)
  assert.equal(e.applyIntent('A', { type: 'BUILD_HOUSE', spaceIndex: 1 }).error, 'NOT_FULL_GROUP');
  assert.equal(e.applyIntent('A', { type: 'BUILD_HOUSE', spaceIndex: 5 }).error, 'NOT_BUILDABLE'); // railroad
});

test('building is allowed on a complete group during your turn (not land-dependent)', () => {
  const e = makeEngine(); e.start();
  e.state.owners[1] = 'A'; e.state.owners[3] = 'A';
  P(e, 'A').position = 30; // standing elsewhere — still allowed
  assert.ok(e.applyIntent('A', { type: 'BUILD_HOUSE', spaceIndex: 1 }).ok);
  assert.equal(e.state.houses[1], 1);
});

test('even-build is enforced within a color group', () => {
  const e = makeEngine(); e.start();
  e.state.owners[1] = 'A'; e.state.owners[3] = 'A';
  assert.ok(e.applyIntent('A', { type: 'BUILD_HOUSE', spaceIndex: 1 }).ok);
  assert.equal(e.applyIntent('A', { type: 'BUILD_HOUSE', spaceIndex: 1 }).error, 'UNEVEN_BUILD');
  assert.ok(e.applyIntent('A', { type: 'BUILD_HOUSE', spaceIndex: 3 }).ok); // evens it out
  assert.equal(e.state.houses[1], 1);
  assert.equal(e.state.houses[3], 1);
});

test('building deducts the per-group cost and decrements bank supply', () => {
  const e = makeEngine(); e.start();
  e.state.owners[1] = 'A'; e.state.owners[3] = 'A';
  const before = P(e, 'A').money;
  const bank = e.state.bank.houses;
  e.applyIntent('A', { type: 'BUILD_HOUSE', spaceIndex: 1 }); // brown = $50/house
  assert.equal(before - P(e, 'A').money, 50);
  assert.equal(e.state.bank.houses, bank - 1);
  const v = e.view('A');
  assert.equal(v.board[1].houses, 1);
  assert.equal(v.bank.houses, bank - 1);
});

test('the 5th building becomes a hotel and returns 4 houses to the bank', () => {
  const e = makeEngine(); e.start();
  e.state.owners[1] = 'A'; e.state.owners[3] = 'A';
  for (const i of [1, 3, 1, 3, 1, 3, 1, 3]) e.applyIntent('A', { type: 'BUILD_HOUSE', spaceIndex: i }); // 4 each
  assert.equal(e.state.houses[1], 4);
  const bankBefore = e.state.bank.houses;
  const hotelsBefore = e.state.bank.hotels;
  const r = e.applyIntent('A', { type: 'BUILD_HOUSE', spaceIndex: 1 }); // hotel
  assert.ok(r.ok);
  assert.equal(e.state.hotels[1], true);
  assert.equal(e.state.houses[1], 0);
  assert.equal(e.state.bank.houses, bankBefore + 4, '4 houses returned to bank');
  assert.equal(e.state.bank.hotels, hotelsBefore - 1);
});

test('rent uses the correct house/hotel tier', () => {
  const e = makeEngine(['A', 'B']); e.start();
  e.state.owners[1] = 'A'; e.state.owners[3] = 'A';
  e.state.houses[3] = 3; // Baltic with 3 houses → rentTable[3] = 180
  Object.assign(P(e, 'B'), { position: 0 }); e.state.current = 1; e.state.awaitingEnd = false;
  let before = P(e, 'B').money; dice(e, [1, 2]); e.applyIntent('B', { type: 'ROLL' });
  assert.equal(before - P(e, 'B').money, 180);

  e.state.houses[3] = 0; e.state.hotels[3] = true; // hotel → rentTable[5] = 450
  Object.assign(P(e, 'B'), { position: 0 }); e.state.current = 1; e.state.awaitingEnd = false;
  before = P(e, 'B').money; dice(e, [1, 2]); e.applyIntent('B', { type: 'ROLL' });
  assert.equal(before - P(e, 'B').money, 450);
});

test('bank supply exhaustion blocks building (houses and hotels)', () => {
  const e = makeEngine(); e.start();
  e.state.owners[1] = 'A'; e.state.owners[3] = 'A';
  e.state.bank.houses = 0;
  assert.equal(e.applyIntent('A', { type: 'BUILD_HOUSE', spaceIndex: 1 }).error, 'NO_HOUSES_LEFT');
  e.state.bank.houses = 32; e.state.houses[1] = 4; e.state.houses[3] = 4; e.state.bank.hotels = 0;
  assert.equal(e.applyIntent('A', { type: 'BUILD_HOUSE', spaceIndex: 1 }).error, 'NO_HOTELS_LEFT');
});

test('selling returns half cost and respects even-build in reverse', () => {
  const e = makeEngine(); e.start();
  e.state.owners[1] = 'A'; e.state.owners[3] = 'A';
  e.state.houses[1] = 2; e.state.houses[3] = 2;
  const before = P(e, 'A').money;
  const bank = e.state.bank.houses;
  assert.ok(e.applyIntent('A', { type: 'SELL_HOUSE', spaceIndex: 1 }).ok); // brown $50 → refund $25
  assert.equal(P(e, 'A').money - before, 25);
  assert.equal(e.state.houses[1], 1);
  assert.equal(e.state.bank.houses, bank + 1);
  // lot 1 now has 1, lot 3 has 2 → cannot sell from lot 1 (not the max)
  assert.equal(e.applyIntent('A', { type: 'SELL_HOUSE', spaceIndex: 1 }).error, 'UNEVEN_SELL');
});

test('selling a hotel converts it back to 4 houses (drawn from the bank)', () => {
  const e = makeEngine(); e.start();
  e.state.owners[1] = 'A'; e.state.owners[3] = 'A';
  e.state.hotels[1] = true; e.state.houses[3] = 4; // lot1 hotel (level 5) is the group max
  const before = P(e, 'A').money;
  assert.ok(e.applyIntent('A', { type: 'SELL_HOUSE', spaceIndex: 1 }).ok);
  assert.equal(e.state.hotels[1], false);
  assert.equal(e.state.houses[1], 4);
  assert.equal(P(e, 'A').money - before, 25);

  // if the bank lacks 4 houses, the hotel downgrade is rejected
  const e2 = makeEngine(); e2.start();
  e2.state.owners[1] = 'A'; e2.state.owners[3] = 'A';
  e2.state.hotels[1] = true; e2.state.houses[3] = 4; e2.state.bank.houses = 3;
  assert.equal(e2.applyIntent('A', { type: 'SELL_HOUSE', spaceIndex: 1 }).error, 'NO_HOUSES_FOR_DOWNGRADE');
});

test('INSUFFICIENT_FUNDS rejects a build the player cannot afford', () => {
  const e = makeEngine(); e.start();
  e.state.owners[37] = 'A'; e.state.owners[39] = 'A'; // darkBlue = $200/house
  P(e, 'A').money = 100;
  assert.equal(e.applyIntent('A', { type: 'BUILD_HOUSE', spaceIndex: 37 }).error, 'INSUFFICIENT_FUNDS');
  assert.equal(e.state.houses[37], 0);
  assert.equal(P(e, 'A').money, 100, 'no money spent on a rejected build');
});

test('repair cards now charge real amounts (a hotel counts as a hotel, not 4 houses)', () => {
  const e = makeEngine(); e.start();
  e.state.owners[1] = 'A'; e.state.houses[1] = 3; // 3 houses
  e.state.owners[3] = 'A'; e.state.hotels[3] = true; // 1 hotel
  setChanceTop(e, 'CH11'); // General repairs: $25/house, $100/hotel
  P(e, 'A').position = 4; dice(e, [1, 2]); // → 7 Chance
  const before = P(e, 'A').money;
  e.applyIntent('A', { type: 'ROLL' });
  assert.equal(before - P(e, 'A').money, 3 * 25 + 1 * 100); // 175
});
