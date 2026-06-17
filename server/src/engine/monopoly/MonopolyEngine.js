'use strict';

const {
  START_MONEY, PASS_GO, JAIL_INDEX, JAIL_FEE, JAIL_MAX_TURNS, BOARD_SIZE, BOARD,
  RAILROAD_RENTS, UTILITY_MULT, OWNABLE_TYPES, CHANCE_CARDS, COMMUNITY_CARDS,
  BANK_HOUSES, BANK_HOTELS, DEFAULT_CONFIG,
} = require('./constants');

/**
 * MonopolyEngine — Phases 1-5. Server-authoritative, in-memory; same interface
 * as the UNO engines.
 *   P1 board/movement/money/jail · P2 buying+rent · P3 cards/tax/jail-options
 *   P4 houses & hotels · P5 mortgaging, trading, auctions, bankruptcy + win.
 *
 * Intents: ROLL, END_TURN, BUY_PROPERTY, DECLINE_PROPERTY, JAIL_PAY,
 *   JAIL_USE_CARD, BUILD_HOUSE{spaceIndex}, SELL_HOUSE{spaceIndex},
 *   MORTGAGE{spaceIndex}, UNMORTGAGE{spaceIndex},
 *   PROPOSE_TRADE{toPlayerId,offerProps,offerCash,requestProps,requestCash},
 *   ACCEPT_TRADE, DECLINE_TRADE, CANCEL_TRADE,
 *   AUCTION_BID{amount}, AUCTION_PASS, SETTLE_DEBT, DECLARE_BANKRUPTCY,
 *   CALL_END_GAME, AGREE_END, DECLINE_END.
 *
 * Phase 5 notes:
 *  - DECLINE_PROPERTY now opens an ascending, turn-based auction (replaces the
 *    Phase-2 "decline leaves it unowned").
 *  - A charge that takes a player below $0 opens a `pendingDebt`; the debtor must
 *    SELL_HOUSE/MORTGAGE then SETTLE_DEBT, or DECLARE_BANKRUPTCY.
 *  - Railroad/utility rent counts only UNMORTGAGED owned ones; a mortgaged space
 *    charges no rent.
 *  - Net worth = cash + property value (mortgaged at half) + building value.
 */
class MonopolyEngine {
  constructor({ players = [], config = {}, rng } = {}) {
    this.rng = rng || (() => Math.random());
    this.state = {
      config: { ...DEFAULT_CONFIG },
      players: players.map((p) => ({
        id: p.id, name: p.name, isHost: !!p.isHost,
        position: 0, money: START_MONEY, inJail: false, jailTurns: 0,
        doublesCount: 0, jailHeld: [], eliminated: false,
      })),
      owners: new Array(BOARD_SIZE).fill(null),
      houses: new Array(BOARD_SIZE).fill(0),
      hotels: new Array(BOARD_SIZE).fill(false),
      mortgaged: new Array(BOARD_SIZE).fill(false),
      bank: { houses: BANK_HOUSES, hotels: BANK_HOTELS },
      chanceDeck: [],
      communityDeck: [],
      current: 0,
      status: 'lobby',
      winner: null,
      lastRoll: null,
      lastCard: null,
      pendingPurchase: null,
      pendingDoubles: false,
      awaitingEnd: false,
      turnDoubles: false, // doubles on the roll currently being resolved (for resume)
      lastCreditorId: null, // creditor for a charge that may open a debt
      pendingTrade: null,
      pendingAuction: null,
      pendingDebt: null,
      endVote: null,
      log: [],
      events: [],
    };
  }

  // ----- lifecycle ---------------------------------------------------------

  start() {
    const s = this.state;
    if (s.players.length < 2) return this._err('NEED_AT_LEAST_2_PLAYERS');
    for (const p of s.players) {
      p.position = 0; p.money = START_MONEY; p.inJail = false; p.jailTurns = 0;
      p.doublesCount = 0; p.jailHeld = []; p.eliminated = false;
    }
    s.owners = new Array(BOARD_SIZE).fill(null);
    s.houses = new Array(BOARD_SIZE).fill(0);
    s.hotels = new Array(BOARD_SIZE).fill(false);
    s.mortgaged = new Array(BOARD_SIZE).fill(false);
    s.bank = { houses: BANK_HOUSES, hotels: BANK_HOTELS };
    s.chanceDeck = this._shuffle(CHANCE_CARDS.map((c) => ({ ...c })));
    s.communityDeck = this._shuffle(COMMUNITY_CARDS.map((c) => ({ ...c })));
    s.current = 0;
    s.status = 'playing';
    s.winner = null;
    s.lastRoll = null; s.lastCard = null;
    s.pendingPurchase = null; s.pendingDoubles = false; s.awaitingEnd = false; s.turnDoubles = false;
    s.lastCreditorId = null; s.pendingTrade = null; s.pendingAuction = null; s.pendingDebt = null; s.endVote = null;
    this._log('MATCH_STARTED', `${s.players[s.current].name} goes first. Everyone starts at Go with $${START_MONEY}.`, { firstPlayer: s.players[s.current].id });
    return { ok: true, events: this._drain() };
  }

  _shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // ----- intent dispatch ---------------------------------------------------

