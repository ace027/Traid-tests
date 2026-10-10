# Plan 03-03 Summary: HUD: turn controls, battle, shop, inventory, towns, log, game over

## Result
**Status**: Complete
**Wave**: 2
**Agent**: engineering-frontend-developer
**Completed**: 2026-10-10

## Agent Selection Rationale

| Candidate | Semantic | Heuristic | Memory | Total | Source |
|-----------|----------|-----------|--------|-------|--------|
| engineering-frontend-developer | — | 8 | 0 | 8 | mandatory |
| engineering-senior-developer | — | 15 | 5 | 20 | heuristic |
| testing-qa-verification-specialist | — | 11 | 4.5 | 15.5 | heuristic |

- **Task type detected**: implementation
- **Confidence**: LOW
- **Adapter**: claude-code
- **Model tier**: sonnet

## Completed Tasks
- [x] Task 1: HUD frame, log and scoreboard (done)
- [x] Task 2: Action panels (done)
- [x] Task 3: HUD tests (done)

## Files Modified
- `src/client/ui/battle.ts`
- `src/client/ui/gameover.ts`
- `src/client/ui/hud.css`
- `src/client/ui/hud.ts`
- `src/client/ui/inventory.ts`
- `src/client/ui/log.ts`
- `src/client/ui/shop.ts`
- `src/client/ui/town.ts`
- `tests/client/hud.test.ts`

## Verification Results
4/4 verification commands passed (run by Triad after the agent finished).

## Verification Commands
| Command | Exit Code | Result |
|---------|-----------|--------|
| `npx tsc --noEmit` | 0 | PASS |
| `npx vitest run tests/client` | 0 | PASS |
| `npx vite build` | 0 | PASS |
| `npx vitest run tests/client/hud.test.ts` | 0 | PASS |

## Key Decisions
- board.ts has no setPathHandler yet, so hud.ts does `import * as board` and calls it only if present. Once 03-02 exports it, the handler sends choosePath. The choose-path panel also has "Go to <tileId>" buttons built from stepsAvailable.
- Portraits are coloured boxes, not art.drawMonster, because art.ts is created by 03-02 and the plan said not to import it.
- The Inventory toggle is hidden during battle, choose-path and game-over.
- An unowned town shows only Leave, because the engine rejects capturing an unowned town.
- The log shows state.log plus event-derived lines, deduplicated, capped at 50.
- Battle events come from store.lastEvents, which only holds events from the latest state message.
- `state as never` casts are used where engine functions expect GameState but the client holds a PublicGameState.

## Issues Encountered
(none)

## Escalations
(none)

## Handoff Context
- **Key outputs**: src/client/ui/battle.ts; src/client/ui/gameover.ts; src/client/ui/hud.css; src/client/ui/hud.ts; src/client/ui/inventory.ts; src/client/ui/log.ts; src/client/ui/shop.ts; src/client/ui/town.ts; tests/client/hud.test.ts
- **Decisions made**: board.ts has no setPathHandler yet, so hud.ts does `import * as board` and calls it only if present. Once 03-02 exports it, the handler sends choosePath. The choose-path panel also has "Go to <tileId>" buttons built from stepsAvailable.; Portraits are coloured boxes, not art.drawMonster, because art.ts is created by 03-02 and the plan said not to import it.; The Inventory toggle is hidden during battle, choose-path and game-over.; An unowned town shows only Leave, because the engine rejects capturing an unowned town.; The log shows state.log plus event-derived lines, deduplicated, capped at 50.; Battle events come from store.lastEvents, which only holds events from the latest state message.; `state as never` casts are used where engine functions expect GameState but the client holds a PublicGameState.
- **Open questions**: (none)
- **Conventions established**: 03-02 should export `setPathHandler(fn: ((tileId: string) => void) | null)` from src/client/render/board.ts. hud.ts already calls it when it exists.; art.drawMonster is not wired into the battle panel. battle.ts `portrait()` is the single place to swap it in.; hud.css assumes main.ts's `div.hud` container and uses the CSS variables from styles.css.

## Requirements Covered
- REQ-09

## Token Usage
9 requests, 281218 input tokens (244371 cached), 13430 output tokens, $0.2753
