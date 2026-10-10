# Phase 2: Multiplayer server and lobby — Review Summary

## Result: PASSED

**Cycles Used**: 2
**Reviewers**: testing-qa-verification-specialist, engineering-senior-developer, engineering-laravel-specialist
**Evaluators**: code-quality, integration, business-logic
**Completed**: 2026-10-10

## Findings Summary
- Must-fix (blocker, critical, major) found: 3; fixed: 3; unresolved: 0
- Suggestions (minor, advisory): 1
- Deferred (confidence 50-79%): 16
- Hot spots (flagged by 2+ reviewers): `src/server/rooms.ts`, `src/server/server.ts`, `src/shared/protocol.ts`

## Findings Detail
| ID | Severity | Location | Issue | Reviewers | Confidence | Status |
|----|----------|----------|-------|-----------|------------|--------|
| F-001 | major | `src/server/rooms.ts:131-149` | In the lobby, when the last seat disconnects, `seats` becomes empty and `hostId` is not reassigned (the guard `room.seats.length > 0` skips it). The room stays alive for the 10-minute TTL. A later `join` re-fills it and clears `emptySince`, but `hostId` still names the departed player. | testing-qa-verification-specialist, engineering-laravel-specialist, evaluator:code-quality, evaluator:integration, evaluator:business-logic | 85% | fixed |
| F-002 | major | `src/server/rooms.ts:63-73` | When the last lobby player leaves, `disconnect` removes the seat but leaves `hostId` pointing at the departed player. The room stays in the map until the 10-minute TTL. `join` then accepts a new player into that room and clears `emptySince`, but never reassigns `hostId`. Nobody can call `start`, because `start` requires `hostId === playerId`. | engineering-senior-developer | 80% | fixed |
| F-003 | major | `src/server/server.ts (src/server/rooms.ts):69-73` | The full authoritative `GameState` is broadcast to every client, including `seed` and `rngState`. Any client can compute the upcoming dice rolls and monster picks, and combat rolls if combat uses the same RNG. The server is meant to be authoritative. | evaluator:business-logic | 80% | fixed |
| F-004 | minor | `src/server/rooms.ts:202-210` | When `base` is empty, `name` becomes 'Player'. The duplicate loop then builds suffixed names from `base.slice(...)`, which is empty. Duplicate blank names therefore become "2", "3" and so on instead of "Player2". | evaluator:business-logic | 85% | deferred |

## Reviewer Verdicts
- Cycle 1, testing-qa-verification-specialist: **NEEDS WORK**
- Cycle 1, engineering-senior-developer: **NEEDS WORK**
- Cycle 1, engineering-laravel-specialist: **NEEDS WORK**
- Cycle 1, evaluator:code-quality: **NEEDS WORK**
- Cycle 1, evaluator:integration: **NEEDS WORK**
- Cycle 1, evaluator:business-logic: **NEEDS WORK**
- Cycle 2, testing-qa-verification-specialist: **PASS**
- Cycle 2, engineering-senior-developer: **PASS**
- Cycle 2, engineering-laravel-specialist: **PASS**
- Cycle 2, evaluator:business-logic: **NEEDS WORK**

## Suggestions (Not Required)
- F-004 `src/server/rooms.ts`: When `base` is empty, `name` becomes 'Player'. The duplicate loop then builds suffixed names from `base.slice(...)`, which is empty. Duplicate blank names therefore become "2", "3" and so on instead of "Player2". (fix: Compute `const root = base.slice(0, MAX_NAME_LENGTH) || 'Player'` once and use `root` in the loop.)

