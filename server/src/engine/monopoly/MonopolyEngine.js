'use strict';

const {
  START_MONEY, PASS_GO, JAIL_INDEX, JAIL_FEE, JAIL_MAX_TURNS, BOARD_SIZE, BOARD,
  RAILROAD_RENTS, UTILITY_MULT, OWNABLE_TYPES, DEFAULT_CONFIG,
} = require('./constants');

/**
 * MonopolyEngine — Phase 1 (board/movement/money/jail) + Phase 2 (buying
 * properties + rent). Server-authoritative, in-memory. Same interface as the
 * UNO engines so rooms.js stays generic.
 *
 * Intents: ROLL, END_TURN, BUY_PROPERTY, DECLINE_PROPERTY.
 *
 * Phase 2 landing resolution:
 *  - Unowned ownable space → PAUSE the turn with `pendingPurchase`; the current
 *    player must BUY_PROPERTY or DECLINE_PROPERTY before continuing.
 *  - Owned by someone else → auto-pay rent (property base, doubled for a full
 *    color group; railroad scales by count; utility = dice total × 4/×10).
 *  - Own / non-ownable space → announce only.
 * Money MAY go negative (no bankruptcy yet) — it is just transferred and logged.
 * Houses/trading/mortgaging/auctions and tax/Chance/CC effects are later phases.
 */
class MonopolyEngine {
  constructor({ players = [], config = {}, rng } = {}) {
    this.rng = rng || (() => Math.random());
    this.state = {
      config: { ...DEFAULT_CONFIG },
      players: players.map((p) => ({
        id: p.id,
        name: p.name,
        isHost: !!p.isHost,
        position: 0,
        money: START_MONEY,
        inJail: false,
        jailTurns: 0,
        doublesCount: 0,
        eliminated: false,
      })),
      owners: new Array(BOARD_SIZE).fill(null), // ownerId | null per space
      current: 0,
      status: 'lobby',
      winner: null,
      lastRoll: null,
      pendingPurchase: null, // { spaceIndex, name, price } — current player decides
      pendingDoubles: false, // whether the paused roll was doubles (re-roll after decision)
      log: [],
      events: [],
    };
  }

  // ----- lifecycle ---------------------------------------------------------

  start() {
    const s = this.state;
    if (s.players.length < 2) return this._err('NEED_AT_LEAST_2_PLAYERS');
    for (const p of s.players) {
      p.position = 0; p.money = START_MONEY; p.inJail = false; p.jailTurns = 0; p.doublesCount = 0;
    }
    s.owners = new Array(BOARD_SIZE).fill(null);
    s.current = 0;
    s.status = 'playing';
    s.winner = null;
    s.lastRoll = null;
    s.pendingPurchase = null;
    s.pendingDoubles = false;
    this._log('MATCH_STARTED', `${s.players[s.current].name} goes first. Everyone starts at Go with $${START_MONEY}.`, { firstPlayer: s.players[s.current].id });
    return { ok: true, events: this._drain() };
  }

  // ----- intent dispatch ---------------------------------------------------

  applyIntent(playerId, intent = {}) {
    const s = this.state;
    if (s.status !== 'playing') return this._err('GAME_NOT_ACTIVE');
    const idx = this._indexOf(playerId);
    if (idx < 0) return this._err('NO_SUCH_PLAYER');
    if (idx !== s.current) return this._err('NOT_YOUR_TURN');
    switch (intent.type) {
      case 'BUY_PROPERTY': return this._handleBuy(idx);
      case 'DECLINE_PROPERTY': return this._handleDecline(idx);
      case 'ROLL':
        if (s.pendingPurchase) return this._err('MUST_RESOLVE_PURCHASE');
        return this._handleRoll(idx);
      case 'END_TURN':
        if (s.pendingPurchase) return this._err('MUST_RESOLVE_PURCHASE');
        return this._handleEndTurn(idx);
      default: return this._err('UNKNOWN_INTENT');
    }
  }

  _rollDie() { return 1 + Math.floor(this.rng() * 6); }