  applyIntent(playerId, intent = {}) {
    const s = this.state;
    if (s.status !== 'playing') return this._err('GAME_NOT_ACTIVE');
    const idx = this._indexOf(playerId);
    if (idx < 0) return this._err('NO_SUCH_PLAYER');
    if (s.players[idx].eliminated) return this._err('ELIMINATED');

    // ----- global pending states (actor may not be the current player) -----
    if (s.pendingTrade) {
      if (intent.type === 'ACCEPT_TRADE') return this._handleAcceptTrade(idx);
      if (intent.type === 'DECLINE_TRADE') return this._handleDeclineTrade(idx);
      if (intent.type === 'CANCEL_TRADE') return this._handleCancelTrade(idx);
      return this._err('AWAITING_TRADE_RESPONSE');
    }
    if (s.pendingAuction) {
      if (intent.type === 'AUCTION_BID') return this._handleAuctionBid(idx, intent.amount);
      if (intent.type === 'AUCTION_PASS') return this._handleAuctionPass(idx);
      return this._err('AUCTION_IN_PROGRESS');
    }
    if (s.pendingDebt) {
      if (s.players[idx].id !== s.pendingDebt.debtorId) return this._err('AWAITING_DEBT');
      switch (intent.type) {
        case 'SELL_HOUSE': return this._handleSell(idx, intent.spaceIndex);
        case 'MORTGAGE': return this._handleMortgage(idx, intent.spaceIndex);
        case 'SETTLE_DEBT': return this._handleSettleDebt(idx);
        case 'DECLARE_BANKRUPTCY': return this._handleDeclareBankruptcy(idx);
        default: return this._err('MUST_RESOLVE_DEBT');
      }
    }
    if (s.endVote) {
      if (intent.type === 'AGREE_END') return this._handleAgreeEnd(idx);
      if (intent.type === 'DECLINE_END') return this._handleDeclineEnd(idx);
      return this._err('AWAITING_END_VOTE');
    }

    // ----- normal turn (current player only) -----
    if (idx !== s.current) return this._err('NOT_YOUR_TURN');
    if (s.pendingPurchase) {
      if (intent.type === 'BUY_PROPERTY') return this._handleBuy(idx);
      if (intent.type === 'DECLINE_PROPERTY') return this._handleDecline(idx);
      return this._err('MUST_RESOLVE_PURCHASE');
    }
    switch (intent.type) {
      case 'JAIL_PAY': return this._handleJailPay(idx);
      case 'JAIL_USE_CARD': return this._handleJailCard(idx);
      case 'BUILD_HOUSE': return this._handleBuild(idx, intent.spaceIndex);
      case 'SELL_HOUSE': return this._handleSell(idx, intent.spaceIndex);
      case 'MORTGAGE': return this._handleMortgage(idx, intent.spaceIndex);
      case 'UNMORTGAGE': return this._handleUnmortgage(idx, intent.spaceIndex);
      case 'PROPOSE_TRADE': return this._handleProposeTrade(idx, intent);
      case 'CALL_END_GAME': return this._handleCallEndGame(idx);
      case 'ROLL':
        if (s.awaitingEnd) return this._err('MUST_END_TURN');
        return this._handleRoll(idx);
      case 'END_TURN':
        return this._handleEndTurn(idx);
      default: return this._err('UNKNOWN_INTENT');
    }
  }

  _rollDie() { return 1 + Math.floor(this.rng() * 6); }
  _handleRoll(idx) { return this.state.players[idx].inJail ? this._jailRoll(idx) : this._freeRoll(idx); }

  _freeRoll(idx) {
    const s = this.state;
    const p = s.players[idx];
    const d1 = this._rollDie(); const d2 = this._rollDie();
    const total = d1 + d2; const doubles = d1 === d2;
    s.lastRoll = { d1, d2, total, playerId: p.id };
    this._log('ROLLED', `${p.name} rolled ${d1} + ${d2} = ${total}${doubles ? ' (doubles!)' : ''}.`, { player: p.id, d1, d2, total, doubles });
    if (doubles) {
      p.doublesCount += 1;
      if (p.doublesCount >= 3) {
        this._sendToJail(idx);
        this._log('THREE_DOUBLES_JAIL', `${p.name} rolled three doubles and was sent to Jail!`, { player: p.id });
        return this._endTurnNow(idx);
      }
    } else { p.doublesCount = 0; }
    this._move(idx, total);
    return this._postMove(idx, total, doubles);
  }

  _jailRoll(idx) {
    const s = this.state;
    const p = s.players[idx];
    const d1 = this._rollDie(); const d2 = this._rollDie();
    const total = d1 + d2; const doubles = d1 === d2;
    s.lastRoll = { d1, d2, total, playerId: p.id };
    this._log('ROLLED', `${p.name} rolled ${d1} + ${d2} = ${total}${doubles ? ' (doubles!)' : ''}.`, { player: p.id, d1, d2, total, doubles });
    if (doubles) {
      p.inJail = false; p.jailTurns = 0; p.doublesCount = 0;
      this._log('LEFT_JAIL', `${p.name} rolled doubles and left Jail.`, { player: p.id });
      this._move(idx, total);
      return this._postMove(idx, total, false);
    }
    p.jailTurns += 1;
    if (p.jailTurns >= JAIL_MAX_TURNS) {
      p.money -= JAIL_FEE; p.inJail = false; p.jailTurns = 0;
      this._log('PAID_JAIL', `${p.name} paid $${JAIL_FEE} after ${JAIL_MAX_TURNS} turns and left Jail.`, { player: p.id, fee: JAIL_FEE });
      this._move(idx, total);
      return this._postMove(idx, total, false);
    }
    this._log('STAYED_IN_JAIL', `${p.name} stayed in Jail (turn ${p.jailTurns}/${JAIL_MAX_TURNS}).`, { player: p.id, jailTurns: p.jailTurns });
    return this._endTurnNow(idx);
  }

  _handleJailPay(idx) {
    const p = this.state.players[idx];
    if (!p.inJail) return this._err('NOT_IN_JAIL');
    p.money -= JAIL_FEE;
    this._log('PAID_JAIL', `${p.name} paid $${JAIL_FEE} to leave Jail.`, { player: p.id, fee: JAIL_FEE });
    this._freeFromJail(idx);
    return this._freeRoll(idx);
  }

  _handleJailCard(idx) {
    const p = this.state.players[idx];
    if (!p.inJail) return this._err('NOT_IN_JAIL');
    if (p.jailHeld.length === 0) return this._err('NO_JAIL_CARD');
    const held = p.jailHeld.pop();
    this._deck(held.deck).push(held.card);
    this._log('USED_JAIL_CARD', `${p.name} used a Get Out of Jail Free card.`, { player: p.id });
    this._freeFromJail(idx);
    return this._freeRoll(idx);
  }

  _freeFromJail(idx) { const p = this.state.players[idx]; p.inJail = false; p.jailTurns = 0; p.doublesCount = 0; }

  _postMove(idx, total, doublesForReroll) {
    const s = this.state;
    s.turnDoubles = doublesForReroll;
    s.lastCreditorId = null;
    if (s.players[idx].inJail) return this._endTurnNow(idx); // dice landed on Go-To-Jail
    const paused = this._resolveLanding(idx, total, 0);
    if (paused) return { ok: true, events: this._drain() }; // purchase decision
    if (s.players[idx].inJail) return this._endTurnNow(idx); // a card sent them to jail
    if (s.players[idx].money < 0) { this._openDebt(idx); return { ok: true, events: this._drain() }; }
    return this._afterResolve(idx, doublesForReroll);
  }

