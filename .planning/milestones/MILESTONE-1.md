# Milestone 1: v1 Playable — Summary

## Completed
2026-10-10

## Goal
A complete browser board-game RPG that friends can play online with room codes: rules engine, multiplayer server, browser client and one-command run.

## Metrics
| Metric | Value |
|--------|-------|
| Phases | 4 |
| Plans completed | 13/13 |
| Requirements satisfied | n/a |
| Key files | 59 created/modified |

## Phase Outcomes
| Phase | Name | Plans | Key Deliverable |
|-------|------|-------|-----------------|
| 1 | Rules engine and project foundation | 4/4 | Deterministic TypeScript rules engine: seeded RNG, 41-tile branching map, dice movement, combat, items/shops, towns, 4-week calendar with boss, bot-driven full-game simulation |
| 2 | Multiplayer server and lobby | 3/3 | Authoritative WebSocket server with 4-letter room codes, lobby, seat tokens and reconnect, town upgrade/capture, PvP item theft, boss bonus scoring, seed hidden from clients |
| 3 | Browser client | 4/4 | Vite canvas client with original code-drawn art: lobby, animated board, HUD for battle/shop/inventory/towns, accessible path buttons, two-tab Playwright full-game test |
| 4 | Polish and playtest | 2/2 | npm start serves client and WebSocket on one port, offline-turn takeover after 45 s, finished-room expiry, Back to lobby, drawn combat portraits, README with tunnel hosting |

## Key Decisions
- Original IP: mechanics inspired by the genre, all names, art and text original
- TypeScript + ws + Vite + vitest, Playwright for browser tests
- In-memory state, no database; 2-4 players, no bots in v1
- Server-authoritative engine; clients receive state without seed or rngState
- Boss kill gives +500 gold, winner is the top score; town upgrade 80 x level (max 3), capture 150 x level
- Disconnected current player is auto-played after 45 s

## Files Created
- README.md
- index.html
- package-lock.json
- package.json
- playwright.config.ts
- scripts/dev.mjs
- src/client/main.ts
- src/client/net.ts
- src/client/render/animate.ts
- src/client/render/art.ts
- src/client/render/board.ts
- src/client/store.ts
- src/client/styles.css
- src/client/ui/battle.ts
- src/client/ui/gameover.ts
- src/client/ui/hud.css
- src/client/ui/hud.ts
- src/client/ui/inventory.ts
- src/client/ui/lobby.ts
- src/client/ui/log.ts
- src/client/ui/shop.ts
- src/client/ui/town.ts
- src/client/views.ts
- src/engine/bot.ts
- src/engine/calendar.ts
- src/engine/combat.ts
- src/engine/data/classes.ts
- src/engine/data/items.ts
- src/engine/data/monsters.ts
- src/engine/game.ts
- src/engine/index.ts
- src/engine/inventory.ts
- src/engine/map.ts
- src/engine/movement.ts
- src/engine/rng.ts
- src/engine/types.ts
- src/server/main.ts
- src/server/rooms.ts
- src/server/server.ts
- tests/client/board.test.ts
- tests/client/hud.test.ts
- tests/client/lobby.test.ts
- tests/client/store.test.ts
- tests/client/ui.test.ts
- tests/e2e/smoke.spec.ts
- tests/engine/calendar.test.ts
- tests/engine/combat.test.ts
- tests/engine/game.test.ts
- tests/engine/inventory.test.ts
- tests/engine/map.test.ts
- tests/engine/movement.test.ts
- tests/engine/rng.test.ts
- tests/engine/simulation.test.ts
- tests/server/protocol.test.ts
- tests/server/rooms.test.ts
- tests/server/static.test.ts
- tsconfig.json
- vite.config.ts
- vitest.config.ts

## Archive Location
.planning/archive/milestone-1/
