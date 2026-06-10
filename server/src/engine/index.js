'use strict';

const constants = require('./constants');
const deck = require('./deck');
const { NoMercyEngine, DEFAULT_CONFIG } = require('./NoMercyEngine');

module.exports = {
  ...constants,
  buildDeck: deck.buildDeck,
  shuffle: deck.shuffle,
  makeRng: deck.makeRng,
  NoMercyEngine,
  DEFAULT_CONFIG,
};
