'use strict';

const {
  COLORS,
  TYPE,
  COLORED_ACTION_TYPES,
  OUTCOME_BY_ID,
  OUTCOMES,
  RACE_WINDOW_MS,
  isWild,
  needsColor,
} = require('./constants');
const { buildDeck, shuffle, makeRng } = require('./deck');

const DEFAULT_CONFIG = { recycleThreshold: 50 };

/**
 * SpinEngine — authoritative, server-side ADAMAS UNO Spin.
 *
 * Same interface as NoMercyEngine/FlipEngine:
 *   new SpinEngine({ players, config, rng }); start(); applyIntent(pid, intent);
 *   view(pid); state.status; state.winner.
 * Intents: PLAY_CARD, DRAW, PASS, SAY_UNO, SPIN, SPIN_CHOICE, RACE_TAP
 *   (+ RACE_TIMEOUT — injected by the server when the race window elapses).
 *
 * Classic UNO rules (no stacking/deflection). A Spin card forces the NEXT
 * player to spin a server-chosen 12-segment wheel; that spin REPLACES their
 * turn and their turn ends once the outcome resolves. The wheel outcome is
 * picked by the server (this engine); the client only animates to it.
 */
class SpinEngine {
  constructor({ players = [], config = {}, rng } = {}) {
    this.rng = rng || makeRng((Math.random() * 2 ** 31) | 0);
    this.state = {
      config: { ...DEFAULT_CONFIG, recycleThreshold: config.recycleThreshold ?? DEFAULT_CONFIG.recycleThreshold },
      players: players.map((p) => ({
        id: p.id, name: p.name, isHost: !!p.isHost, hand: [], eliminated: false, saidUno: false,
      })),
      direction: 1,
      current: 0,
      drawPile: [],
      discardPile: [],
      activeColor: null,
      status: 'lobby',
      winner: null,
      pendingPlay: null, // { idx, cardId } — drew a playable card; may play or PASS
      pendingSpin: false, // current player must SPIN (forced)
      spinnerIdx: null, // who is currently resolving a spin
      spinResult: null, // { spinId, outcomeId, key, label } for animation
      spinSeq: 0,
      pendingChoice: null, // { type, player } — awaiting a SPIN_CHOICE
      race: null, // { active, deadlineTs, winner }
      log: [],
    };
  }

  // ----- lifecycle ---------------------------------------------------------

  start() {
    const s = this.state;
    if (s.players.length < 2) return this._err('NEED_AT_LEAST_2_PLAYERS');
    const deck = shuffle(buildDeck(), this.rng);
    for (const p of s.players) { p.hand = []; p.saidUno = false; }
    for (let r = 0; r < 7; r++) for (const p of s.players) p.hand.push(deck.pop());
    s.drawPile = deck;
    // Starting card: flip until a plain number (avoid starting on action/wild/spin).
    const skipped = [];
    let top = s.drawPile.pop();
    while (top && top.type !== TYPE.NUMBER) { skipped.push(top); top = s.drawPile.pop(); }
    s.drawPile = skipped.concat(s.drawPile);
    s.discardPile = [top];
    s.activeColor = top.color;
    s.direction = 1;
    s.current = this._nextIndex(0, 1, 1);
    s.status = 'playing';
    s.winner = null;
    s.pendingPlay = null;
    s.pendingSpin = false;
    s.spinnerIdx = null;
    s.spinResult = null;
    s.pendingChoice = null;
    s.race = null;
    this._emit('MATCH_STARTED', { firstPlayer: s.players[s.current].id });
    return { ok: true, events: this._drain() };
  }

  // ----- intent dispatch ---------------------------------------------------

