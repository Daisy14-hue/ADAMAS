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

const COLORS = ['red', 'yellow', 'green', 'blue'];
const WILDS = new Set(['wild', 'wildDraw4']);
const COLOR_ACTIONS = new Set(['skip', 'reverse', 'draw2', 'spin']);

function isPlayable(card, view) {
  if (WILDS.has(card.type)) return true;
  if (card.color === view.activeColor) return true;
  const top = view.topCard;
  if (!top) return true;
  if (top.type === 'number' && card.type === 'number' && card.value === top.value) return true;
  if (COLOR_ACTIONS.has(card.type) && card.type === top.type) return true;
  return false;
}

// Spin-aware bot driver: handles normal turns, forced spins, spin-choices and the race.
function runGame(clients, { maxMoves = 16000 } = {}) {
  return new Promise((resolve, reject) => {
    let moves = 0, done = false;
    const latest = {}, acting = {}, pending = {};
    const finish = (view) => { if (done) return; done = true; for (const c of clients) c.sock.removeAllListeners('state'); resolve(view); };

    function myHand(view) { return (view.players.find((p) => p.isYou) || {}).hand || []; }

    function choiceIntent(view) {
      const h = myHand(view);
      const t = view.choice.type;
      if (t === 'raceDiscard') {
        const card = h[0];
        return { type: 'SPIN_CHOICE', cardId: card.id, chosenColor: 'red' };
      }
      if (t === 'almostUno') {
        const keepIds = h.slice(0, 2).map((c) => c.id);
        const topCardId = h.length > 2 ? h[2].id : undefined;
        return { type: 'SPIN_CHOICE', keepIds, topCardId };
      }
      if (t === 'discardNumber') {
        const numCard = h.find((c) => c.type === 'number') || h[0];
        const number = numCard.type === 'number' ? numCard.value : 0;
        const discardIds = h.filter((c) => c.type === 'number' && c.value === number).map((c) => c.id);
        return { type: 'SPIN_CHOICE', number, discardIds, topCardId: discardIds[0] };
      }
      if (t === 'discardColor') {
        const colCard = h.find((c) => !WILDS.has(c.type) && c.color) || h[0];
        const color = colCard.color || 'red';
        const discardIds = h.filter((c) => !WILDS.has(c.type) && c.color === color).map((c) => c.id);
        return { type: 'SPIN_CHOICE', color, discardIds, topCardId: discardIds[0] };
      }
      return { type: 'SPIN_CHOICE' };
    }

    function buildActions(view, myPid) {
      if (view.race && view.race.active) return [{ type: 'RACE_TAP' }];
      if (view.choice) return [choiceIntent(view)];
      if (view.mustSpin) return [{ type: 'SPIN' }];
      if (view.currentPlayerId !== myPid) return [];
      const h = myHand(view);
      const out = [];
      for (const card of h) {
        if (!isPlayable(card, view)) continue;
        const intent = { type: 'PLAY_CARD', cardId: card.id };
        if (WILDS.has(card.type)) intent.chosenColor = COLORS.includes(view.activeColor) ? view.activeColor : 'red';
        out.push(intent);
      }
      if (view.canPass) out.push({ type: 'PASS' });
      out.push({ type: 'DRAW' });
      return out;
    }

    function schedule(c) {
      if (done) return;
      const view = latest[c.playerId];
      if (!view) return;
      if (view.status === 'finished') return finish(view);
      const actionable = (view.race && view.race.active) || view.choice || (view.currentPlayerId === c.playerId);
      if (!actionable) return;
      if (acting[c.playerId]) { pending[c.playerId] = true; return; }
      act(c);
    }
    async function act(c) {
      acting[c.playerId] = true;
      try {
        if (++moves > maxMoves) { done = true; return reject(new Error('spin game did not terminate')); }
        const actions = buildActions(latest[c.playerId], c.playerId);
        for (const intent of actions) {
          const res = await rpc(c.sock, 'intent', intent);
          if (res && res.ok) break;
        }
      } finally { acting[c.playerId] = false; }
      if (pending[c.playerId]) { pending[c.playerId] = false; schedule(c); }
    }
    for (const c of clients) c.sock.on('state', ({ view }) => { latest[c.playerId] = view; schedule(c); });
  });
}

test('a Spin room is created with gameType spin', async () => {
  const { server, port } = await startServer();
  const host = await connect(port);
  const guest = await connect(port);
  const lobbyP = once(guest, 'lobby');
  const cr = await rpc(host, 'createRoom', { name: 'Host', gameType: 'spin' });
  assert.ok(cr.ok);
  await rpc(guest, 'joinRoom', { name: 'Guest', code: cr.code });
  const lobby = await lobbyP;
  assert.equal(lobby.gameType, 'spin');
  host.close(); guest.close(); server.close();
});

test('Spin match view exposes spin fields and an inactive draw-stack', async () => {
  const { server, port } = await startServer();
  const host = await connect(port);
  const guest = await connect(port);
  const cr = await rpc(host, 'createRoom', { name: 'Host', gameType: 'spin' });
  await rpc(guest, 'joinRoom', { name: 'Guest', code: cr.code });
  const hostState = once(host, 'state');
  await rpc(host, 'startMatch', {});
  const hv = (await hostState).view;
  assert.equal(hv.status, 'playing');
  assert.equal(hv.drawStack.active, false);
  assert.equal(hv.side, undefined, 'no flip side in Spin');
  assert.equal('spinPending' in hv, true);
  assert.equal(hv.players.find((p) => p.isYou).hand.length, 7);
  host.close(); guest.close(); server.close();
});

test('a full 3-player Spin game runs end-to-end to a winner', async () => {
  const { server, port } = await startServer({ graceMs: 60000 });
  const a = await connect(port);
  const b = await connect(port);
  const c = await connect(port);
  const ca = await rpc(a, 'createRoom', { name: 'A', gameType: 'spin' });
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
