'use strict';

const {
  START_MONEY, PASS_GO, JAIL_INDEX, JAIL_FEE, JAIL_MAX_TURNS, BOARD_SIZE, BOARD,
  RAILROAD_RENTS, UTILITY_MULT, OWNABLE_TYPES, CHANCE_CARDS, COMMUNITY_CARDS,
  BANK_HOUSES, BANK_HOTELS, DEFAULT_CONFIG,
} = require('./constants');

/**
 * MonopolyEngine — Phases 1-4. Server-authoritative, in-memory; same interface
 * as the UNO engines.
 *   P1 board/movement/money/jail · P2 buying + rent · P3 cards/tax/jail-options
 *   P4 houses & hotels (even-build, limited bank supply, rent tiers, selling).
 *
 * Intents: ROLL, END_TURN, BUY_PROPERTY, DECLINE_PROPERTY, JAIL_PAY,
 *          JAIL_USE_CARD, BUILD_HOUSE { spaceIndex }, SELL_HOUSE { spaceIndex }.
 *
 * TURN FLOW (P4): after a non-doubles roll resolves (no pending purchase, not
 * jailed) the engine enters a MANAGEMENT window (`awaitingEnd`) instead of
 * auto-advancing — the player may BUILD_HOUSE/SELL_HOUSE freely and then must
 * END_TURN. Doubles still re-roll; going to jail ends the turn immediately.
 * Building requires sufficient funds (cannot go negative); rent still can.
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
        jailHeld: [],
        eliminated: false,
      })),
      owners: new Array(BOARD_SIZE).fill(null),
      houses: new Array(BOARD_SIZE).fill(0), // per property (0-4)
      hotels: new Array(BOARD_SIZE).fill(false), // per property
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
      awaitingEnd: false, // management window: current player must END_TURN
      log: [],
      events: [],
    };
  }

  // ----- lifecycle ---------------------------------------------------------

  start() {
    const s = this.state;
    if (s.players.length < 2) return this._err('NEED_AT_LEAST_2_PLAYERS');
    for (const p of s.players) {
      p.position = 0; p.money = START_MONEY; p.inJail = false; p.jailTurns = 0; p.doublesCount = 0; p.jailHeld = [];
    }
    s.owners = new Array(BOARD_SIZE).fill(null);
    s.houses = new Array(BOARD_SIZE).fill(0);
    s.hotels = new Array(BOARD_SIZE).fill(false);
    s.bank = { houses: BANK_HOUSES, hotels: BANK_HOTELS };
    s.chanceDeck = this._shuffle(CHANCE_CARDS.map((c) => ({ ...c })));
    s.communityDeck = this._shuffle(COMMUNITY_CARDS.map((c) => ({ ...c })));
    s.current = 0;
    s.status = 'playing';
    s.winner = null;
    s.lastRoll = null;
    s.lastCard = null;
    s.pendingPurchase = null;
    s.pendingDoubles = false;
    s.awaitingEnd = false;
    this._log('MATCH_STARTED', `${s.players[s.current].name} goes first. Everyone starts at Go with $${START_MONEY}.`, { firstPlayer: s.players[s.current].id });
    return { ok: true, events: this._drain() };
  }

  _shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
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
      case 'JAIL_PAY': return this._handleJailPay(idx);
      case 'JAIL_USE_CARD': return this._handleJailCard(idx);
      case 'BUILD_HOUSE': return this._handleBuild(idx, intent.spaceIndex);
      case 'SELL_HOUSE': return this._handleSell(idx, intent.spaceIndex);
      case 'ROLL':
        if (s.pendingPurchase) return this._err('MUST_RESOLVE_PURCHASE');
        if (s.awaitingEnd) return this._err('MUST_END_TURN');
        return this._handleRoll(idx);
      case 'END_TURN':
        if (s.pendingPurchase) return this._err('MUST_RESOLVE_PURCHASE');
        return this._handleEndTurn(idx);
      default: return this._err('UNKNOWN_INTENT');
    }
  }

  _rollDie() { return 1 + Math.floor(this.rng() * 6); }

  _handleRoll(idx) {
    return this.state.players[idx].inJail ? this._jailRoll(idx) : this._freeRoll(idx);
  }

  _freeRoll(idx) {
    const s = this.state;
    const p = s.players[idx];
    const d1 = this._rollDie();
    const d2 = this._rollDie();
    const total = d1 + d2;
    const doubles = d1 === d2;
    s.lastRoll = { d1, d2, total, playerId: p.id };
    this._log('ROLLED', `${p.name} rolled ${d1} + ${d2} = ${total}${doubles ? ' (doubles!)' : ''}.`, { player: p.id, d1, d2, total, doubles });

    if (doubles) {
      p.doublesCount += 1;
      if (p.doublesCount >= 3) {
        this._sendToJail(idx);
        this._log('THREE_DOUBLES_JAIL', `${p.name} rolled three doubles and was sent to Jail!`, { player: p.id });
        return this._endTurnNow(idx);
      }
    } else {
      p.doublesCount = 0;
    }
    this._move(idx, total);
    return this._postMove(idx, total, doubles);
  }

  _jailRoll(idx) {
    const s = this.state;
    const p = s.players[idx];
    const d1 = this._rollDie();
    const d2 = this._rollDie();
    const total = d1 + d2;
    const doubles = d1 === d2;
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
      p.money -= JAIL_FEE;
      p.inJail = false; p.jailTurns = 0;
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

  _freeFromJail(idx) {
    const p = this.state.players[idx];
    p.inJail = false; p.jailTurns = 0; p.doublesCount = 0;
  }

  _postMove(idx, total, doublesForReroll) {
    const s = this.state;
    if (s.players[idx].inJail) return this._endTurnNow(idx); // dice landed on Go-To-Jail
    const paused = this._resolveLanding(idx, total, 0);
    if (paused) {
      s.pendingDoubles = doublesForReroll;
      return { ok: true, events: this._drain() };
    }
    if (s.players[idx].inJail) return this._endTurnNow(idx); // a card sent them to jail
    return this._afterResolve(idx, doublesForReroll);
  }

  // Doubles → roll again; otherwise open the management window (no auto-advance).
  _afterResolve(idx, rollAgain) {
    const s = this.state;
    if (rollAgain) {
      this._log('ROLL_AGAIN', `${s.players[idx].name} rolled doubles — roll again.`, { player: s.players[idx].id });
      return { ok: true, events: this._drain() };
    }
    s.awaitingEnd = true;
    this._log('AWAITING_END', `${s.players[idx].name} may build/sell, then end their turn.`, { player: s.players[idx].id });
    return { ok: true, events: this._drain() };
  }

  // Turn ends immediately (jail cases) — no management window.
  _endTurnNow(idx) {
    this._advanceTurn();
    return { ok: true, events: this._drain() };
  }

  _handleEndTurn(idx) {
    const s = this.state;
    const p = s.players[idx];
    if (p.inJail) return this._err('MUST_ROLL');
    if (p.doublesCount > 0) return this._err('MUST_ROLL'); // owe a doubles re-roll
    if (!s.awaitingEnd) return this._err('MUST_ROLL'); // must roll before ending
    this._advanceTurn();
    return { ok: true, events: this._drain() };
  }

  // ----- Phase 4: building / selling ---------------------------------------

  _group(colorGroup) {
    return BOARD.filter((sp) => sp.colorGroup === colorGroup).map((sp) => sp.index);
  }

  _levelOf(i) {
    return this.state.hotels[i] ? 5 : this.state.houses[i];
  }

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

    const level = this._levelOf(spaceIndex);
    if (level >= 5) return this._err('ALREADY_MAX');
    const minLevel = Math.min(...group.map((i) => this._levelOf(i)));
    if (level !== minLevel) return this._err('UNEVEN_BUILD'); // must build on the lowest lot(s) first

    const isHotel = level === 4; // 5th building → hotel
    if (isHotel) {
      if (s.bank.hotels < 1) return this._err('NO_HOTELS_LEFT');
    } else if (s.bank.houses < 1) {
      return this._err('NO_HOUSES_LEFT');
    }
    const cost = space.houseCost;
    if (p.money < cost) return this._err('INSUFFICIENT_FUNDS'); // building cannot go negative

    p.money -= cost;
    if (isHotel) {
      s.houses[spaceIndex] = 0;
      s.hotels[spaceIndex] = true;
      s.bank.houses += 4; // the 4 houses return to the bank
      s.bank.hotels -= 1;
      this._log('BUILT_HOTEL', `${p.name} built a hotel on ${space.name} for $${cost}.`, { player: p.id, index: spaceIndex, cost });
    } else {
      s.houses[spaceIndex] += 1;
      s.bank.houses -= 1;
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
    if (level !== maxLevel) return this._err('UNEVEN_SELL'); // must sell from the highest lot(s) first

    const refund = Math.floor(space.houseCost / 2);
    if (s.hotels[spaceIndex]) {
      // Selling a hotel converts it to 4 houses on the lot, drawing 4 from the bank.
      if (s.bank.houses < 4) return this._err('NO_HOUSES_FOR_DOWNGRADE');
      s.hotels[spaceIndex] = false;
      s.houses[spaceIndex] = 4;
      s.bank.houses -= 4;
      s.bank.hotels += 1;
      p.money += refund;
      this._log('SOLD_HOTEL', `${p.name} sold the hotel on ${space.name} for $${refund} (now 4 houses).`, { player: p.id, index: spaceIndex, refund });
    } else {
      s.houses[spaceIndex] -= 1;
      s.bank.houses += 1;
      p.money += refund;
      this._log('SOLD_HOUSE', `${p.name} sold a house on ${space.name} for $${refund} (now ${s.houses[spaceIndex]}).`, { player: p.id, index: spaceIndex, refund, houses: s.houses[spaceIndex] });
    }
    return { ok: true, events: this._drain() };
  }

  // ----- landing resolution (tax / cards / ownable) ------------------------

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
      case 'chance':
        return this._drawAndApply(idx, 'chance', total, depth);
      case 'communityChest':
        return this._drawAndApply(idx, 'community', total, depth);
      default:
        return false;
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
    this._log('RENT_PAID',
      `${p.name} paid $${rent} rent to ${ownerPlayer ? ownerPlayer.name : '???'} for ${spaceName} (balance $${p.money}).`,
      { from: p.id, to: ownerId, amount: rent, index: pos, balance: p.money });
  }

  _computeRent(index, total) {
    const s = this.state;
    const space = BOARD[index];
    const owner = s.owners[index];
    if (space.type === 'railroad') return this._railroadRent(owner);
    if (space.type === 'utility') {
      const count = s.owners.filter((o, i) => o === owner && BOARD[i].type === 'utility').length;
      return total * (UTILITY_MULT[count] || 4);
    }
    // property rent tiers (Phase 4)
    if (s.hotels[index]) return space.rentTable[5];
    if (s.houses[index] > 0) return space.rentTable[s.houses[index]];
    // 0 houses: base rent, doubled for a full unbuilt color group (Phase 2 rule)
    let rent = space.rentTable[0];
    const group = this._group(space.colorGroup);
    if (group.every((i) => s.owners[i] === owner)) rent *= 2;
    return rent;
  }

  _railroadRent(owner) {
    const count = this.state.owners.filter((o, i) => o === owner && BOARD[i].type === 'railroad').length;
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
        p.money -= eff.amount;
        this._log('CARD_PAY', `${p.name} paid $${eff.amount} to the bank (balance $${p.money}).`, { player: p.id, amount: eff.amount });
        return false;
      case 'collectFromEach': {
        let got = 0;
        for (const other of s.players) { if (other.id === p.id) continue; other.money -= eff.amount; got += eff.amount; }
        p.money += got;
        this._log('CARD_COLLECT_EACH', `${p.name} collected $${eff.amount} from each player ($${got} total).`, { player: p.id, amount: eff.amount, total: got });
        return false;
      }
      case 'payEach': {
        let paid = 0;
        for (const other of s.players) { if (other.id === p.id) continue; other.money += eff.amount; paid += eff.amount; }
        p.money -= paid;
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
        p.money -= cost;
        this._log('CARD_REPAIRS', `${p.name} paid $${cost} for repairs (${houses} houses, ${hotels} hotels).`, { player: p.id, cost, houses, hotels });
        return false;
      }
      case 'moveTo':
        return this._doMoveTo(idx, eff.index, !!eff.passGo, total, depth);
      case 'moveBy':
        return this._doMoveBy(idx, eff.steps, total, depth);
      case 'moveToNearest':
        return this._doMoveToNearest(idx, eff.target, eff.payMultiplier, total, depth);
      default:
        return false;
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
    for (let step = 1; step <= BOARD_SIZE; step++) {
      const cand = (from + step) % BOARD_SIZE;
      if (BOARD[cand].type === target) { pos = cand; break; }
    }
    if (pos < from) { p.money += PASS_GO; this._log('PASSED_GO', `${p.name} passed Go (+$${PASS_GO}).`, { player: p.id, amount: PASS_GO }); }
    p.position = pos;
    this._log('CARD_MOVE', `${p.name} advanced to the nearest ${target} (${BOARD[pos].name}).`, { player: p.id, index: pos });
    const owner = s.owners[pos];
    if (owner == null) {
      s.pendingPurchase = { spaceIndex: pos, name: BOARD[pos].name, price: BOARD[pos].price };
      this._log('BUY_OPTION', `${p.name} may buy ${BOARD[pos].name} for $${BOARD[pos].price}.`, { player: p.id, index: pos, price: BOARD[pos].price });
      return true;
    }
    if (owner === p.id) {
      this._log('OWN_PROPERTY', `${p.name} landed on their own ${BOARD[pos].name}.`, { player: p.id, index: pos });
      return false;
    }
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
    let houses = 0;
    let hotels = 0;
    s.owners.forEach((o, i) => {
      if (o !== pid) return;
      if (s.hotels[i]) hotels += 1; // a hotel counts as a hotel, not 4 houses
      else houses += s.houses[i];
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
    s.awaitingEnd = false;
    s.current = (s.current + 1) % s.players.length;
    this._log('TURN_CHANGED', `It's ${s.players[s.current].name}'s turn.`, { player: s.players[s.current].id });
  }

  // ----- helpers -----------------------------------------------------------

  _indexOf(playerId) { return this.state.players.findIndex((p) => p.id === playerId); }

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
    const cur = s.players[s.current];
    const jailOptions = cur && cur.inJail
      ? { canPay: true, canUseCard: cur.jailHeld.length > 0, mustRollAttempt: true }
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
      })),
      bank: { ...s.bank },
      pendingPurchase: s.pendingPurchase ? { ...s.pendingPurchase } : null,
      awaitingEnd: s.awaitingEnd,
      jailOptions,
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
        jailCards: p.jailHeld.length,
        properties: this._ownedBy(p.id),
        eliminated: false,
        isYou: p.id === playerId,
      })),
    };
  }

  publicState() { return this.view(null); }
}

module.exports = { MonopolyEngine, DEFAULT_CONFIG };
