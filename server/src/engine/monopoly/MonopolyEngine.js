'use strict';

const {
  START_MONEY, PASS_GO, JAIL_INDEX, GO_TO_JAIL_INDEX, JAIL_FEE, JAIL_MAX_TURNS,
  BOARD_SIZE, BOARD, DEFAULT_CONFIG,
} = require('./constants');

/**
 * MonopolyEngine — Phase 1 (board + movement + money). Server-authoritative,
 * in-memory. Same interface as the UNO engines so rooms.js stays generic:
 *   new MonopolyEngine({ players, config, rng }); start(); applyIntent(pid, i);
 *   view(pid); state.status; state.winner.
 * Intents (Phase 1): ROLL, END_TURN.
 *
 * Phase 1 is announce-only: landing on a space emits a LANDED event with no
 * economic effect, EXCEPT passing/landing on Go (+$200) and Go-To-Jail. There is
 * no buying/rent/cards/tax/building/trading and no elimination — winner stays
 * null and the game simply continues. Money & positions are fully PUBLIC.
 *
 * A dice roll uses the injected seeded rng (testable). Doubles → roll again;
 * three doubles in one turn → straight to jail. After a non-doubles roll the
 * turn AUTO-passes to the next player (ROLL is the only intent needed in normal
 * play; END_TURN is a defensive explicit pass).
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
        doublesCount: 0, // doubles rolled so far THIS turn
        eliminated: false, // never true in Phase 1 (kept for view-shape parity)
      })),
      current: 0,
      status: 'lobby',
      winner: null,
      lastRoll: null, // { d1, d2, total, playerId }
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
    s.current = 0;
    s.status = 'playing';
    s.winner = null;
    s.lastRoll = null;
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
      case 'ROLL': return this._handleRoll(idx);
      case 'END_TURN': return this._handleEndTurn(idx);
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
        this._move(idx, total); // leaves jail and moves; no extra roll from jail
        return this._afterResolve(idx, false); // doubles-out of jail does NOT grant another roll
      }
      p.jailTurns += 1;
      if (p.jailTurns >= JAIL_MAX_TURNS) {
        p.money -= JAIL_FEE;
        p.inJail = false; p.jailTurns = 0;
        this._log('PAID_JAIL', `${p.name} paid $${JAIL_FEE} after ${JAIL_MAX_TURNS} turns and left Jail.`, { player: p.id, fee: JAIL_FEE });
        this._move(idx, total);
        return this._afterResolve(idx, false);
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
        return this._afterResolve(idx, false); // 3rd doubles: no move, turn ends
      }
    } else {
      p.doublesCount = 0;
    }

    this._move(idx, total);
    if (p.inJail) {
      // landed on Go-To-Jail during the move → turn ends, no re-roll
      return this._afterResolve(idx, false);
    }
    // doubles (and not jailed) → same player rolls again this turn
    return this._afterResolve(idx, doubles);
  }

  // Resolve the end of a roll: re-roll (same player) on doubles, else auto-pass.
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
    // Phase 1 auto-passes after a non-doubles roll, so END_TURN is rarely needed.
    // It is a defensive explicit pass: you cannot use it to skip a required roll
    // or to bail out of a doubles re-roll.
    const s = this.state;
    const p = s.players[idx];
    if (p.doublesCount > 0 && !p.inJail) return this._err('MUST_ROLL'); // owe a doubles re-roll
    if (s.lastRoll && s.lastRoll.playerId === p.id) {
      // they have already acted this turn → allow an explicit pass
      this._advanceTurn();
      return { ok: true, events: this._drain() };
    }
    return this._err('MUST_ROLL');
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
    s.players[s.current].doublesCount = 0; // clear per-turn doubles
    s.current = (s.current + 1) % s.players.length;
    this._log('TURN_CHANGED', `It's ${s.players[s.current].name}'s turn.`, { player: s.players[s.current].id });
  }

  // ----- helpers -----------------------------------------------------------

  _indexOf(playerId) {
    return this.state.players.findIndex((p) => p.id === playerId);
  }

  _log(type, msg, data = {}) {
    const entry = { type, msg, ...data };
    this.state.events.push(entry);
    this.state.log.push({ type, msg });
    if (this.state.log.length > 50) this.state.log.shift();
  }

  _drain() {
    const ev = this.state.events.slice();
    this.state.events = [];
    return ev;
  }

  _err(code) { return { ok: false, error: code, events: [] }; }

  view(playerId) {
    const s = this.state;
    return {
      status: s.status,
      winner: s.winner, // always null in Phase 1
      currentPlayerId: s.players[s.current] ? s.players[s.current].id : null,
      lastRoll: s.lastRoll ? { d1: s.lastRoll.d1, d2: s.lastRoll.d2, total: s.lastRoll.total } : null,
      board: BOARD, // static, public
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
        eliminated: false,
        isYou: p.id === playerId,
      })),
    };
  }

  publicState() {
    return this.view(null);
  }
}

module.exports = { MonopolyEngine, DEFAULT_CONFIG };
