'use strict';

const {
  COLORS_BY_SIDE,
  TYPE,
  COLORED_ACTION_TYPES,
  isWild,
  isColoredDraw,
  isDrawCard,
  isReverse,
  isFlip,
  drawValueOf,
} = require('./constants');
const { buildDeck, shuffle, makeRng } = require('./deck');

const DEFAULT_CONFIG = { recycleThreshold: 50 };

class FlipEngine {
  constructor({ players = [], config = {}, rng } = {}) {
    this.rng = rng || makeRng((Math.random() * 2 ** 31) | 0);
    this.state = {
      config: { ...DEFAULT_CONFIG, recycleThreshold: config.recycleThreshold ?? DEFAULT_CONFIG.recycleThreshold },
      players: players.map((p) => ({
        id: p.id,
        name: p.name,
        isHost: !!p.isHost,
        hand: [],
        eliminated: false,
        saidUno: false,
      })),
      side: 'light',
      direction: 1,
      current: 0,
      drawPile: [],
      discardPile: [],
      activeColor: null,
      drawStack: null,
      pendingPlay: null,
      status: 'lobby',
      winner: null,
      log: [],
    };
  }

  start() {
    const s = this.state;
    if (s.players.length < 2) return this._err('NEED_AT_LEAST_2_PLAYERS');
    const deck = shuffle(buildDeck(), this.rng);
    for (const p of s.players) {
      p.hand = [];
      p.saidUno = false;
    }
    for (let r = 0; r < 7; r++) for (const p of s.players) p.hand.push(deck.pop());
    s.side = 'light';
    s.drawPile = deck;
    const skipped = [];
    let top = s.drawPile.pop();
    while (top && this._faceOf(top, 'light').type !== TYPE.NUMBER) {
      skipped.push(top);
      top = s.drawPile.pop();
    }
    s.drawPile = skipped.concat(s.drawPile);
    s.discardPile = [top];
    s.activeColor = this._activeFace(top).color;
    s.direction = 1;
    s.current = this._nextIndex(0, 1, 1);
    s.drawStack = null;
    s.pendingPlay = null;
    s.status = 'playing';
    s.winner = null;
    this._emit('MATCH_STARTED', { firstPlayer: s.players[s.current].id, side: s.side });
    return { ok: true, events: this._drain() };
  }

