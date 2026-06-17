'use client';

import { useState } from 'react';
import { playClick } from '@/lib/sound';
import { spaceRect, colorBarRect, buildingSlots, VB, TOKEN_COLORS, CLUSTER } from './monopolyGeometry';

/**
 * Monopoly — Phase 6 graphical board (SVG) + Phases 1-5 management panels.
 * PURE RENDER of `view`: the board, tokens (current positions), and a read-only
 * click-to-detail popup. All actions remain in the management panels below.
 */
const MONO_COLORS = {
  brown: '#8b5a2b', lightBlue: '#8fd3f0', pink: '#d93a96', orange: '#e8893a',
  red: '#e2433b', yellow: '#e8c423', green: '#1f9e57', darkBlue: '#2b54d6',
};
const chipStyle = (sp) => (sp.type === 'property' ? { background: MONO_COLORS[sp.colorGroup] || '#666' } : { background: sp.type === 'railroad' ? '#2a3344' : '#555' });
const chipIcon = (sp) => (sp.type === 'railroad' ? '🚂 ' : sp.type === 'utility' ? '💡 ' : '');
const buildIndicator = (sp) => (sp.hotel ? ' 🏨' : sp.houses > 0 ? ` 🏠×${sp.houses}` : '');
const trunc = (s, n = 13) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const cornerLabel = { 0: 'GO →', 10: 'JAIL', 20: 'FREE\nPARKING', 30: 'GO TO\nJAIL' };
const typeIcon = { railroad: '🚂', utility: '💡', chance: '?', communityChest: '📦', tax: '💰' };

