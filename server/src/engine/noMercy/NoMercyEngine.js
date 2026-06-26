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

class NoMercyEngine {
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
      direction: 1,
      current: 0,
      drawPile: [],
      discardPile: [],
      setAside: [],
      activeColor: null,
      drawStack: null,
      pendingPlay: null,
      pendingRoulette: null, // { victimIdx, color } — manual draw-until-color
      pendingDiscardAll: null, // { idx, color } — player chooses which to shed
      status: 'lobby',
      winner: null,
      log: [],
    };
  }

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
    for (let r = 0; r < 7; r++) {
      for (const p of s.players) p.hand.push(deck.pop());
    }
    s.drawPile = deck;
    const skipped = [];
    let top = s.drawPile.pop();
    while (top && top.type !== TYPE.NUMBER) {
      skipped.push(top);
      top = s.drawPile.pop();
    }
    s.drawPile = skipped.concat(s.drawPile);
    s.discardPile = [top];
    s.activeColor = top.color;
    s.direction = 1;
    s.current = this._nextIndex(0, 1, 1);
    s.drawStack = null;
    s.pendingPlay = null;
    s.pendingRoulette = null;
    s.pendingDiscardAll = null;
    s.status = 'playing';
    s.winner = null;
    this._emit('MATCH_STARTED', { firstPlayer: s.players[s.current].id });
    return { ok: true, events: this._drain() };
  }

  applyIntent(playerId, intent = {}) {
    const s = this.state;
    if (s.status !== 'playing') return this._err('GAME_NOT_ACTIVE');
    const idx = this._indexOf(playerId);
    if (idx < 0) return this._err('NO_SUCH_PLAYER');
    if (idx !== s.current) return this._err('NOT_YOUR_TURN');
    if (s.players[idx].eliminated) return this._err('PLAYER_ELIMINATED');
    // During a Wild Roulette the victim may ONLY draw (one card at a time).
    if (s.pendingRoulette && intent.type !== 'DRAW') return this._err('ROULETTE_IN_PROGRESS');
    // During a Discard All choice the player may ONLY choose what to shed.
    if (s.pendingDiscardAll && intent.type !== 'DISCARD_ALL_CHOOSE') return this._err('DISCARD_ALL_IN_PROGRESS');

    switch (intent.type) {
      case 'PLAY_CARD':
        return this._handlePlay(idx, intent);
      case 'PLAY_CARDS':
        return this._handlePlayCards(idx, intent);
      case 'DISCARD_ALL_CHOOSE':
        return this._handleDiscardAllChoose(idx, intent);
      case 'DRAW':
        return this._handleDraw(idx);
      case 'PASS':
        return this._handlePass(idx);
      case 'SAY_UNO':
        s.players[idx].saidUno = true;
        return { ok: true, events: this._drain() };
      default:
        return this._err('UNKNOWN_INTENT');
    }
  }

  _handlePlay(idx, intent) {
    const s = this.state;
    const player = s.players[idx];
    const card = player.hand.find((c) => c.id === intent.cardId);
    if (!card) return this._err('CARD_NOT_IN_HAND');

    if (s.pendingPlay && s.pendingPlay.idx === idx) {
      if (card.id !== s.pendingPlay.cardId) return this._err('MUST_PLAY_DRAWN_CARD');
    }

    if (s.drawStack) return this._handleStackResponse(idx, card, intent);

    if (!this._isPlayable(card)) return this._err('ILLEGAL_MOVE');

    if (this._needsColor(card)) {
      if (!COLORS.includes(intent.chosenColor)) return this._err('COLOR_REQUIRED');
    }
    if (card.type === TYPE.WILD_ROULETTE) {
      if (!COLORS.includes(intent.rouletteColor)) return this._err('ROULETTE_COLOR_REQUIRED');
    }

    s.pendingPlay = null;
    this._moveToDiscard(idx, card, intent.chosenColor);
    this._emit('CARD_PLAYED', { player: player.id, card: this._publicCard(card) });

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
        this._advance(2);
        break;
      case TYPE.REVERSE: {
        s.direction *= -1;
        if (this._activeCount() === 2) {
          s.current = idx;
        } else {
          this._advance(1);
        }
        break;
      }
      case TYPE.SKIP_EVERYONE:
        s.current = idx;
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
        s.direction *= -1;
        this._startDrawStack(idx, card);
        break;
      case TYPE.WILD_ROULETTE:
        this._resolveRoulette(idx, intent.rouletteColor);
        break;
      default:
        this._advance(1);
    }
  }

  _multiFaceKey(card) {
    if (card.type === TYPE.NUMBER) return `num:${card.value}`;
    if (card.type === TYPE.SKIP || card.type === TYPE.REVERSE || card.type === TYPE.DRAW2) return `sym:${card.type}`;
    return null;
  }

  _handlePlayCards(idx, intent) {
    const s = this.state;
    const player = s.players[idx];
    const ids = intent.cardIds;
    if (!Array.isArray(ids) || ids.length === 0) return this._err('EMPTY_SET');
    if (ids.length > 14) return this._err('SET_TOO_LARGE');

    const cards = [];
    const seen = new Set();
    for (const id of ids) {
      if (seen.has(id)) return this._err('CARD_NOT_IN_HAND');
      seen.add(id);
      const c = player.hand.find((x) => x.id === id);
      if (!c) return this._err('CARD_NOT_IN_HAND');
      cards.push(c);
    }

    if (cards.length === 1) {
      return this._handlePlay(idx, { type: 'PLAY_CARD', cardId: ids[0], chosenColor: intent.chosenColor, rouletteColor: intent.rouletteColor });
    }

    // Post-draw window: a set is allowed only if it LEADS with the just-drawn card.
    if (s.pendingPlay && s.pendingPlay.idx === idx && ids[0] !== s.pendingPlay.cardId) {
      return this._err('MUST_PLAY_DRAWN_CARD');
    }

    if (cards.some((c) => isWild(c))) return this._err('WILD_IN_SET');
    const key = this._multiFaceKey(cards[0]);
    if (!key) return this._err('INELIGIBLE_SET_FACE');
    if (!cards.every((c) => this._multiFaceKey(c) === key)) return this._err('MIXED_FACES');

    const first = cards[0];
    if (s.drawStack) {
      if (first.type !== TYPE.DRAW2) return this._err('ILLEGAL_STACK_RESPONSE');
      if (drawValueOf(first) < s.drawStack.lastValue) return this._err('NON_ASCENDING_DRAW');
    } else if (!this._isPlayable(first)) {
      return this._err('ILLEGAL_MOVE');
    }

    s.pendingPlay = null;
    for (const card of cards) {
      this._moveToDiscard(idx, card);
      this._emit('CARD_PLAYED', { player: player.id, card: this._publicCard(card) });
    }
    this._emit('CARDS_PLAYED', { player: player.id, count: cards.length, face: key });

    if (player.hand.length === 0) return this._win(idx);

    this._applyMultiEffect(idx, cards);
    return { ok: true, events: this._drain() };
  }

  _applyMultiEffect(idx, cards) {
    const s = this.state;
    const k = cards.length;
    const type = cards[0].type;
    if (type === TYPE.NUMBER) {
      this._advance(1);
      return;
    }
    if (type === TYPE.SKIP) {
      this._advance(k + 1);
      return;
    }
    if (type === TYPE.REVERSE) {
      const odd = k % 2 === 1;
      if (this._activeCount() === 2) {
        if (odd) s.direction *= -1;
        s.current = idx;
        this._emit('TURN_CHANGED', { player: s.players[s.current].id });
      } else {
        if (odd) s.direction *= -1;
        this._advance(1);
      }
      return;
    }
    if (type === TYPE.DRAW2) {
      const add = drawValueOf(cards[0]) * k;
      if (s.drawStack) {
        s.drawStack.total += add;
        s.drawStack.lastValue = drawValueOf(cards[0]);
        s.drawStack.lastWasColoredDraw = true;
        s.drawStack.chainActive = false;
      } else {
        s.drawStack = { total: add, lastValue: drawValueOf(cards[0]), lastWasColoredDraw: true, chainActive: false };
      }
      s.current = this._nextIndex(idx, s.direction, 1);
      this._emit('DRAW_STACK_UPDATED', { total: s.drawStack.total, target: s.players[s.current].id });
      return;
    }
    this._advance(1);
  }

  // Discard All is now interactive: the card is already on top of the pile and
  // activeColor is set; the player then chooses which same-color cards to shed.
  _resolveDiscardAll(idx, card) {
    const s = this.state;
    s.pendingDiscardAll = { idx, color: card.color };
    this._emit('DISCARD_ALL_PENDING', { player: s.players[idx].id, color: card.color });
  }

  /** The player's chosen subset of same-color cards to shed (may be empty). */
  _handleDiscardAllChoose(idx, intent) {
    const s = this.state;
    if (!s.pendingDiscardAll || s.pendingDiscardAll.idx !== idx) return this._err('NO_DISCARD_ALL_PENDING');
    const player = s.players[idx];
    const pd = s.pendingDiscardAll;
    const ids = intent.cardIds;
    if (!Array.isArray(ids)) return this._err('BAD_CHOICE');

    // Validate the WHOLE list before mutating (atomic).
    const chosen = [];
    const seen = new Set();
    for (const id of ids) {
      if (seen.has(id)) return this._err('CARD_NOT_IN_HAND');
      seen.add(id);
      const c = player.hand.find((x) => x.id === id);
      if (!c) return this._err('CARD_NOT_IN_HAND');
      if (isWild(c)) return this._err('WILD_IN_DISCARD_ALL');
      if (c.color !== pd.color) return this._err('WRONG_DISCARD_COLOR');
      chosen.push(c);
    }

    // Shed harmlessly: remove from hand, slide UNDER the Discard All card.
    const chosenIds = seen;
    player.hand = player.hand.filter((c) => !chosenIds.has(c.id));
    const top = s.discardPile.pop(); // the Discard All card
    s.discardPile.push(...chosen, top);
    s.pendingDiscardAll = null;
    this._emit('DISCARD_ALL_RESOLVED', { player: player.id, color: pd.color, count: chosen.length });
    this._maybeRecycleByThreshold();
    if (player.hand.length === 0) return this._win(idx);
    this._advance(1);
    return { ok: true, events: this._drain() };
  }

  // Wild Roulette: the victim now manually presses DRAW (one card at a time,
  // keeping each) until they reveal the called color. No auto-loop.
  _resolveRoulette(idx, rouletteColor) {
    const s = this.state;
    const victimIdx = this._nextIndex(idx, s.direction, 1);
    s.activeColor = rouletteColor;
    s.pendingRoulette = { victimIdx, color: rouletteColor };
    s.current = victimIdx;
    this._emit('ROULETTE_STARTED', { target: s.players[victimIdx].id, color: rouletteColor });
  }

  /** A victim's DRAW press while a Wild Roulette is pending. */
  _handleRouletteDraw(idx) {
    const s = this.state;
    const player = s.players[idx];
    const pr = s.pendingRoulette;
    const drawn = this._drawCards(1);
    if (drawn.length === 0) {
      // Empty pile: resolve safely rather than loop forever.
      return this._finishRoulette(idx);
    }
    const card = drawn[0];
    player.hand.push(card);
    this._emit('CARD_DRAWN', { player: player.id });
    if (card.color === pr.color) return this._finishRoulette(idx);
    // Still pending — the victim presses DRAW again.
    return { ok: true, events: this._drain() };
  }

  _finishRoulette(idx) {
    const s = this.state;
    const victim = s.players[idx];
    s.pendingRoulette = null;
    this._emit('ROULETTE_RESOLVED', { target: victim.id, color: s.activeColor });
    this._checkElimination(idx);
    if (s.status === 'finished') return { ok: true, events: this._drain() };
    s.current = this._nextIndex(idx, s.direction, 1); // victim's turn is skipped
    this._emit('TURN_CHANGED', { player: s.players[s.current].id });
    return { ok: true, events: this._drain() };
  }

  _startDrawStack(idx, card) {
    const s = this.state;
    const val = drawValueOf(card);
    s.drawStack = {
      total: val,
      lastValue: val,
      lastWasColoredDraw: isColoredDraw(card),
      chainActive: false,
    };
    s.current = this._nextIndex(idx, s.direction, 1);
    this._emit('DRAW_STACK_UPDATED', {
      total: s.drawStack.total,
      target: s.players[s.current].id,
    });
  }

  _handleStackResponse(idx, card, intent) {
    const s = this.state;
    const player = s.players[idx];
    const ds = s.drawStack;

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
      ds.lastWasColoredDraw = isColoredDraw(card);
      ds.chainActive = false;
      this._emit('CARD_PLAYED', { player: player.id, card: this._publicCard(card) });
      if (player.hand.length === 0) return this._win(idx);
      s.current = this._nextIndex(idx, s.direction, 1);
      this._emit('DRAW_STACK_UPDATED', { total: ds.total, target: s.players[s.current].id });
      return { ok: true, events: this._drain() };
    }

    if (isReverse(card)) {
      if (ds.chainActive) {
        // Chain active: any Reverse, color ignored (4.8).
      } else {
        if (!ds.lastWasColoredDraw) return this._err('CANNOT_DEFLECT_WILD_DRAW');
        if (card.color !== s.activeColor) return this._err('REVERSE_MUST_MATCH_COLOR');
      }
      s.pendingPlay = null;
      player.hand = player.hand.filter((c) => c.id !== card.id);
      s.discardPile.push(card);
      s.direction *= -1;
      ds.chainActive = true;
      this._emit('CARD_PLAYED', { player: player.id, card: this._publicCard(card) });
      this._emit('REVERSE_DEFLECT', { player: player.id, total: ds.total });
      if (player.hand.length === 0) return this._win(idx);
      s.current = this._nextIndex(idx, s.direction, 1);
      this._emit('DRAW_STACK_UPDATED', { total: ds.total, target: s.players[s.current].id });
      return { ok: true, events: this._drain() };
    }

    return this._err('ILLEGAL_STACK_RESPONSE');
  }

  _handleDraw(idx) {
    const s = this.state;
    const player = s.players[idx];

    // Wild Roulette draw-until-color (victim keeps every card).
    if (s.pendingRoulette) return this._handleRouletteDraw(idx);

    if (s.drawStack) {
      const total = s.drawStack.total;
      const drawn = this._drawCards(total);
      player.hand.push(...drawn);
      this._emit('PENALTY_TAKEN', { player: player.id, count: drawn.length });
      s.drawStack = null;
      s.pendingPlay = null;
      const eliminated = this._checkElimination(idx);
      if (s.status === 'finished') return { ok: true, events: this._drain() };
      s.current = this._nextIndex(idx, s.direction, 1);
      this._emit('TURN_CHANGED', { player: s.players[s.current].id, viaPenalty: true, eliminated });
      return { ok: true, events: this._drain() };
    }

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
    if (s.drawStack) return this._err('CANNOT_PASS_DURING_STACK');
    if (!s.pendingPlay || s.pendingPlay.idx !== idx) return this._err('NOTHING_TO_PASS');
    s.pendingPlay = null;
    this._emit('TURN_PASSED', { player: s.players[idx].id });
    s.current = this._nextIndex(idx, s.direction, 1);
    this._emit('TURN_CHANGED', { player: s.players[s.current].id });
    return { ok: true, events: this._drain() };
  }

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
    if (isWild(card)) return true;
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
      if (s.drawPile.length === 0) break;
      out.push(s.drawPile.pop());
    }
    return out;
  }

  _recycle() {
    const s = this.state;
    const top = s.discardPile.pop() || null;
    const pool = s.discardPile.concat(s.setAside);
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
      canPass: !!(s.pendingPlay && s.pendingPlay.idx === this._indexOf(playerId)),
      drawnCardId: (s.pendingPlay && s.pendingPlay.idx === this._indexOf(playerId)) ? s.pendingPlay.cardId : null,
      mustDrawRoulette: (s.pendingRoulette && s.pendingRoulette.victimIdx === this._indexOf(playerId))
        ? { color: s.pendingRoulette.color } : null,
      mustChooseDiscardAll: (s.pendingDiscardAll && s.pendingDiscardAll.idx === this._indexOf(playerId))
        ? { color: s.pendingDiscardAll.color } : null,
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

  publicState() {
    const v = this.view(null);
    v.players = v.players.map(({ hand, isYou, ...rest }) => rest);
    return v;
  }
}

module.exports = { NoMercyEngine, DEFAULT_CONFIG };
