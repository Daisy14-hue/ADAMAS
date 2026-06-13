'use strict';

/**
 * ADAMAS — UNO Spin engine constants.
 *
 * Authoritative source: ADAMAS_SPIN_SPEC.md. Classic UNO (numbers + Skip,
 * Reverse, Draw 2, Wild, Wild Draw 4) — NO stacking, NO deflection — PLUS a
 * colored "Spin" card that forces the NEXT player to spin a 12-segment wheel.
 * Win by emptying your hand. Shared "draw one / PASS" rule.
 */

const COLORS = ['red', 'yellow', 'green', 'blue'];

const TYPE = {
  NUMBER: 'number',
  SKIP: 'skip',
  REVERSE: 'reverse',
  DRAW2: 'draw2',
  WILD: 'wild',
  WILD_DRAW4: 'wildDraw4',
  SPIN: 'spin', // colored; matches by colour/symbol; forces next player to spin
};

const WILD_TYPES = new Set([TYPE.WILD, TYPE.WILD_DRAW4]);
// Symbol-matchable colored action types (Spin matches like Skip/Reverse).
const COLORED_ACTION_TYPES = new Set([TYPE.SKIP, TYPE.REVERSE, TYPE.DRAW2, TYPE.SPIN]);

const isWild = (card) => WILD_TYPES.has(card.type);
const needsColor = (card) => WILD_TYPES.has(card.type);

/**
 * The 12 wheel segments (order = how the client lays out segments). The server
 * picks one uniformly at random on each spin. ids are 1..12 (match the spec).
 *   1-9  : official outcomes
 *   10-12: ADAMAS custom outcomes
 */
const OUTCOMES = [
  { id: 1, key: 'almostUno', label: 'Almost UNO', choice: 'almostUno' },
  { id: 2, key: 'discardNumber', label: 'Discard a Number', choice: 'discardNumber' },
  { id: 3, key: 'discardColor', label: 'Discard a Color', choice: 'discardColor' },
  { id: 4, key: 'drawRed', label: 'Draw until Red', color: 'red' },
  { id: 5, key: 'drawBlue', label: 'Draw until Blue', color: 'blue' },
  { id: 6, key: 'drawGreen', label: 'Draw until Green', color: 'green' },
  { id: 7, key: 'drawYellow', label: 'Draw until Yellow', color: 'yellow' },
  { id: 8, key: 'tradeHands', label: 'Trade Hands' },
  { id: 9, key: 'unoSpinRace', label: 'UNO Spin!' },
  { id: 10, key: 'everyoneDraws1', label: 'Everyone Draws 1' }, // custom
  { id: 11, key: 'swapLeader', label: 'Swap with Leader' }, // custom
  { id: 12, key: 'draw4', label: 'Draw 4' }, // custom
];
const OUTCOME_BY_ID = Object.fromEntries(OUTCOMES.map((o) => [o.id, o]));

const RACE_WINDOW_MS = 5000;

/**
 * DECK_SPEC — standard 108-card UNO deck + 8 Spin cards (2 per colour) = 116.
 *   Numbers:  4 × (one 0 + two each 1-9) = 76
 *   Actions:  4 × (Skip 2 + Reverse 2 + Draw2 2) = 24
 *   Spin:     4 × 2 = 8
 *   Wilds:    Wild 4 + Wild Draw 4 = 8
 *   TOTAL = 76 + 24 + 8 + 8 = 116
 * (Spin-card count is an ADAMAS choice; assert total === 116 on build.)
 */
const DECK_SPEC = {
  perColor: {
    numbers: { zeroCount: 1, oneToNineCount: 2 },
    actions: { [TYPE.SKIP]: 2, [TYPE.REVERSE]: 2, [TYPE.DRAW2]: 2, [TYPE.SPIN]: 2 },
  },
  wilds: { [TYPE.WILD]: 4, [TYPE.WILD_DRAW4]: 4 },
};
const DECK_SIZE = 116;

module.exports = {
  COLORS,
  TYPE,
  WILD_TYPES,
  COLORED_ACTION_TYPES,
  OUTCOMES,
  OUTCOME_BY_ID,
  RACE_WINDOW_MS,
  DECK_SPEC,
  DECK_SIZE,
  isWild,
  needsColor,
};