  _afterResolve(idx, rollAgain) {
    const s = this.state;
    if (rollAgain) {
      this._log('ROLL_AGAIN', `${s.players[idx].name} rolled doubles — roll again.`, { player: s.players[idx].id });
      return { ok: true, events: this._drain() };
    }
    s.awaitingEnd = true;
    this._log('AWAITING_END', `${s.players[idx].name} may manage, then end their turn.`, { player: s.players[idx].id });
    return { ok: true, events: this._drain() };
  }

  _endTurnNow(idx) { this._advanceTurn(); return { ok: true, events: this._drain() }; }

  _handleEndTurn(idx) {
    const s = this.state;
    const p = s.players[idx];
    if (p.inJail) return this._err('MUST_ROLL');
    if (p.doublesCount > 0) return this._err('MUST_ROLL');
    if (!s.awaitingEnd) return this._err('MUST_ROLL');
    this._advanceTurn();
    return { ok: true, events: this._drain() };
  }

  // ----- Phase 5: mortgaging -----------------------------------------------

  _mortgageValue(i) { return Math.floor(BOARD[i].price / 2); }
  _unmortgageCost(i) { return Math.round(this._mortgageValue(i) * 1.1); }

  _handleMortgage(idx, spaceIndex) {
    const s = this.state;
    const p = s.players[idx];
    if (!Number.isInteger(spaceIndex) || spaceIndex < 0 || spaceIndex >= BOARD_SIZE) return this._err('BAD_SPACE');
    const space = BOARD[spaceIndex];
    if (!OWNABLE_TYPES.has(space.type)) return this._err('NOT_OWNABLE');
    if (s.owners[spaceIndex] !== p.id) return this._err('NOT_OWNER');
    if (s.mortgaged[spaceIndex]) return this._err('ALREADY_MORTGAGED');
    if (space.type === 'property' && this._groupHasBuildings(space.colorGroup)) return this._err('CANNOT_MORTGAGE_WITH_BUILDINGS');
    s.mortgaged[spaceIndex] = true;
    const value = this._mortgageValue(spaceIndex);
    p.money += value;
    this._log('MORTGAGED', `${p.name} mortgaged ${space.name} for $${value}.`, { player: p.id, index: spaceIndex, value });
    return { ok: true, events: this._drain() };
  }

  _handleUnmortgage(idx, spaceIndex) {
    const s = this.state;
    const p = s.players[idx];
    if (!Number.isInteger(spaceIndex) || spaceIndex < 0 || spaceIndex >= BOARD_SIZE) return this._err('BAD_SPACE');
    const space = BOARD[spaceIndex];
    if (s.owners[spaceIndex] !== p.id) return this._err('NOT_OWNER');
    if (!s.mortgaged[spaceIndex]) return this._err('NOT_MORTGAGED');
    const cost = this._unmortgageCost(spaceIndex);
    if (p.money < cost) return this._err('INSUFFICIENT_FUNDS');
    p.money -= cost;
    s.mortgaged[spaceIndex] = false;
    this._log('UNMORTGAGED', `${p.name} lifted the mortgage on ${space.name} for $${cost}.`, { player: p.id, index: spaceIndex, cost });
    return { ok: true, events: this._drain() };
  }

  _groupHasBuildings(colorGroup) {
    const s = this.state;
    return this._group(colorGroup).some((i) => s.houses[i] > 0 || s.hotels[i]);
  }

  // ----- Phase 4: building / selling ---------------------------------------

  _group(colorGroup) { return BOARD.filter((sp) => sp.colorGroup === colorGroup).map((sp) => sp.index); }
  _levelOf(i) { return this.state.hotels[i] ? 5 : this.state.houses[i]; }

  _handleBuild(idx, spaceIndex) {
    const s = this.state;
    const p = s.players[idx];
    if (s.pendingPurchase) return this._err('MUST_RESOLVE_PURCHASE');
    if (!Number.isInteger(spaceIndex) || spaceIndex < 0 || spaceIndex >= BOARD_SIZE) return this._err('BAD_SPACE');
    const space = BOARD[spaceIndex];
    if (space.type !== 'property') return this._err('NOT_BUILDABLE');
    if (s.owners[spaceIndex] !== p.id) return this._err('NOT_OWNER');
    const group = this._group(space.colorGroup);
    if (!group.every((i) => s.owners[i] === p.id)) return this._err('NOT_FULL_GROUP');
    if (group.some((i) => s.mortgaged[i])) return this._err('GROUP_MORTGAGED');
    const level = this._levelOf(spaceIndex);
    if (level >= 5) return this._err('ALREADY_MAX');
    const minLevel = Math.min(...group.map((i) => this._levelOf(i)));
    if (level !== minLevel) return this._err('UNEVEN_BUILD');
    const isHotel = level === 4;
    if (isHotel) { if (s.bank.hotels < 1) return this._err('NO_HOTELS_LEFT'); }
    else if (s.bank.houses < 1) return this._err('NO_HOUSES_LEFT');
    const cost = space.houseCost;
    if (p.money < cost) return this._err('INSUFFICIENT_FUNDS');
    p.money -= cost;
    if (isHotel) {
      s.houses[spaceIndex] = 0; s.hotels[spaceIndex] = true; s.bank.houses += 4; s.bank.hotels -= 1;
      this._log('BUILT_HOTEL', `${p.name} built a hotel on ${space.name} for $${cost}.`, { player: p.id, index: spaceIndex, cost });
    } else {
      s.houses[spaceIndex] += 1; s.bank.houses -= 1;
      this._log('BUILT_HOUSE', `${p.name} built a house on ${space.name} (now ${s.houses[spaceIndex]}) for $${cost}.`, { player: p.id, index: spaceIndex, cost, houses: s.houses[spaceIndex] });
    }
    return { ok: true, events: this._drain() };
  }

