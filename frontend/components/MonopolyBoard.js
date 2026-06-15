'use client';

import { playClick } from '@/lib/sound';

/**
 * Monopoly — Phase 1 + Phase 2 screen (simple text/stat UI; graphical board is a
 * later phase). Shows each player's money, current space, and OWNED properties;
 * whose turn it is; a ROLL button — or a Buy/Decline prompt when you've landed on
 * an unowned ownable space; the last dice; and an event log (buys + rent included).
 */
const MONO_COLORS = {
  brown: '#8b5a2b', lightBlue: '#8fd3f0', pink: '#d93a96', orange: '#e8893a',
  red: '#e2433b', yellow: '#e8c423', green: '#1f9e57', darkBlue: '#2b54d6',
};
function chipStyle(space) {
  if (space.type === 'property') return { background: MONO_COLORS[space.colorGroup] || '#666' };
  if (space.type === 'railroad') return { background: '#2a3344' };
  return { background: '#555' }; // utility
}
function chipIcon(space) {
  if (space.type === 'railroad') return '🚂 ';
  if (space.type === 'utility') return '💡 ';
  return '';
}

export default function MonopolyBoard({ view, playerId, onIntent, onLeave }) {
  const board = view.board || [];
  const myTurn = view.currentPlayerId === playerId && view.status === 'playing';
  const pend = view.pendingPurchase;
  const myBuy = myTurn && pend;
  const spaceName = (pos) => (board[pos] ? board[pos].name : `#${pos}`);
  const currentName = (view.players.find((p) => p.id === view.currentPlayerId) || {}).name || '—';
  const lr = view.lastRoll;

  const act = (intent) => { playClick(); onIntent(intent); };

  return (
    <div className="board monopoly-board">
      <div className="board-top">
        <button className="btn ghost" onClick={onLeave}>← Leave</button>
        <span className="pill">🎩 Monopoly · Phase 2</span>
        <div className="spacer" />
        <span className="turn-banner">
          {myTurn ? <span className="your-turn">● Your turn</span> : <>Turn: <b>{currentName}</b></>}
        </span>
      </div>

      <div className="mono-main">
        {/* players / stats / owned properties */}
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
                <div className="muted mono-player-pos">
                  📍 {spaceName(p.position)} · <b className={p.money < 0 ? 'mono-money-neg' : 'mono-money'}>${p.money}</b>
                </div>
                {p.properties && p.properties.length > 0 && (
                  <div className="prop-chips">
                    {p.properties.map((i) => (
                      <span key={i} className="prop-chip" style={chipStyle(board[i])} title={board[i].name}>
                        {chipIcon(board[i])}{board[i].name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* dice + controls (ROLL, or Buy/Decline on a pending purchase) */}
        <div className="mono-center">
          <div className="dice-row">
            <div className="die">{lr ? lr.d1 : '—'}</div>
            <div className="die">{lr ? lr.d2 : '—'}</div>
          </div>
          <div className="muted" style={{ minHeight: 20 }}>
            {lr ? `Last roll: ${lr.d1} + ${lr.d2} = ${lr.total}` : 'No roll yet.'}
          </div>

          {myBuy ? (
            <div className="buy-prompt">
              <div className="buy-title">You landed on <b>{pend.name}</b></div>
              <div className="row gap-12" style={{ justifyContent: 'center' }}>
                <button className="btn primary big" onClick={() => act({ type: 'BUY_PROPERTY' })}>
                  Buy · ${pend.price}
                </button>
                <button className="btn" onClick={() => act({ type: 'DECLINE_PROPERTY' })}>
                  Decline
                </button>
              </div>
            </div>
          ) : (
            <button
              className="btn primary big roll-btn"
              disabled={!myTurn || !!pend}
              onClick={() => act({ type: 'ROLL' })}
              title={myTurn ? 'Roll the dice' : `Waiting for ${currentName}`}
            >
              🎲 {myTurn ? 'ROLL' : `${currentName}…`}
            </button>
          )}
          {!myTurn && pend && (
            <div className="muted" style={{ marginTop: 8 }}>{currentName} is deciding on {pend.name}…</div>
          )}
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