  applyIntent(playerId, intent = {}) {
    const s = this.state;
    if (s.status !== 'playing') return this._err('GAME_NOT_ACTIVE');
    const idx = this._indexOf(playerId);
    if (idx < 0) return this._err('NO_SUCH_PLAYER');

    // Race + choice + timeout are NOT gated on whose normal turn it is.
    if (intent.type === 'RACE_TAP') return this._handleRaceTap(idx);
    if (intent.type === 'RACE_TIMEOUT') return this._handleRaceTimeout();
    if (intent.type === 'SPIN_CHOICE') return this._handleSpinChoice(idx, intent);
    if (intent.type === 'SAY_UNO') { s.players[idx].saidUno = true; return { ok: true, events: this._drain() }; }

    // While a choice or race is open, normal actions are blocked.
    if (s.pendingChoice) return this._err('AWAITING_CHOICE');
    if (s.race && s.race.active) return this._err('RACE_IN_PROGRESS');

    if (idx !== s.current) return this._err('NOT_YOUR_TURN');

    if (s.pendingSpin) {
      if (intent.type === 'SPIN') return this._handleSpin(idx);
      return this._err('MUST_SPIN');
    }

    switch (intent.type) {
      case 'PLAY_CARD': return this._handlePlay(idx, intent);
      case 'DRAW': return this._handleDraw(idx);
      case 'PASS': return this._handlePass(idx);
      case 'SPIN': return this._err('NOTHING_TO_SPIN');
      default: return this._err('UNKNOWN_INTENT');
    }
  }

  // ----- normal play -------------------------------------------------------

  _handlePlay(idx, intent) {
    const s = this.state;
    const player = s.players[idx];
    const card = player.hand.find((c) => c.id === intent.cardId);
    if (!card) return this._err('CARD_NOT_IN_HAND');
    if (s.pendingPlay && s.pendingPlay.idx === idx && card.id !== s.pendingPlay.cardId) {
      return this._err('MUST_PLAY_DRAWN_CARD');
    }
    if (!this._isPlayable(card)) return this._err('ILLEGAL_MOVE');
    if (needsColor(card) && !COLORS.includes(intent.chosenColor)) return this._err('COLOR_REQUIRED');

    s.pendingPlay = null;
    this._moveToDiscard(idx, card, intent.chosenColor);
    this._emit('CARD_PLAYED', { player: player.id, card: this._publicCard(card) });
    if (player.hand.length === 0) return this._win(idx);
    this._applyEffect(idx, card);
    return { ok: true, events: this._drain() };
  }

  _applyEffect(idx, card) {
    const s = this.state;
    switch (card.type) {
      case TYPE.NUMBER: this._advance(1); break;
      case TYPE.SKIP: this._advance(2); break;
      case TYPE.REVERSE:
        s.direction *= -1;
        if (s.players.length === 2) s.current = idx; // 2-player reverse = skip
        else this._advance(1);
        break;
      case TYPE.DRAW2: {
        const t = this._nextIndex(idx, s.direction, 1);
        this._giveCards(t, 2);
        this._emit('FORCED_DRAW', { player: s.players[t].id, count: 2 });
        s.current = this._nextIndex(idx, s.direction, 2); // next player skipped
        this._emit('TURN_CHANGED', { player: s.players[s.current].id });
        break;
      }
      case TYPE.WILD: this._advance(1); break;
      case TYPE.WILD_DRAW4: {
        const t = this._nextIndex(idx, s.direction, 1);
        this._giveCards(t, 4);
        this._emit('FORCED_DRAW', { player: s.players[t].id, count: 4 });
        s.current = this._nextIndex(idx, s.direction, 2);
        this._emit('TURN_CHANGED', { player: s.players[s.current].id });
        break;
      }
      case TYPE.SPIN: {
        // The NEXT player must spin; their normal turn is replaced by the spin.
        s.current = this._nextIndex(idx, s.direction, 1);
        s.pendingSpin = true;
        this._emit('SPIN_REQUIRED', { player: s.players[s.current].id });
        break;
      }
      default: this._advance(1);
    }
  }

  // ----- the wheel ---------------------------------------------------------

