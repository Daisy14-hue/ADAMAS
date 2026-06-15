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


// ----- Phase 3: Chance & Community Chest decks (full official effects) -----
// Each card: { id, text, effect }. `effect.kind` is interpreted by the engine.
const CHANCE_CARDS = [
  { id: 'CH1', text: 'Advance to Go (Collect $200).', effect: { kind: 'moveTo', index: 0, passGo: true } },
  { id: 'CH2', text: 'Advance to Illinois Avenue. If you pass Go, collect $200.', effect: { kind: 'moveTo', index: 24, passGo: true } },
  { id: 'CH3', text: 'Advance to St. Charles Place. If you pass Go, collect $200.', effect: { kind: 'moveTo', index: 11, passGo: true } },
  { id: 'CH4', text: 'Advance to the nearest Utility. If unowned you may buy it; if owned, throw dice and pay the owner 10× the amount thrown.', effect: { kind: 'moveToNearest', target: 'utility', payMultiplier: 10 } },
  { id: 'CH5', text: 'Advance to the nearest Railroad. If owned, pay the owner twice the rental due.', effect: { kind: 'moveToNearest', target: 'railroad', payMultiplier: 2 } },
  { id: 'CH6', text: 'Advance to the nearest Railroad. If owned, pay the owner twice the rental due.', effect: { kind: 'moveToNearest', target: 'railroad', payMultiplier: 2 } },
  { id: 'CH7', text: 'Bank pays you dividend of $50.', effect: { kind: 'collect', amount: 50 } },
  { id: 'CH8', text: 'Get Out of Jail Free.', effect: { kind: 'getOutOfJailFree' } },
  { id: 'CH9', text: 'Go Back 3 Spaces.', effect: { kind: 'moveBy', steps: -3 } },
  { id: 'CH10', text: 'Go to Jail. Do not pass Go, do not collect $200.', effect: { kind: 'goToJail' } },
  { id: 'CH11', text: 'Make general repairs on all your property: $25 per house, $100 per hotel.', effect: { kind: 'repairs', perHouse: 25, perHotel: 100 } },
  { id: 'CH12', text: 'Speeding fine $15.', effect: { kind: 'pay', amount: 15 } },
  { id: 'CH13', text: 'Take a trip to Reading Railroad. If you pass Go, collect $200.', effect: { kind: 'moveTo', index: 5, passGo: true } },
  { id: 'CH14', text: 'Advance to Boardwalk.', effect: { kind: 'moveTo', index: 39, passGo: false } },
  { id: 'CH15', text: 'You have been elected Chairman of the Board. Pay each player $50.', effect: { kind: 'payEach', amount: 50 } },
  { id: 'CH16', text: 'Your building loan matures. Collect $150.', effect: { kind: 'collect', amount: 150 } },
];

const COMMUNITY_CARDS = [
  { id: 'CC1', text: 'Advance to Go (Collect $200).', effect: { kind: 'moveTo', index: 0, passGo: true } },
  { id: 'CC2', text: 'Bank error in your favor. Collect $200.', effect: { kind: 'collect', amount: 200 } },
  { id: 'CC3', text: "Doctor's fee. Pay $50.", effect: { kind: 'pay', amount: 50 } },
  { id: 'CC4', text: 'From sale of stock you get $50.', effect: { kind: 'collect', amount: 50 } },
  { id: 'CC5', text: 'Get Out of Jail Free.', effect: { kind: 'getOutOfJailFree' } },
  { id: 'CC6', text: 'Go to Jail. Do not pass Go, do not collect $200.', effect: { kind: 'goToJail' } },
  { id: 'CC7', text: 'Holiday fund matures. Collect $100.', effect: { kind: 'collect', amount: 100 } },
  { id: 'CC8', text: 'Income tax refund. Collect $20.', effect: { kind: 'collect', amount: 20 } },
  { id: 'CC9', text: 'It is your birthday. Collect $10 from every player.', effect: { kind: 'collectFromEach', amount: 10 } },
  { id: 'CC10', text: 'Life insurance matures. Collect $100.', effect: { kind: 'collect', amount: 100 } },
  { id: 'CC11', text: 'Pay hospital fees of $100.', effect: { kind: 'pay', amount: 100 } },
  { id: 'CC12', text: 'Pay school fees of $50.', effect: { kind: 'pay', amount: 50 } },
  { id: 'CC13', text: 'Receive $25 consultancy fee.', effect: { kind: 'collect', amount: 25 } },
  { id: 'CC14', text: 'You are assessed for street repairs: $40 per house, $115 per hotel.', effect: { kind: 'repairs', perHouse: 40, perHotel: 115 } },
  { id: 'CC15', text: 'You have won second prize in a beauty contest. Collect $10.', effect: { kind: 'collect', amount: 10 } },
  { id: 'CC16', text: 'You inherit $100.', effect: { kind: 'collect', amount: 100 } },
];

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
  CHANCE_CARDS,
  COMMUNITY_CARDS,
  DEFAULT_CONFIG,
};
