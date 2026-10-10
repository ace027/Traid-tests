# Phase 3: Browser client -- Context

## Phase Goal
Browser client: lobby, board map, dice, combat, shop, inventory, town and PvP views and game-over screen, with original procedurally drawn art and simple animation, talking to the phase 2 server.

## Requirements Covered
- REQ-09
- REQ-01

## What Already Exists (from prior phases)
- src/engine: types (GameState, Action, Phase incl. 'town'), CLASSES, ITEMS, MONSTERS, shopStock, computeScore; importable from the client (no node imports)
- src/shared/protocol.ts: ClientMessage, ServerMessage, PublicGameState (state without seed and rngState)
- src/server: ws server on PORT (default 8787), npm run server; accepts any path; rejoin with {t:'rejoin',code,token}; replaced sockets closed with code 4000

## Key Design Decisions
- Vite + vanilla TypeScript, no UI framework; HTML/CSS DOM panels over one full-window canvas for the board
- Dev: vite on 5173 proxies /ws to ws://localhost:8787; client connects to ws(s)://location.host/ws
- Client store: a tiny observable holding {connection, code, playerId, token, lobby, state, lastEvents, error}; token and code saved in sessionStorage for auto-rejoin on reload
- Art is original and drawn with Canvas 2D primitives (tiles as rounded shapes coloured by kind, players as coloured crests with class glyph letters, monsters as simple procedural blobs); no external images, fonts or copied assets
- Contract between modules (src/client/views.ts): mountBoard(canvas: HTMLCanvasElement, store: Store): void and mountHud(root: HTMLElement, store: Store, send: (m: ClientMessage) => void): void
- UI tests use vitest with the jsdom environment per file; browser smoke test uses @playwright/test with the preinstalled Chromium

## Plan Structure
- **Plan 03-01 (Wave 1)**: Vite app shell, networking, store and lobby -- Set up the Vite client, the WebSocket connection with auto-rejoin, the store, the lobby screens, and stub board/HUD modules that later plans replace.
- **Plan 03-02 (Wave 2)**: Board renderer, dice and movement animation -- Render the board map, players, towns and the boss tile on canvas with original procedural art, animated token movement and a dice roll animation, and clickable path choices.
- **Plan 03-03 (Wave 2)**: HUD: turn controls, battle, shop, inventory, towns, log, game over -- Build every DOM panel needed to play: turn and dice controls, battle screen, shop, inventory and equipment, town decisions, event log, scoreboard and game-over screen.
- **Plan 03-04 (Wave 3)**: Two-tab browser smoke test and dev run script -- Prove two browser tabs can create, join, start and take turns against the real server, and add one command to run server and client together in development.
