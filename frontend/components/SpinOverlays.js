'use client';

import { useEffect, useRef, useState } from 'react';
import Card from './Card';

const PALETTE = ['#7c5cff', '#00d4ff', '#2fd07a', '#f5b914', '#e2433b', '#e85aa8', '#27b3b0', '#e8893a', '#8b5cf6', '#3aa856', '#2b7fd6', '#ff7ab6'];
const SHORT = ['UNO!', '#', 'COLOR', 'RED', 'BLUE', 'GREEN', 'YEL', 'TRADE', 'RACE', '+1 ALL', 'SWAP', '+4'];
const COLORS = ['red', 'yellow', 'green', 'blue'];
const isWildType = (t) => t === 'wild' || t === 'wildDraw4';

function xy(cx, cy, r, a) { const rad = (a - 90) * Math.PI / 180; return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)]; }
function wedge(cx, cy, r, a0, a1) {
  const [x0, y0] = xy(cx, cy, r, a0);
  const [x1, y1] = xy(cx, cy, r, a1);
  return `M${cx},${cy} L${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 0 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z`;
}

function Wheel({ rotation, wheel }) {
  const cx = 100, cy = 100, r = 95;
  return (
    <div className="overlay spin-overlay">
      <div className="wheel-card">
        <div className="wheel-wrap">
          <div className="wheel-pointer" />
          <svg viewBox="0 0 200 200" className="wheel" style={{ transform: `rotate(${rotation}deg)` }}>
            {Array.from({ length: 12 }).map((_, i) => {
              const [lx, ly] = xy(cx, cy, r * 0.66, i * 30 + 15);
              return (
                <g key={i}>
                  <path d={wedge(cx, cy, r, i * 30, (i + 1) * 30)} fill={PALETTE[i]} stroke="rgba(0,0,0,.35)" strokeWidth="1" />
                  <text x={lx} y={ly} fill="#0b0d12" fontSize="9" fontWeight="800" textAnchor="middle"
                    transform={`rotate(${i * 30 + 15} ${lx} ${ly})`}>{SHORT[i]}</text>
                </g>
              );
            })}
            <circle cx={cx} cy={cy} r="16" fill="#11151d" stroke="#2a3344" strokeWidth="2" />
          </svg>
        </div>
        <div className={`spin-result ${wheel.landed ? 'show' : ''}`}>
          {wheel.landed ? <>🎯 {wheel.label}</> : 'Spinning…'}
        </div>
      </div>
    </div>
  );
}

function RaceOverlay({ deadlineTs, tapped, onTap }) {
  const [left, setLeft] = useState(Math.max(0, Math.ceil((deadlineTs - Date.now()) / 1000)));
  useEffect(() => {
    const id = setInterval(() => setLeft(Math.max(0, Math.ceil((deadlineTs - Date.now()) / 1000))), 200);
    return () => clearInterval(id);
  }, [deadlineTs]);
  return (
    <div className="overlay race-overlay">
      <div className="race-card">
        <div className="race-title">⚡ UNO SPIN — TAP!</div>
        <div className="muted">First to tap dumps a card. {left}s left</div>
        <button className={`tap-btn ${tapped ? 'tapped' : ''}`} disabled={tapped} onClick={onTap}>
          {tapped ? 'TAPPED!' : 'TAP!'}
        </button>
      </div>
    </div>
  );
}