  _pickOutcome() {
    return OUTCOMES[Math.floor(this.rng() * OUTCOMES.length)].id;
  }

  _handleSpin(idx) {
    const s = this.state;
    s.pendingSpin = false;
    s.spinnerIdx = idx;
    const outcomeId = this._pickOutcome();
    const o = OUTCOME_BY_ID[outcomeId];
    s.spinSeq += 1;
    s.spinResult = { spinId: s.spinSeq, outcomeId, key: o.key, label: o.label };
    this._emit('SPUN', { player: s.players[idx].id, spinId: s.spinSeq, outcomeId, key: o.key, label: o.label });
    this._applyOutcome(idx, o);
    return { ok: true, events: this._drain() };
  }

  _applyOutcome(idx, o) {
    const s = this.state;
    switch (o.key) {
      case 'almostUno':
        if (s.players[idx].hand.length <= 2) return this._endSpinnerTurn();
        s.pendingChoice = { type: 'almostUno', player: idx };
        return this._emit('CHOICE_REQUIRED', { player: s.players[idx].id, choice: 'almostUno' });
      case 'discardNumber':
        s.pendingChoice = { type: 'discardNumber', player: idx };
        return this._emit('CHOICE_REQUIRED', { player: s.players[idx].id, choice: 'discardNumber' });
      case 'discardColor':
        s.pendingChoice = { type: 'discardColor', player: idx };
        return this._emit('CHOICE_REQUIRED', { player: s.players[idx].id, choice: 'discardColor' });
      case 'drawRed': case 'drawBlue': case 'drawGreen': case 'drawYellow':
        this._drawUntilColor(idx, o.color);
        return this._endSpinnerTurn();
      case 'tradeHands':
        this._tradeHands();
        return this._endSpinnerTurn();
      case 'unoSpinRace':
        s.race = { active: true, deadlineTs: Date.now() + RACE_WINDOW_MS, winner: null };
        return this._emit('RACE_OPENED', { spinnerId: s.players[idx].id, windowMs: RACE_WINDOW_MS });
      case 'everyoneDraws1':
        for (let i = 0; i < s.players.length; i++) this._giveCards(i, 1);
        this._emit('EVERYONE_DREW', { count: 1 });
        return this._endSpinnerTurn();
      case 'swapLeader':
        this._swapWithLeader(idx);
        return this._endSpinnerTurn();
      case 'draw4':
        this._giveCards(idx, 4);
        this._emit('FORCED_DRAW', { player: s.players[idx].id, count: 4 });
        return this._endSpinnerTurn();
      default:
        return this._endSpinnerTurn();
    }
  }

  _drawUntilColor(idx, color) {
    const s = this.state;
    let guard = 0;
    while (guard++ < 500) {
      const drawn = this._drawCards(1);
      if (!drawn.length) break;
      const c = drawn[0];
      s.players[idx].hand.push(c);
      if (c.color === color || isWild(c)) break; // stop on the colour or a Wild
    }
  }

  _tradeHands() {
    const s = this.state;
    const n = s.players.length;
    const hands = s.players.map((p) => p.hand);
    // each player passes to the next player in the current direction
    const newHands = new Array(n);
    for (let i = 0; i < n; i++) newHands[this._nextIndex(i, s.direction, 1)] = hands[i];
    s.players.forEach((p, i) => { p.hand = newHands[i]; });
    this._emit('TRADE_HANDS', {});
  }

  _swapWithLeader(idx) {
    const s = this.state;
    let best = -1;
    let bestCount = Infinity;
    // nearest in current direction wins ties
    for (let step = 1; step < s.players.length; step++) {
      const j = this._nextIndex(idx, s.direction, step);
      if (s.players[j].hand.length < bestCount) { bestCount = s.players[j].hand.length; best = j; }
    }
    if (best < 0 || bestCount >= s.players[idx].hand.length) {
      this._emit('SWAP_LEADER', { swapped: false });
      return; // spinner already has the fewest (or tie) → no-op
    }
    const tmp = s.players[idx].hand;
    s.players[idx].hand = s.players[best].hand;
    s.players[best].hand = tmp;
    this._emit('SWAP_LEADER', { swapped: true, with: s.players[best].id });
  }

