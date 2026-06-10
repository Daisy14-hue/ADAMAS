'use strict';

const {
  COLORS,
  TYPE,
  COLORED_ACTION_TYPES,
  isWild,
  isColoredDraw,
  isWildDraw,
  isDrawCard,
  isReverse,
  drawValueOf,
} = require('./constants');
const { buildDeck, shuffle, makeRng } = require('./deck');

const DEFAULT_CONFIG = { eliminationLimit: 25, recycleThreshold: 50 };

/**
 * NoMercyEngine — authoritative, server-side UNO No Mercy (ADAMAS variant).
 *
 * Design:
 *  - Pure of any I/O. Clients send INTENTS; `applyIntent` validates against the
 *    rules, mutates internal state, and returns { ok, error?, events }.
 *  - All state lives on `this.state`. Tests may construct an engine, call
 *    `start()` OR hand-craft a scenario by writing to `this.state` directly,
 *    then drive it through `applyIntent`.
 *  - Deterministic when constructed with a seeded rng (see deck.makeRng).
 *
 * Errors are returned as { ok:false, error:CODE } — never thrown — so the
 * realtime layer can reject an illegal intent and leave state untouched.
 */
class NoMercyEngine {
  /**
   * @param {Object} opts
   * @param {Array<{id:string,name:string,isHost?:boolean}>} opts.players
   * @param {Object} [opts.config] { eliminationLimit, recycleThreshold }
   * @param {Function} [opts.rng] float in [0,1); inject for determinism
   */
  constructor({ players = [], config = {}, rng } = {}) {
    this.rng = rng || makeRng((Math.random() * 2 ** 31) | 0);
    this.state = {
      config: { ...DEFAULT_CONFIG, ...config },
      players: players.map((p) => ({
        id: p.id,
        name: p.name,
        isHost: !!p.isHost,
        hand: [],
        eliminated: false,
        saidUno: false,
      })),
      direction: 1, // 1 = clockwise, -1 = counter-clockwise
      current: 0, // index into players whose decision is pending
      drawPile: [],
      discardPile: [],
      setAside: [], // eliminated players' cards, held until next reshuffle
      activeColor: null,
      drawStack: null, // null when inactive; see startDrawStack for shape
      pendingPlay: null, // { idx, cardId } — drawn playable card that must be played
      status: 'lobby', // 'lobby' | 'playing' | 'finished'
      winner: null,
      log: [],
    };
  }

  // ----- lifecycle ---------------------------------------------------------

  /** Build deck, deal 7 each, flip a starting number card, set first player. */
  start() {
    const s = this.state;
    if (s.players.length < 2) {
      return this._err('NEED_AT_LEAST_2_PLAYERS');
    }
    const deck = shuffle(buildDeck(), this.rng);
    for (const p of s.players) {
      p.hand = [];
      p.eliminated = false;
      p.saidUno = false;
    }
    // Deal 7 each.
    for (let r = 0; r < 7; r++) {
      for (const p of s.players) p.hand.push(deck.pop());
    }
    s.drawPile = deck;
    // Flip a starting card; if it's an action/wild, set it aside at the bottom
    // and flip again until a plain number shows (guaranteed: 76 numbers exist).
    const skipped = [];
    let top = s.drawPile.pop();
    while (top && top.type !== TYPE.NUMBER) {
      skipped.push(top);
      top = s.drawPile.pop();
    }
    s.drawPile = skipped.concat(s.drawPile); // skipped cards go to the bottom
    s.discardPile = [top];
    s.activeColor = top.color;
    s.direction = 1;
    s.current = this._nextIndex(0, 1, 1); // player to the left of dealer (idx 0)
    s.drawStack = null;
    s.pendingPlay = null;
    s.status = 'playing';
    s.winner = null;
    this._emit('MATCH_STARTED', { firstPlayer: s.players[s.current].id });
    return { ok: true, events: this._drain() };
  }

  // ----- intent entry point ------------------------------------------------

