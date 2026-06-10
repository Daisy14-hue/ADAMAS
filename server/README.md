# ADAMAS — Server (Phase 1)

The authoritative, server-side game logic for **ADAMAS**. Phase 1 ships one
fully-built engine: **UNO No Mercy** (ADAMAS house-rules variant).

This package is currently the **pure rules engine + its test suite**. It has no
external dependencies and runs on Node 20+. The realtime layer (Express +
Socket.IO) and rooms/lobby plug on top of this engine next; state is kept
in-memory for Phase 1 (no database — nothing is persisted yet).

## Layout

```
server/
├─ src/engine/
│  ├─ constants.js        card types, deck composition, predicates
│  ├─ deck.js             buildDeck() (asserts 168), shuffle, seeded RNG
│  ├─ NoMercyEngine.js    the engine: intents → validated state transitions
│  └─ index.js            barrel export
└─ test/
   ├─ deck.test.js        deck invariants
   └─ engine.test.js      35 rule tests incl. every house-rule example
```

## Run the tests

```bash
cd server
npm test          # node --test
```

All 35 tests should pass.

## Design

- **Server-authoritative.** Clients never compute legality. They send *intents*
  (`PLAY_CARD`, `DRAW`, `SAY_UNO`); `engine.applyIntent(playerId, intent)`
  validates against the rules, mutates state, and returns
  `{ ok, error?, events }`. Illegal intents are **rejected without mutating
  state** — never thrown.
- **Pure & deterministic.** No I/O. Construct with a seeded RNG
  (`makeRng(seed)`) for reproducible deals; tests hand-craft scenarios by
  writing `engine.state` directly.
- **Redacted views.** `engine.view(playerId)` returns a player-specific snapshot
  (own hand visible, opponents as counts). `engine.publicState()` is the
  spectator view.

### Emitted events (for the realtime layer)

`MATCH_STARTED`, `CARD_PLAYED`, `CARD_DRAWN`, `TURN_CHANGED`,
`DRAW_STACK_UPDATED`, `REVERSE_DEFLECT`, `PENALTY_TAKEN`, `DISCARD_ALL`,
`ROULETTE_RESOLVED`, `DECK_RECYCLED`, `PLAYER_ELIMINATED`, `MATCH_FINISHED`.

## Deck composition (exactly 168)

Mattel never published per-card quantities, so ADAMAS fixes them in one place
(`DECK_SPEC` in `constants.js`). The builder asserts the total is 168 on every
build.

| Group | Count |
|---|---|
| Numbers (4 colors × [one 0, two each 1–9]) | 76 |
| Colored actions (4 × [Skip 3, Reverse 3, Draw 2 ×3, Skip Everyone 2, Discard All 1]) | 48 |
| Wilds (Wild 4, Wild Draw 4 ×8, Wild Draw 6 ×8, Wild Draw 10 ×8, Wild Reverse Draw 4 ×8, Wild Color Roulette ×8) | 44 |
| **Total** | **168** |

Change the counts in `DECK_SPEC`; the 168 assertion guards the total.

## ⚠️ ADAMAS variant vs. official Mattel "Show 'Em No Mercy"

The build follows the **ADAMAS spec / Appendix A house rules** (authoritative for
this project). These deliberately diverge from the official Mattel rules sheet
(HVW18) — flagged here as required by the spec:

1. **0 and 7 are plain number cards.** Official No Mercy uses 7 = *Swap hands*
   and 0 = *Pass hands*. ADAMAS overrides both to plain numbers (no swap, no
   pass).
2. **Draw 4 is Wild, not colored.** The only colored draw card is **Draw 2**.
   Draw 4/6/10 and Reverse +4 are all Wild. (The official sheet prints Draw 4 as
   a colored card.) This is what makes Reverse Deflection apply *only* to Draw 2.
3. **Plain Wild and Wild Draw 4 exist** in the ADAMAS wild set; the official
   deck has neither.
4. **Reverse Deflection + Reverse Chain are ADAMAS house rules** (4.6 / 4.8) —
   not part of official No Mercy, which has no deflection mechanic.

The official PDFs supplied with the project are **visual reference for card
artwork only**, not a rules source.

## House-rule behavior verified by tests

- **Ascending stacking (4.7):** new draw value must be ≥ previous; descending is
  rejected; penalties accumulate; taking the penalty is a **skip**.
- **Reverse Deflection (4.6):** only against a colored Draw 2, reverse must match
  the active color, value unchanged, penalty redirected.
- **Reverse Chain (4.8):** after the first deflection, any reverse (color
  ignored) flips direction; the penalty **ping-pongs between the two duellists
  only** — other seats are never pulled in.
- **Wild Draw Reverse +4 (4.9):** reverses, adds 4, cannot be deflected/chained,
  may only be answered by ascending stack or taking the penalty.
- **Wild draws (4/6/10):** cannot be deflected or chained.
- **Mercy (4.2):** hand ≥ limit (default 25) → eliminated, hand set aside until
  the next reshuffle; last player standing wins.
- **Recycling (4.10):** empty draw pile or discard ≥ threshold (default 50) →
  preserve top, reshuffle the rest (including set-aside eliminated cards).

## Known Phase 1 limitations

- **No reconnect / disconnect handling.** A player disconnect may end the match
  (deferred — spec §8). To be added in a later phase.
- **No persistence.** Rooms and game state are in-memory; nothing survives a
  server restart. Postgres arrives when persistence features (stats, history,
  accounts) land.
- **UNO call is recorded but not enforced.** `SAY_UNO` is tracked; the
  catch/penalty rule is not implemented in Phase 1 (not specified in the ADAMAS
  ruleset).
