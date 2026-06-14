'use strict';

/**
 * ADAMAS — Monopoly Phase 1 constants.
 *
 * Authoritative source: ADAMAS_MONOPOLY_PHASE1_SPEC.md. Phase 1 is the turning
 * skeleton only: the 40-space classic US board, money, dice/doubles, movement,
 * pass-Go (+$200), and go-to-jail. NO buying/rent/cards/tax/building/trading —
 * landings are ANNOUNCE-ONLY (except Go and Go-To-Jail). Property color/price
 * data is included for LATER phases but is NOT used by Phase 1 logic.
 */

const START_MONEY = 1500;
const PASS_GO = 200;
const JAIL_INDEX = 10;
const GO_TO_JAIL_INDEX = 30;
const JAIL_FEE = 50;
const JAIL_MAX_TURNS = 3;
const BOARD_SIZE = 40;

// Each space: { index, name, type, color?, amount? }.
// type ∈ go|property|railroad|utility|tax|chance|communityChest|jail|goToJail|freeParking
const BOARD = [
  { index: 0, name: 'Go', type: 'go' },
  { index: 1, name: 'Mediterranean Avenue', type: 'property', color: 'brown' },
  { index: 2, name: 'Community Chest', type: 'communityChest' },
  { index: 3, name: 'Baltic Avenue', type: 'property', color: 'brown' },
  { index: 4, name: 'Income Tax', type: 'tax', amount: 200 },
  { index: 5, name: 'Reading Railroad', type: 'railroad' },
  { index: 6, name: 'Oriental Avenue', type: 'property', color: 'lightBlue' },
  { index: 7, name: 'Chance', type: 'chance' },
  { index: 8, name: 'Vermont Avenue', type: 'property', color: 'lightBlue' },
  { index: 9, name: 'Connecticut Avenue', type: 'property', color: 'lightBlue' },
  { index: 10, name: 'Jail / Just Visiting', type: 'jail' },
  { index: 11, name: 'St. Charles Place', type: 'property', color: 'pink' },
  { index: 12, name: 'Electric Company', type: 'utility' },
  { index: 13, name: 'States Avenue', type: 'property', color: 'pink' },
  { index: 14, name: 'Virginia Avenue', type: 'property', color: 'pink' },
  { index: 15, name: 'Pennsylvania Railroad', type: 'railroad' },
  { index: 16, name: 'St. James Place', type: 'property', color: 'orange' },
  { index: 17, name: 'Community Chest', type: 'communityChest' },
  { index: 18, name: 'Tennessee Avenue', type: 'property', color: 'orange' },
  { index: 19, name: 'New York Avenue', type: 'property', color: 'orange' },
  { index: 20, name: 'Free Parking', type: 'freeParking' },
  { index: 21, name: 'Kentucky Avenue', type: 'property', color: 'red' },
  { index: 22, name: 'Chance', type: 'chance' },
  { index: 23, name: 'Indiana Avenue', type: 'property', color: 'red' },
  { index: 24, name: 'Illinois Avenue', type: 'property', color: 'red' },
  { index: 25, name: 'B&O Railroad', type: 'railroad' },
  { index: 26, name: 'Atlantic Avenue', type: 'property', color: 'yellow' },
  { index: 27, name: 'Ventnor Avenue', type: 'property', color: 'yellow' },
  { index: 28, name: 'Water Works', type: 'utility' },
  { index: 29, name: 'Marvin Gardens', type: 'property', color: 'yellow' },
  { index: 30, name: 'Go To Jail', type: 'goToJail' },
  { index: 31, name: 'Pacific Avenue', type: 'property', color: 'green' },
  { index: 32, name: 'North Carolina Avenue', type: 'property', color: 'green' },
  { index: 33, name: 'Community Chest', type: 'communityChest' },
  { index: 34, name: 'Pennsylvania Avenue', type: 'property', color: 'green' },
  { index: 35, name: 'Short Line Railroad', type: 'railroad' },
  { index: 36, name: 'Chance', type: 'chance' },
  { index: 37, name: 'Park Place', type: 'property', color: 'darkBlue' },
  { index: 38, name: 'Luxury Tax', type: 'tax', amount: 100 },
  { index: 39, name: 'Boardwalk', type: 'property', color: 'darkBlue' },
];

if (BOARD.length !== BOARD_SIZE) {
  throw new Error(`Monopoly board invariant violated: ${BOARD.length} spaces, expected ${BOARD_SIZE}.`);
}

// Phase 1 has no meaningful config (starting money is fixed). Kept shape-compatible.
const DEFAULT_CONFIG = {};

module.exports = {
  START_MONEY,
  PASS_GO,
  JAIL_INDEX,
  GO_TO_JAIL_INDEX,
  JAIL_FEE,
  JAIL_MAX_TURNS,
  BOARD_SIZE,
  BOARD,
  DEFAULT_CONFIG,
};