  applyIntent(playerId, intent = {}) {
    const s = this.state;
    if (s.status !== 'playing') return this._err('GAME_NOT_ACTIVE');
    const idx = this._indexOf(playerId);
    if (idx < 0) return this._err('NO_SUCH_PLAYER');
    if (idx !== s.current) return this._err('NOT_YOUR_TURN');
    if (s.players[idx].eliminated) return this._err('PLAYER_ELIMINATED');

    switch (intent.type) {
      case 'PLAY_CARD':
        return this._handlePlay(idx, intent);
      case 'DRAW':
        return this._handleDraw(idx);
      case 'SAY_UNO':
        s.players[idx].saidUno = true;
        return { ok: true, events: this._drain() };
      default:
        return this._err('UNKNOWN_INTENT');
    }
  }

  // ----- play a card -------------------------------------------------------

  _handlePlay(idx, intent) {
    const s = this.state;
    const player = s.players[idx];
    const card = player.hand.find((c) => c.id === intent.cardId);
    if (!card) return this._err('CARD_NOT_IN_HAND');

    // If a drawn playable card is pending, only that card may be played.
    if (s.pendingPlay && s.pendingPlay.idx === idx) {
      if (card.id !== s.pendingPlay.cardId) return this._err('MUST_PLAY_DRAWN_CARD');
    }

    // Active draw stack changes the legal-response set entirely.
    if (s.drawStack) return this._handleStackResponse(idx, card, intent);

    // Normal play.
    if (!this._isPlayable(card)) return this._err('ILLEGAL_MOVE');

    // Validate color choice for wilds that require one.
    if (this._needsColor(card)) {
      if (!COLORS.includes(intent.chosenColor)) return this._err('COLOR_REQUIRED');
    }
    if (card.type === TYPE.WILD_ROULETTE) {
      if (!COLORS.includes(intent.rouletteColor)) return this._err('ROULETTE_COLOR_REQUIRED');
    }

    s.pendingPlay = null;
    this._moveToDiscard(idx, card, intent.chosenColor);
    this._emit('CARD_PLAYED', { player: player.id, card: this._publicCard(card) });

    // Win by emptying hand (single card out — discardAll handles its own case).
    if (player.hand.length === 0) return this._win(idx);

    this._applyEffect(idx, card, intent);
    return { ok: true, events: this._drain() };
  }

  _applyEffect(idx, card, intent) {
    const s = this.state;
    switch (card.type) {
      case TYPE.NUMBER:
        this._advance(1);
        break;
      case TYPE.SKIP:
        this._advance(2); // next player loses their turn
        break;
      case TYPE.REVERSE: {
        s.direction *= -1;
        if (this._activeCount() === 2) {
          // 2-player reverse acts as a skip → current player goes again.
          s.current = idx;
        } else {
          this._advance(1);
        }
        break;
      }
      case TYPE.SKIP_EVERYONE:
        s.current = idx; // everyone else skipped; play again
        break;
      case TYPE.DISCARD_ALL:
        this._resolveDiscardAll(idx, card);
        break;
      case TYPE.DRAW2:
        this._startDrawStack(idx, card);
        break;
      case TYPE.WILD:
        this._advance(1);
        break;
      case TYPE.WILD_DRAW4:
      case TYPE.WILD_DRAW6:
      case TYPE.WILD_DRAW10:
        this._startDrawStack(idx, card);
        break;
      case TYPE.WILD_REVERSE_DRAW4:
        s.direction *= -1; // treated as a Draw card that reverses (4.9)
        this._startDrawStack(idx, card);
        break;
      case TYPE.WILD_ROULETTE:
        this._resolveRoulette(idx, intent.rouletteColor);
        break;
      default:
        this._advance(1);
    }
  }

  _resolveDiscardAll(idx, card) {
    const s = this.state;
    const player = s.players[idx];
    const color = card.color;
    const matching = player.hand.filter((c) => c.color === color);
    player.hand = player.hand.filter((c) => c.color !== color);
    // Extra cards go UNDER the Discard All card (which is the current top).
    const top = s.discardPile.pop();
    s.discardPile.push(...matching, top);
    this._emit('DISCARD_ALL', { player: player.id, color, count: matching.length });
    this._maybeRecycleByThreshold();
    if (player.hand.length === 0) {
      this._win(idx);
      return;
    }
    this._advance(1);
  }