// ---- the SVG board -------------------------------------------------------
function BoardSvg({ view, selected, onSelect }) {
  const board = view.board || [];
  const seatColor = {};
  view.players.forEach((p, i) => { seatColor[p.id] = TOKEN_COLORS[i % TOKEN_COLORS.length]; });

  // group living players by position for cluster offsets
  const byPos = {};
  view.players.forEach((p) => {
    if (p.eliminated) return;
    (byPos[p.position] = byPos[p.position] || []).push(p);
  });

  return (
    <svg className="mono-svg" viewBox={`0 0 ${VB} ${VB}`} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="tokShine" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="rgba(255,255,255,.85)" />
          <stop offset="45%" stopColor="rgba(255,255,255,.15)" />
          <stop offset="100%" stopColor="rgba(0,0,0,.25)" />
        </radialGradient>
      </defs>

      {/* center */}
      <rect x="0" y="0" width={VB} height={VB} fill="#cfe8d6" />
      <rect x={130} y={130} width={VB - 260} height={VB - 260} fill="#c7e3cf" stroke="#0b0d12" strokeWidth="2" />
      <text x={VB / 2} y={VB / 2 - 18} textAnchor="middle" className="mono-center-title" transform={`rotate(-45 ${VB / 2} ${VB / 2})`}>ADAMAS</text>
      <text x={VB / 2} y={VB / 2 + 36} textAnchor="middle" className="mono-center-sub" transform={`rotate(-45 ${VB / 2} ${VB / 2})`}>MONOPOLY</text>

      {/* spaces */}
      {board.map((sp) => {
        const r = spaceRect(sp.index);
        const isProp = sp.type === 'property';
        const bar = isProp ? colorBarRect(r) : null;
        const owner = view.players.find((p) => p.id === sp.ownerId);
        const isCorner = r.edge === 'corner';
        const second = isProp || sp.type === 'railroad' || sp.type === 'utility'
          ? `$${sp.price}` : sp.type === 'tax' ? `Pay $${sp.amount}` : '';
        return (
          <g key={sp.index} className="mono-space" onClick={() => onSelect(sp.index)}>
            <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="#f7f4ea" stroke="#0b0d12" strokeWidth="2" />
            {bar && <rect x={bar.x} y={bar.y} width={bar.w} height={bar.h} fill={MONO_COLORS[sp.colorGroup]} stroke="#0b0d12" strokeWidth="1.5" />}
            {sp.mortgaged && <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="rgba(20,20,30,.42)" />}
            <g transform={`rotate(${r.rot} ${r.cx} ${r.cy})`}>
              {isCorner ? (
                cornerLabel[sp.index].split('\n').map((ln, k, arr) => (
                  <text key={k} x={r.cx} y={r.cy + (k - (arr.length - 1) / 2) * 22 + 6} textAnchor="middle" className="mono-corner-text">{ln}</text>
                ))
              ) : (
                <>
                  {!isProp && typeIcon[sp.type] && <text x={r.cx} y={r.cy - 16} textAnchor="middle" className="mono-space-icon">{typeIcon[sp.type]}</text>}
                  <text x={r.cx} y={r.cy + 6} textAnchor="middle" className="mono-space-name">{trunc(sp.name)}</text>
                  {second && <text x={r.cx} y={r.cy + 22} textAnchor="middle" className="mono-space-price">{second}</text>}
                </>
              )}
            </g>
            {/* ownership marker */}
            {owner && <circle cx={r.x + 9} cy={r.y + 9} r="6" fill={seatColor[owner.id]} stroke="#0b0d12" strokeWidth="1.5" />}
            {/* house/hotel indicators along the inner edge (classic placement) */}
            {isProp && sp.hotel && (() => {
              const { slots, fs } = buildingSlots(r, 1);
              return <text x={slots[0].x} y={slots[0].y} textAnchor="middle" dominantBaseline="central" className="mono-build-icon" style={{ fontSize: fs }}>🏨</text>;
            })()}
            {isProp && !sp.hotel && sp.houses > 0 && (() => {
              const { slots, fs } = buildingSlots(r, sp.houses);
              return slots.map((s, i) => (
                <text key={i} x={s.x} y={s.y} textAnchor="middle" dominantBaseline="central" className="mono-build-icon" style={{ fontSize: fs }}>🏠</text>
              ));
            })()}
            {selected === sp.index && <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="none" stroke="#7c5cff" strokeWidth="5" />}
          </g>
        );
      })}

      {/* tokens */}
      {Object.entries(byPos).flatMap(([pos, list]) => {
        const r = spaceRect(Number(pos));
        return list.map((p, k) => {
          const off = CLUSTER[k % CLUSTER.length];
          const cx = r.cx + off[0];
          const cy = r.cy + off[1];
          return (
            <g key={p.id} className="mono-token">
              <circle cx={cx} cy={cy} r="21" fill={seatColor[p.id]} stroke="#fff" strokeWidth="2.5" />
              <circle cx={cx} cy={cy} r="21" fill="url(#tokShine)" />
              <text x={cx} y={cy + 7} textAnchor="middle" className="mono-token-text">{(p.name || '?')[0].toUpperCase()}</text>
            </g>
          );
        });
      })}
    </svg>
  );
}

