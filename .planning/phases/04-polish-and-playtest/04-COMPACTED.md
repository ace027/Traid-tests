---
phase: 04-polish-and-playtest
compacted: 2026-10-10
original_summaries: [04-01-SUMMARY.md, 04-02-SUMMARY.md]
requirements_satisfied: [REQ-10]
---

# Phase 4: Polish and playtest — Compacted Summary

## Deliverables
- 04-01 Production server, offline-turn takeover, finished-room expiry (Complete): package.json, src/server/main.ts, src/server/rooms.ts, src/server/server.ts, tests/server/protocol.test.ts, tests/server/rooms.test.ts, tests/server/static.test.ts
- 04-02 Back to lobby, art portraits in combat, README (Complete): README.md, src/client/ui/battle.ts, src/client/ui/gameover.ts, tests/client/ui.test.ts

## Decisions
- 04-01: `RoomManager` constructor is now `(now, offlineTurnMs)`.
- 04-01: The `/ws` path is enforced only when `staticDir` is set. Without it the server behaves as before, so existing tests are unchanged.
- 04-01: `tickOffline` stops after at most 200 auto-actions, or on a bot action error, so it cannot loop.
- 04-02: Tie rule: all players sharing the top score are listed, only when a winner exists. A winner-less game still shows 'Game over'.
- 04-02: Player token initial is the first letter of the class name. Seat colour comes from the player's index in state.players.

## Conventions and Open Questions
- 04-01 convention: The client must connect to `ws://<host>/ws` when served from the production server (when `staticDir` is set, `/ws` is the only accepted WebSocket path).
- 04-01 convention: `startServer` without `staticDir` still accepts any WebSocket path, as before.
- 04-01 convention: `Seat` and `Room` gained the nullable fields `disconnectedAt` and `finishedAt`. They are not part of the shared protocol.
- 04-02 convention: README says `npm start` runs on port 8787, and the plan says the same. Please confirm the start script from 04-01 does that.

## Files Modified
| File | Change |
|------|--------|
| `package.json` | 04-01: Production server, offline-turn takeover, finished-room expiry |
| `src/server/main.ts` | 04-01: Production server, offline-turn takeover, finished-room expiry |
| `src/server/rooms.ts` | 04-01: Production server, offline-turn takeover, finished-room expiry |
| `src/server/server.ts` | 04-01: Production server, offline-turn takeover, finished-room expiry |
| `tests/server/protocol.test.ts` | 04-01: Production server, offline-turn takeover, finished-room expiry |
| `tests/server/rooms.test.ts` | 04-01: Production server, offline-turn takeover, finished-room expiry |
| `tests/server/static.test.ts` | 04-01: Production server, offline-turn takeover, finished-room expiry |
| `README.md` | 04-02: Back to lobby, art portraits in combat, README |
| `src/client/ui/battle.ts` | 04-02: Back to lobby, art portraits in combat, README |
| `src/client/ui/gameover.ts` | 04-02: Back to lobby, art portraits in combat, README |
| `tests/client/ui.test.ts` | 04-02: Back to lobby, art portraits in combat, README |

## Verification
- 04-01 (REQ-10): 4/4 verification commands passed
- 04-02 (REQ-10): 6/6 verification commands passed

## Agents
- 04-01: engineering-backend-architect
- 04-02: engineering-frontend-developer
