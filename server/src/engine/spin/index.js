'use strict';
const constants = require('./constants');
const deck = require('./deck');
const { SpinEngine, DEFAULT_CONFIG } = require('./SpinEngine');
module.exports = {
  ...constants,
  buildDeck: deck.buildDeck, shuffle: deck.shuffle, makeRng: deck.makeRng,
  SpinEngine, DEFAULT_CONFIG,
};
