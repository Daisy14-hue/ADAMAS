'use strict';

const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const { RoomManager } = require('./rooms');

const DEFAULT_GRACE_MS = 60000; // reconnect grace window before a seat is removed

/**
 * Build the ADAMAS realtime server (Express + Socket.IO).
 *
 * Returns { app, server, io, rooms } without listening, so tests can bind to an
 * ephemeral port. `opts.graceMs` overrides the reconnect grace window (tests).
 *
 * Protocol (client → server events take an optional ack callback). The shapes
 * are backwards-compatible — reconnect only ADDS fields (`pid`, `connected`):
 *   createRoom  { name, config }       -> ack { ok, code, playerId, pid, isHost }
 *   joinRoom    { name, code, pid? }   -> ack { ok, code, playerId, pid, isHost, reconnected }
 *   updateConfig{ eliminationLimit, recycleThreshold } -> ack { ok } | { ok:false, error }
 *   startMatch  {}                     -> ack { ok } | { ok:false, error }
 *   intent      { type, ... }          -> ack { ok } | { ok:false, error }
 *   leaveRoom   {}                     -> ack { ok }   (explicit, immediate leave)
 *
 * Server → client broadcasts:
 *   lobby   { code, status, hostId, config, players:[{id,name,isHost,connected}] }
 *   state   { view, events }    (view.players[].connected is included)
 *   ended   { reason }          (match ended: PLAYER_REMOVED after grace, PLAYER_LEFT)
 *
 * `playerId` in acks equals `pid` (the stable identity the client matches
 * against view.players[].id and lobby.hostId). It is kept for back-compat.
 */
function createServer({ corsOrigin = '*', graceMs = DEFAULT_GRACE_MS } = {}) {
  const app = express();
  app.get('/health', (_req, res) => res.json({ ok: true, service: 'adamas', ts: Date.now() }));

  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: corsOrigin, methods: ['GET', 'POST'] } });
  const rooms = new RoomManager();

  // pid -> grace removal timer (kept in the socket layer because firing it needs
  // to broadcast over io).
  const graceTimers = new Map();
  const clearGrace = (pid) => {
    const t = graceTimers.get(pid);
    if (t) {
      clearTimeout(t);
      graceTimers.delete(pid);
    }
  };

  const broadcastLobby = (room) => {
    if (!room) return;
    io.to(room.code).emit('lobby', rooms.lobbyState(room));
  };

  const broadcastGame = (room, events = []) => {
    if (!room || !room.engine) return;
    for (const p of room.players) {
      if (!p.socketId) continue;
      io.to(p.socketId).emit('state', { view: rooms.gameView(room, p.pid), events });
    }
  };

  const startGrace = (code, pid) => {
    clearGrace(pid);
    const timer = setTimeout(() => {
      graceTimers.delete(pid);
      const room = rooms.getRoom(code);
      if (!room) return;
      const player = room.players.find((p) => p.pid === pid);
      if (!player || player.connected) return; // reconnected in time → keep seat
      const res = rooms.removePlayer(code, pid);
      if (res.endedMatch) io.to(code).emit('ended', { reason: 'PLAYER_REMOVED' });
      if (!res.roomClosed && res.room) {
        broadcastLobby(res.room);
        broadcastGame(res.room);
      }
    }, graceMs);
    if (typeof timer.unref === "function") timer.unref(); // never block process exit
    graceTimers.set(pid, timer);
  };

  io.on('connection', (socket) => {
    const ack = (cb, payload) => {
      if (typeof cb === 'function') cb(payload);
    };

    socket.on('createRoom', (data = {}, cb) => {
      if (socket.data.roomCode) return ack(cb, { ok: false, error: 'ALREADY_IN_ROOM' });
      const { room, player } = rooms.createRoom(data.name, socket.id, data.config || {});
      socket.join(room.code);
      socket.data.roomCode = room.code;
      socket.data.pid = player.pid;
      ack(cb, { ok: true, code: room.code, playerId: player.pid, pid: player.pid, isHost: player.isHost });
      broadcastLobby(room);
    });

    socket.on('joinRoom', (data = {}, cb) => {
      if (socket.data.roomCode) return ack(cb, { ok: false, error: 'ALREADY_IN_ROOM' });
      const { room, player, reconnected, error } = rooms.joinRoom(data.code, data.name, socket.id, data.pid);
      if (error) return ack(cb, { ok: false, error });
      socket.join(room.code);
      socket.data.roomCode = room.code;
      socket.data.pid = player.pid;
      clearGrace(player.pid); // cancel any pending removal
      ack(cb, {
        ok: true,
        code: room.code,
        playerId: player.pid,
        pid: player.pid,
        isHost: player.isHost,
        reconnected: !!reconnected,
      });
      broadcastLobby(room);
      // A reconnecting player mid-match needs their private hand re-sent.
      if (room.engine) {
        io.to(socket.id).emit('state', { view: rooms.gameView(room, player.pid), events: [] });
      }
    });

    socket.on('updateConfig', (data = {}, cb) => {
      const { room, error } = rooms.updateConfig(socket.data.roomCode, socket.data.pid, data);
      if (error) return ack(cb, { ok: false, error });
      ack(cb, { ok: true });
      broadcastLobby(room);
    });

    socket.on('startMatch', (_data, cb) => {
      const { room, events, error } = rooms.startMatch(socket.data.roomCode, socket.data.pid);
      if (error) return ack(cb, { ok: false, error });
      ack(cb, { ok: true });
      broadcastLobby(room); // status flips to "playing"
      broadcastGame(room, events);
    });

    socket.on('intent', (intent = {}, cb) => {
      const { room, result, error } = rooms.applyIntent(socket.data.roomCode, socket.data.pid, intent);
      if (error) return ack(cb, { ok: false, error });
      if (!result.ok) return ack(cb, { ok: false, error: result.error });
      ack(cb, { ok: true });
      broadcastGame(room, result.events);
      if (room.status === 'finished') broadcastLobby(room);
    });

    // Explicit, intentional leave → remove immediately (no grace period).
    socket.on('leaveRoom', (_data, cb) => {
      handleExplicitLeave(socket);
      ack(cb, { ok: true });
    });

    // Transport drop → grace period, NOT removal.
    socket.on('disconnect', () => handleDisconnect(socket));

    function handleDisconnect(sock) {
      const code = sock.data.roomCode;
      const pid = sock.data.pid;
      if (!code || !pid) return;
      const { room, player } = rooms.markDisconnected(code, pid);
      if (!room || !player) return;
      broadcastLobby(room);
      broadcastGame(room); // refresh connected flags in the live game view
      startGrace(code, pid);
    }

    function handleExplicitLeave(sock) {
      const code = sock.data.roomCode;
      const pid = sock.data.pid;
      sock.leave(code || '');
      sock.data.roomCode = null;
      sock.data.pid = null;
      if (!code || !pid) return;
      clearGrace(pid);
      const res = rooms.removePlayer(code, pid);
      if (res.endedMatch) io.to(code).emit('ended', { reason: 'PLAYER_LEFT' });
      if (!res.roomClosed && res.room) {
        broadcastLobby(res.room);
        broadcastGame(res.room);
      }
    }
  });

  return { app, server, io, rooms };
}

module.exports = { createServer };