  _endSpinnerTurn() {
    const s = this.state;
    const from = s.spinnerIdx == null ? s.current : s.spinnerIdx;
    s.spinnerIdx = null;
    s.pendingChoice = null;
    s.race = null;
    s.pendingSpin = false;
    s.current = this._nextIndex(from, s.direction, 1);
    this._emit('TURN_CHANGED', { player: s.players[s.current].id });
  }

  // ----- the UNO Spin race -------------------------------------------------

  _handleRaceTap(idx) {
    const s = this.state;
    if (!s.race) return this._err('NO_RACE');
    if (!s.race.active || s.race.winner != null) return this._err('RACE_OVER');
    s.race.winner = idx;
    s.race.active = false;
    s.pendingChoice = { type: 'raceDiscard', player: idx };
    this._emit('RACE_WON', { winner: s.players[idx].id });
    return { ok: true, events: this._drain() };
  }

  _handleRaceTimeout() {
    const s = this.state;
    if (!s.race || !s.race.active) return { ok: true, events: this._drain() };
    s.race.active = false;
    s.race.winner = s.spinnerIdx;
    s.pendingChoice = { type: 'raceDiscard', player: s.spinnerIdx };
    this._emit('RACE_TIMEOUT', { winner: s.players[s.spinnerIdx].id });
    return { ok: true, events: this._drain() };
  }

  // ----- spin choices ------------------------------------------------------

  _handleSpinChoice(idx, intent) {
    const s = this.state;
    if (!s.pendingChoice) return this._err('NO_PENDING_CHOICE');
    if (idx !== s.pendingChoice.player) return this._err('NOT_YOUR_CHOICE');
    const player = s.players[idx];
    const type = s.pendingChoice.type;

    const placeTop = (topCardId, discarded) => {
      if (!topCardId) return;
      const moveIdx = s.discardPile.findIndex((c) => c.id === topCardId);
      if (moveIdx >= 0 && moveIdx !== s.discardPile.length - 1) {
        const [c] = s.discardPile.splice(moveIdx, 1);
        s.discardPile.push(c);
      }
      const t = this._topDiscard();
      s.activeColor = isWild(t) ? (t.chosenColor || s.activeColor) : t.color;
    };

    if (type === 'almostUno') {
      const keep = Array.isArray(intent.keepIds) ? intent.keepIds : [];
      if (keep.length !== 2 || keep[0] === keep[1]) return this._err('CHOOSE_TWO_TO_KEEP');
      if (!keep.every((id) => player.hand.some((c) => c.id === id))) return this._err('CARD_NOT_IN_HAND');
      const discarded = player.hand.filter((c) => !keep.includes(c.id));
      player.hand = player.hand.filter((c) => keep.includes(c.id));
      for (const c of discarded) s.discardPile.push(c);
      placeTop(intent.topCardId, discarded);
      this._emit('ALMOST_UNO', { player: player.id, kept: 2 });
      return this._finishChoice(idx);
    }

    if (type === 'discardNumber' || type === 'discardColor') {
      const ids = Array.isArray(intent.discardIds) ? intent.discardIds : [];
      const match = type === 'discardNumber'
        ? (c) => c.type === TYPE.NUMBER && c.value === intent.number
        : (c) => !isWild(c) && c.color === intent.color;
      if (type === 'discardNumber' && (intent.number == null)) return this._err('PICK_A_NUMBER');
      if (type === 'discardColor' && !COLORS.includes(intent.color)) return this._err('PICK_A_COLOR');
      // only allow discarding cards that actually match (wilds never via colour)
      const toDiscard = player.hand.filter((c) => ids.includes(c.id) && match(c));
      const discardSet = new Set(toDiscard.map((c) => c.id));
      player.hand = player.hand.filter((c) => !discardSet.has(c.id));
      for (const c of toDiscard) s.discardPile.push(c);
      placeTop(intent.topCardId, toDiscard);
      this._emit(type === 'discardNumber' ? 'DISCARD_NUMBER' : 'DISCARD_COLOR', { player: player.id, count: toDiscard.length });
      return this._finishChoice(idx);
    }

    if (type === 'raceDiscard') {
      const card = player.hand.find((c) => c.id === intent.cardId);
      if (!card) return this._err('CARD_NOT_IN_HAND');
      player.hand = player.hand.filter((c) => c.id !== card.id);
      if (isWild(card)) card.chosenColor = COLORS.includes(intent.chosenColor) ? intent.chosenColor : 'red';
      s.discardPile.push(card);
      s.activeColor = isWild(card) ? card.chosenColor : card.color;
      this._emit('RACE_DISCARD', { player: player.id, card: this._publicCard(card) });
      return this._finishChoice(idx);
    }

    return this._err('UNKNOWN_CHOICE');
  }

