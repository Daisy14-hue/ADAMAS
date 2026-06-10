# ADAMAS — Phase 1

A dark, real-time multiplayer game hub. Phase 1 ships one fully playable game:
**UNO No Mercy** (ADAMAS house-rules variant), plus the hub, rooms/lobby, and
host controls. Everything else in the hub is shown as locked "Coming Soon".

```
Game/
├─ server/     Node + Express + Socket.IO. Pure rules engine + realtime. In-memory (no DB).
└─ frontend/   Next.js (App Router) dark UI with animations. Talks to the server over WebSockets.
```

Identity is display-name only (no passwords, no accounts). State is authoritative
on the server; clients send intents and the server decides legality.

## Quick start (two terminals)

**1) Server**
```bash
cd server
npm install
npm start          # → http://localhost:4000
```

**2) Frontend**
```bash
cd frontend
npm install
npm run dev        # → http://localhost:3000
```

Open http://localhost:3000 in two or more browser tabs/devices: create a room in
one, join with the room code in the others, set the host limits, and Start Match.

> The frontend reads the server URL from `NEXT_PUBLIC_SERVER_URL`
> (default `http://localhost:4000`). Copy `frontend/.env.local.example` to
> `frontend/.env.local` to change it.

## What works

- **Landing** — ADAMAS hero, welcome note to the group, Play / Make Account.
- **Make Account** — pick a display name (reused when creating/joining rooms).
- **Hub** — UNO No Mercy is playable; UNO Flip, Monopoly, and others are locked.
- **Lobby** — create a room (you become host) or join by code; host configures the
  elimination limit and discard-recycle threshold, then starts the match.
- **Game board** — your fanned hand with playable cards highlighted, the draw and
  discard piles, opponents around the table with live hand counts, the current
  turn, the direction of play, the live draw-stack total, wild/roulette color
  pickers, and Draw / Take-Penalty / "UNO!" controls.
- **Animations** — cards pop onto the discard pile, the turn holder pulses, the
  draw-stack badge flashes as it grows, the deck shows a shuffle on recycle, and a
  confetti winner overlay closes the match. All respect `prefers-reduced-motion`.
- **Full UNO No Mercy rules** — ascending draw stacking, reverse deflection, the
  reverse-chain ping-pong, Wild Draw Reverse +4, mercy elimination, discard
  recycling. (See `server/README.md` for the rule details and the deliberate
  ADAMAS-vs-official divergences.)

## Tests & verification

- **Engine:** 35 unit tests (`server/test/`) covering the deck (=168), every card
  effect, and every house-rule worked example from Appendix A.
- **Realtime:** 8 multi-client integration tests that spin up the server, connect
  real Socket.IO clients, and play a full 3-player game end-to-end through the
  protocol.

```bash
cd server && npm test        # 43/43 pass
```

The frontend's components and imports are validated (bundle-checked) but the heavy
`next build` is run on your machine via the Quick start above.

## Phase 1 limitations (by design)

- No reconnect: a disconnect during a match ends it (the other players get a
  notice). No persistence — rooms are in-memory and reset on server restart.
- "UNO!" is recorded but the catch/penalty rule isn't enforced (not in the spec).
- Postgres, auth, chat, stats, history, spectator, and the other games are
  reserved for later phases (locked placeholders in the hub).
