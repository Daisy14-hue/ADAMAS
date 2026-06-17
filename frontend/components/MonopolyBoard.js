'use client';

import { useState } from 'react';
import { playClick } from '@/lib/sound';

/**
 * Monopoly — Phases 1-5 screen (simple text/stat UI; graphical board is Phase 6).
 * Money/positions/ownership/net-worth are public. Adds Phase-5 panels: mortgage/
 * unmortgage + build/sell management, a trade builder, an auction panel, and a
 * debt panel. Eliminated players see a spectator view (no actions).
 */
const MONO_COLORS = {
  brown: '#8b5a2b', lightBlue: '#8fd3f0', pink: '#d93a96', orange: '#e8893a',
  red: '#e2433b', yellow: '#e8c423', green: '#1f9e57', darkBlue: '#2b54d6',
};
const chipStyle = (sp) => (sp.type === 'property' ? { background: MONO_COLORS[sp.colorGroup] || '#666' } : { background: sp.type === 'railroad' ? '#2a3344' : '#555' });
const chipIcon = (sp) => (sp.type === 'railroad' ? '🚂 ' : sp.type === 'utility' ? '💡 ' : '');
const buildIndicator = (sp) => (sp.hotel ? ' 🏨' : sp.houses > 0 ? ` 🏠×${sp.houses}` : '');

