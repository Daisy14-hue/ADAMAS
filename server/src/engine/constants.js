'use strict';

/**
 * ADAMAS — UNO No Mercy engine constants.
 *
 * This file is the single source of truth for card types, the deck
 * composition, and the small predicate/helper functions the engine relies on.
 *
 * IMPORTANT — ADAMAS variant vs. official Mattel "Show 'Em No Mercy":
 *  - 0 and 7 are PLAIN NUMBER cards here (house rule). The official game uses
 *    7=Swap hands and 0=Pass hands; ADAMAS explicitly overrides that.
 *  - The ONLY colored draw card is Draw 2. Draw 4/6/10 and Reverse+4 are WILD
 *    (the official sheet prints Draw 4 as a colored card). ADAMAS spec 4.3.
 *  - ADAMAS additionally includes plain Wild and Wild Draw 4 in the wild set.
 *  - Mattel never published exact per-card quantities, so the counts below are
 *    chosen by ADAMAS to total EXACTLY 168 and live in one place (DECK_SPEC).
 */

const COLORS = ['red', 'yellow', 'green', 'blue'];

// Card "type" tags. `value` on a card means: number value for numbers, and the
// stacking/draw value for draw cards.
const TYPE = {
  NUMBER: 'number',
  SKIP: 'skip',
  REVERSE: 'reverse',
  DRAW2: 'draw2',
  SKIP_EVERYONE: 'skipEveryone',
  DISCARD_ALL: 'discardAll',
  WILD: 'wild',
  WILD_DRAW4: 'wildDraw4',
  WILD_DRAW6: 'wildDraw6',
  WILD_DRAW10: 'wildDraw10',
  WILD_REVERSE_DRAW4: 'wildReverseDraw4',
  WILD_ROULETTE: 'wildRoulette',
};

// Stacking values (ADAMAS 4.7 / Appendix A §1).
const DRAW_VALUE = {
  [TYPE.DRAW2]: 2,
  [TYPE.WILD_DRAW4]: 4,
  [TYPE.WILD_REVERSE_DRAW4]: 4,
  [TYPE.WILD_DRAW6]: 6,
  [TYPE.WILD_DRAW10]: 10,
};

const WILD_TYPES = new Set([
  TYPE.WILD,
  TYPE.WILD_DRAW4,
  TYPE.WILD_DRAW6,
  TYPE.WILD_DRAW10,
  TYPE.WILD_REVERSE_DRAW4,
  TYPE.WILD_ROULETTE,
]);

// The matchable "symbol" action types (colored, non-draw distinctions matter
// for symbol-matching when playing onto the discard pile).
const COLORED_ACTION_TYPES = new Set([
  TYPE.SKIP,
  TYPE.REVERSE,
  TYPE.DRAW2,
  TYPE.SKIP_EVERYONE,
  TYPE.DISCARD_ALL,
]);

/**
 * DECK_SPEC — composition that sums to EXACTLY 168.
 *
 *   Numbers:          4 colors × (one 0 + two each of 1-9) = 4 × 19 = 76
 *   Colored actions:  4 colors × (Skip3 Rev3 Draw2-3 SkipEvery2 DiscardAll1) = 4 × 12 = 48
 *   Wilds:            Wild4 + WildDraw4-8 + WildDraw6-8 + WildDraw10-8
 *                     + WildReverseDraw4-8 + WildRoulette-8 = 44
 *   TOTAL = 76 + 48 + 44 = 168
 *
 * (Per-card counts are an ADAMAS design choice — Mattel never published them.
 *  Change them here; the deck builder asserts the total is still 168.)
 */
const DECK_SPEC = {
  perColor: {
    numbers: { zeroCount: 1, oneToNineCount: 2 }, // 1 + 9*2 = 19
    actions: {
      [TYPE.SKIP]: 3,
      [TYPE.REVERSE]: 3,
      [TYPE.DRAW2]: 3,
      [TYPE.SKIP_EVERYONE]: 2,
      [TYPE.DISCARD_ALL]: 1,
    },
  },
  wilds: {
    [TYPE.WILD]: 4,
    [TYPE.WILD_DRAW4]: 8,
    [TYPE.WILD_DRAW6]: 8,
    [TYPE.WILD_DRAW10]: 8,
    [TYPE.WILD_REVERSE_DRAW4]: 8,
    [TYPE.WILD_ROULETTE]: 8,
  },
};

const DECK_SIZE = 168;

// ---- predicates -----------------------------------------------------------

const isWild = (card) => WILD_TYPES.has(card.type);

// The only colored draw card is Draw 2 (ADAMAS 4.3). This is what can be
// reverse-deflected (4.6).
const isColoredDraw = (card) => card.type === TYPE.DRAW2;

const isWildDraw = (card) =>
  card.type === TYPE.WILD_DRAW4 ||
  card.type === TYPE.WILD_DRAW6 ||
  card.type === TYPE.WILD_DRAW10 ||
  card.type === TYPE.WILD_REVERSE_DRAW4;

const isDrawCard = (card) => isColoredDraw(card) || isWildDraw(card);

const isReverse = (card) => card.type === TYPE.REVERSE;

const drawValueOf = (card) => DRAW_VALUE[card.type] || 0;

module.exports = {
  COLORS,
  TYPE,
  DRAW_VALUE,
  WILD_TYPES,
  COLORED_ACTION_TYPES,
  DECK_SPEC,
  DECK_SIZE,
  isWild,
  isColoredDraw,
  isWildDraw,
  isDrawCard,
  isReverse,
  drawValueOf,
};
