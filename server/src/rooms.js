'use strict';

const { randomUUID } = require('crypto');
const { NoMercyEngine, DEFAULT_CONFIG } = require('./engine/noMercy');
const { FlipEngine } = require('./engine/flip');
const { SpinEngine } = require('./engine/spin');
const { MonopolyEngine } = require('./engine/monopoly');

const GAME_TYPES = new Set(['noMercy', 'flip', 'spin', 'monopoly']);

/**
 * In-memory room/lobby manager for ADAMAS Phase 1.
 *
 * No database — rooms live only in process memory and vanish on restart.
 *
 * IDENTITY MODEL (reconnect support):
 *   Each player has a stable `pid` (a crypto.randomUUID) that is their identity
 *   for the whole match — this is what the NoMercy engine sees as the player id.
 *   The live transport is tracked separately as `socketId`, which changes every
 *   time the player (re)connects. A disconnect does NOT delete the player; the
 *   socket layer marks them `connected: false` and starts a grace timer. A
 *   reconnect re-attaches a fresh socketId to the same `pid`.
 *
 * Player shape: { pid, socketId, name, isHost, connected, disconnectedAt }
 */

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no easily-confused chars
const CODE_LENGTH = 4;
const MAX_PLAYERS = 10;
const MIN_PLAYERS = 2;

function sanitizeName(name) {
  const n = String(name == null ? '' : name).trim().slice(0, 20);
  return n.length ? n : 'Player';
}