  _handleSell(idx, spaceIndex) {
    const s = this.state;
    const p = s.players[idx];
    if (s.pendingPurchase) return this._err('MUST_RESOLVE_PURCHASE');
    if (!Number.isInteger(spaceIndex) || spaceIndex < 0 || spaceIndex >= BOARD_SIZE) return this._err('BAD_SPACE');
    const space = BOARD[spaceIndex];
    if (space.type !== 'property') return this._err('NOT_BUILDABLE');
    if (s.owners[spaceIndex] !== p.id) return this._err('NOT_OWNER');
    const group = this._group(space.colorGroup);
    const level = this._levelOf(spaceIndex);
    if (level <= 0) return this._err('NOTHING_TO_SELL');
    const maxLevel = Math.max(...group.map((i) => this._levelOf(i)));
    if (level !== maxLevel) return this._err('UNEVEN_SELL');
    const refund = Math.floor(space.houseCost / 2);
    if (s.hotels[spaceIndex]) {
      if (s.bank.houses < 4) return this._err('NO_HOUSES_FOR_DOWNGRADE');
      s.hotels[spaceIndex] = false; s.houses[spaceIndex] = 4; s.bank.houses -= 4; s.bank.hotels += 1;
      p.money += refund;
      this._log('SOLD_HOTEL', `${p.name} sold the hotel on ${space.name} for $${refund} (now 4 houses).`, { player: p.id, index: spaceIndex, refund });
    } else {
      s.houses[spaceIndex] -= 1; s.bank.houses += 1; p.money += refund;
      this._log('SOLD_HOUSE', `${p.name} sold a house on ${space.name} for $${refund} (now ${s.houses[spaceIndex]}).`, { player: p.id, index: spaceIndex, refund, houses: s.houses[spaceIndex] });
    }
    return { ok: true, events: this._drain() };
  }

  // ----- Phase 5: trading --------------------------------------------------

  _handleProposeTrade(idx, intent) {
    const s = this.state;
    const p = s.players[idx];
    const tIdx = this._indexOf(intent.toPlayerId);
    if (tIdx < 0 || tIdx === idx || s.players[tIdx].eliminated) return this._err('BAD_TRADE_TARGET');
    const offerProps = Array.isArray(intent.offerProps) ? intent.offerProps : [];
    const requestProps = Array.isArray(intent.requestProps) ? intent.requestProps : [];
    const offerCash = Number.isInteger(intent.offerCash) ? intent.offerCash : 0;
    const requestCash = Number.isInteger(intent.requestCash) ? intent.requestCash : 0;
    if (offerCash < 0 || requestCash < 0) return this._err('BAD_TRADE');
    if (!offerProps.every((i) => Number.isInteger(i) && s.owners[i] === p.id)) return this._err('OFFER_NOT_OWNED');
    if (!requestProps.every((i) => Number.isInteger(i) && s.owners[i] === s.players[tIdx].id)) return this._err('REQUEST_NOT_OWNED');
    s.pendingTrade = { fromId: p.id, toId: s.players[tIdx].id, offerProps, offerCash, requestProps, requestCash };
    this._log('TRADE_PROPOSED', `${p.name} proposed a trade to ${s.players[tIdx].name}.`, { from: p.id, to: s.players[tIdx].id });
    return { ok: true, events: this._drain() };
  }

  _groupsOf(indices) {
    const set = new Set();
    for (const i of indices) if (BOARD[i] && BOARD[i].type === 'property') set.add(BOARD[i].colorGroup);
    return [...set];
  }

  _groupBuildingProceeds(pid, groups) {
    const s = this.state;
    let total = 0;
    for (const g of groups) {
      for (const i of this._group(g)) {
        if (s.owners[i] !== pid) continue;
        const lvl = s.hotels[i] ? 5 : s.houses[i];
        total += lvl * Math.floor(BOARD[i].houseCost / 2);
      }
    }
    return total;
  }

  _liquidateGroups(pid, groups) {
    const s = this.state;
    const pl = s.players[this._indexOf(pid)];
    for (const g of groups) {
      for (const i of this._group(g)) {
        if (s.owners[i] !== pid) continue;
        const lvl = s.hotels[i] ? 5 : s.houses[i];
        if (lvl === 0) continue;
        const refund = lvl * Math.floor(BOARD[i].houseCost / 2);
        if (s.hotels[i]) { s.bank.hotels += 1; } else { s.bank.houses += s.houses[i]; }
        s.hotels[i] = false; s.houses[i] = 0;
        pl.money += refund;
        this._log('TRADE_LIQUIDATE', `${pl.name}'s buildings on ${BOARD[i].name} were sold for $${refund} before the trade.`, { player: pid, index: i, refund });
      }
    }
  }

  _handleAcceptTrade(idx) {
    const s = this.state;
    const t = s.pendingTrade;
    if (s.players[idx].id !== t.toId) return this._err('NOT_TRADE_TARGET');
    const from = s.players[this._indexOf(t.fromId)];
    const to = s.players[this._indexOf(t.toId)];
    const fromGroups = this._groupsOf(t.offerProps);
    const toGroups = this._groupsOf(t.requestProps);
    // Affordability check using projected liquidation proceeds (no mutation yet).
    const fromFinal = from.money + this._groupBuildingProceeds(from.id, fromGroups) - t.offerCash + t.requestCash;
    const toFinal = to.money + this._groupBuildingProceeds(to.id, toGroups) - t.requestCash + t.offerCash;
    if (fromFinal < 0 || toFinal < 0) return this._err('TRADE_UNAFFORDABLE');
    // Apply: sell buildings on traded groups, transfer cash, transfer ownership.
    this._liquidateGroups(from.id, fromGroups);
    this._liquidateGroups(to.id, toGroups);
    from.money += -t.offerCash + t.requestCash;
    to.money += -t.requestCash + t.offerCash;
    for (const i of t.offerProps) s.owners[i] = to.id; // mortgaged flag travels with the lot
    for (const i of t.requestProps) s.owners[i] = from.id;
    this._log('TRADE_ACCEPTED', `${to.name} accepted the trade with ${from.name}.`, { from: from.id, to: to.id });
    s.pendingTrade = null;
    return { ok: true, events: this._drain() };
  }

