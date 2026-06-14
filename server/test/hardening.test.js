'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');

const { createServer } = require('../src/server');
const { validateIntent } = require('../src/rooms');

// Harness that also exposes the RoomManager (needed to force an engine throw).
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

async function startedRoom(ctx) {
  const host = await connect(ctx.port);
  const guest = await connect(ctx.port);
  const cr = await rpc(host, 'createRoom', { name: 'Host' });
  const jr = await rpc(guest, 'joinRoom', { name: 'Guest', code: cr.code });
  await rpc(host, 'startMatch', {});
  return { host, guest, code: cr.code, hostPid: cr.pid, guestPid: jr.pid };
}

// ---- unit: validateIntent -------------------------------------------------

test('validateIntent accepts well-formed intents and rejects malformed ones', () => {
  assert.equal(validateIntent({ type: 'DRAW' }), true);
  assert.equal(validateIntent({ type: 'PASS' }), true);
  assert.equal(validateIntent({ type: 'PLAY_CARD', cardId: 'c1' }), true);
  assert.equal(validateIntent({ type: 'PLAY_CARD', cardId: 'c1', chosenColor: 'red' }), true);
  assert.equal(validateIntent({ type: 'SPIN_CHOICE', number: 7 }), true);
  assert.equal(validateIntent({ type: 'RACE_TAP' }), true);

  assert.equal(validateIntent(null), false);
  assert.equal(validateIntent('DRAW'), false);
  assert.equal(validateIntent([]), false);
  assert.equal(validateIntent({}), false);
  assert.equal(validateIntent({ type: 'NOPE' }), false);
  assert.equal(validateIntent({ type: 'PLAY_CARD' }), false); // missing cardId
  assert.equal(validateIntent({ type: 'PLAY_CARD', cardId: 123 }), false); // wrong type
  assert.equal(validateIntent({ type: 'PLAY_CARD', cardId: 'c1', chosenColor: 'mauve' }), false);
  assert.equal(validateIntent({ type: 'SPIN_CHOICE', number: 42 }), false);
  assert.equal(validateIntent({ type: 'SPIN_CHOICE', keepIds: [1, 2] }), false);
});

// ---- malformed intents are rejected over the wire -------------------------

test('malformed intents are rejected with BAD_INTENT and the room survives', async () => {
  const ctx = await startServer();
  const { host, guest, code } = await startedRoom(ctx);

  const bad = [
    'not-an-object',
    null,
    {},
    { type: 'NOPE' },
    { type: 'PLAY_CARD' },
    { type: 'PLAY_CARD', cardId: 123 },
    { type: 'PLAY_CARD', cardId: 'x', chosenColor: 'mauve' },
  ];
  for (const intent of bad) {
    const res = await rpc(host, 'intent', intent);
    assert.equal(res.ok, false);
    assert.equal(res.error, 'BAD_INTENT', `expected BAD_INTENT for ${JSON.stringify(intent)}`);
  }
  // Room is still alive and playing.
  assert.ok(ctx.rooms.getRoom(code));
  assert.equal(ctx.rooms.getRoom(code).status, 'playing');

  host.close(); guest.close(); ctx.server.close();
});

// ---- a thrown engine error does not crash the room ------------------------

test('a thrown engine error yields ENGINE_ERROR and the room keeps running', async () => {
  const ctx = await startServer();
  const { host, guest, code } = await startedRoom(ctx);

  const room = ctx.rooms.getRoom(code);
  const orig = room.engine.applyIntent.bind(room.engine);
  room.engine.applyIntent = () => { throw new Error('boom (intentional test throw)'); };

  // silence the expected server-side error log for clean test output
  const origErr = console.error;
  console.error = () => {};
  const res = await rpc(host, 'intent', { type: 'DRAW' });
  console.error = origErr;

  assert.equal(res.ok, false);
  assert.equal(res.error, 'ENGINE_ERROR');
  // The room survived the throw.
  assert.ok(ctx.rooms.getRoom(code));
  assert.equal(ctx.rooms.getRoom(code).status, 'playing');

  // Restore the engine — the room is fully usable again (a malformed intent
  // still returns cleanly, proving the server loop never died).
  room.engine.applyIntent = orig;
  const res2 = await rpc(host, 'intent', { type: 'GARBAGE' });
  assert.equal(res2.error, 'BAD_INTENT');

  host.close(); guest.close(); ctx.server.close();
});

// ---- per-socket rate limiting ---------------------------------------------

test('flooding a socket triggers RATE_LIMITED without dropping the connection', async () => {
  const ctx = await startServer({ rateLimit: { capacity: 5, perSecond: 5 } });
  const { host, guest, code } = await startedRoom(ctx);

  // Fire 20 intents back-to-back (no await between sends) → bucket of 5 drains.
  const acks = await Promise.all(
    Array.from({ length: 20 }, () => rpc(host, 'intent', { type: 'DRAW' })),
  );
  const limited = acks.filter((a) => a && a.error === 'RATE_LIMITED').length;
  assert.ok(limited > 0, 'some intents should be rate-limited under a flood');
  assert.ok(limited >= 10, `most of the flood should be limited (got ${limited})`);
  // Connection still alive and room intact.
  assert.ok(ctx.rooms.getRoom(code));

  host.close(); guest.close(); ctx.server.close();
});

// ---- createRoom input clamping/validation ---------------------------------

test('createRoom sanitizes name, validates gameType, and clamps config', async () => {
  const ctx = await startServer();
  const host = await connect(ctx.port);
  const lobbyP = once(host, 'lobby');
  const cr = await rpc(host, 'createRoom', {
    name: 'x'.repeat(100),
    gameType: 'totally-not-a-game',
    config: { eliminationLimit: 99999, recycleThreshold: -5 },
  });
  assert.ok(cr.ok);
  const lobby = await lobbyP;
  assert.equal(lobby.gameType, 'noMercy', 'unknown gameType falls back to noMercy');
  assert.ok(lobby.players[0].name.length <= 20, 'name is truncated');
  assert.ok(lobby.config.eliminationLimit <= 200, 'elimination limit clamped');
  assert.ok(lobby.config.recycleThreshold >= 10, 'recycle threshold clamped');

  host.close(); ctx.server.close();
});