// ---- detail popup --------------------------------------------------------
function SpaceDetail({ view, index, onClose }) {
  const sp = view.board[index];
  if (!sp) return null;
  const owner = view.players.find((p) => p.id === sp.ownerId);
  const rentLine = () => {
    if (sp.type === 'property') {
      if (sp.hotel) return `Hotel rent: $${sp.rentTable[5]}`;
      if (sp.houses > 0) return `Rent (${sp.houses} ho.): $${sp.rentTable[sp.houses]}`;
      return `Base rent: $${sp.rentTable[0]}`;
    }
    if (sp.type === 'railroad') return 'Rent: $25 / $50 / $100 / $200 by # owned';
    if (sp.type === 'utility') return 'Rent: dice × 4 (one) / × 10 (both)';
    if (sp.type === 'tax') return `Pay $${sp.amount}`;
    return '';
  };
  return (
    <div className="overlay" onClick={onClose}>
      <div className="picker space-detail" onClick={(e) => e.stopPropagation()}>
        <button className="gag-close" onClick={onClose} aria-label="Close">×</button>
        {sp.type === 'property' && <div className="detail-bar" style={{ background: MONO_COLORS[sp.colorGroup] }} />}
        <h3 style={{ margin: '6px 0 2px' }}>{sp.name}</h3>
        <div className="muted" style={{ marginBottom: 10, textTransform: 'capitalize' }}>{sp.colorGroup || sp.type}</div>
        <div className="detail-rows">
          {(sp.price != null) && <div><span className="muted">Price</span><b>${sp.price}</b></div>}
          <div><span className="muted">Owner</span><b>{owner ? owner.name : 'Unowned (bank)'}</b></div>
          {rentLine() && <div><span className="muted">Rent</span><b>{rentLine()}</b></div>}
          {sp.type === 'property' && <div><span className="muted">Buildings</span><b>{sp.hotel ? 'Hotel' : `Houses: ${sp.houses}`}</b></div>}
          {(sp.type === 'property' || sp.type === 'railroad' || sp.type === 'utility') && (
            <div><span className="muted">Mortgaged</span><b>{sp.mortgaged ? 'Yes' : 'No'}</b></div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- main component ------------------------------------------------------
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

  const [sel, setSel] = useState(null); // selected board space index (detail popup)

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
  const canManage = myTurn && !pend && !auction && !trade && !view.jailOptions;
  const debtManage = debt && debt.debtorId === playerId;
  const others = view.players.filter((p) => !p.eliminated && p.id !== playerId);
  const targetProps = board.filter((b) => b.ownerId === tTarget);

  return (
    <div className="board monopoly-board">
      <div className="board-top">
        <button className="btn ghost" onClick={onLeave}>← Leave</button>
        <span className="pill">🎩 Monopoly</span>
        <span className="pill" title="Bank building supply">🏦 🏠 {bank.houses} · 🏨 {bank.hotels}</span>
        <div className="spacer" />
        {meEliminated && <span className="pill" style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}>👀 Spectating</span>}
        <span className="turn-banner">{myTurn ? <span className="your-turn">● Your turn</span> : <>Turn: <b>{currentName}</b></>}</span>
      </div>

      <div className="mono-layout">
        {/* graphical board */}
        <div className="mono-boardwrap">
          <BoardSvg view={view} selected={sel} onSelect={(i) => { playClick(); setSel(i); }} />
        </div>

        {/* management side */}
        <div className="mono-main">
          {/* players */}
          <div className="mono-players">
            <h3 style={{ marginTop: 0 }}>Players</h3>
            {view.players.map((p, i) => (
              <div key={p.id} className={`mono-player ${p.id === view.currentPlayerId ? 'turn' : ''} ${p.eliminated || p.connected === false ? 'is-offline' : ''}`}>
                <span className="avatar" style={{ width: 28, height: 28, fontSize: 13, background: TOKEN_COLORS[i % TOKEN_COLORS.length], color: '#06121a' }}>{(p.name || '?')[0].toUpperCase()}</span>
                <div className="mono-player-info">
                  <div className="mono-player-name">
                    <b>{p.name}</b>
                    {p.isYou && <span className="muted"> (you)</span>}
                    {p.eliminated && <span className="pill" style={{ marginLeft: 6, borderColor: 'var(--danger)', color: 'var(--danger)' }}>☠ OUT</span>}
                    {p.inJail && !p.eliminated && <span className="pill" style={{ marginLeft: 6, borderColor: 'var(--danger)', color: 'var(--danger)' }}>🔒</span>}
                    {p.jailCards > 0 && <span className="pill" style={{ marginLeft: 6 }}>🎟️{p.jailCards}</span>}
                  </div>
                  <div className="muted mono-player-pos">
                    📍 {spaceName(p.position)} · <b className={p.money < 0 ? 'mono-money-neg' : 'mono-money'}>${p.money}</b><span className="muted"> · NW ${p.netWorth}</span>
                  </div>
                  {p.properties && p.properties.length > 0 && (
                    <div className="prop-chips">
                      {p.properties.map((i) => (
                        <span key={i} className={`prop-chip ${board[i].mortgaged ? 'mtg' : ''}`} style={chipStyle(board[i])} title={board[i].name}>
                          {chipIcon(board[i])}{trunc(board[i].name, 16)}{buildIndicator(board[i])}{board[i].mortgaged ? ' (MTG)' : ''}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* center: dice + active panel */}
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
                ) : <div className="muted" style={{ marginTop: 6 }}>Waiting for {(view.players.find((p) => p.id === auction.turnPid) || {}).name} to bid…</div>}
              </div>
            )}

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

            {endVote && endVote.pending.includes(playerId) && (
              <div className="buy-prompt">
                <div className="buy-title">🏁 End the game by net worth?</div>
                <div className="row gap-8" style={{ justifyContent: 'center', marginTop: 8 }}>
                  <button className="btn primary" onClick={() => act({ type: 'AGREE_END' })}>Agree</button>
                  <button className="btn ghost" onClick={() => act({ type: 'DECLINE_END' })}>Decline</button>
                </div>
              </div>
            )}

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
                <button className="btn primary big roll-btn" disabled={!myTurn} onClick={() => act({ type: 'ROLL' })}>🎲 {myTurn ? 'ROLL' : `${currentName}…`}</button>
              )
            )}

            {(canManage || debtManage) && myProps.length > 0 && (
              <div className="manage-panel">
                <h4 style={{ margin: '4px 0 8px' }}>Manage properties</h4>
                {myProps.map((sp) => (
                  <div className="manage-row" key={sp.index}>
                    <span className="group-dot" style={chipStyle(sp)} />
                    <span className="manage-name">{trunc(sp.name, 16)}{sp.mortgaged ? ' (MTG)' : ''}{buildIndicator(sp)}</span>
                    <div className="spacer" />
                    {sp.type === 'property' && ownsWholeGroup(sp) && !sp.mortgaged && (
                      <>
                        <button className="btn small" onClick={() => act({ type: 'BUILD_HOUSE', spaceIndex: sp.index })}>Build ${sp.houseCost}</button>
                        <button className="btn small ghost" onClick={() => act({ type: 'SELL_HOUSE', spaceIndex: sp.index })}>Sell</button>
                      </>
                    )}
                    {!sp.mortgaged
                      ? <button className="btn small ghost" onClick={() => act({ type: 'MORTGAGE', spaceIndex: sp.index })}>Mortgage</button>
                      : <button className="btn small" onClick={() => act({ type: 'UNMORTGAGE', spaceIndex: sp.index })}>Unmortgage</button>}
                  </div>
                ))}
              </div>
            )}

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
                      {myProps.map((sp) => <span key={sp.index} className={`trade-chip ${tOffer.includes(sp.index) ? 'sel' : ''}`} onClick={() => toggle(tOffer, setTOffer, sp.index)}>{trunc(sp.name, 12)}</span>)}
                    </div>
                    <input className="input" type="number" placeholder="+ your cash" value={tOfferCash} onChange={(e) => setTOfferCash(Math.max(0, parseInt(e.target.value, 10) || 0))} style={{ marginTop: 6 }} />
                    <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>You get:</div>
                    <div className="trade-chips">
                      {targetProps.map((sp) => <span key={sp.index} className={`trade-chip ${tReq.includes(sp.index) ? 'sel' : ''}`} onClick={() => toggle(tReq, setTReq, sp.index)}>{trunc(sp.name, 12)}</span>)}
                    </div>
                    <input className="input" type="number" placeholder="+ their cash" value={tReqCash} onChange={(e) => setTReqCash(Math.max(0, parseInt(e.target.value, 10) || 0))} style={{ marginTop: 6 }} />
                    <button className="btn primary" style={{ marginTop: 8, width: '100%' }}
                      onClick={() => act({ type: 'PROPOSE_TRADE', toPlayerId: tTarget, offerProps: tOffer, offerCash: tOfferCash, requestProps: tReq, requestCash: tReqCash })}>Propose</button>
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
      </div>

      {sel != null && <SpaceDetail view={view} index={sel} onClose={() => setSel(null)} />}

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
