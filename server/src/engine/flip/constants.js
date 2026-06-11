'use strict';

/**
 * ADAMAS — UNO Flip engine constants (double-sided deck).
 *
 * Authoritative source: ADAMAS_FLIP_SPEC.md. This is an ADAMAS variant of the
 * official UNO Flip — same 112-card double-sided deck, but with the ADAMAS
 * custom stacking + reverse-deflection rules (official Flip has no stacking).
 *
 * Each PHYSICAL card has two faces: light and dark. The engine tracks a global
 * `side` and always evaluates playability/colour/effects on the ACTIVE face.
 */

const LIGHT_COLORS = ['red', 'yellow', 'green', 'blue'];
const DARK_COLORS = ['pink', 'teal', 'orange', 'purple'];
const COLORS_BY_SIDE = { light: LIGHT_COLORS, dark: DARK_COLORS };
const ALL_COLORS = [...LIGHT_COLORS, ...DARK_COLORS];

const TYPE = {
  NUMBER: 'number',
  SKIP: 'skip',
  REVERSE: 'reverse',
  SKIP_EVERYONE: 'skipEveryone', // dark only
  FLIP: 'flip',
  DRAW_ONE: 'drawOne', // light colored draw, value 1
  DRAW_FIVE: 'drawFive', // dark colored draw, value 5
  WILD: 'wild',
  WILD_DRAW_TWO: 'wildDrawTwo', // light wild draw, value 2
  WILD_DRAW_COLOR: 'wildDrawColor', // dark wild draw, value 5, draw-until-colour
};

// Stacking values (ADAMAS spec 2.7). Light and dark never mix in one stack.
const DRAW_VALUE = {
  [TYPE.DRAW_ONE]: 1,
  [TYPE.WILD_DRAW_TWO]: 2,
  [TYPE.DRAW_FIVE]: 5,
  [TYPE.WILD_DRAW_COLOR]: 5,
};

const WILD_TYPES = new Set([TYPE.WILD, TYPE.WILD_DRAW_TWO, TYPE.WILD_DRAW_COLOR]);
const COLORED_DRAWS = new Set([TYPE.DRAW_ONE, TYPE.DRAW_FIVE]); // deflectable
const WILD_DRAWS = new Set([TYPE.WILD_DRAW_TWO, TYPE.WILD_DRAW_COLOR]); // not deflectable
// Symbol-matchable colored action types (per active face).
const COLORED_ACTION_TYPES = new Set([
  TYPE.SKIP,
  TYPE.REVERSE,
  TYPE.SKIP_EVERYONE,
  TYPE.FLIP,
  TYPE.DRAW_ONE,
  TYPE.DRAW_FIVE,
]);

const isWild = (face) => WILD_TYPES.has(face.type);
const isColoredDraw = (face) => COLORED_DRAWS.has(face.type);
const isWildDraw = (face) => WILD_DRAWS.has(face.type);
const isDrawCard = (face) => isColoredDraw(face) || isWildDraw(face);
const isReverse = (face) => face.type === TYPE.REVERSE;
const isFlip = (face) => face.type === TYPE.FLIP;
const drawValueOf = (face) => DRAW_VALUE[face.type] || 0;

/**
 * DECK_SPEC — per-side face composition. Each side independently totals 112
 * faces; pairing into 112 physical cards happens in deck.js (by category, so a
 * physical card is number/number, action/action, wild/wild or flip/flip — like
 * the real product). Mattel's exact split isn't published per-card, so these
 * counts are an ADAMAS choice that totals 112 per side (mirrors No Mercy).
 *
 *   Light: 76 numbers + (DrawOne8 + Skip8 + Reverse8 + Flip4 = 28 actions)
 *          + (Wild4 + WildDrawTwo4 = 8 wild) = 112
 *   Dark:  76 numbers + (DrawFive8 + Reverse8 + SkipEveryone8 + Flip4 = 28)
 *          + (Wild4 + WildDrawColor4 = 8 wild) = 112
 */
const DECK_SPEC = {
  light: {
    colors: LIGHT_COLORS,
    numbers: { zeroCount: 1, oneToNineCount: 2 }, // 19 per colour
    actions: { [TYPE.DRAW_ONE]: 2, [TYPE.SKIP]: 2, [TYPE.REVERSE]: 2, [TYPE.FLIP]: 1 },
    wilds: { [TYPE.WILD]: 4, [TYPE.WILD_DRAW_TWO]: 4 },
  },
  dark: {
    colors: DARK_COLORS,
    numbers: { zeroCount: 1, oneToNineCount: 2 },
    actions: { [TYPE.DRAW_FIVE]: 2, [TYPE.REVERSE]: 2, [TYPE.SKIP_EVERYONE]: 2, [TYPE.FLIP]: 1 },
    wilds: { [TYPE.WILD]: 4, [TYPE.WILD_DRAW_COLOR]: 4 },
  },
};

const DECK_SIZE = 112;

module.exports = {
  LIGHT_COLORS,
  DARK_COLORS,
  COLORS_BY_SIDE,
  ALL_COLORS,
  TYPE,
  DRAW_VALUE,
  WILD_TYPES,
  COLORED_DRAWS,
  WILD_DRAWS,
  COLORED_ACTION_TYPES,
  DECK_SPEC,
  DECK_SIZE,
  isWild,
  isColoredDraw,
  isWildDraw,
  isDrawCard,
  isReverse,
  isFlip,
  drawValueOf,
};
