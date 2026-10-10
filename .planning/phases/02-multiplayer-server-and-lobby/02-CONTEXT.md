# Phase 2: Multiplayer server and lobby -- Context

## Phase Goal
Authoritative WebSocket server with rooms, join codes, seats, reconnect and turn validation, plus the PvP and town rules completed in the engine.

## Requirements Covered
- REQ-01
- REQ-02
- REQ-05
- REQ-07

## What Already Exists (from prior phases)
- src/engine (phase 1): createGame({seed,players}), applyAction(state, playerId, action) => {state, events, error?}, chooseBotAction(state, playerId), getStartTileId in calendar.ts, BOSS_ID, LAST_WEEK; all exported from src/engine/index.ts
- Towns are claimed automatically on landing (100 gold) and tolled; level never changes; boss kill makes the slayer win outright (finishBattle in combat.ts)
- 98 vitest tests; tsc strict; ESM; extensionless imports with Bundler resolution

## Key Design Decisions
- Server is Node + ws, run with tsx (no build step); port from env PORT, default 8787
- Server keeps every room in memory; one GameState per room; all rules run in the engine on the server; clients send intents only
- Room code: 4 uppercase letters excluding I and O, generated with crypto.randomInt, unique among live rooms
- Seat identity: on join the server issues a sessionToken (crypto.randomUUID); a client reconnecting with {code, token} reclaims its seat; the seat stays reserved while the game runs
- First joiner is host; host starts the game with 2-4 seated players; class picked in the lobby; names 1-16 chars trimmed
- Town rules (assumed): the owner landing on their own town may upgrade it (cost 80 x level, max level 3); a rival landing on an owned town pays toll and may then capture it for 150 x level gold, which goes to the old owner
- PvP (assumed): the PvP winner also takes one random non-equipped item from the loser if any
- Boss rule (assumed, resolves review finding): the slayer gets a 500 gold bonus and the game ends with determineWinner by score, instead of the slayer winning outright
- Shared wire protocol in src/shared/protocol.ts as a discriminated union, validated by hand-written type guards (no new validation dependency)

## Plan Structure
- **Plan 02-01 (Wave 1)**: Town upgrades and capture, PvP item theft, boss bonus -- Complete REQ-05 and REQ-07 in the engine: town upgrade and capture actions, item theft on PvP wins, and the boss bonus win rule.
- **Plan 02-02 (Wave 1)**: Wire protocol and room manager -- Define the client/server message protocol and a transport-free room manager handling codes, seats, lobby, reconnect tokens and turn-validated game actions.
- **Plan 02-03 (Wave 2)**: WebSocket server and multi-client protocol tests -- Serve the room manager over WebSockets with broadcasting, reconnect and a heartbeat, and prove a full multi-client game end to end.
