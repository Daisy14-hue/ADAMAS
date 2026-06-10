'use strict';

const { NoMercyEngine, DEFAULT_CONFIG } = require('./engine');

/**
 * In-memory room/lobby manager for ADAMAS Phase 1.
 *
 * No database — rooms live only in process memory and vanish on restart.
 * A player's identity within a room is their socket id (Phase 1: no accounts,
 * no reconnect). Each room owns one NoMercyEngine instance once the match
 * starts.
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

  createRoom(hostName, socketId, config = {}) {
    const code = this._newCode();
    const room = {
      code,
      hostId: socketId,
      status: 'lobby', // 'lobby' | 'playing' | 'finished'
      config: {
        eliminationLimit: clampInt(config.eliminationLimit, 2, 200, DEFAULT_CONFIG.eliminationLimit),
        recycleThreshold: clampInt(config.recycleThreshold, 10, 200, DEFAULT_CONFIG.recycleThreshold),
      },
      players: [],
      engine: null,
    };
    this.rooms.set(code, room);
    const player = this._addPlayer(room, hostName, socketId);
    return { room, player };
  }

  joinRoom(code, name, socketId) {
    const room = this.rooms.get(String(code || '').toUpperCase().trim());
    if (!room) return { error: 'ROOM_NOT_FOUND' };
    if (room.status !== 'lobby') return { error: 'MATCH_ALREADY_STARTED' };
    if (room.players.length >= MAX_PLAYERS) return { error: 'ROOM_FULL' };
    if (room.players.some((p) => p.id === socketId)) {
      return { room, player: room.players.find((p) => p.id === socketId) };
    }
    const player = this._addPlayer(room, name, socketId);
    return { room, player };
  }

  _addPlayer(room, name, socketId) {
    const player = {
      id: socketId,
      name: sanitizeName(name),
      isHost: room.hostId === socketId,
      connected: true,
    };
    room.players.push(player);
    return player;
  }

  updateConfig(code, socketId, config) {
    const room = this.rooms.get(code);
    if (!room) return { error: 'ROOM_NOT_FOUND' };
    if (room.hostId !== socketId) return { error: 'NOT_HOST' };
    if (room.status !== 'lobby') return { error: 'MATCH_ALREADY_STARTED' };
    if (config.eliminationLimit !== undefined) {
      room.config.eliminationLimit = clampInt(config.eliminationLimit, 2, 200, room.config.eliminationLimit);
    }
    if (config.recycleThreshold !== undefined) {
      room.config.recycleThreshold = clampInt(config.recycleThreshold, 10, 200, room.config.recycleThreshold);
    }
    return { room };
  }

  startMatch(code, socketId) {
    const room = this.rooms.get(code);
    if (!room) return { error: 'ROOM_NOT_FOUND' };
    if (room.hostId !== socketId) return { error: 'NOT_HOST' };
    if (room.status !== 'lobby') return { error: 'MATCH_ALREADY_STARTED' };
    if (room.players.length < MIN_PLAYERS) return { error: 'NEED_AT_LEAST_2_PLAYERS' };

    room.engine = new NoMercyEngine({
      players: room.players.map((p) => ({ id: p.id, name: p.name, isHost: p.isHost })),
      config: room.config,
    });
    const res = room.engine.start();
    if (!res.ok) return { error: res.error };
    room.status = 'playing';
    return { room, events: res.events };
  }

  applyIntent(code, socketId, intent) {
    const room = this.rooms.get(code);
    if (!room) return { error: 'ROOM_NOT_FOUND' };
    if (room.status !== 'playing' || !room.engine) return { error: 'GAME_NOT_ACTIVE' };
    const res = room.engine.applyIntent(socketId, intent);
    if (res.ok && room.engine.state.status === 'finished') room.status = 'finished';
    return { room, result: res };
  }

  /** Remove a player (disconnect/leave). Returns { room, removed, roomClosed }. */
  removePlayer(code, socketId) {
    const room = this.rooms.get(code);
    if (!room) return { roomClosed: false };
    const idx = room.players.findIndex((p) => p.id === socketId);
    if (idx < 0) return { room, removed: null, roomClosed: false };
    const [removed] = room.players.splice(idx, 1);

    // If the match is in progress, a disconnect ends it (Phase 1 limitation).
    if (room.status === 'playing') {
      room.status = 'finished';
    }

    // Reassign host if the host left and players remain.
    if (room.hostId === socketId && room.players.length > 0) {
      room.hostId = room.players[0].id;
      room.players[0].isHost = true;
    }

    let roomClosed = false;
    if (room.players.length === 0) {
      this.rooms.delete(code);
      roomClosed = true;
    }
    return { room: roomClosed ? null : room, removed, roomClosed };
  }

  getRoom(code) {
    return this.rooms.get(code) || null;
  }

  /** Lobby snapshot for broadcasting (no engine state). */
  lobbyState(room) {
    return {
      code: room.code,
      status: room.status,
      hostId: room.hostId,
      config: { ...room.config },
      players: room.players.map((p) => ({ id: p.id, name: p.name, isHost: p.isHost })),
    };
  }
}

module.exports = { RoomManager, sanitizeName, clampInt, MIN_PLAYERS, MAX_PLAYERS };
