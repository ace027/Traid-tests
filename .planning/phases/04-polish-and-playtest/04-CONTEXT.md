# Phase 4: Polish and playtest -- Context

## Phase Goal
Make Realm Rush ready to play with friends: one-command production run, no stalled games when a player drops, a way back to the lobby after a game, combat portraits drawn with the original art module, and a README for hosting via a tunnel.

## Requirements Covered
- REQ-10

## What Already Exists (from prior phases)
- Phase 1-3: engine (createGame, applyAction, chooseBotAction), ws server (src/server/server.ts startServer, rooms.ts RoomManager with sweep, main.ts on PORT 8787), Vite client (src/client), npm scripts server, dev, build, dev:all, e2e; Playwright full-game e2e in tests/e2e/smoke.spec.ts
- net.ts exports clearSession; render/art.ts exports drawMonster and drawToken (original procedural art); battle.ts portraits are coloured boxes

## Key Design Decisions
- Production: `npm start` builds the client with vite then runs the server, which serves dist/ statically over HTTP and the WebSocket on /ws on the same port (assumed)
- Offline turn rule (assumed): if the current player's seat has been disconnected for 45 s during a game, the server plays that seat's turn with chooseBotAction until the turn passes; the timer restarts for each new offline current player
- Finished games: a room in game-over is swept 10 minutes after game-over even if sockets stay connected (assumed)
- Back to lobby: the game-over panel gets a 'Back to lobby' button that clears the session and reloads; no rematch flow (assumed, simplest)
- All art stays original and code-drawn; no external assets

## Plan Structure
- **Plan 04-01 (Wave 1)**: Production server, offline-turn takeover, finished-room expiry -- Serve the built client and the WebSocket from one port with npm start, keep games moving when the current player is offline, and expire finished rooms.
- **Plan 04-02 (Wave 1)**: Back to lobby, art portraits in combat, README -- Finish the player journey after a game, use the original art module on the combat screen, and document how to run and share the game.