  /** After a choice: a discard outcome can empty a hand → that player wins. */
  _finishChoice(idx) {
    const s = this.state;
    if (s.players[idx].hand.length === 0) {
      s.pendingChoice = null;
      return this._win(idx);
    }
    this._endSpinnerTurn();
    return { ok: true, events: this._drain() };
  }

  // ----- draw / pass -------------------------------------------------------

  _handleDraw(idx) {
    const s = this.state;
    const player = s.players[idx];
    const drawn = this._drawCards(1);
    if (!drawn.length) return this._err('NO_CARDS_TO_DRAW');
    const card = drawn[0];
    player.hand.push(card);
    this._emit('CARD_DRAWN', { player: player.id });
    if (this._isPlayable(card)) {
      s.pendingPlay = { idx, cardId: card.id };
      this._emit('DREW_PLAYABLE', { player: player.id });
      return { ok: true, events: this._drain() };
    }
    this._emit('DREW_UNPLAYABLE', { player: player.id });
    s.current = this._nextIndex(idx, s.direction, 1);
    this._emit('TURN_CHANGED', { player: s.players[s.current].id });
    return { ok: true, events: this._drain() };
  }

  _handlePass(idx) {
    const s = this.state;
    if (!s.pendingPlay || s.pendingPlay.idx !== idx) return this._err('NOTHING_TO_PASS');
    s.pendingPlay = null;
    this._emit('TURN_PASSED', { player: s.players[idx].id });
    s.current = this._nextIndex(idx, s.direction, 1);
    this._emit('TURN_CHANGED', { player: s.players[s.current].id });
    return { ok: true, events: this._drain() };
  }

  // ----- helpers -----------------------------------------------------------

  _moveToDiscard(idx, card, chosenColor) {
    const s = this.state;
    const player = s.players[idx];
    player.hand = player.hand.filter((c) => c.id !== card.id);
    if (isWild(card)) { card.chosenColor = chosenColor; s.activeColor = chosenColor; }
    else s.activeColor = card.color;
    s.discardPile.push(card);
    this._maybeRecycleByThreshold();
  }

  _isPlayable(card) {
    const s = this.state;
    if (isWild(card)) return true;
    if (card.color === s.activeColor) return true;
    const top = this._topDiscard();
    if (!top) return true;
    if (top.type === TYPE.NUMBER && card.type === TYPE.NUMBER && card.value === top.value) return true;
    if (COLORED_ACTION_TYPES.has(card.type) && card.type === top.type) return true;
    return false;
  }

  _giveCards(idx, n) {
    const drawn = this._drawCards(n);
    this.state.players[idx].hand.push(...drawn);
  }

  _topDiscard() {
    const d = this.state.discardPile;
    return d.length ? d[d.length - 1] : null;
  }