  _resolveRoulette(idx, rouletteColor) {
    const s = this.state;
    const targetIdx = this._nextIndex(idx, s.direction, 1);
    const target = s.players[targetIdx];
    // Target reveals cards one at a time until one matches the called color.
    // Wild cards do NOT count — keep drawing through them.
    // (ADAMAS 4.5: color is called by the player who PLAYED the roulette.)
    // Safety bound so a pathological empty deck can't loop forever.
    let guard = 0;
    while (guard++ < 1000) {
      const drawn = this._drawCards(1);
      if (drawn.length === 0) break; // no cards anywhere
      const c = drawn[0];
      target.hand.push(c);
      if (c.color === rouletteColor) break;
    }
    s.activeColor = rouletteColor;
    this._emit('ROULETTE_RESOLVED', { target: target.id, color: rouletteColor });
    if (this._checkElimination(targetIdx)) {
      // target eliminated; turn advances past them anyway
    }
    if (s.status === 'finished') return;
    s.current = this._nextIndex(targetIdx, s.direction, 1); // target loses their turn
    this._emit('TURN_CHANGED', { player: s.players[s.current].id });
  }

  // ----- draw stack (house rules 4.6–4.9) ----------------------------------

  _startDrawStack(idx, card) {
    const s = this.state;
    const val = drawValueOf(card);
    s.drawStack = {
      total: val,
      lastValue: val,
      lastWasColoredDraw: isColoredDraw(card), // only Draw 2 is deflectable
      chainActive: false,
    };
    s.current = this._nextIndex(idx, s.direction, 1); // target responds next
    this._emit('DRAW_STACK_UPDATED', {
      total: s.drawStack.total,
      target: s.players[s.current].id,
    });
  }

  _handleStackResponse(idx, card, intent) {
    const s = this.state;
    const player = s.players[idx];
    const ds = s.drawStack;

    // (1) Continue the stack with an ascending Draw card.
    if (isDrawCard(card)) {
      const val = drawValueOf(card);
      if (val < ds.lastValue) return this._err('NON_ASCENDING_DRAW');
      if (this._needsColor(card) && !COLORS.includes(intent.chosenColor)) {
        return this._err('COLOR_REQUIRED');
      }
      s.pendingPlay = null;
      if (card.type === TYPE.WILD_REVERSE_DRAW4) s.direction *= -1;
      this._moveToDiscard(idx, card, intent.chosenColor);
      ds.total += val;
      ds.lastValue = val;
      ds.lastWasColoredDraw = isColoredDraw(card); // becomes false once a wild draw lands
      ds.chainActive = false; // stacking a draw card breaks any reverse-chain context
      this._emit('CARD_PLAYED', { player: player.id, card: this._publicCard(card) });
      if (player.hand.length === 0) return this._win(idx);
      s.current = this._nextIndex(idx, s.direction, 1);
      this._emit('DRAW_STACK_UPDATED', { total: ds.total, target: s.players[s.current].id });
      return { ok: true, events: this._drain() };
    }

    // (2) Reverse — deflection (first) or chain (subsequent).
    if (isReverse(card)) {
      if (ds.chainActive) {
        // Chain active: any Reverse, color ignored (4.8).
      } else {
        // First deflection: only against a colored Draw 2, and the Reverse must
        // match the active color (4.6).
        if (!ds.lastWasColoredDraw) return this._err('CANNOT_DEFLECT_WILD_DRAW');
        if (card.color !== s.activeColor) return this._err('REVERSE_MUST_MATCH_COLOR');
      }
      s.pendingPlay = null;
      // Reverse is consumed; activeColor stays the underlying Draw 2 color so the
      // stack remains a colored Draw 2 throughout the duel.
      player.hand = player.hand.filter((c) => c.id !== card.id);
      s.discardPile.push(card);
      s.direction *= -1;
      ds.chainActive = true;
      this._emit('CARD_PLAYED', { player: player.id, card: this._publicCard(card) });
      this._emit('REVERSE_DEFLECT', { player: player.id, total: ds.total });
      if (player.hand.length === 0) return this._win(idx);
      // Penalty redirects to the immediate neighbor in the NEW direction.
      s.current = this._nextIndex(idx, s.direction, 1);
      this._emit('DRAW_STACK_UPDATED', { total: ds.total, target: s.players[s.current].id });
      return { ok: true, events: this._drain() };
    }

    // (3) Anything else (number, plain wild, skipEveryone, discardAll, roulette)
    // is NOT a legal response to a live stack (4.7).
    return this._err('ILLEGAL_STACK_RESPONSE');
  }

