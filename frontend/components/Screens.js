'use client';

import { useState } from 'react';

const GROUP = ['Ashish', 'Mahi', 'Sneha', 'Aditi', 'Divyanshu'];

export function Landing({ onPlay, onMakeAccount, name }) {
  return (
    <div className="landing">
      <h1 className="brand">ADAMAS</h1>
      <p className="brand-sub">
        Where the table&apos;s always set, the cards are merciless, and the group&apos;s always game.
        Pull up a seat.
      </p>
      <p className="welcome-note">
        Welcome, <b>{GROUP.join(', ')}</b> — and whoever else pulls up a chair.
      </p>
      <div className="landing-cta">
        <button className="btn primary big" onClick={onPlay}>
          ▶ Play
        </button>
        <button className="btn big" onClick={onMakeAccount}>
          {name ? `Switch name (${name})` : 'Make Account'}
        </button>
      </div>
    </div>
  );
}

export function NameScreen({ initialName = '', onSubmit, onBack }) {
  const [value, setValue] = useState(initialName);
  const submit = (e) => {
    e.preventDefault();
    const n = value.trim();
    if (n) onSubmit(n);
  };
  return (
    <div className="landing">
      <div className="card-panel" style={{ width: 'min(420px, 92vw)' }}>
        <h2 style={{ marginTop: 0 }}>Choose a display name</h2>
        <p className="muted" style={{ marginTop: -6 }}>
          Phase 1 is name-only — no passwords, no accounts.
        </p>
        <form onSubmit={submit} className="col gap-16">
          <input
            className="input"
            autoFocus
            maxLength={20}
            placeholder="e.g. Sneha"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <div className="row gap-12">
            <button type="button" className="btn ghost" onClick={onBack}>
              Back
            </button>
            <div className="spacer" />
            <button type="submit" className="btn primary" disabled={!value.trim()}>
              Continue
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const UNO_VARIANTS = [
  { id: 'noMercy', title: 'UNO No Mercy', tag: 'Playable now', playable: true },
  { id: 'flip', title: 'UNO Flip', tag: 'Playable now', playable: true },
  { id: 'soon', title: 'Coming Soon', tag: 'Locked', playable: false },
];
const OTHER_GAMES = [
  { id: 'monopoly', title: 'Monopoly', tag: 'Coming soon' },
  { id: 'soon2', title: 'Coming Soon', tag: 'Locked' },
];

export function Hub({ onPick, onLocked }) {
  return (
    <div className="page">
      <h2>Game Hub</h2>
      <p className="muted" style={{ marginTop: -8 }}>Pick your poison. One playable, the rest landing soon.</p>

      <h3 style={{ marginTop: 24 }}>UNO</h3>
      <div className="hub-grid">
        {UNO_VARIANTS.map((v) => (
          <div
            key={v.id}
            className={`tile ${v.playable ? 'playable' : 'locked'}`}
            onClick={() => (v.playable ? onPick(v.id) : onLocked(v.title))}
          >
            {!v.playable && <span className="lock-badge">🔒</span>}
            <div className="tile-title">{v.title}</div>
            <div className={`pill ${v.playable ? '' : ''}`}>{v.tag}</div>
          </div>
        ))}
      </div>

      <h3 style={{ marginTop: 28 }}>More</h3>
      <div className="hub-grid">
        {OTHER_GAMES.map((g) => (
          <div key={g.id} className="tile locked" onClick={() => onLocked(g.title)}>
            <span className="lock-badge">🔒</span>
            <div className="tile-title">{g.title}</div>
            <div className="pill">{g.tag}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RoomEntry({ onCreate, onJoin, onBack, busy, gameType }) {
  const [code, setCode] = useState('');
  const title = gameType === 'flip' ? 'UNO Flip' : 'UNO No Mercy';
  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <button className="btn ghost" onClick={onBack}>← Back to hub</button>
      <h2 style={{ marginTop: 16 }}>{title} — Lobby</h2>
      <div className="lobby-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="card-panel">
          <h3 style={{ marginTop: 0 }}>Create Room</h3>
          <p className="muted">Spin up a fresh table. You&apos;ll be the host and set the limits.</p>
          <button className="btn primary" disabled={busy} onClick={onCreate}>Create Room</button>
        </div>
        <div className="card-panel">
          <h3 style={{ marginTop: 0 }}>Join Room</h3>
          <p className="muted">Got a room code? Drop it in.</p>
          <form
            className="col gap-12"
            onSubmit={(e) => { e.preventDefault(); if (code.trim()) onJoin(code.trim().toUpperCase()); }}
          >
            <input
              className="input"
              placeholder="ROOM CODE"
              style={{ letterSpacing: '.3em', textTransform: 'uppercase', textAlign: 'center', fontWeight: 800 }}
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button className="btn accent2" type="submit" disabled={busy || !code.trim()}>Join Room</button>
          </form>
        </div>
      </div>
    </div>
  );
}

function Stepper({ value, min, max, step, onChange }) {
  return (
    <div className="stepper">
      <button onClick={() => onChange(Math.max(min, value - step))}>−</button>
      <span className="val">{value}</span>
      <button onClick={() => onChange(Math.min(max, value + step))}>+</button>
    </div>
  );
}

export function Lobby({ room, playerId, onUpdateConfig, onStart, onLeave }) {
  const isHost = room.hostId === playerId;
  const canStart = room.players.length >= 2;
  return (
    <div className="page">
      <div className="row gap-12" style={{ alignItems: 'center' }}>
        <button className="btn ghost" onClick={onLeave}>← Leave</button>
        <div className="spacer" />
        <span className="muted">Room code</span>
        <span className="code-chip">{room.code}</span>
      </div>

      <div className="lobby-grid">
        <div className="card-panel">
          <h3 style={{ marginTop: 0 }}>Players ({room.players.length})</h3>
          {room.players.map((p) => (
            <div className={`player-row ${p.connected === false ? 'is-offline' : ''}`} key={p.id}>
              <span className="avatar">{(p.name || '?')[0].toUpperCase()}</span>
              <b>{p.name}</b>
              {p.id === playerId && <span className="muted">(you)</span>}
              <span className={`conn-badge ${p.connected === false ? 'off' : 'on'}`}>
                {p.connected === false ? 'reconnecting…' : 'online'}
              </span>
              <div className="spacer" />
              {p.isHost && <span className="pill tag-host">HOST</span>}
            </div>
          ))}
          {room.players.length < 2 && (
            <p className="muted">Waiting for at least one more player to join…</p>
          )}
        </div>

        <div className="card-panel">
          <h3 style={{ marginTop: 0 }}>Match settings</h3>
          {room.gameType !== 'flip' && (
            <div className="setting">
              <div>
                <div><b>Elimination limit</b></div>
                <div className="muted" style={{ fontSize: 13 }}>Hand ≥ this many cards = knocked out</div>
              </div>
              {isHost ? (
                <Stepper value={room.config.eliminationLimit} min={5} max={60} step={5}
                  onChange={(v) => onUpdateConfig({ eliminationLimit: v })} />
              ) : (<b>{room.config.eliminationLimit}</b>)}
            </div>
          )}
          <div className="setting">
            <div>
              <div><b>Discard recycle threshold</b></div>
              <div className="muted" style={{ fontSize: 13 }}>Reshuffle when discard hits this</div>
            </div>
            {isHost ? (
              <Stepper value={room.config.recycleThreshold} min={25} max={100} step={25}
                onChange={(v) => onUpdateConfig({ recycleThreshold: v })} />
            ) : (<b>{room.config.recycleThreshold}</b>)}
          </div>

          <div style={{ marginTop: 18 }}>
            {isHost ? (
              <button className="btn primary big" style={{ width: '100%' }} disabled={!canStart} onClick={onStart}>
                {canStart ? 'Start Match' : 'Need 2+ players'}
              </button>
            ) : (
              <p className="muted center" style={{ padding: 12 }}>Waiting for the host to start…</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
// EOF Screens.js