  _handleRoll(idx) {
    const s = this.state;
    const p = s.players[idx];
    const d1 = this._rollDie();
    const d2 = this._rollDie();
    const total = d1 + d2;
    const doubles = d1 === d2;
    s.lastRoll = { d1, d2, total, playerId: p.id };
    this._log('ROLLED', `${p.name} rolled ${d1} + ${d2} = ${total}${doubles ? ' (doubles!)' : ''}.`, { player: p.id, d1, d2, total, doubles });

    // ----- in jail -----
    if (p.inJail) {
      if (doubles) {
        p.inJail = false; p.jailTurns = 0; p.doublesCount = 0;
        this._log('LEFT_JAIL', `${p.name} rolled doubles and left Jail.`, { player: p.id });
        this._move(idx, total);
        return this._postMove(idx, total, false); // no bonus re-roll from jail
      }
      p.jailTurns += 1;
      if (p.jailTurns >= JAIL_MAX_TURNS) {
        p.money -= JAIL_FEE;
        p.inJail = false; p.jailTurns = 0;
        this._log('PAID_JAIL', `${p.name} paid $${JAIL_FEE} after ${JAIL_MAX_TURNS} turns and left Jail.`, { player: p.id, fee: JAIL_FEE });
        this._move(idx, total);
        return this._postMove(idx, total, false);
      }
      this._log('STAYED_IN_JAIL', `${p.name} stayed in Jail (turn ${p.jailTurns}/${JAIL_MAX_TURNS}).`, { player: p.id, jailTurns: p.jailTurns });
      return this._afterResolve(idx, false);
    }

    // ----- normal turn -----
    if (doubles) {
      p.doublesCount += 1;
      if (p.doublesCount >= 3) {
        this._sendToJail(idx);
        this._log('THREE_DOUBLES_JAIL', `${p.name} rolled three doubles and was sent to Jail!`, { player: p.id });
        return this._afterResolve(idx, false);
      }
    } else {
      p.doublesCount = 0;
    }

    this._move(idx, total);
    return this._postMove(idx, total, doubles);
  }

  // After a move: jail (goToJail) ends the turn; an unowned ownable space pauses
  // for a buy/decline; everything else resolves and continues (re-roll/auto-pass).
  _postMove(idx, total, doublesForReroll) {
    const s = this.state;
    if (s.players[idx].inJail) return this._afterResolve(idx, false); // landed on Go-To-Jail
    const paused = this._resolveLanding(idx, total);
    if (paused) {
      s.pendingDoubles = doublesForReroll;
      return { ok: true, events: this._drain() };
    }
    return this._afterResolve(idx, doublesForReroll);
  }

  _afterResolve(idx, rollAgain) {
    const s = this.state;
    if (rollAgain) {
      this._log('ROLL_AGAIN', `${s.players[idx].name} rolled doubles — roll again.`, { player: s.players[idx].id });
      return { ok: true, events: this._drain() };
    }
    this._advanceTurn();
    return { ok: true, events: this._drain() };
  }

  _handleEndTurn(idx) {
    const s = this.state;
    const p = s.players[idx];
    if (p.doublesCount > 0 && !p.inJail) return this._err('MUST_ROLL');
    if (s.lastRoll && s.lastRoll.playerId === p.id) {
      this._advanceTurn();
      return { ok: true, events: this._drain() };
    }
    return this._err('MUST_ROLL');
  }

  // ----- Phase 2: landing resolution / buy / rent --------------------------

  _resolveLanding(idx, total) {
    const s = this.state;
    const p = s.players[idx];
    const space = BOARD[p.position];
    if (!OWNABLE_TYPES.has(space.type)) return false; // tax/chance/CC/free parking — announce only
    const owner = s.owners[p.position];
    if (owner == null) {
      s.pendingPurchase = { spaceIndex: p.position, name: space.name, price: space.price };
      this._log('BUY_OPTION', `${p.name} may buy ${space.name} for $${space.price}.`, { player: p.id, index: p.position, name: space.name, price: space.price });
      return true; // pause for decision
    }
    if (owner === p.id) {
      this._log('OWN_PROPERTY', `${p.name} landed on their own ${space.name}.`, { player: p.id, index: p.position });
      return false;
    }
    // owned by someone else → pay rent (auto)
    const rent = this._computeRent(p.position, total);
    const ownerPlayer = s.players[this._indexOf(owner)];
    p.money -= rent;
    if (ownerPlayer) ownerPlayer.money += rent;
    this._log('RENT_PAID',
      `${p.name} paid $${rent} rent to ${ownerPlayer ? ownerPlayer.name : '???'} for ${space.name} (balance $${p.money}).`,
      { from: p.id, to: owner, amount: rent, index: p.position, balance: p.money });
    return false;
  }

  _computeRent(index, total) {
    const s = this.state;
    const space = BOARD[index];
    const owner = s.owners[index];
    if (space.type === 'railroad') {
      const count = s.owners.filter((o, i) => o === owner && BOARD[i].type === 'railroad').length;
      return RAILROAD_RENTS[count] || 0;
    }
    if (space.type === 'utility') {
      const count = s.owners.filter((o, i) => o === owner && BOARD[i].type === 'utility').length;
      return total * (UTILITY_MULT[count] || 4);
    }
    // property: base rent, doubled if owner holds the full color group (no building yet)
    let rent = space.rentTable[0];
    const groupIdx = BOARD.filter((sp) => sp.colorGroup === space.colorGroup).map((sp) => sp.index);
    const ownsWholeGroup = groupIdx.every((i) => s.owners[i] === owner);
    if (ownsWholeGroup) rent *= 2;
    return rent;
  }