  _drawCards(n) {
    const s = this.state;
    const out = [];
    for (let i = 0; i < n; i++) {
      if (s.drawPile.length === 0) this._recycle();
      if (s.drawPile.length === 0) break;
      out.push(s.drawPile.pop());
    }
    return out;
  }

  _recycle() {
    const s = this.state;
    const top = s.discardPile.pop() || null;
    const pool = s.discardPile;
    s.discardPile = top ? [top] : [];
    if (pool.length === 0) return;
    s.drawPile = s.drawPile.concat(shuffle(pool, this.rng));
    this._emit('DECK_RECYCLED', { reshuffled: pool.length });
  }

  _maybeRecycleByThreshold() {
    const s = this.state;
    if (s.discardPile.length >= s.config.recycleThreshold) this._recycle();
  }

  _win(idx) {
    const s = this.state;
    s.status = 'finished';
    s.winner = s.players[idx].id;
    s.pendingPlay = null;
    s.pendingSpin = false;
    s.pendingChoice = null;
    s.race = null;
    this._emit('MATCH_FINISHED', { winner: s.players[idx].id, reason: 'emptied-hand' });
    return { ok: true, events: this._drain() };
  }

  _indexOf(playerId) {
    return this.state.players.findIndex((p) => p.id === playerId);
  }

  _nextIndex(fromIdx, dir = this.state.direction, steps = 1) {
    const n = this.state.players.length;
    return (((fromIdx + dir * steps) % n) + n) % n;
  }

  _advance(steps = 1) {
    const s = this.state;
    s.current = this._nextIndex(s.current, s.direction, steps);
    this._emit('TURN_CHANGED', { player: s.players[s.current].id });
  }

  _publicCard(card) {
    return {
      id: card.id,
      color: isWild(card) ? card.chosenColor ?? null : card.color,
      type: card.type,
      value: card.value,
    };
  }

  _emit(type, data = {}) { this.state.log.push({ type, ...data }); }
  _drain() { const ev = this.state.log.slice(); this.state.log = []; return ev; }
  _err(code) { return { ok: false, error: code, events: [] }; }

  view(playerId) {
    const s = this.state;
    const meIdx = this._indexOf(playerId);
    const choiceForMe = s.pendingChoice && s.pendingChoice.player === meIdx ? { type: s.pendingChoice.type } : null;
    return {
      status: s.status,
      winner: s.winner,
      direction: s.direction,
      activeColor: s.activeColor,
      topCard: this._topDiscard() ? this._publicCard(this._topDiscard()) : null,
      currentPlayerId: s.players[s.current] ? s.players[s.current].id : null,
      drawPileCount: s.drawPile.length,
      discardPileCount: s.discardPile.length,
      drawStack: { active: false, total: 0 }, // Spin has no stacking (UI parity)
      config: { ...s.config },
      canPass: !!(s.pendingPlay && s.pendingPlay.idx === meIdx),
      // Spin-specific:
      spinPending: s.pendingSpin,
      mustSpin: s.pendingSpin && s.current === meIdx,
      spinnerId: s.spinnerIdx != null && s.players[s.spinnerIdx] ? s.players[s.spinnerIdx].id : null,
      spinResult: s.spinResult,
      race: s.race && s.race.active ? { active: true, deadlineTs: s.race.deadlineTs } : null,
      choice: choiceForMe,
      players: s.players.map((p) => ({
        id: p.id, name: p.name, isHost: p.isHost, eliminated: false,
        handCount: p.hand.length, isYou: p.id === playerId,
        hand: p.id === playerId ? p.hand.map((c) => this._publicCard(c)) : undefined,
      })),
    };
  }

  publicState() {
    const v = this.view(null);
    v.players = v.players.map(({ hand, isYou, ...rest }) => rest);
    return v;
  }
}

module.exports = { SpinEngine, DEFAULT_CONFIG };