## Deferred (Medium Confidence)
- `src/server/rooms.ts` [minor, 60%]: `MAX_ROOMS` is a global cap with no per-IP or per-connection limit. Rooms with connected sockets, including finished games, never expire. There is also no message rate limit in `server.ts`.
- `src/server/server.ts` [minor, 70%]: Any exception message from the engine or room code is sent verbatim to the client.
- `tests/server/rooms.test.ts, tests/server/protocol.test.ts` [minor, 70%]: No test covers lobby-phase rejoin. After a lobby disconnect the seat is deleted, so `rejoin` returns 'Invalid session token'. There is also no test of host reassignment when the room empties (Finding 1), of a `rejoin` that moves a socket from another seat, or of the ping/terminate timers.
- `src/server/server.ts` [minor, 65%]: The `create`, `join` and `rejoin` branches repeat the same block: bind the socket, send `joined`, then broadcast the lobby. Each also repeats the `'error' in r` check. `rejoin` adds the state resend.
- `src/server/server.ts` [minor, 55%]: `sessions` is keyed by socket only. `socketsOf(code)` and `bind` scan every session in the server on each broadcast and each bind. The room model does not know which sockets it holds.
- `src/shared/protocol.ts` [minor, 60%]: `ACTION_TYPES` and the `parseAction` switch hand-mirror the engine `Action` union. The `default: return null` branch means a new engine action compiles without any check against the parser. The action would be silently rejected at runtime. Also, `MAX_MESSAGE_BYTES` is compared against `raw.length`, which counts UTF-16 units rather than bytes.
- `src/server/rooms.ts (with src/server/server.ts)` [major, 60%]: When a player disconnects mid-game, the seat is only marked `connected = false`. Nothing skips or auto-plays that player's turn, and nothing uses `connected` after that. The server also doesn't tell the other clients that the turn is stuck. The game remains stuck on that seat until the player returns. If they never return, it stays stuck until the room is swept, which takes 10 minutes after every seat is offline.
- `src/server/rooms.ts` [minor, 70%]: There is no per-connection or per-IP limit on room creation, and no message rate limit. A client can create a room, disconnect, and repeat. Each empty room lives for 10 minutes, so 200 such rooms fill `MAX_ROOMS`.
- `tests/server/protocol.test.ts` [major, 70%]: The stated "PvP/town rules wired to the engine" has no protocol-level test. No test covers a non-host `start` over the socket, `join` after the game has started, `setClass` over the socket, or the heartbeat termination of dead sockets. The room-manager tests cover only some of these.
- `tests/server/protocol.test.ts` [advisory, 60%]: The test helper uses `any` for the predicate parameter, the return type, and the seat callbacks.
- `src/server/main.ts` [advisory, 50%]: Only PORT is configurable. There is no HOST, no TLS or wss guidance, and no allowed-origins setting. The server binds to all interfaces. `Number(process.env.PORT) || 8787` silently ignores an invalid value.
- `src/server/server.ts` [minor, 50%]: The full authoritative `GameState` is broadcast to every socket in a room. Any hidden information (other players' inventory or RNG seed and state) is exposed to all clients, since there is no per-player view.
- `src/server/rooms.ts (src/server/server.ts)` [major, 75%]: When a player disconnects mid-game, the seat is only marked `connected=false`. Nothing skips, auto-plays, or times out that seat's turn. If it is the disconnected player's turn, or they are the defender in a PvP battle, the game halts for everyone until that player returns. The room is only swept after every seat has been offline for 10 minutes.
- `src/server/rooms.ts` [minor, 55%]: Once a game has started, a disconnected seat only gets `connected = false`. Nothing skips its turn or ends the game. If the player on turn never returns, and others stay connected, no `action` from anyone else is accepted. The room never reaches `emptySince`, so the TTL sweep never removes it.
- `src/server/rooms.ts (src/server/server.ts)` [major, 65%]: A disconnected seat on its turn is never skipped, and there is no turn timeout. `disconnect` only sets `connected=false` mid-game, and `applyAction` accepts actions only from the current player. If the current player never returns, the game stalls for the other players until the room is swept. The sweep only happens when every seat is offline.
- `tests/server/protocol.test.ts` [major, 75%]: The lobby and permission rules have no test. Untested cases are: a non-host `start`, `start` with fewer than the minimum players, `join` after the game has started, a full room, an invalid rejoin token, `setClass`, host transfer when the host leaves the lobby, and a lobby leaver losing the seat. The rejoin test also checks only that the turn index matches the player id. It does not check that class, name or token are preserved.

## Fixes Applied
- cycle 1: engineering-backend-architect on F-001, F-002 (done); engineering-senior-developer on F-003 (done); checks 7/7 passed
- minor findings: engineering-backend-architect on F-004, F-002, F-003, F-006, F-007, F-008, F-010, F-011 (partial); left as is: F-002: not fixed. Per-IP and per-socket rate limits and expiry of idle or game-over rooms need a design decision. / F-010: only partly applicable. A lobby room is already deleted when its last seat leaves (`rooms.disconnect` in rooms.ts), so create-then-disconnect does not fill `MAX_ROOMS`. The remaining part is create and message rate limiting, which is the same design decision as F-002. / F-011: not done, heartbeat termination and sweep timers. The 30s and 60s intervals are hard-coded and not injectable, so testing them needs fake timers or a code change. A town or PvP action only has an error-path test (out-of-phase `captureTown`), because reaching a real town state needs engine setup.; checks 7/7 passed, 2 file(s) changed

## Cycle Delta
- cycle 1: 3 must-fix, 0 suggestions, 13 deferred, 0 dropped (low confidence)
- cycle 2: 0 must-fix (resolved 3, new 0, unchanged 0), 1 suggestions, 3 deferred, 0 dropped (low confidence)

## Coverage
No coverage data found (looked for coverage/coverage-summary.json, coverage-summary.json, coverage/lcov.info, lcov.info, coverage.xml, coverage/cobertura-coverage.xml, coverage/coverage.xml, coverage.txt, coverage/coverage.txt). Advisory only: run the test suite with coverage to check review.coverage_thresholds.