  // ----- draw / take penalty ----------------------------------------------

  _handleDraw(idx) {
    const s = this.state;
    const player = s.players[idx];

    // Taking the accumulated penalty (uses up the turn → player is skipped).
    if (s.drawStack) {
      const total = s.drawStack.total;
      const drawn = this._drawCards(total);
      player.hand.push(...drawn);
      this._emit('PENALTY_TAKEN', { player: player.id, count: drawn.length });
      s.drawStack = null;
      s.pendingPlay = null;
      const eliminated = this._checkElimination(idx);
      if (s.status === 'finished') return { ok: true, events: this._drain() };
      // Penalty draw is a SKIP: play moves to the next player.
      s.current = this._nextIndex(idx, s.direction, 1);
      this._emit('TURN_CHANGED', { player: s.players[s.current].id, viaPenalty: true, eliminated });
      return { ok: true, events: this._drain() };
    }

    // Voluntary draw-to-match (4.4 step 5). Only allowed when you cannot play.
    if (s.pendingPlay && s.pendingPlay.idx === idx) return this._err('MUST_PLAY_DRAWN_CARD');
    if (this._hasPlayableCard(idx)) return this._err('YOU_HAVE_A_PLAYABLE_CARD');

    const drawn = this._drawCards(1);
    if (drawn.length === 0) return this._err('NO_CARDS_TO_DRAW');
    const card = drawn[0];
    player.hand.push(card);
    this._emit('CARD_DRAWN', { player: player.id });

    if (this._checkElimination(idx)) {
      if (s.status === 'finished') return { ok: true, events: this._drain() };
      s.current = this._nextIndex(idx, s.direction, 1);
      this._emit('TURN_CHANGED', { player: s.players[s.current].id });
      return { ok: true, events: this._drain() };
    }

    if (this._isPlayable(card)) {
      // Must play this freshly-drawn playable card immediately.
      s.pendingPlay = { idx, cardId: card.id };
      this._emit('DREW_PLAYABLE', { player: player.id });
    } else {
      // Keep drawing (player issues DRAW again).
      this._emit('DREW_UNPLAYABLE', { player: player.id });
    }
    return { ok: true, events: this._drain() };
  }

  // ----- helpers -----------------------------------------------------------

  _moveToDiscard(idx, card, chosenColor) {
    const s = this.state;
    const player = s.players[idx];
    player.hand = player.hand.filter((c) => c.id !== card.id);
    if (isWild(card)) {
      card.chosenColor = chosenColor || s.activeColor;
      s.activeColor = card.chosenColor;
    } else {
      s.activeColor = card.color;
    }
    s.discardPile.push(card);
    this._maybeRecycleByThreshold();
  }

  _isPlayable(card) {
    const s = this.state;
    if (isWild(card)) return true; // wilds always playable on a normal turn
    if (card.color === s.activeColor) return true;
    const top = this._topDiscard();
    if (!top) return true;
    if (top.type === TYPE.NUMBER && card.type === TYPE.NUMBER && card.value === top.value) return true;
    if (COLORED_ACTION_TYPES.has(card.type) && card.type === top.type) return true;
    return false;
  }

  _needsColor(card) {
    return isWild(card) && card.type !== TYPE.WILD_ROULETTE;
  }

