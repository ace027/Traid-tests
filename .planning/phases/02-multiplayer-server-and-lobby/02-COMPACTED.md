---
phase: 02-multiplayer-server-and-lobby
compacted: 2026-10-10
original_summaries: [02-01-SUMMARY.md, 02-02-SUMMARY.md, 02-03-SUMMARY.md]
requirements_satisfied: [REQ-05, REQ-07, REQ-01, REQ-02]
---

# Phase 2: Multiplayer server and lobby — Compacted Summary

## Deliverables
- 02-01 Town upgrades and capture, PvP item theft, boss bonus (Complete)
- 02-02 Wire protocol and room manager (Complete): package-lock.json, package.json
- 02-03 WebSocket server and multi-client protocol tests (Complete): package-lock.json, package.json, src/server/main.ts, src/server/server.ts, tests/server/protocol.test.ts

## Decisions
- 02-01: The theft code reserves one copy of each equipped item id, so duplicates of an equipped id can still be stolen.
- 02-03: Start and action broadcast state to every socket in the room. Rejoin sends the rejoiner a lobby broadcast, then a private state with events [].
- 02-03: A second rejoin on the same seat deletes the old socket's session first, then closes it with code 4000, so its close handler does not mark the seat disconnected
- 02-03: Binary frames and unparseable or invalid messages get an error to the sender only. Oversized frames are rejected by ws maxPayload, which closes the socket.

## Conventions and Open Questions
- 02-01 convention: New events are item-stolen {from,to,itemId}, town-upgrade, town-capture, town-toll, town-claim and leave-town.
- 02-02 convention: ACTION_TYPES now matches every Action type in src/engine/types.ts.
- 02-03 convention: Start the server with `npm run server`. The protocol is as in src/shared/protocol.ts.
- 02-03 convention: A client gets 'joined' with its token, and should store the token for {t:'rejoin',code,token}.
- 02-03 convention: Rejoin during a game also yields the current 'state'.

## Files Modified
| File | Change |
|------|--------|
| `package-lock.json` | 02-02: Wire protocol and room manager |
| `package.json` | 02-02: Wire protocol and room manager |
| `package-lock.json` | 02-03: WebSocket server and multi-client protocol tests |
| `package.json` | 02-03: WebSocket server and multi-client protocol tests |
| `src/server/main.ts` | 02-03: WebSocket server and multi-client protocol tests |
| `src/server/server.ts` | 02-03: WebSocket server and multi-client protocol tests |
| `tests/server/protocol.test.ts` | 02-03: WebSocket server and multi-client protocol tests |

## Verification
- 02-01 (REQ-05, REQ-07): 4/4 verification commands passed
- 02-02 (REQ-01, REQ-02): 4/4 verification commands passed
- 02-03 (REQ-01, REQ-02): 3/3 verification commands passed

## Agents
- 02-01: engineering-backend-architect
- 02-02: engineering-backend-architect
- 02-03: engineering-backend-architect

## Also Covered
- src/engine/movement.ts
- src/engine/combat.ts
- src/engine/game.ts
- src/engine/bot.ts
- src/engine/inventory.ts
- tests/engine/towns.test.ts
- tests/engine/combat.test.ts
- tests/engine/game.test.ts
- tests/engine/simulation.test.ts
- src/server/rooms.ts
- tests/server/rooms.test.ts
