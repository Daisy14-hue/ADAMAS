'use client';

import { cardGlyph, cardLabel } from '@/lib/cards';

/**
 * A single UNO card face.
 * props: card {color,type,value}, size: 'normal'|'small'|'tiny', faceDown, className
 */
export default function Card({ card, size = 'normal', faceDown = false, className = '', onClick, title }) {
  if (faceDown) {
    return (
      <div className={`deck-back ${className}`} aria-hidden>
        <div className="oval">UNO</div>
      </div>
    );
  }
  const colorClass = isWild(card) ? 'wild' : (card.color || 'wild');
  const glyph = cardGlyph(card);
  return (
    <div
      className={`uno-card ${colorClass} ${size === 'small' ? 'small' : ''} ${size === 'tiny' ? 'tiny' : ''} ${className}`}
      onClick={onClick}
      title={title || cardLabel(card)}
      role={onClick ? 'button' : undefined}
    >
      <div className="oval" />
      <span className="corner tl">{glyph}</span>
      <span className="big">{glyph}</span>
      <span className="corner br">{glyph}</span>
    </div>
  );
}

function isWild(card) {
  // A card is wild by TYPE alone — a residual `color` must not unset wild styling.
  return [
    'wild',
    'wildDraw4',
    'wildDraw6',
    'wildDraw10',
    'wildReverseDraw4',
    'wildRoulette',
    'wildDrawTwo',
    'wildDrawColor',
  ].includes(card.type);
}
// EOF Card.js
