'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');

const { createServer } = require('../src/server');

function startServer(opts = {}) {
  return new Promise((resolve) => {
    const { server } = createServer({ corsOrigin: '*', ...opts });
    server.listen(0, () => resolve({ server, port: server.address().port }));
  });
}
function connect(port) {
  return new Promise((resolve) => {
    const sock = io(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
    sock.on('connect', () => resolve(sock));
  });
}
const rpc = (sock, event, data) => new Promise((res) => sock.emit(event, data, res));
const once = (sock, event) => new Promise((res) => sock.once(event, res));

const LIGHT = ['red', 'yellow', 'green', 'blue'];
const DARK = ['pink', 'teal', 'orange', 'purple'];
const WILDS = new Set(['wild', 'wildDrawTwo', 'wildDrawColor']);
const COLOR_ACTIONS = new Set(['skip', 'reverse', 'skipEveryone', 'flip', 'drawOne', 'drawFive']);

function isPlayable(card, view) {
  if (WILDS.has(card.type)) return true;
  if (card.color === view.activeColor) return true;
  const top = view.topCard;
  if (!top) return true;
  if (top.type === 'number' && card.type === 'number' && card.value === top.value) return true;
  if (COLOR_ACTIONS.has(card.type) && card.type === top.type) return true;
  return false;
}

// Drive a full Flip game with simple bots (take penalty on a stack; else play
// first legal card; else draw, then play the drawn card if playable).
function runGame(clients, { maxMoves = 9000 } = {}) {
  return new Promise((resolve, reject) => {
    let moves = 0;
    let done = false;
    const latest = {};
    const acting = {};
    const pending = {};
    const finish = (view) => { if (done) return; done = true; for (const c of clients) c.sock.removeAllListeners('state'); resolve(view); };

    function buildCandidates(view) {
      const me = view.players.find((p) => p.isYou);
      const palette = view.side === 'dark' ? DARK : LIGHT;
      const pickColor = palette.includes(view.activeColor) ? view.activeColor : palette[0];
      if (view.drawStack.active) return [{ type: 'DRAW' }];
      const out = [];
      for (const card of me.hand) {
        if (!isPlayable(card, view)) continue;
        const intent = { type: 'PLAY_CARD', cardId: card.id };
        if (WILDS.has(card.type)) intent.chosenColor = pickColor;
        out.push(intent);
      }
      out.push({ type: 'DRAW' });
      return out;
    }
    function schedule(c) {
      if (done) return;
      const view = latest[c.playerId];
      if (!view) return;
      if (view.status === 'finished') return finish(view);
      if (view.currentPlayerId !== c.playerId) return;
      if (acting[c.playerId]) { pending[c.playerId] = true; return; }
      act(c);
    }
    async function act(c) {
      acting[c.playerId] = true;
      try {
        if (++moves > maxMoves) { done = true; return reject(new Error('flip game did not terminate')); }
        for (const intent of buildCandidates(latest[c.playerId])) {
          const res = await rpc(c.sock, 'intent', intent);
          if (res && res.ok) break;
        }
      } finally { acting[c.playerId] = false; }
      if (pending[c.playerId]) { pending[c.playerId] = false; schedule(c); }
    }
    for (const c of clients) c.sock.on('state', ({ view }) => { latest[c.playerId] = view; schedule(c); });
  });
}

test('a Flip room is created with gameType flip', async () => {
  const { server, port } = await startServer();
  const host = await connect(port);
  const guest = await connect(port);
  const lobbyP = once(guest, 'lobby');
  const cr = await rpc(host, 'createRoom', { name: 'Host', gameType: 'flip' });
  assert.ok(cr.ok);
  await rpc(guest, 'joinRoom', { name: 'Guest', code: cr.code });
  const lobby = await lobbyP;
  assert.equal(lobby.gameType, 'flip');
  host.close(); guest.close(); server.close();
});

test('Flip match start sends a light-side view with the active face hand', async () => {
  const { server, port } = await startServer();
  const host = await connect(port);
  const guest = await connect(port);
  const cr = await rpc(host, 'createRoom', { name: 'Host', gameType: 'flip' });
  await rpc(guest, 'joinRoom', { name: 'Guest', code: cr.code });
  const hostState = once(host, 'state');
  await rpc(host, 'startMatch', {});
  const hv = (await hostState).view;
  assert.equal(hv.side, 'light');
  assert.equal(hv.status, 'playing');
  assert.equal(hv.players.find((p) => p.isYou).hand.length, 7);
  assert.ok(LIGHT.includes(hv.topCard.color) || hv.topCard.color === null);
  host.close(); guest.close(); server.close();
});

test('a full 3-player Flip game runs end-to-end to a winner', async () => {
  const { server, port } = await startServer();
  const a = await connect(port);
  const b = await connect(port);
  const c = await connect(port);
  const ca = await rpc(a, 'createRoom', { name: 'A', gameType: 'flip' });
  const code = ca.code;
  const jb = await rpc(b, 'joinRoom', { name: 'B', code });
  const jc = await rpc(c, 'joinRoom', { name: 'C', code });
  const clients = [
    { sock: a, playerId: ca.pid },
    { sock: b, playerId: jb.pid },
    { sock: c, playerId: jc.pid },
  ];
  const gameP = runGame(clients);
  await rpc(a, 'startMatch', {});
  const finalView = await gameP;
  assert.equal(finalView.status, 'finished');
  assert.ok(finalView.winner, 'a winner is declared');
  a.close(); b.close(); c.close(); server.close();
});

test('No Mercy rooms still work alongside Flip (default gameType)', async () => {
  const { server, port } = await startServer();
  const host = await connect(port);
  const guest = await connect(port);
  const cr = await rpc(host, 'createRoom', { name: 'Host' }); // no gameType → noMercy
  const lobbyP = once(guest, 'lobby');
  await rpc(guest, 'joinRoom', { name: 'Guest', code: cr.code });
  const lobby = await lobbyP;
  assert.equal(lobby.gameType, 'noMercy');
  const hostState = once(host, 'state');
  await rpc(host, 'startMatch', {});
  const hv = (await hostState).view;
  assert.equal(hv.status, 'playing');
  assert.equal(hv.side, undefined, 'No Mercy view has no side field');
  host.close(); guest.close(); server.close();
});