  _handleDeclineTrade(idx) {
    const s = this.state;
    if (s.players[idx].id !== s.pendingTrade.toId) return this._err('NOT_TRADE_TARGET');
    this._log('TRADE_DECLINED', `${s.players[idx].name} declined the trade.`, { player: s.players[idx].id });
    s.pendingTrade = null;
    return { ok: true, events: this._drain() };
  }

  _handleCancelTrade(idx) {
    const s = this.state;
    if (s.players[idx].id !== s.pendingTrade.fromId) return this._err('NOT_TRADE_PROPOSER');
    this._log('TRADE_CANCELLED', `${s.players[idx].name} cancelled the trade.`, { player: s.players[idx].id });
    s.pendingTrade = null;
    return { ok: true, events: this._drain() };
  }

  // ----- Phase 5: auctions -------------------------------------------------

  _handleDecline(idx) {
    const s = this.state;
    if (!s.pendingPurchase) return this._err('NO_PENDING_PURCHASE');
    const { spaceIndex, name } = s.pendingPurchase;
    s.pendingPurchase = null;
    const activePids = s.players.filter((p) => !p.eliminated).map((p) => p.id);
    s.pendingAuction = { spaceIndex, name, currentBid: 0, highBidderId: null, minBid: 10, activePids, turnIdx: 0 };
    this._log('AUCTION_OPENED', `${s.players[idx].name} declined ${name}; it goes to auction (min $10).`, { index: spaceIndex, name });
    return { ok: true, events: this._drain() };
  }

  _handleAuctionBid(idx, amount) {
    const s = this.state;
    const a = s.pendingAuction;
    const p = s.players[idx];
    if (p.id !== a.activePids[a.turnIdx]) return this._err('NOT_YOUR_BID');
    if (!Number.isInteger(amount) || amount <= a.currentBid || amount < a.minBid) return this._err('BID_TOO_LOW');
    if (amount > p.money) return this._err('BID_OVER_CASH');
    a.currentBid = amount; a.highBidderId = p.id;
    this._log('AUCTION_BID', `${p.name} bid $${amount} for ${a.name}.`, { player: p.id, amount });
    a.turnIdx = (a.turnIdx + 1) % a.activePids.length;
    return this._resolveAuctionIfDone();
  }

  _handleAuctionPass(idx) {
    const s = this.state;
    const a = s.pendingAuction;
    const p = s.players[idx];
    if (p.id !== a.activePids[a.turnIdx]) return this._err('NOT_YOUR_BID');
    this._log('AUCTION_PASS', `${p.name} passed.`, { player: p.id });
    a.activePids.splice(a.turnIdx, 1);
    if (a.turnIdx >= a.activePids.length) a.turnIdx = 0;
    return this._resolveAuctionIfDone();
  }

  _resolveAuctionIfDone() {
    const s = this.state;
    const a = s.pendingAuction;
    if (a.activePids.length > 1) return { ok: true, events: this._drain() };
    // ≤ 1 active bidder remains → finalize
    if (a.highBidderId) {
      const winner = s.players[this._indexOf(a.highBidderId)];
      winner.money -= a.currentBid;
      s.owners[a.spaceIndex] = winner.id;
      this._log('AUCTION_WON', `${winner.name} won ${a.name} at auction for $${a.currentBid}.`, { player: winner.id, index: a.spaceIndex, amount: a.currentBid });
    } else {
      this._log('AUCTION_UNSOLD', `${a.name} drew no bids and stays unowned.`, { index: a.spaceIndex });
    }
    s.pendingAuction = null;
    // resume the main player's turn (the decliner is s.current)
    if (s.players[s.current].money < 0) { this._openDebt(s.current); return { ok: true, events: this._drain() }; }
    return this._afterResolve(s.current, s.turnDoubles);
  }

  // ----- Phase 5: debt / bankruptcy ----------------------------------------

  _openDebt(idx) {
    const s = this.state;
    const p = s.players[idx];
    s.pendingDebt = { debtorId: p.id, amount: -p.money, creditorId: s.lastCreditorId };
    this._log('DEBT', `${p.name} owes $${-p.money} and must raise funds or go bankrupt.`, { debtor: p.id, amount: -p.money, creditor: s.lastCreditorId });
  }

  _handleSettleDebt(idx) {
    const s = this.state;
    const p = s.players[idx];
    if (p.money < 0) return this._err('CANT_SETTLE');
    this._log('DEBT_SETTLED', `${p.name} settled their debt.`, { player: p.id });
    s.pendingDebt = null;
    return this._afterResolve(idx, s.turnDoubles);
  }

  _handleDeclareBankruptcy(idx) {
    const s = this.state;
    const debtor = s.players[idx];
    const creditorId = s.pendingDebt ? s.pendingDebt.creditorId : null;
    const creditor = creditorId ? s.players[this._indexOf(creditorId)] : null;

    // Sell all buildings to the bank; proceeds form part of the estate.
    let proceeds = 0;
    s.owners.forEach((o, i) => {
      if (o !== debtor.id) return;
      const lvl = s.hotels[i] ? 5 : s.houses[i];
      if (lvl > 0) {
        proceeds += lvl * Math.floor(BOARD[i].houseCost / 2);
        if (s.hotels[i]) s.bank.hotels += 1; else s.bank.houses += s.houses[i];
        s.hotels[i] = false; s.houses[i] = 0;
      }
    });
    const estateCash = debtor.money + proceeds; // may be negative (creditor absorbs the loss)
    const props = [];
    s.owners.forEach((o, i) => { if (o === debtor.id) props.push(i); });

    if (creditor) {
      for (const i of props) s.owners[i] = creditor.id; // mortgages travel; receiver may unmortgage later
      if (estateCash > 0) creditor.money += estateCash;
      this._log('BANKRUPT_TO_PLAYER', `${debtor.name} went bankrupt; estate goes to ${creditor.name}.`, { debtor: debtor.id, creditor: creditor.id, props: props.length });
    } else {
      for (const i of props) { s.owners[i] = null; s.mortgaged[i] = false; } // returned to bank, unowned
      this._log('BANKRUPT_TO_BANK', `${debtor.name} went bankrupt; properties returned to the bank.`, { debtor: debtor.id, props: props.length });
    }
    debtor.money = 0;
    debtor.eliminated = true;
    // release any held jail cards back to their decks
    for (const held of debtor.jailHeld) this._deck(held.deck).push(held.card);
    debtor.jailHeld = [];
    s.pendingDebt = null;
    this._log('ELIMINATED', `${debtor.name} is out of the game.`, { player: debtor.id });
    if (this._checkWin()) return { ok: true, events: this._drain() };
    this._advanceTurn();
    return { ok: true, events: this._drain() };
  }

