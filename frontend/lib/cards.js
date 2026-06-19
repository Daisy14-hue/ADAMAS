// Pure helpers for rendering cards for BOTH games (No Mercy + Flip).
// The server is authoritative; these helpers only drive display + highlighting.

export const COLOR_HEX = {
  red: '#e2433b', yellow: '#f5b914', green: '#36a85a', blue: '#2b7fd6',
  pink: '#e85aa8', teal: '#27b3b0', orange: '#e8893a', purple: '#8b5cf6',
};

export const LIGHT_COLORS = ['red', 'yellow', 'green', 'blue'];
export const DARK_COLORS = ['pink', 'teal', 'orange', 'purple'];

// All wild types across both games.
export const WILD_TYPES = new Set([
  'wild', 'wildDraw4', 'wildDraw6', 'wildDraw10', 'wildReverseDraw4', 'wildRoulette', // No Mercy
  'wildDrawTwo', 'wildDrawColor', // Flip
]);

// All draw-card types across both games.
export const DRAW_TYPES = new Set([
  'draw2', 'wildDraw4', 'wildDraw6', 'wildDraw10', 'wildReverseDraw4', // No Mercy
  'drawOne', 'drawFive', 'wildDrawTwo', 'wildDrawColor', // Flip
]);

// Colored, symbol-matchable action types across both games.
const COLOR_ACTIONS = new Set([
  'skip', 'reverse', 'draw2', 'skipEveryone', 'discardAll', // No Mercy
  'drawOne', 'drawFive', 'flip', // Flip (skip/reverse/skipEveryone shared)
  'spin', // spin
]);

export function isWildType(type) {
  return WILD_TYPES.has(type);
}

// Wilds need a chosen colour, except No Mercy's roulette (which calls a colour
// via a separate prompt). Flip's wildDrawColor DOES need a colour (the target).
export function needsColor(card) {
  return WILD_TYPES.has(card.type) && card.type !== 'wildRoulette';
}

export function cardGlyph(card) {
  switch (card.type) {
    case 'number': return String(card.value);
    case 'skip': return 'Ø';
    case 'reverse': return '⇄';
    case 'draw2': return '+2';
    case 'skipEveryone': return '⦰';
    case 'discardAll': return '⤓';
    case 'flip': return '⇅';
    case 'drawOne': return '+1';
    case 'drawFive': return '+5';
    case 'spin': return '🎡';
    case 'wild': return 'W';
    case 'wildDraw4': return '+4';
    case 'wildDraw6': return '+6';
    case 'wildDraw10': return '+10';
    case 'wildReverseDraw4': return '⇄+4';
    case 'wildRoulette': return '◎';
    case 'wildDrawTwo': return '+2';
    case 'wildDrawColor': return 'C+';
    default: return '?';
  }
}

export function cardLabel(card) {
  const color = card.color ? card.color[0].toUpperCase() + card.color.slice(1) : 'Wild';
  const names = {
    number: `${card.value}`,
    skip: 'Skip', reverse: 'Reverse', draw2: 'Draw 2', skipEveryone: 'Skip Everyone',
    discardAll: 'Discard All', flip: 'Flip', drawOne: 'Draw One', drawFive: 'Draw Five', spin: 'Spin',
    wild: 'Wild', wildDraw4: 'Wild Draw 4', wildDraw6: 'Wild Draw 6', wildDraw10: 'Wild Draw 10',
    wildReverseDraw4: 'Wild Reverse Draw 4', wildRoulette: 'Wild Color Roulette',
    wildDrawTwo: 'Wild Draw Two', wildDrawColor: 'Wild Draw Color',
  };
  return `${color} ${names[card.type] || card.type}`;
}

/** Highlight mirror (server still decides legality). Works for both games. */
export function isPlayable(card, view) {
  if (!view) return false;
  if (view.drawStack && view.drawStack.active) {
    if (DRAW_TYPES.has(card.type)) {
      const v = drawValue(card);
      return v >= (view.drawStack.lastValue || 0);
    }
    if (card.type === 'reverse') return true; // server validates colour/chain
    return false;
  }
  if (WILD_TYPES.has(card.type)) return true;
  if (card.color === view.activeColor) return true;
  const top = view.topCard;
  if (!top) return true;
  if (top.type === 'number' && card.type === 'number' && card.value === top.value) return true;
  if (COLOR_ACTIONS.has(card.type) && card.type === top.type) return true;
  return false;
}

export function drawValue(card) {
  const map = {
    draw2: 2, wildDraw4: 4, wildReverseDraw4: 4, wildDraw6: 6, wildDraw10: 10,
    drawOne: 1, wildDrawTwo: 2, drawFive: 5, wildDrawColor: 5,
  };
  return map[card.type] || 0;
}
// EOF cards.js
