'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Card from './Card';
import { isPlayable, needsColor } from '@/lib/cards';

const COLORS = ['red', 'yellow', 'green', 'blue'];

export default function GameBoard({ view, playerId, onIntent, onLeave }) {
  const me = view.players.find((p) => p.isYou) || { hand: [] };
  const opponents = view.players.filter((p) => !p.isYou);
  const myTurn = view.currentPlayerId === playerId && view.status === 'playing';
  const stack = view.drawStack || { active: false, total: 0 };

  const [picker, setPicker] = useState(null); // { mode:'wild'|'roulette', card }
  const [shuffling, setShuffling] = useState(false);
  const prevTotal = useRef(stack.total);
  const prevDiscardCount = useRef(view.discardPileCount);

  // Shuffle animation when the deck recycles (discard count drops sharply).
  useEffect(() => {
    if (view.discardPileCount < prevDiscardCount.current - 2) {
      setShuffling(true);
      const t = setTimeout(() => setShuffling(false), 800);
      return () => clearTimeout(t);
    }
    prevDiscardCount.current = view.discardPileCount;
  }, [view.discardPileCount]);

  const stackFlash = stack.total !== prevTotal.current;
  useEffect(() => { prevTotal.current = stack.total; }, [stack.total]);

  const playCard = (card) => {
    if (!myTurn) return;
    if (!isPlayable(card, view)) return;
    if (card.type === 'wildRoulette') { setPicker({ mode: 'roulette', card }); return; }
    if (needsColor(card)) { setPicker({ mode: 'wild', card }); return; }
    onIntent({ type: 'PLAY_CARD', cardId: card.id });
  };

  const chooseColor = (color) => {
    const { mode, card } = picker;
    setPicker(null);
    if (mode === 'roulette') onIntent({ type: 'PLAY_CARD', cardId: card.id, rouletteColor: color });
    else onIntent({ type: 'PLAY_CARD', cardId: card.id, chosenColor: color });
  };

  const doDraw = () => { if (myTurn) onIntent({ type: 'DRAW' }); };
  const sayUno = () => onIntent({ type: 'SAY_UNO' });

  const finished = view.status === 'finished';
  const winnerName = useMemo(() => {
    const w = view.players.find((p) => p.id === view.winner);
    return w ? w.name : null;
  }, [view.winner, view.players]);

  return (
    <div className="board">
      {/* top bar */}
      <div className="board-top">
        <button className="btn ghost" onClick={onLeave}>← Leave</button>
        <span className="pill">Room {/* code lives in lobby */}No Mercy</span>
        <div className="spacer" />
        <ColorChip color={view.activeColor} />
        <span className="turn-banner">
          {myTurn ? <span className="your-turn">● Your turn</span> :
            <>Turn: <b>{(view.players.find((p) => p.id === view.currentPlayerId) || {}).name || '—'}</b></>}
        </span>
      </div>

      {/* opponents */}
      <div className="opponents">
        {opponents.map((p) => (
          <div key={p.id} className={`opp ${p.id === view.currentPlayerId ? 'turn' : ''} ${p.eliminated ? 'eliminated' : ''}`}>
            <div className="row gap-8" style={{ alignItems: 'center' }}>
              <span className="avatar" style={{ width: 26, height: 26, fontSize: 13 }}>{(p.name || '?')[0].toUpperCase()}</span>
              <b>{p.name}</b>{p.isHost && <span className="pill tag-host" style={{ padding: '1px 6px' }}>H</span>}
            </div>
            <div className="mini-cards">
              {Array.from({ length: Math.min(p.handCount, 12) }).map((_, i) => <span className="mc" key={i} />)}
            </div>
            <div className="count">{p.eliminated ? '☠' : p.handCount}</div>
          </div>
        ))}
      </div>

      {/* center table */}
      <div className="table-center">
        <div className="pile">
          <div className="pile-label">Draw ({view.drawPileCount})</div>
          <div className="draw-pile" onClick={doDraw} title={myTurn ? 'Draw' : ''}>
            <div className={`deck-back ${shuffling ? 'shuffling' : ''}`}><div className="oval">UNO</div></div>
          </div>
        </div>

        <div className="dir-indicator">
          <div className={`dir-arrow ${view.direction === 1 ? 'cw' : 'ccw'}`}>↻</div>
          <span>{view.direction === 1 ? 'Clockwise' : 'Counter'}</span>
        </div>

        <div className="pile">
          <div className="pile-label">Discard</div>
          {view.topCard ? (
            <Card key={view.topCard.id} card={view.topCard} className="played-pop" />
          ) : (
            <div className="deck-back"><div className="oval">—</div></div>
          )}
        </div>

        {stack.active && (
          <div className={`stack-badge ${stackFlash ? 'stack-flash' : ''}`}>
            <span>DRAW</span><span className="num">{stack.total}</span>
            {view.drawStack.chainActive && <span title="Reverse chain active">⇄</span>}
          </div>
        )}
      </div>

      {/* my hand + controls */}
      <div className="hand-wrap">
        <div className="controls">
          <button className="btn" disabled={!myTurn} onClick={doDraw}>
            {stack.active ? `Take penalty (+${stack.total})` : 'Draw card'}
          </button>
          <button className={`btn ${me.handCount <= 2 ? 'accent2' : 'ghost'}`} onClick={sayUno} disabled={view.status !== 'playing'}>
            Say “UNO!”
          </button>
        </div>
        <div className="hand">
          {me.hand && me.hand.map((card) => {
            const playable = myTurn && isPlayable(card, view);
            return (
              <div key={card.id} className={`card-slot ${playable ? 'playable' : 'unplayable'}`}>
                <Card card={card} onClick={() => playCard(card)} />
              </div>
            );
          })}
          {(!me.hand || me.hand.length === 0) && !finished && <span className="muted">No cards — you&apos;re out or about to win.</span>}
        </div>
      </div>

      {/* color picker */}
      {picker && (
        <div className="overlay" onClick={() => setPicker(null)}>
          <div className="picker" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>{picker.mode === 'roulette' ? 'Call a color (roulette)' : 'Pick a color'}</h3>
            <div className="swatches">
              {COLORS.map((c) => <div key={c} className={`swatch ${c}`} onClick={() => chooseColor(c)} title={c} />)}
            </div>
          </div>
        </div>
      )}

      {/* winner overlay */}
      {finished && (
        <div className="overlay">
          <Confetti />
          <div className="picker winner-card" onClick={(e) => e.stopPropagation()}>
            <div className="winner-title">{winnerName ? `${winnerName} wins!` : 'Game over'}</div>
            <p className="muted">{view.winner === playerId ? 'No mercy shown. 🏆' : 'Better luck next round.'}</p>
            <button className="btn primary big" onClick={onLeave}>Back to hub</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ColorChip({ color }) {
  const map = { red: '#e2433b', yellow: '#f5b914', green: '#36a85a', blue: '#2b7fd6' };
  return (
    <span className="pill" title="Active color">
      <span style={{ width: 12, height: 12, borderRadius: 99, background: map[color] || '#888', display: 'inline-block' }} />
      {color || '—'}
    </span>
  );
}

function Confetti() {
  const bits = Array.from({ length: 50 });
  const colors = ['#e2433b', '#f5b914', '#36a85a', '#2b7fd6', '#7c5cff', '#00d4ff'];
  return (
    <>
      {bits.map((_, i) => (
        <span
          key={i}
          className="confetti"
          style={{
            left: `${Math.random() * 100}%`,
            background: colors[i % colors.length],
            animationDuration: `${1.6 + Math.random() * 1.8}s`,
            animationDelay: `${Math.random() * 0.6}s`,
          }}
        />
      ))}
    </>
  );
}
// EOF GameBoard.js
