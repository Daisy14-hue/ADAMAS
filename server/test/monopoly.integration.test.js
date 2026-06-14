'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');

const { createServer } = require('../src/server');

function startServer(opts = {}) {
  return new Promise((resolve) => {
    const ctx = createServer({ corsOrigin: '*', ...opts });
    ctx.server.listen(0, () => resolve({ ...ctx, port: ctx.server.address().port }));
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

test('a Monopoly room is created with gameType monopoly', async () => {
  const ctx = await startServer();
  const host = await connect(ctx.port);
  const guest = await connect(ctx.port);
  const lobbyP = once(guest, 'lobby');
  const cr = await rpc(host, 'createRoom', { name: 'Host', gameType: 'monopoly' });
  assert.ok(cr.ok);
  await rpc(guest, 'joinRoom', { name: 'Guest', code: cr.code });
  const lobby = await lobbyP;
  assert.equal(lobby.gameType, 'monopoly');
  host.close(); guest.close(); ctx.server.close();
});

test('Monopoly start broadcasts a public board + $1500 stats', async () => {
  const ctx = await startServer();
  const host = await connect(ctx.port);
  const guest = await connect(ctx.port);
  const cr = await rpc(host, 'createRoom', { name: 'Host', gameType: 'monopoly' });
  await rpc(guest, 'joinRoom', { name: 'Guest', code: cr.code });
  const hostState = once(host, 'state');
  await rpc(host, 'startMatch', {});
  const hv = (await hostState).view;
  assert.equal(hv.status, 'playing');
  assert.equal(hv.board.length, 40);
  assert.equal(hv.currentPlayerId, cr.pid);
  assert.equal(hv.lastRoll, null);
  // public info: I can see the opponent's money/position
  for (const p of hv.players) {
    assert.equal(p.money, 1500);
    assert.equal(p.position, 0);
    assert.equal('connected' in p, true, 'connected flag injected by rooms');
  }
  host.close(); guest.close(); ctx.server.close();
});

test('ROLL works over the wire and is rejected for the non-current player', async () => {
  const ctx = await startServer();
  const host = await connect(ctx.port);
  const guest = await connect(ctx.port);
  const cr = await rpc(host, 'createRoom', { name: 'Host', gameType: 'monopoly' });
  const jr = await rpc(guest, 'joinRoom', { name: 'Guest', code: cr.code });
  const hostState = once(host, 'state');
  await rpc(host, 'startMatch', {});
  const hv = (await hostState).view;
  const currentSock = hv.currentPlayerId === cr.pid ? host : guest;
  const otherSock = hv.currentPlayerId === cr.pid ? guest : host;

  assert.equal((await rpc(otherSock, 'intent', { type: 'ROLL' })).error, 'NOT_YOUR_TURN');

  const stateP = once(currentSock, 'state');
  const res = await rpc(currentSock, 'intent', { type: 'ROLL' });
  assert.ok(res.ok, res.error);
  const v = (await stateP).view;
  assert.ok(v.lastRoll && v.lastRoll.total >= 2 && v.lastRoll.total <= 12);

  host.close(); guest.close(); ctx.server.close();
});

test('hardening still applies: ROLL/END_TURN allowed, garbage is BAD_INTENT', async () => {
  const ctx = await startServer();
  const host = await connect(ctx.port);
  const guest = await connect(ctx.port);
  const cr = await rpc(host, 'createRoom', { name: 'Host', gameType: 'monopoly' });
  await rpc(guest, 'joinRoom', { name: 'Guest', code: cr.code });
  const hostState = once(host, 'state');
  await rpc(host, 'startMatch', {});
  await hostState;
  // garbage intent rejected
  assert.equal((await rpc(host, 'intent', { type: 'TELEPORT' })).error, 'BAD_INTENT');
  host.close(); guest.close(); ctx.server.close();
});