  // ----- Phase 5: win / agreed end -----------------------------------------

  _netWorth(idx) {
    const s = this.state;
    const p = s.players[idx];
    let w = p.money;
    s.owners.forEach((o, i) => {
      if (o !== p.id) return;
      const sp = BOARD[i];
      w += s.mortgaged[i] ? this._mortgageValue(i) : sp.price;
      if (sp.type === 'property') w += (s.hotels[i] ? 5 : s.houses[i]) * sp.houseCost;
    });
    return w;
  }

  _checkWin() {
    const s = this.state;
    const alive = s.players.filter((p) => !p.eliminated);
    if (alive.length === 1) {
      s.status = 'finished';
      s.winner = alive[0].id;
      this._log('MATCH_FINISHED', `${alive[0].name} is the last player standing and wins!`, { winner: alive[0].id, reason: 'last-standing' });
      return true;
    }
    return false;
  }

  _handleCallEndGame(idx) {
    const s = this.state;
    const others = s.players.filter((p) => !p.eliminated && p.id !== s.players[idx].id).map((p) => p.id);
    s.endVote = { callerId: s.players[idx].id, pending: others, agreed: [s.players[idx].id] };
    this._log('END_CALLED', `${s.players[idx].name} called to end the game — highest net worth wins if all agree.`, { caller: s.players[idx].id });
    if (others.length === 0) return this._finishByNetWorth();
    return { ok: true, events: this._drain() };
  }

  _handleAgreeEnd(idx) {
    const s = this.state;
    const v = s.endVote;
    const pid = s.players[idx].id;
    if (!v.pending.includes(pid)) return this._err('NOT_VOTING');
    v.pending = v.pending.filter((x) => x !== pid);
    v.agreed.push(pid);
    this._log('END_AGREE', `${s.players[idx].name} agreed to end the game.`, { player: pid });
    if (v.pending.length === 0) return this._finishByNetWorth();
    return { ok: true, events: this._drain() };
  }

  _handleDeclineEnd(idx) {
    const s = this.state;
    const pid = s.players[idx].id;
    if (!s.endVote.pending.includes(pid)) return this._err('NOT_VOTING');
    this._log('END_DECLINED', `${s.players[idx].name} declined to end the game — play continues.`, { player: pid });
    s.endVote = null;
    return { ok: true, events: this._drain() };
  }

  _finishByNetWorth() {
    const s = this.state;
    s.endVote = null;
    let best = -1; let bestWorth = -Infinity;
    s.players.forEach((p, i) => {
      if (p.eliminated) return;
      const w = this._netWorth(i);
      if (w > bestWorth) { bestWorth = w; best = i; }
    });
    s.status = 'finished';
    s.winner = s.players[best].id;
    this._log('MATCH_FINISHED', `${s.players[best].name} wins by net worth ($${bestWorth})!`, { winner: s.players[best].id, reason: 'net-worth', netWorth: bestWorth });
    return { ok: true, events: this._drain() };
  }

  // ----- landing resolution ------------------------------------------------

  _resolveLanding(idx, total, depth) {
    const s = this.state;
    const p = s.players[idx];
    const space = BOARD[p.position];
    if (OWNABLE_TYPES.has(space.type)) return this._resolveOwnable(idx, p.position, total);
    switch (space.type) {
      case 'tax':
        p.money -= space.amount;
        this._log('TAX_PAID', `${p.name} paid $${space.amount} ${space.name} (balance $${p.money}).`, { player: p.id, amount: space.amount });
        return false;
      case 'goToJail':
        this._sendToJail(idx);
        this._log('GO_TO_JAIL', `${p.name} was sent to Jail!`, { player: p.id });
        return false;
      case 'chance': return this._drawAndApply(idx, 'chance', total, depth);
      case 'communityChest': return this._drawAndApply(idx, 'community', total, depth);
      default: return false;
    }
  }

  _resolveOwnable(idx, pos, total) {
    const s = this.state;
    const p = s.players[idx];
    const space = BOARD[pos];
    const owner = s.owners[pos];
    if (owner == null) {
      s.pendingPurchase = { spaceIndex: pos, name: space.name, price: space.price };
      this._log('BUY_OPTION', `${p.name} may buy ${space.name} for $${space.price}.`, { player: p.id, index: pos, name: space.name, price: space.price });
      return true;
    }
    if (owner === p.id) {
      this._log('OWN_PROPERTY', `${p.name} landed on their own ${space.name}.`, { player: p.id, index: pos });
      return false;
    }
    if (s.mortgaged[pos]) {
      this._log('MORTGAGED_NO_RENT', `${space.name} is mortgaged — no rent due.`, { player: p.id, index: pos });
      return false;
    }
    const rent = this._computeRent(pos, total);
    this._transferRent(idx, owner, rent, space.name, pos);
    return false;
  }

  _transferRent(idx, ownerId, rent, spaceName, pos) {
    const s = this.state;
    const p = s.players[idx];
    const ownerPlayer = s.players[this._indexOf(ownerId)];
    p.money -= rent;
    if (ownerPlayer) ownerPlayer.money += rent;
    s.lastCreditorId = ownerId; // for a possible debt
    this._log('RENT_PAID',
      `${p.name} paid $${rent} rent to ${ownerPlayer ? ownerPlayer.name : '???'} for ${spaceName} (balance $${p.money}).`,
      { from: p.id, to: ownerId, amount: rent, index: pos, balance: p.money });
  }

  _computeRent(index, total) {
    const s = this.state;
    const space = BOARD[index];
    const owner = s.owners[index];
    if (s.mortgaged[index]) return 0;
    if (space.type === 'railroad') return this._railroadRent(owner);
    if (space.type === 'utility') {
      const count = s.owners.filter((o, i) => o === owner && BOARD[i].type === 'utility' && !s.mortgaged[i]).length;
      return total * (UTILITY_MULT[count] || 4);
    }
    if (s.hotels[index]) return space.rentTable[5];
    if (s.houses[index] > 0) return space.rentTable[s.houses[index]];
    let rent = space.rentTable[0];
    const group = this._group(space.colorGroup);
    if (group.every((i) => s.owners[i] === owner)) rent *= 2;
    return rent;
  }

