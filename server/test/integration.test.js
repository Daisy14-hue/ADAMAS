'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');

const { createServer } = require('../src/server');

// ---- harness --------------------------------------------------------------

function startServer() {
  return new Promise((resolve) => {
    const { server } = createServer({ corsOrigin: '*' });
    server.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

function connect(port) {
  return new Promise((resolve) => {
    const sock = io(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
    sock.on('connect', () => resolve(sock));
  });
}

// Promisified emit-with-ack.
function rpc(sock, event, data) {
  return new Promise((resolve) => sock.emit(event, data, resolve));
}

// Wait for the next event of a given name.
function once(sock, event) {
  return new Promise((resolve) => sock.once(event, resolve));
}

// ---- minimal client-side legality mirror (for the bot driver) -------------

const WILDS = new Set(['wild', 'wildDraw4', 'wildDraw6', 'wildDraw10', 'wildReverseDraw4', 'wildRoulette']);
const COLOR_ACTIONS = new Set(['skip', 'reverse', 'draw2', 'skipEveryone', 'discardAll']);

function isPlayable(card, view) {
  if (WILDS.has(card.type)) return true;
  if (card.color === view.activeColor) return true;
  const top = view.topCard;
  if (!top) return true;
  if (top.type === 'number' && card.type === 'number' && card.value === top.value) return true;
  if (COLOR_ACTIONS.has(card.type) && card.type === top.type) return true;
  return false;
}

function needsColor(card) {
  return WILDS.has(card.type) && card.type !== 'wildRoulette';
}

/**
 * Drive a full game with simple bots:
 *  - on a live draw-stack, always take the penalty (a legal response),
 *  - otherwise play the first legal card, falling back to drawing.
 * Resolves with the final view once status === 'finished'.
 */
function runGame(clients, { maxMoves = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    let moves = 0;
    let done = false;
    const latest = {};
    const acting = {};
    const pending = {};

    const finish = (view) => {
      if (done) return;
      done = true;
      for (const c of clients) c.sock.removeAllListeners('state');
      resolve(view);
    };

    function buildCandidates(view) {
      const me = view.players.find((p) => p.isYou);
      const candidates = [];
      if (view.drawStack.active) {
        candidates.push({ type: 'DRAW' }); // take the penalty (always legal)
        return candidates;
      }
      for (const card of me.hand) {
        if (!isPlayable(card, view)) continue;
        const intent = { type: 'PLAY_CARD', cardId: card.id };
        if (needsColor(card)) {
          intent.chosenColor = ['red', 'yellow', 'green', 'blue'].includes(view.activeColor) ? view.activeColor : 'red';
        }
        if (card.type === 'wildRoulette') intent.rouletteColor = 'red';
        candidates.push(intent);
      }
      candidates.push({ type: 'DRAW' });
      return candidates;
    }

    // Always acts on the freshest view; single-flight per player with a
    // pending-rerun flag so no turn-triggering state update is ever dropped.
    function schedule(c) {
      if (done) return;
      const view = latest[c.playerId];
      if (!view) return;
      if (view.status === 'finished') return finish(view);
      if (view.currentPlayerId !== c.playerId) return;
      if (acting[c.playerId]) {
        pending[c.playerId] = true;
        return;
      }
      act(c);
    }

    async function act(c) {
      acting[c.playerId] = true;
      try {
        if (++moves > maxMoves) {
          done = true;
          return reject(new Error('game did not terminate within maxMoves'));
        }
        const view = latest[c.playerId];
        for (const intent of buildCandidates(view)) {
          const res = await rpc(c.sock, 'intent', intent);
          if (res && res.ok) break;
        }
      } finally {
        acting[c.playerId] = false;
      }
      if (pending[c.playerId]) {
        pending[c.playerId] = false;
        schedule(c);
      }
    }

    for (const c of clients) {
      c.sock.on('state', ({ view }) => {
        latest[c.playerId] = view;
        schedule(c);
      });
    }
  });
}

// ---- tests ----------------------------------------------------------------

test('health endpoint responds', async () => {
  const { server, port } = await startServer();
  const res = await fetch(`http://localhost:${port}/health`);
  const body = await res.json();
  assert.equal(body.ok, true);
  server.close();
});

test('create + join lobby syncs both players and host flag', async () => {
  const { server, port } = await startServer();
  const host = await connect(port);
  const guest = await connect(port);

  const created = await rpc(host, 'createRoom', { name: 'Ashish' });
  assert.ok(created.ok);
  assert.equal(created.isHost, true);
  const code = created.code;

  const lobbyP = once(guest, 'lobby');
  const joined = await rpc(guest, 'joinRoom', { name: 'Mahi', code });
  assert.ok(joined.ok, joined.error);
  assert.equal(joined.isHost, false);

  const lobby = await lobbyP;
  assert.equal(lobby.code, code);
  assert.equal(lobby.players.length, 2);
  assert.deepEqual(lobby.players.map((p) => p.name).sort(), ['Ashish', 'Mahi']);

  host.close();
  guest.close();
  server.close();
});

test('joining a bad code is rejected', async () => {
  const { server, port } = await startServer();
  const guest = await connect(port);
  const res = await rpc(guest, 'joinRoom', { name: 'X', code: 'ZZZZ' });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'ROOM_NOT_FOUND');
  guest.close();
  server.close();
});

test('only the host can change config and start the match', async () => {
  const { server, port } = await startServer();
  const host = await connect(port);
  const guest = await connect(port);
  const { code } = await rpc(host, 'createRoom', { name: 'Host' });
  await rpc(guest, 'joinRoom', { name: 'Guest', code });

  assert.equal((await rpc(guest, 'updateConfig', { eliminationLimit: 10 })).error, 'NOT_HOST');
  assert.equal((await rpc(guest, 'startMatch', {})).error, 'NOT_HOST');

  const lobbyP = once(guest, 'lobby');
  assert.ok((await rpc(host, 'updateConfig', { eliminationLimit: 10, recycleThreshold: 30 })).ok);
  const lobby = await lobbyP;
  assert.equal(lobby.config.eliminationLimit, 10);
  assert.equal(lobby.config.recycleThreshold, 30);

  host.close();
  guest.close();
  server.close();
});

test('match start deals private hands to each player', async () => {
  const { server, port } = await startServer();
  const host = await connect(port);
  const guest = await connect(port);
  const { code } = await rpc(host, 'createRoom', { name: 'Host' });
  await rpc(guest, 'joinRoom', { name: 'Guest', code });

  const hostState = once(host, 'state');
  const guestState = once(guest, 'state');
  assert.ok((await rpc(host, 'startMatch', {})).ok);

  const hv = (await hostState).view;
  const gv = (await guestState).view;
  assert.equal(hv.status, 'playing');
  // Each sees their own 7-card hand and only counts for the opponent.
  const hostMe = hv.players.find((p) => p.isYou);
  const hostThem = hv.players.find((p) => !p.isYou);
  assert.equal(hostMe.hand.length, 7);
  assert.equal(hostThem.hand, undefined);
  assert.equal(hostThem.handCount, 7);
  assert.equal(gv.players.find((p) => p.isYou).hand.length, 7);

  host.close();
  guest.close();
  server.close();
});

test('out-of-turn intent is rejected by the server', async () => {
  const { server, port } = await startServer();
  const host = await connect(port);
  const guest = await connect(port);
  const { code } = await rpc(host, 'createRoom', { name: 'Host' });
  await rpc(guest, 'joinRoom', { name: 'Guest', code });

  const hostState = once(host, 'state');
  await rpc(host, 'startMatch', {});
  const hv = (await hostState).view;
  const notCurrent = hv.currentPlayerId === host.id ? guest : host;
  const res = await rpc(notCurrent, 'intent', { type: 'DRAW' });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'NOT_YOUR_TURN');

  host.close();
  guest.close();
  server.close();
});

test('a full 3-player game runs end-to-end to a winner', async () => {
  const { server, port } = await startServer();
  const a = await connect(port);
  const b = await connect(port);
  const c = await connect(port);

  const ca = await rpc(a, 'createRoom', { name: 'A', config: { eliminationLimit: 25 } });
  const code = ca.code;
  await rpc(b, 'joinRoom', { name: 'B', code });
  await rpc(c, 'joinRoom', { name: 'C', code });

  const clients = [
    { sock: a, playerId: ca.playerId },
    { sock: b, playerId: b.id },
    { sock: c, playerId: c.id },
  ];
  const gameP = runGame(clients);
  await rpc(a, 'startMatch', {});
  await rpc(a, 'startMatch', {});

  const finalView = await gameP;
  assert.equal(finalView.status, 'finished');
  assert.ok(finalView.winner, 'a winner is declared');

  a.close();
  b.close();
  c.close();
  server.close();
});

test('disconnect during a match ends it', async () => {
  const { server, port } = await startServer();
  const host = await connect(port);
  const guest = await connect(port);
  const { code } = await rpc(host, 'createRoom', { name: 'Host' });
  await rpc(guest, 'joinRoom', { name: 'Guest', code });
  await rpc(host, 'startMatch', {});

  const endedP = once(guest, 'ended');
  host.close();
  const ended = await endedP;
  assert.equal(ended.reason, 'PLAYER_DISCONNECTED');

  guest.close();
  server.close();
});