  applyIntent(playerId, intent = {}) {
    const s = this.state;
    if (s.status !== 'playing') return this._err('GAME_NOT_ACTIVE');
    const idx = this._indexOf(playerId);
    if (idx < 0) return this._err('NO_SUCH_PLAYER');
    if (idx !== s.current) return this._err('NOT_YOUR_TURN');
    switch (intent.type) {
      case 'PLAY_CARD':
        return this._handlePlay(idx, intent);
      case 'PLAY_CARDS':
        return this._handlePlayCards(idx, intent);
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
    if (s.pendingPlay && s.pendingPlay.idx === idx && card.id !== s.pendingPlay.cardId) {
      return this._err('MUST_PLAY_DRAWN_CARD');
    }
    if (s.drawStack) return this._handleStackResponse(idx, card, intent);

    const face = this._activeFace(card);
    if (!this._isPlayable(card)) return this._err('ILLEGAL_MOVE');
    if (isWild(face) && !this._validColor(intent.chosenColor)) return this._err('COLOR_REQUIRED');

    s.pendingPlay = null;
    this._moveToDiscard(idx, card, intent.chosenColor);
    this._emit('CARD_PLAYED', { player: player.id, card: this._publicCard(card) });
    if (player.hand.length === 0) return this._win(idx);
    this._applyEffect(idx, card, intent);
    return { ok: true, events: this._drain() };
  }

  _applyEffect(idx, card, intent) {
    const s = this.state;
    const face = this._activeFace(card);
    switch (face.type) {
      case TYPE.NUMBER:
        this._advance(1);
        break;
      case TYPE.SKIP:
        this._advance(2);
        break;
      case TYPE.REVERSE:
        s.direction *= -1;
        if (s.players.length === 2) s.current = idx;
        else this._advance(1);
        break;
      case TYPE.SKIP_EVERYONE:
        s.current = idx;
        break;
      case TYPE.FLIP:
        this._resolveFlip(idx);
        break;
      case TYPE.DRAW_ONE:
      case TYPE.DRAW_FIVE:
      case TYPE.WILD_DRAW_TWO:
      case TYPE.WILD_DRAW_COLOR:
        this._startDrawStack(idx, card, intent);
        break;
      case TYPE.WILD:
        this._advance(1);
        break;
      default:
        this._advance(1);
    }
  }

  _multiFaceKey(card) {
    const f = this._activeFace(card);
    if (f.type === TYPE.NUMBER) return `num:${f.value}`;
    if (f.type === TYPE.SKIP || f.type === TYPE.REVERSE || f.type === TYPE.DRAW_ONE || f.type === TYPE.DRAW_FIVE) {
      return `sym:${f.type}`;
    }
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
      return this._handlePlay(idx, { type: 'PLAY_CARD', cardId: ids[0], chosenColor: intent.chosenColor });
    }

    // Post-draw window: a set is allowed only if it LEADS with the just-drawn card.
    if (s.pendingPlay && s.pendingPlay.idx === idx && ids[0] !== s.pendingPlay.cardId) {
      return this._err('MUST_PLAY_DRAWN_CARD');
    }

    if (cards.some((c) => isWild(this._activeFace(c)))) return this._err('WILD_IN_SET');
    const key = this._multiFaceKey(cards[0]);
    if (!key) return this._err('INELIGIBLE_SET_FACE');
    if (!cards.every((c) => this._multiFaceKey(c) === key)) return this._err('MIXED_FACES');

    const first = cards[0];
    const firstFace = this._activeFace(first);
    if (s.drawStack) {
      if (!isColoredDraw(firstFace)) return this._err('ILLEGAL_STACK_RESPONSE');
      if (drawValueOf(firstFace) < s.drawStack.lastValue) return this._err('NON_ASCENDING_DRAW');
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
    const face = this._activeFace(cards[0]);
    if (face.type === TYPE.NUMBER) {
      this._advance(1);
      return;
    }
    if (face.type === TYPE.SKIP) {
      this._advance(k + 1);
      return;
    }
    if (face.type === TYPE.REVERSE) {
      const odd = k % 2 === 1;
      if (s.players.length === 2) {
        if (odd) s.direction *= -1;
        s.current = idx;
        this._emit('TURN_CHANGED', { player: s.players[s.current].id });
      } else {
        if (odd) s.direction *= -1;
        this._advance(1);
      }
      return;
    }
    if (face.type === TYPE.DRAW_ONE || face.type === TYPE.DRAW_FIVE) {
      const val = drawValueOf(face);
      const add = val * k;
      if (s.drawStack) {
        s.drawStack.total += add;
        s.drawStack.lastValue = val;
        s.drawStack.lastWasColoredDraw = true;
        s.drawStack.chainActive = false;
        s.drawStack.untilColor = null;
      } else {
        s.drawStack = { total: add, lastValue: val, lastWasColoredDraw: true, chainActive: false, untilColor: null };
      }
      s.current = this._nextIndex(idx, s.direction, 1);
      this._emit('DRAW_STACK_UPDATED', { total: s.drawStack.total, target: s.players[s.current].id });
      return;
    }
    this._advance(1);
  }

  _resolveFlip(idx) {
    const s = this.state;
    s.side = s.side === 'light' ? 'dark' : 'light';
    s.activeColor = this._activeFace(this._topDiscard()).color;
    this._emit('FLIPPED', { side: s.side, activeColor: s.activeColor });
    this._advance(1);
  }

  _startDrawStack(idx, card, intent) {
    const s = this.state;
    const face = this._activeFace(card);
    const val = drawValueOf(face);
    s.drawStack = {
      total: val,
      lastValue: val,
      lastWasColoredDraw: isColoredDraw(face),
      chainActive: false,
      untilColor: face.type === TYPE.WILD_DRAW_COLOR ? (card.chosenColor || intent.chosenColor || null) : null,
    };
    s.current = this._nextIndex(idx, s.direction, 1);
    this._emit('DRAW_STACK_UPDATED', { total: s.drawStack.total, target: s.players[s.current].id });
  }

  _handleStackResponse(idx, card, intent) {
    const s = this.state;
    const player = s.players[idx];
    const ds = s.drawStack;
    const face = this._activeFace(card);

    if (isDrawCard(face)) {
      const val = drawValueOf(face);
      if (val < ds.lastValue) return this._err('NON_ASCENDING_DRAW');
      if (isWild(face) && !this._validColor(intent.chosenColor)) return this._err('COLOR_REQUIRED');
      s.pendingPlay = null;
      this._moveToDiscard(idx, card, intent.chosenColor);
      ds.total += val;
      ds.lastValue = val;
      ds.lastWasColoredDraw = isColoredDraw(face);
      ds.chainActive = false;
      ds.untilColor = face.type === TYPE.WILD_DRAW_COLOR ? (card.chosenColor || intent.chosenColor || null) : null;
      this._emit('CARD_PLAYED', { player: player.id, card: this._publicCard(card) });
      if (player.hand.length === 0) return this._win(idx);
      s.current = this._nextIndex(idx, s.direction, 1);
      this._emit('DRAW_STACK_UPDATED', { total: ds.total, target: s.players[s.current].id });
      return { ok: true, events: this._drain() };
    }

    if (isReverse(face)) {
      if (ds.chainActive) {
        // any reverse, colour ignored
      } else {
        if (!ds.lastWasColoredDraw) return this._err('CANNOT_DEFLECT_WILD_DRAW');
        if (face.color !== s.activeColor) return this._err('REVERSE_MUST_MATCH_COLOR');
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

    if (s.drawStack) {
      const ds = s.drawStack;
      const drawn = this._drawCards(ds.total);
      player.hand.push(...drawn);
      if (ds.untilColor) {
        let guard = 0;
        while (guard++ < 500) {
          const more = this._drawCards(1);
          if (!more.length) break;
          player.hand.push(more[0]);
          if (this._activeFace(more[0]).color === ds.untilColor) break;
        }
      }
      this._emit('PENALTY_TAKEN', { player: player.id, count: player.hand.length });
      s.drawStack = null;
      s.pendingPlay = null;
      s.current = this._nextIndex(idx, s.direction, 1);
      this._emit('TURN_CHANGED', { player: s.players[s.current].id, viaPenalty: true });
      return { ok: true, events: this._drain() };
    }

    if (s.pendingPlay && s.pendingPlay.idx === idx) return this._err('MUST_PLAY_DRAWN_CARD');

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
    if (s.drawStack) return this._err('CANNOT_PASS_DURING_STACK');
    if (!s.pendingPlay || s.pendingPlay.idx !== idx) return this._err('NOTHING_TO_PASS');
    s.pendingPlay = null;
    this._emit('TURN_PASSED', { player: s.players[idx].id });
    s.current = this._nextIndex(idx, s.direction, 1);
    this._emit('TURN_CHANGED', { player: s.players[s.current].id });
    return { ok: true, events: this._drain() };
  }

  _faceOf(card, side) {
    return card[side];
  }

  _activeFace(card) {
    return card[this.state.side];
  }

  _moveToDiscard(idx, card, chosenColor) {
    const s = this.state;
    const player = s.players[idx];
    const face = this._activeFace(card);
    player.hand = player.hand.filter((c) => c.id !== card.id);
    if (isWild(face)) {
      card.chosenColor = chosenColor || s.activeColor;
      s.activeColor = card.chosenColor;
    } else {
      s.activeColor = face.color;
    }
    s.discardPile.push(card);
    this._maybeRecycleByThreshold();
  }

  _isPlayable(card) {
    const s = this.state;
    const f = this._activeFace(card);
    if (isWild(f)) return true;
    if (f.color === s.activeColor) return true;
    const top = this._topDiscard();
    if (!top) return true;
    const tf = this._activeFace(top);
    if (tf.type === TYPE.NUMBER && f.type === TYPE.NUMBER && f.value === tf.value) return true;
    if (COLORED_ACTION_TYPES.has(f.type) && f.type === tf.type) return true;
    return false;
  }

  _validColor(color) {
    return COLORS_BY_SIDE[this.state.side].includes(color);
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
    s.drawStack = null;
    s.pendingPlay = null;
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
    const f = this._activeFace(card);
    return {
      id: card.id,
      color: f.color !== null ? f.color : card.chosenColor ?? null,
      type: f.type,
      value: f.value,
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
      side: s.side,
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
      players: s.players.map((p) => ({
        id: p.id,
        name: p.name,
        isHost: p.isHost,
        eliminated: false,
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

module.exports = { FlipEngine, DEFAULT_CONFIG };