  _railroadRent(owner) {
    const s = this.state;
    const count = s.owners.filter((o, i) => o === owner && BOARD[i].type === 'railroad' && !s.mortgaged[i]).length;
    return RAILROAD_RENTS[count] || 0;
  }

  // ----- cards -------------------------------------------------------------

  _deck(name) { return name === 'chance' ? this.state.chanceDeck : this.state.communityDeck; }

  _drawAndApply(idx, deckName, total, depth) {
    const s = this.state;
    const p = s.players[idx];
    const deck = this._deck(deckName);
    if (deck.length === 0) return false;
    const card = deck.shift();
    s.lastCard = { deck: deckName, text: card.text };
    this._log('CARD_DRAWN', `${p.name} drew ${deckName === 'chance' ? 'Chance' : 'Community Chest'}: “${card.text}”`, { player: p.id, deck: deckName, cardId: card.id, text: card.text });
    if (card.effect.kind !== 'getOutOfJailFree') deck.push(card);
    return this._applyEffect(idx, card.effect, deckName, card, total, depth);
  }

  _applyEffect(idx, eff, deckName, card, total, depth) {
    const s = this.state;
    const p = s.players[idx];
    switch (eff.kind) {
      case 'collect':
        p.money += eff.amount;
        this._log('CARD_COLLECT', `${p.name} collected $${eff.amount} (balance $${p.money}).`, { player: p.id, amount: eff.amount });
        return false;
      case 'pay':
        p.money -= eff.amount; s.lastCreditorId = null;
        this._log('CARD_PAY', `${p.name} paid $${eff.amount} to the bank (balance $${p.money}).`, { player: p.id, amount: eff.amount });
        return false;
      case 'collectFromEach': {
        let got = 0;
        for (const other of s.players) { if (other.id === p.id || other.eliminated) continue; other.money -= eff.amount; got += eff.amount; }
        p.money += got;
        this._log('CARD_COLLECT_EACH', `${p.name} collected $${eff.amount} from each player ($${got} total).`, { player: p.id, amount: eff.amount, total: got });
        return false;
      }
      case 'payEach': {
        let paid = 0;
        for (const other of s.players) { if (other.id === p.id || other.eliminated) continue; other.money += eff.amount; paid += eff.amount; }
        p.money -= paid; s.lastCreditorId = null;
        this._log('CARD_PAY_EACH', `${p.name} paid $${eff.amount} to each player ($${paid} total).`, { player: p.id, amount: eff.amount, total: paid });
        return false;
      }
      case 'getOutOfJailFree':
        p.jailHeld.push({ deck: deckName, card });
        this._log('GOT_JAIL_CARD', `${p.name} keeps a Get Out of Jail Free card.`, { player: p.id });
        return false;
      case 'goToJail':
        this._sendToJail(idx);
        this._log('GO_TO_JAIL', `${p.name} was sent to Jail (card).`, { player: p.id });
        return false;
      case 'repairs': {
        const { houses, hotels } = this._countBuildings(p.id);
        const cost = houses * eff.perHouse + hotels * eff.perHotel;
        p.money -= cost; s.lastCreditorId = null;
        this._log('CARD_REPAIRS', `${p.name} paid $${cost} for repairs (${houses} houses, ${hotels} hotels).`, { player: p.id, cost, houses, hotels });
        return false;
      }
      case 'moveTo': return this._doMoveTo(idx, eff.index, !!eff.passGo, total, depth);
      case 'moveBy': return this._doMoveBy(idx, eff.steps, total, depth);
      case 'moveToNearest': return this._doMoveToNearest(idx, eff.target, eff.payMultiplier, total, depth);
      default: return false;
    }
  }

  _doMoveTo(idx, to, passGo, total, depth) {
    const p = this.state.players[idx];
    const from = p.position;
    p.position = to;
    if (passGo && to < from) { p.money += PASS_GO; this._log('PASSED_GO', `${p.name} passed Go (+$${PASS_GO}).`, { player: p.id, amount: PASS_GO }); }
    this._log('CARD_MOVE', `${p.name} advanced to ${BOARD[to].name}.`, { player: p.id, index: to });
    return this._resolveLanding(idx, total, depth + 1);
  }

