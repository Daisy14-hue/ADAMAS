'use client';

import { playClick } from '@/lib/sound';

/**
 * Monopoly — Phases 1-4 screen (simple text/stat UI; graphical board is Phase 6).
 * Shows money, positions, OWNED properties with houses/hotels, bank building
 * supply, whose turn it is, the dice, the drawn card, jail options, a Build/Sell
 * management panel for your complete monopolies, and an explicit End Turn button
 * (the Phase-4 management window). Money/positions/ownership are public.
 */
const MONO_COLORS = {
  brown: '#8b5a2b', lightBlue: '#8fd3f0', pink: '#d93a96', orange: '#e8893a',
  red: '#e2433b', yellow: '#e8c423', green: '#1f9e57', darkBlue: '#2b54d6',
};
function chipStyle(space) {
  if (space.type === 'property') return { background: MONO_COLORS[space.colorGroup] || '#666' };
  if (space.type === 'railroad') return { background: '#2a3344' };
  return { background: '#555' };
}
function chipIcon(space) {
  if (space.type === 'railroad') return '🚂 ';
  if (space.type === 'utility') return '💡 ';
  return '';
}
function buildIndicator(space) {
  if (space.hotel) return ' 🏨';
  if (space.houses > 0) return ` 🏠×${space.houses}`;
  return '';
}

export default function MonopolyBoard({ view, playerId, onIntent, onLeave }) {
  const board = view.board || [];
  const myTurn = view.currentPlayerId === playerId && view.status === 'playing';
  const pend = view.pendingPurchase;
  const myBuy = myTurn && pend;
  const inJailPrompt = myTurn && view.jailOptions;
  const spaceName = (pos) => (board[pos] ? board[pos].name : `#${pos}`);
  const currentName = (view.players.find((p) => p.id === view.currentPlayerId) || {}).name || '—';
  const lr = view.lastRoll;
  const bank = view.bank || { houses: 0, hotels: 0 };

  const act = (intent) => { playClick(); onIntent(intent); };

  // My complete monopolies (every lot in the group owned by me) → buildable.
  const ownsWholeGroup = (sp) =>
    sp.type === 'property' &&
    board.filter((b) => b.colorGroup === sp.colorGroup).every((b) => b.ownerId === playerId);
  const myManageable = board.filter(ownsWholeGroup);
  const canManage = myTurn && !pend && !inJailPrompt && myManageable.length > 0;

  return (
    <div className="board monopoly-board">
      <div className="board-top">
        <button className="btn ghost" onClick={onLeave}>← Leave</button>
        <span className="pill">🎩 Monopoly · Phase 4</span>
        <span className="pill" title="Bank building supply">🏦 🏠 {bank.houses} · 🏨 {bank.hotels}</span>
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
                  {p.jailCards > 0 && <span className="pill" style={{ marginLeft: 6 }}>🎟️ {p.jailCards}</span>}
                  {p.connected === false && <span className="conn-badge off" style={{ marginLeft: 6 }}>reconnecting…</span>}
                </div>
                <div className="muted mono-player-pos">
                  📍 {spaceName(p.position)} · <b className={p.money < 0 ? 'mono-money-neg' : 'mono-money'}>${p.money}</b>
                </div>
                {p.properties && p.properties.length > 0 && (
                  <div className="prop-chips">
                    {p.properties.map((i) => (
                      <span key={i} className="prop-chip" style={chipStyle(board[i])} title={board[i].name}>
                        {chipIcon(board[i])}{board[i].name}{buildIndicator(board[i])}
                      </span>
                    ))}
                  </div>
                )}
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

          {view.lastCard && (
            <div className={`drawn-card ${view.lastCard.deck}`}>
              <div className="drawn-card-label">{view.lastCard.deck === 'chance' ? '❓ Chance' : '📦 Community Chest'}</div>
              <div className="drawn-card-text">{view.lastCard.text}</div>
            </div>
          )}

          {inJailPrompt ? (
            <div className="jail-prompt">
              <div className="buy-title">You&apos;re in Jail 🔒</div>
              <div className="row gap-12" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
                <button className="btn primary" onClick={() => act({ type: 'JAIL_PAY' })}>Pay $50</button>
                {view.jailOptions.canUseCard && (
                  <button className="btn accent2" onClick={() => act({ type: 'JAIL_USE_CARD' })}>Use Jail Card 🎟️</button>
                )}
                <button className="btn" onClick={() => act({ type: 'ROLL' })}>🎲 Roll for doubles</button>
              </div>
            </div>
          ) : myBuy ? (
            <div className="buy-prompt">
              <div className="buy-title">You landed on <b>{pend.name}</b></div>
              <div className="row gap-12" style={{ justifyContent: 'center' }}>
                <button className="btn primary big" onClick={() => act({ type: 'BUY_PROPERTY' })}>Buy · ${pend.price}</button>
                <button className="btn" onClick={() => act({ type: 'DECLINE_PROPERTY' })}>Decline</button>
              </div>
            </div>
          ) : myTurn && view.awaitingEnd ? (
            <button className="btn primary big" onClick={() => act({ type: 'END_TURN' })}>End Turn ➡</button>
          ) : (
            <button
              className="btn primary big roll-btn"
              disabled={!myTurn}
              onClick={() => act({ type: 'ROLL' })}
              title={myTurn ? 'Roll the dice' : `Waiting for ${currentName}`}
            >
              🎲 {myTurn ? 'ROLL' : `${currentName}…`}
            </button>
          )}
          {!myTurn && pend && (
            <div className="muted" style={{ marginTop: 8 }}>{currentName} is deciding on {pend.name}…</div>
          )}

          {/* Build / Sell management panel (your complete monopolies) */}
          {canManage && (
            <div className="manage-panel">
              <h4 style={{ margin: '4px 0 8px' }}>Build / Sell</h4>
              {myManageable.map((sp) => (
                <div className="manage-row" key={sp.index}>
                  <span className="group-dot" style={{ background: MONO_COLORS[sp.colorGroup] }} />
                  <span className="manage-name">{sp.name}</span>
                  <span className="muted">{sp.hotel ? '🏨' : `🏠×${sp.houses}`}</span>
                  <div className="spacer" />
                  <button className="btn small" onClick={() => act({ type: 'BUILD_HOUSE', spaceIndex: sp.index })}>Build ${sp.houseCost}</button>
                  <button className="btn small ghost" onClick={() => act({ type: 'SELL_HOUSE', spaceIndex: sp.index })}>Sell</button>
                </div>
              ))}
            </div>
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