  _handleBuy(idx) {
    const s = this.state;
    const p = s.players[idx];
    if (!s.pendingPurchase) return this._err('NO_PENDING_PURCHASE');
    const { spaceIndex, name, price } = s.pendingPurchase;
    p.money -= price;
    s.owners[spaceIndex] = p.id;
    s.pendingPurchase = null;
    this._log('BOUGHT', `${p.name} bought ${name} for $${price} (balance $${p.money}).`, { player: p.id, index: spaceIndex, price });
    const doubles = s.pendingDoubles; s.pendingDoubles = false;
    return this._afterResolve(idx, doubles);
  }

  _handleDecline(idx) {
    const s = this.state;
    if (!s.pendingPurchase) return this._err('NO_PENDING_PURCHASE');
    const { name } = s.pendingPurchase;
    s.pendingPurchase = null;
    this._log('DECLINED', `${s.players[idx].name} declined to buy ${name}.`, { player: s.players[idx].id });
    const doubles = s.pendingDoubles; s.pendingDoubles = false;
    return this._afterResolve(idx, doubles);
  }

  // ----- movement / jail ---------------------------------------------------

  _move(idx, steps) {
    const s = this.state;
    const p = s.players[idx];
    const from = p.position;
    const raw = from + steps;
    const np = ((raw % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE;
    p.position = np;
    if (raw >= BOARD_SIZE) {
      p.money += PASS_GO;
      this._log('PASSED_GO', `${p.name} passed Go (+$${PASS_GO}).`, { player: p.id, amount: PASS_GO });
    }
    const space = BOARD[np];
    if (space.type === 'goToJail') {
      this._sendToJail(idx);
      this._log('GO_TO_JAIL', `${p.name} landed on Go To Jail and went to Jail!`, { player: p.id });
      return;
    }
    this._log('LANDED', `${p.name} moved to ${space.name}.`, { player: p.id, index: np, name: space.name, spaceType: space.type });
  }

  _sendToJail(idx) {
    const p = this.state.players[idx];
    p.position = JAIL_INDEX;
    p.inJail = true;
    p.jailTurns = 0;
    p.doublesCount = 0;
  }

  _advanceTurn() {
    const s = this.state;
    s.players[s.current].doublesCount = 0;
    s.current = (s.current + 1) % s.players.length;
    this._log('TURN_CHANGED', `It's ${s.players[s.current].name}'s turn.`, { player: s.players[s.current].id });
  }

  // ----- helpers -----------------------------------------------------------

  _indexOf(playerId) {
    return this.state.players.findIndex((p) => p.id === playerId);
  }

  _ownedBy(pid) {
    const out = [];
    this.state.owners.forEach((o, i) => { if (o === pid) out.push(i); });
    return out;
  }

  _log(type, msg, data = {}) {
    this.state.events.push({ type, msg, ...data });
    this.state.log.push({ type, msg });
    if (this.state.log.length > 60) this.state.log.shift();
  }

  _drain() { const ev = this.state.events.slice(); this.state.events = []; return ev; }
  _err(code) { return { ok: false, error: code, events: [] }; }

  view(playerId) {
    const s = this.state;
    return {
      status: s.status,
      winner: s.winner,
      currentPlayerId: s.players[s.current] ? s.players[s.current].id : null,
      lastRoll: s.lastRoll ? { d1: s.lastRoll.d1, d2: s.lastRoll.d2, total: s.lastRoll.total } : null,
      board: BOARD.map((sp) => ({ ...sp, ownerId: OWNABLE_TYPES.has(sp.type) ? s.owners[sp.index] : null })),
      pendingPurchase: s.pendingPurchase ? { ...s.pendingPurchase } : null,
      config: { ...s.config },
      log: s.log.slice(-30),
      players: s.players.map((p) => ({
        id: p.id,
        name: p.name,
        isHost: p.isHost,
        position: p.position,
        money: p.money,
        inJail: p.inJail,
        jailTurns: p.jailTurns,
        properties: this._ownedBy(p.id),
        eliminated: false,
        isYou: p.id === playerId,
      })),
    };
  }

  publicState() { return this.view(null); }
}

module.exports = { MonopolyEngine, DEFAULT_CONFIG };