  _doMoveBy(idx, steps, total, depth) {
    const p = this.state.players[idx];
    const from = p.position;
    const raw = from + steps;
    p.position = ((raw % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE;
    if (steps > 0 && raw >= BOARD_SIZE) { p.money += PASS_GO; this._log('PASSED_GO', `${p.name} passed Go (+$${PASS_GO}).`, { player: p.id, amount: PASS_GO }); }
    this._log('CARD_MOVE', `${p.name} moved to ${BOARD[p.position].name}.`, { player: p.id, index: p.position });
    return this._resolveLanding(idx, total, depth + 1);
  }

  _doMoveToNearest(idx, target, payMultiplier, total, depth) {
    const s = this.state;
    const p = s.players[idx];
    const from = p.position;
    let pos = from;
    for (let step = 1; step <= BOARD_SIZE; step++) { const cand = (from + step) % BOARD_SIZE; if (BOARD[cand].type === target) { pos = cand; break; } }
    if (pos < from) { p.money += PASS_GO; this._log('PASSED_GO', `${p.name} passed Go (+$${PASS_GO}).`, { player: p.id, amount: PASS_GO }); }
    p.position = pos;
    this._log('CARD_MOVE', `${p.name} advanced to the nearest ${target} (${BOARD[pos].name}).`, { player: p.id, index: pos });
    const owner = s.owners[pos];
    if (owner == null) {
      s.pendingPurchase = { spaceIndex: pos, name: BOARD[pos].name, price: BOARD[pos].price };
      this._log('BUY_OPTION', `${p.name} may buy ${BOARD[pos].name} for $${BOARD[pos].price}.`, { player: p.id, index: pos, price: BOARD[pos].price });
      return true;
    }
    if (owner === p.id || s.mortgaged[pos]) return false;
    let rent;
    if (target === 'utility') {
      const throwTotal = this._rollDie() + this._rollDie();
      rent = payMultiplier * throwTotal;
      this._log('UTILITY_THROW', `${p.name} threw ${throwTotal} for utility rent.`, { player: p.id, throwTotal });
    } else {
      rent = payMultiplier * this._railroadRent(owner);
    }
    this._transferRent(idx, owner, rent, BOARD[pos].name, pos);
    return false;
  }

  _countBuildings(pid) {
    const s = this.state;
    let houses = 0; let hotels = 0;
    s.owners.forEach((o, i) => {
      if (o !== pid) return;
      if (s.hotels[i]) hotels += 1; else houses += s.houses[i];
    });
    return { houses, hotels };
  }

  // ----- buy / decline -----------------------------------------------------

  _handleBuy(idx) {
    const s = this.state;
    const p = s.players[idx];
    if (!s.pendingPurchase) return this._err('NO_PENDING_PURCHASE');
    const { spaceIndex, name, price } = s.pendingPurchase;
    p.money -= price;
    s.owners[spaceIndex] = p.id;
    s.pendingPurchase = null;
    this._log('BOUGHT', `${p.name} bought ${name} for $${price} (balance $${p.money}).`, { player: p.id, index: spaceIndex, price });
    if (p.money < 0) { this._openDebt(idx); return { ok: true, events: this._drain() }; }
    return this._afterResolve(idx, s.turnDoubles);
  }

  // ----- movement / jail ---------------------------------------------------

  _move(idx, steps) {
    const s = this.state;
    const p = s.players[idx];
    const from = p.position;
    const raw = from + steps;
    const np = ((raw % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE;
    p.position = np;
    if (raw >= BOARD_SIZE) { p.money += PASS_GO; this._log('PASSED_GO', `${p.name} passed Go (+$${PASS_GO}).`, { player: p.id, amount: PASS_GO }); }
    const space = BOARD[np];
    if (space.type === 'goToJail') { this._sendToJail(idx); this._log('GO_TO_JAIL', `${p.name} landed on Go To Jail and went to Jail!`, { player: p.id }); return; }
    this._log('LANDED', `${p.name} moved to ${space.name}.`, { player: p.id, index: np, name: space.name, spaceType: space.type });
  }

  _sendToJail(idx) { const p = this.state.players[idx]; p.position = JAIL_INDEX; p.inJail = true; p.jailTurns = 0; p.doublesCount = 0; }

  _nextActiveIndex(from) {
    const s = this.state;
    const n = s.players.length;
    let i = from;
    for (let step = 0; step < n; step++) {
      i = (i + 1) % n;
      if (!s.players[i].eliminated) return i;
    }
    return from;
  }

  _advanceTurn() {
    const s = this.state;
    if (s.status === 'finished') return;
    s.players[s.current].doublesCount = 0;
    s.awaitingEnd = false;
    s.current = this._nextActiveIndex(s.current);
    this._log('TURN_CHANGED', `It's ${s.players[s.current].name}'s turn.`, { player: s.players[s.current].id });
  }

  // ----- helpers -----------------------------------------------------------

  _indexOf(playerId) { return this.state.players.findIndex((p) => p.id === playerId); }
  _ownedBy(pid) { const out = []; this.state.owners.forEach((o, i) => { if (o === pid) out.push(i); }); return out; }

  _log(type, msg, data = {}) {
    this.state.events.push({ type, msg, ...data });
    this.state.log.push({ type, msg });
    if (this.state.log.length > 80) this.state.log.shift();
  }
  _drain() { const ev = this.state.events.slice(); this.state.events = []; return ev; }
  _err(code) { return { ok: false, error: code, events: [] }; }

  view(playerId) {
    const s = this.state;
    const cur = s.players[s.current];
    const jailOptions = cur && cur.inJail && !cur.eliminated
      ? { canPay: true, canUseCard: cur.jailHeld.length > 0, mustRollAttempt: true }
      : null;
    const auction = s.pendingAuction
      ? {
          spaceIndex: s.pendingAuction.spaceIndex, name: s.pendingAuction.name,
          currentBid: s.pendingAuction.currentBid, highBidderId: s.pendingAuction.highBidderId,
          minBid: s.pendingAuction.minBid, turnPid: s.pendingAuction.activePids[s.pendingAuction.turnIdx] || null,
          activePids: [...s.pendingAuction.activePids],
        }
      : null;
    return {
      status: s.status,
      winner: s.winner,
      currentPlayerId: cur ? cur.id : null,
      lastRoll: s.lastRoll ? { d1: s.lastRoll.d1, d2: s.lastRoll.d2, total: s.lastRoll.total } : null,
      lastCard: s.lastCard ? { ...s.lastCard } : null,
      board: BOARD.map((sp) => ({
        ...sp,
        ownerId: OWNABLE_TYPES.has(sp.type) ? s.owners[sp.index] : null,
        houses: sp.type === 'property' ? s.houses[sp.index] : 0,
        hotel: sp.type === 'property' ? !!s.hotels[sp.index] : false,
        mortgaged: OWNABLE_TYPES.has(sp.type) ? !!s.mortgaged[sp.index] : false,
      })),
      bank: { ...s.bank },
      pendingPurchase: s.pendingPurchase ? { ...s.pendingPurchase } : null,
      pendingTrade: s.pendingTrade ? { ...s.pendingTrade } : null,
      pendingAuction: auction,
      pendingDebt: s.pendingDebt ? { ...s.pendingDebt } : null,
      endVote: s.endVote ? { callerId: s.endVote.callerId, pending: [...s.endVote.pending], agreed: [...s.endVote.agreed] } : null,
      awaitingEnd: s.awaitingEnd,
      jailOptions,
      config: { ...s.config },
      log: s.log.slice(-30),
      players: s.players.map((p, i) => ({
        id: p.id, name: p.name, isHost: p.isHost,
        position: p.position, money: p.money, inJail: p.inJail, jailTurns: p.jailTurns,
        jailCards: p.jailHeld.length, properties: this._ownedBy(p.id),
        netWorth: this._netWorth(i), eliminated: p.eliminated, isYou: p.id === playerId,
      })),
    };
  }

  publicState() { return this.view(null); }
}

module.exports = { MonopolyEngine, DEFAULT_CONFIG };