  _hasPlayableCard(idx) {
    return this.state.players[idx].hand.some((c) => this._isPlayable(c));
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
      if (s.drawPile.length === 0) break; // genuinely out of cards
      out.push(s.drawPile.pop());
    }
    return out;
  }

  _recycle() {
    const s = this.state;
    const top = s.discardPile.pop() || null;
    const pool = s.discardPile.concat(s.setAside); // eliminated cards re-enter here
    s.setAside = [];
    s.discardPile = top ? [top] : [];
    if (pool.length === 0) return;
    s.drawPile = s.drawPile.concat(shuffle(pool, this.rng));
    this._emit('DECK_RECYCLED', { reshuffled: pool.length });
  }

  _maybeRecycleByThreshold() {
    const s = this.state;
    if (s.discardPile.length >= s.config.recycleThreshold) this._recycle();
  }

  _checkElimination(idx) {
    const s = this.state;
    const p = s.players[idx];
    if (!p.eliminated && p.hand.length >= s.config.eliminationLimit) {
      p.eliminated = true;
      s.setAside.push(...p.hand);
      p.hand = [];
      this._emit('PLAYER_ELIMINATED', { player: p.id });
      this._checkWinByElimination();
      return true;
    }
    return false;
  }

  _checkWinByElimination() {
    const s = this.state;
    const active = s.players.filter((p) => !p.eliminated);
    if (active.length === 1 && s.status === 'playing') {
      s.status = 'finished';
      s.winner = active[0].id;
      s.drawStack = null;
      this._emit('MATCH_FINISHED', { winner: active[0].id, reason: 'elimination' });
    }
  }

  _win(idx) {
    const s = this.state;
    s.status = 'finished';
    s.winner = s.players[idx].id;
    s.drawStack = null;
    s.pendingPlay = null;
    this._emit('MATCH_FINISHED', { winner: s.players[idx].id, reason: 'emptied-hand' });
    return { ok: true, events: this._drain() };
  }

  _activeCount() {
    return this.state.players.filter((p) => !p.eliminated).length;
  }

  _indexOf(playerId) {
    return this.state.players.findIndex((p) => p.id === playerId);
  }

  /** Index `steps` non-eliminated seats away from `fromIdx` in direction `dir`. */
  _nextIndex(fromIdx, dir = this.state.direction, steps = 1) {
    const s = this.state;
    const n = s.players.length;
    let idx = fromIdx;
    let moved = 0;
    let guard = 0;
    while (moved < steps && guard++ < n * steps + n) {
      idx = (idx + dir + n) % n;
      if (!s.players[idx].eliminated) moved++;
    }
    return idx;
  }

  _advance(steps = 1) {
    const s = this.state;
    s.current = this._nextIndex(s.current, s.direction, steps);
    this._emit('TURN_CHANGED', { player: s.players[s.current].id });
  }

  // ----- views & events ----------------------------------------------------

  _publicCard(card) {
    return {
      id: card.id,
      color: isWild(card) ? card.chosenColor ?? null : card.color,
      type: card.type,
      value: card.value,
    };
  }

  _emit(type, data = {}) {
    this.state.log.push({ type, ...data });
  }

  _drain() {
    const ev = this.state.log.slice();
    this.state.log = [];
    return ev;
  }

  _err(code) {
    return { ok: false, error: code, events: [] };
  }

  /** Redacted view for one player (own hand visible; others as counts). */
  view(playerId) {
    const s = this.state;
    return {
      status: s.status,
      winner: s.winner,
      direction: s.direction,
      activeColor: s.activeColor,
      topCard: this._topDiscard() ? this._publicCard(this._topDiscard()) : null,
      currentPlayerId: s.players[s.current] ? s.players[s.current].id : null,
      drawPileCount: s.drawPile.length,
      discardPileCount: s.discardPile.length,
      drawStack: s.drawStack
        ? { active: true, total: s.drawStack.total, lastValue: s.drawStack.lastValue, chainActive: s.drawStack.chainActive }
        : { active: false, total: 0 },
      config: { ...s.config },
      players: s.players.map((p) => ({
        id: p.id,
        name: p.name,
        isHost: p.isHost,
        eliminated: p.eliminated,
        handCount: p.hand.length,
        isYou: p.id === playerId,
        hand: p.id === playerId ? p.hand.map((c) => this._publicCard(c)) : undefined,
      })),
    };
  }

  /** Spectator/public view (no hands). */
  publicState() {
    const v = this.view(null);
    v.players = v.players.map(({ hand, isYou, ...rest }) => rest);
    return v;
  }
}

module.exports = { NoMercyEngine, DEFAULT_CONFIG };
