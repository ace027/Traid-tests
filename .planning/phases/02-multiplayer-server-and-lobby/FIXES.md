# Phase 2: Multiplayer server and lobby — Review Fixes

Fixes applied by the review loop, one section per cycle. Re-review decides whether each one holds.

## Cycle 1

**Date**: 2026-10-10
**Checks**: 7/7 passed
**Files changed**: `src/server/server.ts`, `tests/server/protocol.test.ts`

| Finding | Severity | File | Agent | Status | Notes |
|---------|----------|------|-------|--------|-------|
| F-001 | major | `src/server/rooms.ts` | engineering-backend-architect | fix applied | F-001 and F-002 are the same bug, and one fix covers both. `disconnect` in the lobby now deletes the room as soon as the last seat leaves. A later `join` gets "Room not found", so no room can end up with a stale `hostId`. The sweep test used a lobby room, so I changed it to start the game first. I also added a test for the lobby deletion. I did not add the suggested test of leave-all, then join, then start, because the join now fails. |
| F-002 | major | `src/server/rooms.ts` | engineering-backend-architect | fix applied | F-001 and F-002 are the same bug, and one fix covers both. `disconnect` in the lobby now deletes the room as soon as the last seat leaves. A later `join` gets "Room not found", so no room can end up with a stale `hostId`. The sweep test used a lobby room, so I changed it to start the game first. I also added a test for the lobby deletion. I did not add the suggested test of leave-all, then join, then start, because the join now fails. |
| F-003 | major | `src/server/server.ts (src/server/rooms.ts)` | engineering-senior-developer | fix applied | Server now sends clients a `publicState()` projection that drops `seed` and `rngState`. The RNG stays server-side. The shared `ServerMessage` state type is now `PublicGameState`. The protocol test now asserts the two fields are absent. |
