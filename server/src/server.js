'use strict';

const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const { RoomManager } = require('./rooms');

/**
 * Build the ADAMAS realtime server (Express + Socket.IO).
 *
 * Returns { app, server, io, rooms } without listening, so tests can bind to an
 * ephemeral port. Use createServer().server.listen(port) in production.
 *
 * Protocol (all client → server events take an optional ack callback):
 *   createRoom  { name, config }            -> ack { ok, code, playerId, isHost } | { ok:false, error }
 *   joinRoom    { name, code }              -> ack { ok, code, playerId, isHost } | { ok:false, error }
 *   updateConfig{ eliminationLimit, recycleThreshold } -> ack { ok } | { ok:false, error }
 *   startMatch  {}                          -> ack { ok } | { ok:false, error }
 *   intent      { type, ... }               -> ack { ok } | { ok:false, error }
 *   leaveRoom   {}                          -> ack { ok }
 *
 * Server → client broadcasts:
 *   lobby   { code, status, hostId, config, players }   (lobby changes)
 *   state   { view, events }                            (per-player game state)
 *   ended   { reason }                                  (match ended early, e.g. disconnect)
 */
function createServer({ corsOrigin = '*' } = {}) {
  const app = express();
  app.get('/health', (_req, res) => res.json({ ok: true, service: 'adamas', ts: Date.now() }));

  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: corsOrigin, methods: ['GET', 'POST'] } });
  const rooms = new RoomManager();

  const broadcastLobby = (room) => {
    if (!room) return;
    io.to(room.code).emit('lobby', rooms.lobbyState(room));
  };

  const broadcastGame = (room, events = []) => {
    if (!room || !room.engine) return;
    for (const p of room.players) {
      io.to(p.id).emit('state', { view: room.engine.view(p.id), events });
    }
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
      socket.data.playerId = player.id;
      ack(cb, { ok: true, code: room.code, playerId: player.id, isHost: player.isHost });
      broadcastLobby(room);
    });

    socket.on('joinRoom', (data = {}, cb) => {
      if (socket.data.roomCode) return ack(cb, { ok: false, error: 'ALREADY_IN_ROOM' });
      const { room, player, error } = rooms.joinRoom(data.code, data.name, socket.id);
      if (error) return ack(cb, { ok: false, error });
      socket.join(room.code);
      socket.data.roomCode = room.code;
      socket.data.playerId = player.id;
      ack(cb, { ok: true, code: room.code, playerId: player.id, isHost: player.isHost });
      broadcastLobby(room);
    });

    socket.on('updateConfig', (data = {}, cb) => {
      const code = socket.data.roomCode;
      const { room, error } = rooms.updateConfig(code, socket.id, data);
      if (error) return ack(cb, { ok: false, error });
      ack(cb, { ok: true });
      broadcastLobby(room);
    });

    socket.on('startMatch', (_data, cb) => {
      const code = socket.data.roomCode;
      const { room, events, error } = rooms.startMatch(code, socket.id);
      if (error) return ack(cb, { ok: false, error });
      ack(cb, { ok: true });
      broadcastLobby(room); // status flips to "playing"
      broadcastGame(room, events);
    });

    socket.on('intent', (intent = {}, cb) => {
      const code = socket.data.roomCode;
      const { room, result, error } = rooms.applyIntent(code, socket.id, intent);
      if (error) return ack(cb, { ok: false, error });
      if (!result.ok) return ack(cb, { ok: false, error: result.error });
      ack(cb, { ok: true });
      broadcastGame(room, result.events);
      if (room.status === 'finished') broadcastLobby(room);
    });

    socket.on('leaveRoom', (_data, cb) => {
      handleLeave(socket);
      ack(cb, { ok: true });
    });

    socket.on('disconnect', () => handleLeave(socket));

    function handleLeave(sock) {
      const code = sock.data.roomCode;
      if (!code) return;
      const wasPlaying = rooms.getRoom(code)?.status === 'playing';
      const { room, roomClosed } = rooms.removePlayer(code, sock.id);
      sock.leave(code);
      sock.data.roomCode = null;
      sock.data.playerId = null;
      if (roomClosed || !room) return;
      if (wasPlaying && room.status === 'finished') {
        io.to(room.code).emit('ended', { reason: 'PLAYER_DISCONNECTED' });
      }
      broadcastLobby(room);
    }
  });

  return { app, server, io, rooms };
}

module.exports = { createServer };
