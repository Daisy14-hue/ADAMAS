'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Card from './Card';
import { isPlayable, needsColor } from '@/lib/cards';
import SpinOverlays from './SpinOverlays';

// Smoothly count a number toward `target` (used by the DRAW N stack counter).
function useCountUp(target, ms = 260) {
  const [val, setVal] = useState(target);
  const ref = useRef(target);
  useEffect(() => {
    const from = ref.current;
    const to = target;
    if (from === to) return undefined;
    const reduce = typeof window !== 'undefined' && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setVal(to); ref.current = to; return undefined; }
    const start = performance.now();
    let raf;
    const tick = (t) => {
      const k = Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      setVal(Math.round(from + (to - from) * e));
      if (k < 1) raf = requestAnimationFrame(tick);
      else ref.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return val;
}

export default function GameBoard({ view, playerId, onIntent, onLeave }) {
  const me = view.players.find((p) => p.isYou) || { hand: [] };
  const opponents = view.players.filter((p) => !p.isYou);
  const myTurn = view.currentPlayerId === playerId && view.status === 'playing';
  const stack = view.drawStack || { active: false, total: 0 };
  const side = view.side; // 'light' | 'dark' for Flip; undefined for No Mercy
  const palette = side === 'dark' ? ['pink', 'teal', 'orange', 'purple'] : ['red', 'yellow', 'green', 'blue'];
  const amSpectator = me.eliminated === true; // eliminated → watch-only spectator mode
  // Flip exposes `side`; No Mercy doesn't. Use that to label correctly (no hardcode).
  const gameLabel = side !== undefined ? 'UNO Flip' : 'UNO No Mercy';

  const [picker, setPicker] = useState(null); // { mode:'wild'|'roulette', card }
  const [shuffling, setShuffling] = useState(false);
  const [flipping, setFlipping] = useState(false);
  const [flying, setFlying] = useState(null); // { card, id } cosmetic fly-to-discard
  const flyKey = useRef(0);
  const prevSide = useRef(side);
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
  const stackDisplay = useCountUp(stack.total);

  // Cosmetic: launch a card flying toward the discard pile (state already updated).
  const launchFly = (card) => {
    flyKey.current += 1;
    const id = flyKey.current;
    setFlying({ card, id });
    setTimeout(() => setFlying((f) => (f && f.id === id ? null : f)), 320);
  };

  // Flip side-switch animation.
  useEffect(() => {
    if (side !== undefined && prevSide.current !== undefined && side !== prevSide.current) {
      setFlipping(true);
      const t = setTimeout(() => setFlipping(false), 650);
      prevSide.current = side;
      return () => clearTimeout(t);
    }
    prevSide.current = side;
  }, [side]);

  // ---- multi-card (same-face) selection -----------------------------------
  // A set's "face": same number, or same colored power symbol. Wilds excluded.
  const MULTI_SYMS = new Set(['skip', 'reverse', 'draw2', 'drawOne', 'drawFive']);
  const isWildType = (c) => typeof c.type === 'string' && c.type.startsWith('wild');
  const faceKey = (c) => {
    if (!c || isWildType(c)) return null;
    if (c.type === 'number') return `num:${c.value}`;
    if (MULTI_SYMS.has(c.type)) return `sym:${c.type}`;
    return null;
  };
  const [selected, setSelected] = useState([]); // ordered card ids for a set

  // Keep the selection valid as the view changes (drop played cards / off-turn).
  useEffect(() => {
    setSelected((sel) => {
      if (!myTurn || !me.hand) return sel.length ? [] : sel;
      const pruned = sel.filter((id) => me.hand.some((c) => c.id === id));
      return pruned.length === sel.length ? sel : pruned;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Hard reset any half-built set the moment it stops being my turn.
  useEffect(() => {
    if (!myTurn && selected.length) setSelected([]);
  }, [myTurn]);
  const setFaceKey = selected.length ? faceKey(me.hand.find((c) => c.id === selected[0])) : null;

  const playCard = (card) => {
    if (!myTurn) return;
    // While a set is being built, taps add/remove matching cards.
    if (selected.length) {
      if (selected.includes(card.id)) { setSelected((s) => s.filter((id) => id !== card.id)); return; }
      if (!isWildType(card) && faceKey(card) === setFaceKey) setSelected((s) => [...s, card.id]);
      return;
    }
    if (!isPlayable(card, view)) return;
    if (card.type === 'wildRoulette') { setPicker({ mode: 'roulette', card }); return; }
    if (needsColor(card)) { setPicker({ mode: 'wild', card }); return; }
    // If this legal card has same-face siblings, start a multi-select instead of
    // playing immediately (single play still happens for unique faces).
    const key = faceKey(card);
    if (key && me.hand.some((c) => c.id !== card.id && faceKey(c) === key)) {
      setSelected([card.id]);
      return;
    }
    launchFly(card);
    onIntent({ type: 'PLAY_CARD', cardId: card.id });
  };

  const confirmSet = () => {
    const ids = selected;
    if (!ids.length) return;
    const cards = ids.map((id) => me.hand.find((c) => c.id === id)).filter(Boolean);
    setSelected([]);
    if (!cards.length) return;
    launchFly(cards[cards.length - 1]);
    if (cards.length === 1) onIntent({ type: 'PLAY_CARD', cardId: ids[0] });
    else onIntent({ type: 'PLAY_CARDS', cardIds: ids });
  };
  const cancelSet = () => setSelected([]);

  const chooseColor = (color) => {
    const { mode, card } = picker;
    setPicker(null);
    launchFly(card);
    if (mode === 'roulette') onIntent({ type: 'PLAY_CARD', cardId: card.id, rouletteColor: color });
    else onIntent({ type: 'PLAY_CARD', cardId: card.id, chosenColor: color });
  };

  const doDraw = () => { if (myTurn) onIntent({ type: 'DRAW' }); };
  const sayUno = () => onIntent({ type: 'SAY_UNO' });

  // Adaptive hand overlap: few cards spread out (no overlap), big hands tuck tighter.
  const handLen = (me.hand && me.hand.length) || 0;
  const handOverlap = handLen <= 4 ? 0 : Math.min(56, Math.round((handLen - 4) * 7));
  // Gentle fan: per-card rotation + slight arc dip toward the edges.
  const fanMid = (handLen - 1) / 2;
  const fanStep = handLen <= 1 ? 0 : Math.min(3.4, 26 / handLen); // deg between cards (capped)
  const fanProps = (i) => {
    const off = i - fanMid;
    return { '--rot': `${(off * fanStep).toFixed(2)}deg`, '--ty': `${(Math.abs(off) * 2.2).toFixed(1)}px` };
  };

  const finished = view.status === 'finished';
  const winnerName = useMemo(() => {
    const w = view.players.find((p) => p.id === view.winner);
    return w ? w.name : null;
  }, [view.winner, view.players]);

  return (
    <div className={`board arena ${side === 'dark' ? 'dark-side' : ''}`}>
      {/* top bar */}
      <div className="board-top">
        <button className="btn ghost" onClick={onLeave}>← Leave</button>
        <span className="pill">🎴 {gameLabel}</span>
        <div className="spacer" />
        <ColorChip color={view.activeColor} />
        {side && (
          <span className={`side-badge ${side}`} title="Active side"><span className="dot" />{side} side</span>
        )}
        <span className="turn-banner">
          {myTurn ? <span className="your-turn">● Your turn</span> :
            <>Turn: <b>{(view.players.find((p) => p.id === view.currentPlayerId) || {}).name || '—'}</b></>}
        </span>
      </div>

      {/* the play table: opponents around the top, piles in the middle */}
      <div className="arena-table">
        {/* opponents (player pods) */}
        <div className="opponents">
          {opponents.map((p) => (
            <div key={p.id} className={`opp ${p.id === view.currentPlayerId ? 'turn' : ''} ${p.eliminated ? 'eliminated' : ''} ${p.connected === false ? 'disconnected' : ''}`}>
              <div className="row gap-8" style={{ alignItems: 'center' }}>
                <span className="avatar" style={{ width: 26, height: 26, fontSize: 13 }}>{(p.name || '?')[0].toUpperCase()}</span>
                <b>{p.name}</b>{p.isHost && <span className="pill tag-host" style={{ padding: '1px 6px' }}>H</span>}
              </div>
              {p.connected === false && <span className="conn-badge off">reconnecting…</span>}
              <div className="mini-cards">
                {Array.from({ length: Math.min(p.handCount, 12) }).map((_, i) => <span className="mc" key={i} />)}
              </div>
              <div className="count">{p.eliminated ? '☠' : p.handCount}</div>
            </div>
          ))}
        </div>

        {/* center table */}
        <div className={`table-center ${flipping ? 'flipping' : ''}`}>
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
              <Card key={view.topCard.id} card={view.topCard} className="played-pop discard-top" />
            ) : (
              <div className="deck-back"><div className="oval">—</div></div>
            )}
          </div>

          {stack.active && (
            <div className={`stack-badge ${stackFlash ? 'stack-flash' : ''}`}>
              <span>DRAW</span><span className="num">{stackDisplay}</span>
              {view.drawStack.chainActive && <span title="Reverse chain active">⇄</span>}
            </div>
          )}
        </div>
      </div>

      {/* my hand + controls — hidden entirely once eliminated (spectator) */}
      {amSpectator ? (
        <div className="hand-wrap spectator-wrap">
          <div className="spectator-banner">
            <span className="spectator-eye">👀</span>
            <div>
              <div className="spectator-title">You&apos;re out — spectating</div>
              <div className="muted">You can watch the rest of the match unfold.</div>
            </div>
            <button className="btn primary" onClick={onLeave}>Leave to hub</button>
          </div>
        </div>
      ) : (
        <div className="hand-wrap">
          {myTurn && selected.length > 0 ? (
            <div className="controls set-bar">
              <span className="set-count">🃏 Set: {selected.length} card{selected.length > 1 ? 's' : ''}</span>
              <button className="btn primary" onClick={confirmSet}>Play {selected.length} card{selected.length > 1 ? 's' : ''}</button>
              <button className="btn ghost" onClick={cancelSet}>Cancel</button>
              <span className="muted set-hint">tap matching cards to add · tap a selected card to remove</span>
            </div>
          ) : (
            <div className="controls">
              {view.mustSpin && (
                <button className="btn primary spin-btn" onClick={() => onIntent({ type: 'SPIN' })} title="Forced — spin the wheel">
                  🎡 Spin the Wheel
                </button>
              )}
              <button className="btn" disabled={!myTurn || view.mustSpin} onClick={doDraw}>
                {stack.active ? `Take penalty (+${stack.total})` : 'Draw card'}
              </button>
              {view.canPass && (
                <button className="btn primary" onClick={() => onIntent({ type: 'PASS' })} title="Keep the drawn card and end your turn">
                  Pass ↪
                </button>
              )}
              <button className={`btn ${me.handCount <= 2 ? 'accent2' : 'ghost'}`} onClick={sayUno} disabled={view.status !== 'playing'}>
                Say “UNO!”
              </button>
            </div>
          )}
          <div className="hand fan" style={{ '--ov': `${handOverlap}px` }}>
            {me.hand && me.hand.map((card, i) => {
              const playable = myTurn && isPlayable(card, view);
              const inSet = selected.includes(card.id);
              const addable = selected.length > 0 && !inSet && !isWildType(card) && faceKey(card) === setFaceKey;
              const order = inSet ? selected.indexOf(card.id) + 1 : null;
              return (
                <div key={card.id} className={`card-slot ${playable ? 'playable' : 'unplayable'} ${inSet ? 'sel' : ''} ${addable ? 'addable' : ''}`} style={fanProps(i)}>
                  {inSet && <span className="set-order">{order}</span>}
                  <Card card={card} onClick={() => playCard(card)} />
                </div>
              );
            })}
            {(!me.hand || me.hand.length === 0) && !finished && <span className="muted">No cards — you&apos;re out or about to win.</span>}
          </div>
        </div>
      )}

      {/* color picker */}
      {picker && !amSpectator && (
        <div className="overlay" onClick={() => setPicker(null)}>
          <div className="picker" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>{picker.mode === 'roulette' ? 'Call a color (roulette)' : 'Pick a color'}</h3>
            <div className="swatches">
              {palette.map((c) => <div key={c} className={`swatch ${c}`} onClick={() => chooseColor(c)} title={c} />)}
            </div>
          </div>
        </div>
      )}

      {flipping && <div className="flip-flash" />}

      {/* cosmetic card-play fly-out toward the discard (non-blocking) */}
      {flying && (
        <div className="fly-layer">
          <div key={flying.id} className="flying-card"><Card card={flying.card} /></div>
        </div>
      )}

      <SpinOverlays view={view} onIntent={onIntent} />

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
  const map = { red: '#e2433b', yellow: '#f5b914', green: '#36a85a', blue: '#2b7fd6', pink: '#e85aa8', teal: '#27b3b0', orange: '#e8893a', purple: '#8b5cf6' };
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
// EOF GameBoard.js (multi-card play)