export default function MonopolyBoard({ view, playerId, onIntent, onLeave }) {
  const board = view.board || [];
  const me = view.players.find((p) => p.isYou) || {};
  const meEliminated = !!me.eliminated;
  const myTurn = view.currentPlayerId === playerId && view.status === 'playing' && !meEliminated;
  const pend = view.pendingPurchase;
  const auction = view.pendingAuction;
  const trade = view.pendingTrade;
  const debt = view.pendingDebt;
  const endVote = view.endVote;
  const finished = view.status === 'finished';
  const spaceName = (pos) => (board[pos] ? board[pos].name : `#${pos}`);
  const currentName = (view.players.find((p) => p.id === view.currentPlayerId) || {}).name || '—';
  const lr = view.lastRoll;
  const bank = view.bank || { houses: 0, hotels: 0 };
  const winnerName = (view.players.find((p) => p.id === view.winner) || {}).name;
  const act = (intent) => { playClick(); onIntent(intent); };

  // trade builder state
  const [tTarget, setTTarget] = useState('');
  const [tOffer, setTOffer] = useState([]);
  const [tReq, setTReq] = useState([]);
  const [tOfferCash, setTOfferCash] = useState(0);
  const [tReqCash, setTReqCash] = useState(0);
  const [bid, setBid] = useState('');
  const toggle = (arr, set, v) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const ownsWholeGroup = (sp) =>
    sp.type === 'property' && board.filter((b) => b.colorGroup === sp.colorGroup).every((b) => b.ownerId === playerId);
  const myProps = board.filter((b) => b.ownerId === playerId);
  const canManage = myTurn && !pend && !auction && !trade && !view.jailOptions && (myProps.length > 0 || true);
  const debtManage = debt && debt.debtorId === playerId; // debtor raising funds
  const others = view.players.filter((p) => !p.eliminated && p.id !== playerId);
  const targetProps = board.filter((b) => b.ownerId === tTarget);

  return (
    <div className="board monopoly-board">
      <div className="board-top">
        <button className="btn ghost" onClick={onLeave}>← Leave</button>
        <span className="pill">🎩 Monopoly · Phase 5</span>
        <span className="pill" title="Bank building supply">🏦 🏠 {bank.houses} · 🏨 {bank.hotels}</span>
        <div className="spacer" />
        {meEliminated && <span className="pill" style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}>👀 Spectating</span>}
        <span className="turn-banner">
          {myTurn ? <span className="your-turn">● Your turn</span> : <>Turn: <b>{currentName}</b></>}
        </span>
      </div>

      <div className="mono-main">
        {/* players */}
        <div className="mono-players">
          <h3 style={{ marginTop: 0 }}>Players</h3>
          {view.players.map((p) => (
            <div key={p.id} className={`mono-player ${p.id === view.currentPlayerId ? 'turn' : ''} ${p.eliminated ? 'is-offline' : ''} ${p.connected === false ? 'is-offline' : ''}`}>
              <span className="avatar" style={{ width: 30, height: 30, fontSize: 14 }}>{(p.name || '?')[0].toUpperCase()}</span>
              <div className="mono-player-info">
                <div className="mono-player-name">
                  <b>{p.name}</b>
                  {p.isYou && <span className="muted"> (you)</span>}
                  {p.eliminated && <span className="pill" style={{ marginLeft: 6, borderColor: 'var(--danger)', color: 'var(--danger)' }}>☠ OUT</span>}
                  {p.inJail && !p.eliminated && <span className="pill" style={{ marginLeft: 6, borderColor: 'var(--danger)', color: 'var(--danger)' }}>🔒</span>}
                  {p.jailCards > 0 && <span className="pill" style={{ marginLeft: 6 }}>🎟️{p.jailCards}</span>}
                </div>
                <div className="muted mono-player-pos">
                  📍 {spaceName(p.position)} · <b className={p.money < 0 ? 'mono-money-neg' : 'mono-money'}>${p.money}</b>
                  <span className="muted"> · NW ${p.netWorth}</span>
                </div>
                {p.properties && p.properties.length > 0 && (
                  <div className="prop-chips">
                    {p.properties.map((i) => (
                      <span key={i} className={`prop-chip ${board[i].mortgaged ? 'mtg' : ''}`} style={chipStyle(board[i])} title={board[i].name}>
                        {chipIcon(board[i])}{board[i].name}{buildIndicator(board[i])}{board[i].mortgaged ? ' (MTG)' : ''}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* center: dice + the active panel */}
        <div className="mono-center">
          <div className="dice-row">
            <div className="die">{lr ? lr.d1 : '—'}</div>
            <div className="die">{lr ? lr.d2 : '—'}</div>
          </div>
          <div className="muted" style={{ minHeight: 18 }}>{lr ? `Last: ${lr.d1}+${lr.d2}=${lr.total}` : 'No roll yet.'}</div>

          {view.lastCard && (
            <div className={`drawn-card ${view.lastCard.deck}`}>
              <div className="drawn-card-label">{view.lastCard.deck === 'chance' ? '❓ Chance' : '📦 Community Chest'}</div>
              <div className="drawn-card-text">{view.lastCard.text}</div>
            </div>
          )}

          {/* AUCTION */}
          {auction && (
            <div className="buy-prompt">
              <div className="buy-title">🔨 Auction: <b>{auction.name}</b></div>
              <div className="muted">High bid ${auction.currentBid}{auction.highBidderId ? ` by ${(view.players.find((p) => p.id === auction.highBidderId) || {}).name}` : ' (none)'} · min ${auction.minBid}</div>
              {auction.turnPid === playerId ? (
                <div className="row gap-8" style={{ justifyContent: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                  <input className="input" style={{ width: 90 }} type="number" value={bid} placeholder="$" onChange={(e) => setBid(e.target.value)} />
                  <button className="btn primary" onClick={() => { act({ type: 'AUCTION_BID', amount: parseInt(bid, 10) }); setBid(''); }}>Bid</button>
                  <button className="btn ghost" onClick={() => act({ type: 'AUCTION_PASS' })}>Pass</button>
                </div>
              ) : (
                <div className="muted" style={{ marginTop: 6 }}>Waiting for {(view.players.find((p) => p.id === auction.turnPid) || {}).name} to bid…</div>
              )}
            </div>
          )}

          {/* TRADE response (target) / waiting (proposer) */}
          {trade && !auction && (
            <div className="buy-prompt">
              <div className="buy-title">🤝 Trade</div>
              <div className="muted" style={{ fontSize: 13 }}>
                {(view.players.find((p) => p.id === trade.fromId) || {}).name} → {(view.players.find((p) => p.id === trade.toId) || {}).name}<br />
                Offer: {trade.offerProps.map((i) => board[i].name).join(', ') || '—'} + ${trade.offerCash}<br />
                For: {trade.requestProps.map((i) => board[i].name).join(', ') || '—'} + ${trade.requestCash}
              </div>
              {trade.toId === playerId ? (
                <div className="row gap-8" style={{ justifyContent: 'center', marginTop: 8 }}>
                  <button className="btn primary" onClick={() => act({ type: 'ACCEPT_TRADE' })}>Accept</button>
                  <button className="btn ghost" onClick={() => act({ type: 'DECLINE_TRADE' })}>Decline</button>
                </div>
              ) : trade.fromId === playerId ? (
                <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => act({ type: 'CANCEL_TRADE' })}>Cancel proposal</button>
              ) : <div className="muted" style={{ marginTop: 6 }}>A trade is in progress…</div>}
            </div>
          )}

          {/* DEBT panel (debtor) */}
          {debtManage && (
            <div className="jail-prompt">
              <div className="buy-title">💸 You owe ${debt.amount}</div>
              <div className="muted" style={{ fontSize: 13 }}>Sell/mortgage below to raise cash, then settle — or declare bankruptcy.</div>
              <div className="row gap-8" style={{ justifyContent: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                <button className="btn primary" disabled={me.money < 0} onClick={() => act({ type: 'SETTLE_DEBT' })}>Settle (Pay)</button>
                <button className="btn danger" onClick={() => act({ type: 'DECLARE_BANKRUPTCY' })}>Declare Bankruptcy</button>
              </div>
            </div>
          )}

          {/* END VOTE */}
          {endVote && endVote.pending.includes(playerId) && (
            <div className="buy-prompt">
              <div className="buy-title">🏁 End the game by net worth?</div>
              <div className="row gap-8" style={{ justifyContent: 'center', marginTop: 8 }}>
                <button className="btn primary" onClick={() => act({ type: 'AGREE_END' })}>Agree</button>
                <button className="btn ghost" onClick={() => act({ type: 'DECLINE_END' })}>Decline</button>
              </div>
            </div>
          )}

          {/* normal controls (only when no other panel demands attention) */}
          {!auction && !trade && !debt && !endVote && !meEliminated && (
            view.jailOptions && myTurn ? (
              <div className="jail-prompt">
                <div className="buy-title">You&apos;re in Jail 🔒</div>
                <div className="row gap-12" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
                  <button className="btn primary" onClick={() => act({ type: 'JAIL_PAY' })}>Pay $50</button>
                  {view.jailOptions.canUseCard && <button className="btn accent2" onClick={() => act({ type: 'JAIL_USE_CARD' })}>Use Jail Card 🎟️</button>}
                  <button className="btn" onClick={() => act({ type: 'ROLL' })}>🎲 Roll for doubles</button>
                </div>
              </div>
            ) : myTurn && pend ? (
              <div className="buy-prompt">
                <div className="buy-title">You landed on <b>{pend.name}</b></div>
                <div className="row gap-12" style={{ justifyContent: 'center' }}>
                  <button className="btn primary big" onClick={() => act({ type: 'BUY_PROPERTY' })}>Buy · ${pend.price}</button>
                  <button className="btn" onClick={() => act({ type: 'DECLINE_PROPERTY' })}>Decline → Auction</button>
                </div>
              </div>
            ) : myTurn && view.awaitingEnd ? (
              <button className="btn primary big" onClick={() => act({ type: 'END_TURN' })}>End Turn ➡</button>
            ) : (
              <button className="btn primary big roll-btn" disabled={!myTurn} onClick={() => act({ type: 'ROLL' })}>
                🎲 {myTurn ? 'ROLL' : `${currentName}…`}
              </button>
            )
          )}

          {/* MANAGE: build/sell/mortgage (your turn, or while raising debt funds) */}
          {(canManage || debtManage) && myProps.length > 0 && (
            <div className="manage-panel">
              <h4 style={{ margin: '4px 0 8px' }}>Manage properties</h4>
              {myProps.map((sp) => (
                <div className="manage-row" key={sp.index}>
                  <span className="group-dot" style={chipStyle(sp)} />
                  <span className="manage-name">{sp.name}{sp.mortgaged ? ' (MTG)' : ''}{buildIndicator(sp)}</span>
                  <div className="spacer" />
                  {sp.type === 'property' && ownsWholeGroup(sp) && !sp.mortgaged && (
                    <>
                      <button className="btn small" onClick={() => act({ type: 'BUILD_HOUSE', spaceIndex: sp.index })}>Build ${sp.houseCost}</button>
                      <button className="btn small ghost" onClick={() => act({ type: 'SELL_HOUSE', spaceIndex: sp.index })}>Sell</button>
                    </>
                  )}
                  {!sp.mortgaged ? (
                    <button className="btn small ghost" onClick={() => act({ type: 'MORTGAGE', spaceIndex: sp.index })}>Mortgage</button>
                  ) : (
                    <button className="btn small" onClick={() => act({ type: 'UNMORTGAGE', spaceIndex: sp.index })}>Unmortgage</button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* TRADE builder + Call End (your turn, idle) */}
          {canManage && !view.jailOptions && others.length > 0 && (
            <div className="manage-panel">
              <h4 style={{ margin: '4px 0 8px' }}>Propose a trade</h4>
              <select className="input" value={tTarget} onChange={(e) => { setTTarget(e.target.value); setTReq([]); }}>
                <option value="">Choose a player…</option>
                {others.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {tTarget && (
                <>
                  <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>You give:</div>
                  <div className="trade-chips">
                    {myProps.map((sp) => (
                      <span key={sp.index} className={`trade-chip ${tOffer.includes(sp.index) ? 'sel' : ''}`} onClick={() => toggle(tOffer, setTOffer, sp.index)}>{sp.name}</span>
                    ))}
                  </div>
                  <input className="input" type="number" placeholder="+ your cash" value={tOfferCash} onChange={(e) => setTOfferCash(Math.max(0, parseInt(e.target.value, 10) || 0))} style={{ marginTop: 6 }} />
                  <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>You get:</div>
                  <div className="trade-chips">
                    {targetProps.map((sp) => (
                      <span key={sp.index} className={`trade-chip ${tReq.includes(sp.index) ? 'sel' : ''}`} onClick={() => toggle(tReq, setTReq, sp.index)}>{sp.name}</span>
                    ))}
                  </div>
                  <input className="input" type="number" placeholder="+ their cash" value={tReqCash} onChange={(e) => setTReqCash(Math.max(0, parseInt(e.target.value, 10) || 0))} style={{ marginTop: 6 }} />
                  <button className="btn primary" style={{ marginTop: 8, width: '100%' }}
                    onClick={() => act({ type: 'PROPOSE_TRADE', toPlayerId: tTarget, offerProps: tOffer, offerCash: tOfferCash, requestProps: tReq, requestCash: tReqCash })}>
                    Propose
                  </button>
                </>
              )}
              <button className="btn small ghost" style={{ marginTop: 10 }} onClick={() => act({ type: 'CALL_END_GAME' })}>🏁 Call end game (net worth)</button>
            </div>
          )}
        </div>

        {/* event log */}
        <div className="mono-log">
          <h3 style={{ marginTop: 0 }}>Event log</h3>
          <div className="mono-log-list">
            {(view.log || []).slice().reverse().map((e, i) => <div key={i} className="mono-log-line">{e.msg}</div>)}
            {(!view.log || view.log.length === 0) && <div className="muted">The table is quiet… roll to begin.</div>}
          </div>
        </div>
      </div>

      {finished && (
        <div className="overlay">
          <div className="picker winner-card" onClick={(e) => e.stopPropagation()}>
            <div className="winner-title">{winnerName ? `${winnerName} wins!` : 'Game over'}</div>
            <p className="muted">{view.winner === playerId ? 'The board is yours. 🏆' : 'Better luck next round.'}</p>
            <button className="btn primary big" onClick={onLeave}>Back to hub</button>
          </div>
        </div>
      )}
    </div>
  );
}
// EOF MonopolyBoard.js