function clampInt(v, min, max, fallback) {
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

// ---- defensive guard rails (NOT game rules) ------------------------------
const VALID_COLORS = new Set(['red', 'yellow', 'green', 'blue', 'pink', 'teal', 'orange', 'purple']);
const KNOWN_INTENTS = new Set(['PLAY_CARD', 'DRAW', 'PASS', 'SAY_UNO', 'SPIN', 'SPIN_CHOICE', 'RACE_TAP', 'RACE_TIMEOUT', 'ROLL', 'END_TURN', 'BUY_PROPERTY', 'DECLINE_PROPERTY']);
const isShortStr = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64;
const isColorStr = (v) => typeof v === 'string' && VALID_COLORS.has(v);
const isIdList = (v) => Array.isArray(v) && v.length <= 64 && v.every(isShortStr);

/**
 * Validate an intent is a well-formed object with a known `type` and correctly
 * typed fields BEFORE it reaches an engine. GUARD RAIL only — semantic legality
 * (turn order, card playability, wheel outcomes) stays the engine's job.
 */
function validateIntent(intent) {
  if (!intent || typeof intent !== 'object' || Array.isArray(intent)) return false;
  const t = intent.type;
  if (typeof t !== 'string' || !KNOWN_INTENTS.has(t)) return false;
  switch (t) {
    case 'PLAY_CARD':
      if (!isShortStr(intent.cardId)) return false;
      if (intent.chosenColor !== undefined && !isColorStr(intent.chosenColor)) return false;
      if (intent.rouletteColor !== undefined && !isColorStr(intent.rouletteColor)) return false;
      return true;
    case 'SPIN_CHOICE':
      if (intent.cardId !== undefined && !isShortStr(intent.cardId)) return false;
      if (intent.topCardId !== undefined && !isShortStr(intent.topCardId)) return false;
      if (intent.color !== undefined && !isColorStr(intent.color)) return false;
      if (intent.chosenColor !== undefined && !isColorStr(intent.chosenColor)) return false;
      if (intent.number !== undefined && !(Number.isInteger(intent.number) && intent.number >= 0 && intent.number <= 9)) return false;
      if (intent.keepIds !== undefined && !isIdList(intent.keepIds)) return false;
      if (intent.discardIds !== undefined && !isIdList(intent.discardIds)) return false;
      return true;
    case 'DRAW':
    case 'PASS':
    case 'SAY_UNO':
    case 'SPIN':
    case 'RACE_TAP':
    case 'RACE_TIMEOUT':
    case 'ROLL':              // Monopoly
    case 'END_TURN':          // Monopoly
    case 'BUY_PROPERTY':      // Monopoly Phase 2
    case 'DECLINE_PROPERTY':  // Monopoly Phase 2
      return true;
    default:
      return false;
  }
}

class RoomManager {
  constructor() {
    /** @type {Map<string, Room>} */
    this.rooms = new Map();
  }

  _newCode() {
    let code;
    let guard = 0;
    do {
      code = '';
      for (let i = 0; i < CODE_LENGTH; i++) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      }
      guard++;
    } while (this.rooms.has(code) && guard < 1000);
    return code;
  }

  _findByPid(room, pid) {
    return room.players.find((p) => p.pid === pid) || null;
  }

  createRoom(hostName, socketId, config = {}, gameType = 'noMercy') {
    const cfg = config && typeof config === 'object' ? config : {};
    const code = this._newCode();
    const pid = randomUUID();
    const room = {
      code,
      hostId: pid, // host identity is a stable pid (survives reconnects)
      gameType: typeof gameType === 'string' && GAME_TYPES.has(gameType) ? gameType : 'noMercy',
      status: 'lobby', // 'lobby' | 'playing' | 'finished'
      config: {
        eliminationLimit: clampInt(cfg.eliminationLimit, 2, 200, DEFAULT_CONFIG.eliminationLimit),
        recycleThreshold: clampInt(cfg.recycleThreshold, 10, 200, DEFAULT_CONFIG.recycleThreshold),
      },
      players: [],
      engine: null,
    };
    this.rooms.set(code, room);
    const player = this._addPlayer(room, hostName, socketId, pid);
    return { room, player };
  }

  /**
   * Join a room, or RECONNECT if a known `pid` is supplied.
   * - With a `pid` that already exists in the room → reattach the new socketId
   *   to the existing seat (works in lobby AND mid-match). No duplicate seat.
   * - Otherwise a brand-new player joins (only allowed while in 'lobby').
   */
  joinRoom(code, name, socketId, pid) {
    const safePid = pid != null ? String(pid) : undefined;
    const room = this.rooms.get(String(code || '').toUpperCase().trim());
    if (!room) return { error: 'ROOM_NOT_FOUND' };

    if (safePid) {
      const existing = this._findByPid(room, safePid);
      if (existing) {
        existing.socketId = socketId;
        existing.connected = true;
        existing.disconnectedAt = null;
        if (name) existing.name = sanitizeName(name);
        return { room, player: existing, reconnected: true };
      }
    }

    // New player from here on.
    if (room.status !== 'lobby') return { error: 'MATCH_ALREADY_STARTED' };
    if (room.players.length >= MAX_PLAYERS) return { error: 'ROOM_FULL' };
    const player = this._addPlayer(room, name, socketId, randomUUID());
    return { room, player, reconnected: false };  // (safePid was absent/unknown)
  }

  _addPlayer(room, name, socketId, pid) {
    const player = {
      pid,
      socketId,
      name: sanitizeName(name),
      isHost: room.hostId === pid,
      connected: true,
      disconnectedAt: null,
    };
    room.players.push(player);
    return player;
  }

  /** Mark a player as disconnected without removing them (grace period). */
  markDisconnected(code, pid) {
    const room = this.rooms.get(code);
    if (!room) return { room: null, player: null };
    const player = this._findByPid(room, pid);
    if (!player) return { room, player: null };
    player.connected = false;
    player.disconnectedAt = Date.now();
    return { room, player };
  }

  updateConfig(code, pid, config) {
    const room = this.rooms.get(code);
    if (!room) return { error: 'ROOM_NOT_FOUND' };
    if (room.hostId !== pid) return { error: 'NOT_HOST' };
    if (room.status !== 'lobby') return { error: 'MATCH_ALREADY_STARTED' };
    if (config.eliminationLimit !== undefined) {
      room.config.eliminationLimit = clampInt(config.eliminationLimit, 2, 200, room.config.eliminationLimit);
    }
    if (config.recycleThreshold !== undefined) {
      room.config.recycleThreshold = clampInt(config.recycleThreshold, 10, 200, room.config.recycleThreshold);
    }
    return { room };
  }

  startMatch(code, pid) {
    const room = this.rooms.get(code);
    if (!room) return { error: 'ROOM_NOT_FOUND' };
    if (room.hostId !== pid) return { error: 'NOT_HOST' };
    if (room.status !== 'lobby') return { error: 'MATCH_ALREADY_STARTED' };
    if (room.players.length < MIN_PLAYERS) return { error: 'NEED_AT_LEAST_2_PLAYERS' };

    const EngineCls =
      room.gameType === 'flip' ? FlipEngine
      : room.gameType === 'spin' ? SpinEngine
      : room.gameType === 'monopoly' ? MonopolyEngine
      : NoMercyEngine;
    room.engine = new EngineCls({
      players: room.players.map((p) => ({ id: p.pid, name: p.name, isHost: p.isHost })),
      config: room.config,
    });
    const res = room.engine.start();
    if (!res.ok) return { error: res.error };
    room.status = 'playing';
    return { room, events: res.events };
  }

  applyIntent(code, pid, intent) {
    const room = this.rooms.get(code);
    if (!room) return { error: 'ROOM_NOT_FOUND' };
    if (room.status !== 'playing' || !room.engine) return { error: 'GAME_NOT_ACTIVE' };
    // Guard rail: reject malformed intents before they ever reach the engine.
    if (!validateIntent(intent)) return { error: 'BAD_INTENT' };
    let res;
    try {
      res = room.engine.applyIntent(pid, intent);
    } catch (err) {
      // A bug or unexpected state must NOT crash the room — degrade gracefully.
      // eslint-disable-next-line no-console
      console.error('[ADAMAS] engine.applyIntent threw for room', code, '-', err && err.stack ? err.stack : err);
      return { error: 'ENGINE_ERROR' };
    }
    if (!res || typeof res !== 'object') return { error: 'ENGINE_ERROR' };
    if (res.ok && room.engine.state && room.engine.state.status === 'finished') room.status = 'finished';
    return { room, result: res };
  }

  /**
   * Permanently remove a player (grace timer expired, or an explicit leave).
   * Returns { room, removed, roomClosed, endedMatch }.
   *
   * ENGINE NOTE: the NoMercy rules engine has no "remove a seat mid-match"
   * operation — its turn pointer is an index into a fixed players array, so
   * splicing a player out would corrupt turn order. Rather than silently change
   * engine rules (and break the 43-test engine suite), we choose: if a player is
   * removed while status === 'playing', the MATCH ENDS (endedMatch = true). This
   * only happens AFTER the grace period, so a quick reconnect never triggers it.
   * In 'lobby' the player is simply dropped and the lobby continues.
   */
  removePlayer(code, pid) {
    const room = this.rooms.get(code);
    if (!room) return { room: null, removed: null, roomClosed: false, endedMatch: false };
    const idx = room.players.findIndex((p) => p.pid === pid);
    if (idx < 0) return { room, removed: null, roomClosed: false, endedMatch: false };
    const [removed] = room.players.splice(idx, 1);

    let endedMatch = false;
    if (room.status === 'playing') {
      room.status = 'finished';
      endedMatch = true;
    }

    // Reassign host (by pid) if the host left and players remain.
    if (room.hostId === pid && room.players.length > 0) {
      room.hostId = room.players[0].pid;
      room.players[0].isHost = true;
    }

    let roomClosed = false;
    if (room.players.length === 0) {
      this.rooms.delete(code);
      roomClosed = true;
    }
    return { room: roomClosed ? null : room, removed, roomClosed, endedMatch };
  }

  getRoom(code) {
    return this.rooms.get(code) || null;
  }

  /** Lobby snapshot for broadcasting (no engine state). Includes `connected`. */
  lobbyState(room) {
    return {
      code: room.code,
      status: room.status,
      gameType: room.gameType,
      hostId: room.hostId,
      config: { ...room.config },
      players: room.players.map((p) => ({
        id: p.pid,
        name: p.name,
        isHost: p.isHost,
        connected: p.connected,
      })),
    };
  }

  /**
   * Per-player game view (engine.view by pid) with each player's `connected`
   * flag injected from room state (the engine doesn't track connectivity).
   */
  gameView(room, pid) {
    if (!room.engine) return null;
    const view = room.engine.view(pid);
    for (const vp of view.players) {
      const rp = this._findByPid(room, vp.id);
      vp.connected = rp ? rp.connected : false;
    }
    return view;
  }
}
module.exports = { RoomManager, sanitizeName, clampInt, validateIntent, MIN_PLAYERS, MAX_PLAYERS };
