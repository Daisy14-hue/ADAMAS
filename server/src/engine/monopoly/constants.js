'use strict';

/**
 * ADAMAS — Monopoly constants (Phase 1 + Phase 2).
 *
 * Phase 1: 40-space classic US board, money, dice/doubles, movement, pass-Go,
 * go-to-jail. Phase 2 ADDS official prices + rent tables to ownable spaces and
 * the rules for buying/rent. Houses/trading/mortgaging/auctions/bankruptcy and
 * tax/Chance/Community-Chest effects are LATER phases (announce-only for now).
 *
 * Each property's `rentTable` is [base, 1house, 2, 3, 4, hotel] (official). Phase
 * 2 only uses index 0 (base), doubled when the owner holds the full color group
 * with nothing built. The full tables are included now for later phases.
 */

const START_MONEY = 1500;
const PASS_GO = 200;
const JAIL_INDEX = 10;
const GO_TO_JAIL_INDEX = 30;
const JAIL_FEE = 50;
const JAIL_MAX_TURNS = 3;
const BOARD_SIZE = 40;

const RAILROAD_PRICE = 200;
const UTILITY_PRICE = 150;
// Railroad rent by number of railroads the owner holds.
const RAILROAD_RENTS = { 1: 25, 2: 50, 3: 100, 4: 200 };
// Utility rent multiplier on the dice total, by utilities owned.
const UTILITY_MULT = { 1: 4, 2: 10 };

const OWNABLE_TYPES = new Set(['property', 'railroad', 'utility']);

const prop = (index, name, color, price, rentTable) => ({
  index, name, type: 'property', color, colorGroup: color, price, baseRent: rentTable[0], rentTable,
});
const rail = (index, name) => ({ index, name, type: 'railroad', price: RAILROAD_PRICE });
const util = (index, name) => ({ index, name, type: 'utility', price: UTILITY_PRICE });

const BOARD = [
  { index: 0, name: 'Go', type: 'go' },
  prop(1, 'Mediterranean Avenue', 'brown', 60, [2, 10, 30, 90, 160, 250]),
  { index: 2, name: 'Community Chest', type: 'communityChest' },
  prop(3, 'Baltic Avenue', 'brown', 60, [4, 20, 60, 180, 320, 450]),
  { index: 4, name: 'Income Tax', type: 'tax', amount: 200 },
  rail(5, 'Reading Railroad'),
  prop(6, 'Oriental Avenue', 'lightBlue', 100, [6, 30, 90, 270, 400, 550]),
  { index: 7, name: 'Chance', type: 'chance' },
  prop(8, 'Vermont Avenue', 'lightBlue', 100, [6, 30, 90, 270, 400, 550]),
  prop(9, 'Connecticut Avenue', 'lightBlue', 120, [8, 40, 100, 300, 450, 600]),
  { index: 10, name: 'Jail / Just Visiting', type: 'jail' },
  prop(11, 'St. Charles Place', 'pink', 140, [10, 50, 150, 450, 625, 750]),
  util(12, 'Electric Company'),
  prop(13, 'States Avenue', 'pink', 140, [10, 50, 150, 450, 625, 750]),
  prop(14, 'Virginia Avenue', 'pink', 160, [12, 60, 180, 500, 700, 900]),
  rail(15, 'Pennsylvania Railroad'),
  prop(16, 'St. James Place', 'orange', 180, [14, 70, 200, 550, 750, 950]),
  { index: 17, name: 'Community Chest', type: 'communityChest' },
  prop(18, 'Tennessee Avenue', 'orange', 180, [14, 70, 200, 550, 750, 950]),
  prop(19, 'New York Avenue', 'orange', 200, [16, 80, 220, 600, 800, 1000]),
  { index: 20, name: 'Free Parking', type: 'freeParking' },
  prop(21, 'Kentucky Avenue', 'red', 220, [18, 90, 250, 700, 875, 1050]),
  { index: 22, name: 'Chance', type: 'chance' },
  prop(23, 'Indiana Avenue', 'red', 220, [18, 90, 250, 700, 875, 1050]),
  prop(24, 'Illinois Avenue', 'red', 240, [20, 100, 300, 750, 925, 1100]),
  rail(25, 'B&O Railroad'),
  prop(26, 'Atlantic Avenue', 'yellow', 260, [22, 110, 330, 800, 975, 1150]),
  prop(27, 'Ventnor Avenue', 'yellow', 260, [22, 110, 330, 800, 975, 1150]),
  util(28, 'Water Works'),
  prop(29, 'Marvin Gardens', 'yellow', 280, [24, 120, 360, 850, 1025, 1200]),
  { index: 30, name: 'Go To Jail', type: 'goToJail' },
  prop(31, 'Pacific Avenue', 'green', 300, [26, 130, 390, 900, 1100, 1275]),
  prop(32, 'North Carolina Avenue', 'green', 300, [26, 130, 390, 900, 1100, 1275]),
  { index: 33, name: 'Community Chest', type: 'communityChest' },
  prop(34, 'Pennsylvania Avenue', 'green', 320, [28, 150, 450, 1000, 1200, 1400]),
  rail(35, 'Short Line Railroad'),
  { index: 36, name: 'Chance', type: 'chance' },
  prop(37, 'Park Place', 'darkBlue', 350, [35, 175, 500, 1100, 1300, 1500]),
  { index: 38, name: 'Luxury Tax', type: 'tax', amount: 100 },
  prop(39, 'Boardwalk', 'darkBlue', 400, [50, 200, 600, 1400, 1700, 2000]),
];

if (BOARD.length !== BOARD_SIZE) {
  throw new Error(`Monopoly board invariant violated: ${BOARD.length} spaces, expected ${BOARD_SIZE}.`);
}

const DEFAULT_CONFIG = {};

module.exports = {
  START_MONEY,
  PASS_GO,
  JAIL_INDEX,
  GO_TO_JAIL_INDEX,
  JAIL_FEE,
  JAIL_MAX_TURNS,
  BOARD_SIZE,
  RAILROAD_PRICE,
  UTILITY_PRICE,
  RAILROAD_RENTS,
  UTILITY_MULT,
  OWNABLE_TYPES,
  BOARD,
  DEFAULT_CONFIG,
};
