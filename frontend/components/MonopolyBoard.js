'use client';

import { playClick } from '@/lib/sound';

/**
 * Monopoly — Phase 1 screen (intentionally a simple, readable text/stat UI; the
 * graphical board comes in a later phase). Shows each player's money + current
 * space, whose turn it is, a ROLL button for the current player, the last dice,
 * and a scrolling event log. Money/positions are public.
 */
export default function MonopolyBoard({ view, playerId, onIntent, onLeave }) {
  const board = view.board || [];
  const myTurn = view.currentPlayerId === playerId && view.status === 'playing';
  const spaceName = (pos) => (board[pos] ? board[pos].name : `#${pos}`);
  const currentName = (view.players.find((p) => p.id === view.currentPlayerId) || {}).name || '—';
  const roll = () => { if (myTurn) onIntent({ type: 'ROLL' }); };
  const lr = view.lastRoll;

  return (
    <div className="board monopoly-board">
      <div className="board-top">
        <button className="btn ghost" onClick={onLeave}>← Leave</button>
        <span className="pill">🎩 Monopoly · Phase 1</span>
        <div className="spacer" />
        <span className="turn-banner">
          {myTurn ? <span className="your-turn">● Your roll</span> : <>Turn: <b>{currentName}</b></>}
        </span>
      </div>

      <div className="mono-main">
        {/* players / stats */}
        <div className="mono-players">
          <h3 style={{ marginTop: 0 }}>Players</h3>
          {view.players.map((p) => (
            <div key={p.id} className={`mono-player ${p.id === view.currentPlayerId ? 'turn' : ''} ${p.connected === false ? 'is-offline' : ''}`}>
              <span className="avatar" style={{ width: 30, height: 30, fontSize: 14 }}>{(p.name || '?')[0].toUpperCase()}</span>
              <div className="mono-player-info">
                <div className="mono-player-name">
                  <b>{p.name}</b>
                  {p.isYou && <span className="muted"> (you)</span>}
                  {p.isHost && <span className="pill tag-host" style={{ padding: '1px 6px', marginLeft: 6 }}>H</span>}
                  {p.inJail && <span className="pill" style={{ marginLeft: 6, borderColor: 'var(--danger)', color: 'var(--danger)' }}>🔒 Jail</span>}
                  {p.connected === false && <span className="conn-badge off" style={{ marginLeft: 6 }}>reconnecting…</span>}
                </div>
                <div className="muted mono-player-pos">📍 {spaceName(p.position)} · <b className="mono-money">${p.money}</b></div>
              </div>
            </div>
          ))}
        </div>

        {/* dice + controls */}
        <div className="mono-center">
          <div className="dice-row">
            <div className="die">{lr ? lr.d1 : '—'}</div>
            <div className="die">{lr ? lr.d2 : '—'}</div>
          </div>
          <div className="muted" style={{ minHeight: 20 }}>
            {lr ? `Last roll: ${lr.d1} + ${lr.d2} = ${lr.total}` : 'No roll yet.'}
          </div>
          <button
            className="btn primary big roll-btn"
            disabled={!myTurn}
            onClick={() => { playClick(); roll(); }}
            title={myTurn ? 'Roll the dice' : `Waiting for ${currentName}`}
          >
            🎲 {myTurn ? 'ROLL' : `${currentName}…`}
          </button>
        </div>

        {/* event log */}
        <div className="mono-log">
          <h3 style={{ marginTop: 0 }}>Event log</h3>
          <div className="mono-log-list">
            {(view.log || []).slice().reverse().map((e, i) => (
              <div key={i} className="mono-log-line">{e.msg}</div>
            ))}
            {(!view.log || view.log.length === 0) && <div className="muted">The table is quiet… roll to begin.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
// EOF MonopolyBoard.js
