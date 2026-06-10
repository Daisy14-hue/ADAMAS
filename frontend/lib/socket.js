'use client';

import { io } from 'socket.io-client';

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:4000';

let socket = null;

/** Lazily create a single shared socket connection. */
export function getSocket() {
  if (!socket) {
    socket = io(SERVER_URL, {
      transports: ['websocket'],
      autoConnect: true,
    });
  }
  return socket;
}

/** Promisified emit-with-ack. Resolves with the server's ack payload. */
export function emit(event, data) {
  return new Promise((resolve) => {
    getSocket().emit(event, data, (res) => resolve(res || { ok: false, error: 'NO_RESPONSE' }));
  });
}
// EOF socket.js
