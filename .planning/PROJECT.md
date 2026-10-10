# Realm Rush

## What This Is
A browser-based, online multiplayer competitive board-game RPG in the style of Dokapon Kingdom. Friends join a room by code, roll dice around a map, fight monsters and each other, buy gear and take towns over a week-based structure ending in a boss. All code, art, names and text are original; private personal use only.

## Core Value
A fun, chaotic, backstabbing party RPG that friends can start in seconds with a room code.

## Who It's For
The owner and their friends, playing together in a browser.

## Requirements

### Validated
(None yet — ship to validate)

### Active
- REQ-01: Create/join a game room by short code; 2-4 players; lobby with name and class pick
- REQ-02: Authoritative Node.js WebSocket server holds game state; clients are thin and reconnect to the same seat
- REQ-03: Turn-based board map (tile graph) with dice movement, branching paths and tile effects
- REQ-04: Turn-based combat vs monsters with stats, skills, damage formulas and loot
- REQ-05: Player-vs-player battles and stealing/sabotage between players
- REQ-06: Shops, equipment, items and consumables with an inventory
- REQ-07: Towns that can be conquered, earn income and are contested by players
- REQ-08: Week/day calendar, final boss and win condition by money and score
- REQ-09: Canvas/DOM browser client with original placeholder art and animations
- REQ-10: Automated tests for rules engine and server protocol; one-command local run

### Out of Scope
- Any Sega/Sting assets, characters, names, music or text
- Public hosting, accounts, matchmaking and monetization
- Mobile native apps
- AI bot opponents (maybe later)

## Constraints
- Stack: TypeScript, Node.js server with ws, plain Canvas client bundled with Vite
- Runs locally with one command; friends connect via a tunnel or LAN
- Private use only; no persistence beyond in-memory game state

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Original IP: mechanics inspired by Dokapon Kingdom, all content original | Exact replica would copy copyrighted assets; assumed | Pending |
| TypeScript + ws + Vite + vitest | Simplest stack meeting browser multiplayer; assumed | Pending |
| In-memory state, no database | Private friend sessions only; assumed | Pending |
| Max 4 players, no bots in v1 | Matches genre, keeps scope small; assumed | Pending |

## Architecture Influences
Shared TypeScript rules engine (pure functions) used by an authoritative WebSocket server; thin Canvas client renders state snapshots and sends intents.

---
*Last updated: 2026-10-10 after initialization*