function ChoiceModal({ choice, hand, onIntent }) {
  const [keep, setKeep] = useState([]);
  const t = choice.type;

  if (t === 'raceDiscard') {
    return (
      <div className="overlay">
        <div className="picker spin-choice" onClick={(e) => e.stopPropagation()}>
          <h3>You won! Dump any one card</h3>
          <div className="choice-hand">
            {hand.map((c) => (
              <div key={c.id} className="card-slot" onClick={() => onIntent({ type: 'SPIN_CHOICE', cardId: c.id, chosenColor: 'red' })}>
                <Card card={c} size="small" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (t === 'almostUno') {
    const toggle = (id) => setKeep((k) => (k.includes(id) ? k.filter((x) => x !== id) : k.length < 2 ? [...k, id] : k));
    const topCardId = hand.find((c) => !keep.includes(c.id))?.id;
    return (
      <div className="overlay">
        <div className="picker spin-choice" onClick={(e) => e.stopPropagation()}>
          <h3>Almost UNO! Keep 2 cards</h3>
          <div className="choice-hand">
            {hand.map((c) => (
              <div key={c.id} className={`card-slot ${keep.includes(c.id) ? 'sel' : ''}`} onClick={() => toggle(c.id)}>
                <Card card={c} size="small" />
              </div>
            ))}
          </div>
          <button className="btn primary" disabled={keep.length !== 2}
            onClick={() => onIntent({ type: 'SPIN_CHOICE', keepIds: keep, topCardId })}>
            Keep these 2
          </button>
        </div>
      </div>
    );
  }

  if (t === 'discardNumber') {
    const nums = [...new Set(hand.filter((c) => c.type === 'number').map((c) => c.value))].sort((a, b) => a - b);
    return (
      <div className="overlay">
        <div className="picker spin-choice" onClick={(e) => e.stopPropagation()}>
          <h3>Discard a Number — pick one</h3>
          <div className="num-grid">
            {nums.length === 0 && <span className="muted">No number cards — pick to skip</span>}
            {nums.map((n) => {
              const ids = hand.filter((c) => c.type === 'number' && c.value === n).map((c) => c.id);
              return <button key={n} className="btn" onClick={() => onIntent({ type: 'SPIN_CHOICE', number: n, discardIds: ids, topCardId: ids[0] })}>{n} ×{ids.length}</button>;
            })}
          </div>
        </div>
      </div>
    );
  }

  if (t === 'discardColor') {
    return (
      <div className="overlay">
        <div className="picker spin-choice" onClick={(e) => e.stopPropagation()}>
          <h3>Discard a Color — pick one</h3>
          <div className="swatches">
            {COLORS.map((col) => {
              const ids = hand.filter((c) => !isWildType(c.type) && c.color === col).map((c) => c.id);
              return <div key={col} className={`swatch ${col}`} title={`${col} ×${ids.length}`}
                onClick={() => onIntent({ type: 'SPIN_CHOICE', color: col, discardIds: ids, topCardId: ids[0] })} />;
            })}
          </div>
        </div>
      </div>
    );
  }
  return null;
}

export default function SpinOverlays({ view, onIntent }) {
  const [wheel, setWheel] = useState(null);
  const [rotation, setRotation] = useState(0);
  const [tapped, setTapped] = useState(false);
  const lastSpin = useRef(0);

  useEffect(() => {
    const sr = view.spinResult;
    if (sr && sr.spinId && sr.spinId !== lastSpin.current) {
      lastSpin.current = sr.spinId;
      const segCenter = (sr.outcomeId - 1) * 30 + 15;
      const targetMod = (((-segCenter) % 360) + 360) % 360;
      setRotation((prev) => { let r = prev - (prev % 360) + targetMod; while (r < prev + 360 * 4) r += 360; return r; });
      setWheel({ outcomeId: sr.outcomeId, label: sr.label, landed: false });
      const t1 = setTimeout(() => setWheel((w) => (w ? { ...w, landed: true } : w)), 2700);
      const t2 = setTimeout(() => setWheel(null), 4200);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [view.spinResult]);

  const raceActive = !!(view.race && view.race.active);
  useEffect(() => { if (!raceActive) setTapped(false); }, [raceActive]);

  const me = view.players.find((p) => p.isYou) || { hand: [] };

  return (
    <>
      {wheel && <Wheel rotation={rotation} wheel={wheel} />}
      {raceActive && <RaceOverlay deadlineTs={view.race.deadlineTs} tapped={tapped} onTap={() => { setTapped(true); onIntent({ type: 'RACE_TAP' }); }} />}
      {view.choice && <ChoiceModal choice={view.choice} hand={me.hand} onIntent={onIntent} />}
    </>
  );
}
// EOF SpinOverlays.js
