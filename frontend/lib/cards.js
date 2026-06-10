// Pure helpers for rendering UNO No Mercy cards in the UI.

export const COLOR_HEX = {
  red: '#e2433b',
  yellow: '#f5b914',
  green: '#36a85a',
  blue: '#2b7fd6',
};

export const WILD_TYPES = new Set([
  'wild',
  'wildDraw4',
  'wildDraw6',
  'wildDraw10',
  'wildReverseDraw4',
  'wildRoulette',
]);

const COLOR_ACTIONS = new Set(['skip', 'reverse', 'draw2', 'skipEveryone', 'discardAll']);

export function isWildType(type) {
  return WILD_TYPES.has(type);
}

export function needsColor(card) {
  return WILD_TYPES.has(card.type) && card.type !== 'wildRoulette';
}

/** Short glyph shown big in the card center. */
export function cardGlyph(card) {
  switch (card.type) {
    case 'number': return String(card.value);
    case 'skip': return 'Ø';            // Ø
    case 'reverse': return '⇄';         // ⇄
    case 'draw2': return '+2';
    case 'skipEveryone': return '⦰';    // skip-all-ish
    case 'discardAll': return '⤓';      // dump down arrow
    case 'wild': return 'W';
    case 'wildDraw4': return '+4';
    case 'wildDraw6': return '+6';
    case 'wildDraw10': return '+10';
    case 'wildReverseDraw4': return '⇄+4';
    case 'wildRoulette': return '◎';    // ◎ roulette
    default: return '?';
  }
}

/** Human label for tooltips / accessibility. */
export function cardLabel(card) {
  const color = card.color ? card.color[0].toUpperCase() + card.color.slice(1) : 'Wild';
  const names = {
    number: `${card.value}`,
    skip: 'Skip',
    reverse: 'Reverse',
    draw2: 'Draw 2',
    skipEveryone: 'Skip Everyone',
    discardAll: 'Discard All',
    wild: 'Wild',
    wildDraw4: 'Wild Draw 4',
    wildDraw6: 'Wild Draw 6',
    wildDraw10: 'Wild Draw 10',
    wildReverseDraw4: 'Wild Reverse Draw 4',
    wildRoulette: 'Wild Color Roulette',
  };
  return `${color} ${names[card.type] || card.type}`;
}

/** Mirror of the server's normal-play legality (for UI highlighting only;
 * the server remains authoritative). */
export function isPlayable(card, view) {
  if (!view) return false;
  // During an active draw-stack, the only card plays are ascending draws or a
  // qualifying reverse — keep the hand highlight simple and permissive; the
  // server rejects anything illegal.
  if (view.drawStack && view.drawStack.active) {
    if (card.type === 'draw2' || card.type.startsWith('wildDraw') || card.type === 'wildReverseDraw4') {
      return (card.value || drawValue(card)) >= (view.drawStack.lastValue || 0);
    }
    if (card.type === 'reverse') return true; // server validates color/chain
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
  const map = { draw2: 2, wildDraw4: 4, wildReverseDraw4: 4, wildDraw6: 6, wildDraw10: 10 };
  return map[card.type] || 0;
}
// EOF cards.js
