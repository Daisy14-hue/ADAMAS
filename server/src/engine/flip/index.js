'use strict';

const constants = require('./constants');
const deck = require('./deck');
const { FlipEngine, DEFAULT_CONFIG } = require('./FlipEngine');

module.exports = {
  ...constants,
  buildDeck: deck.buildDeck,
  shuffle: deck.shuffle,
  makeRng: deck.makeRng,
  FlipEngine,
  DEFAULT_CONFIG,
};
