# Plan 02-01 Summary: Town upgrades and capture, PvP item theft, boss bonus

## Result
**Status**: Failed
**Wave**: 1
**Agent**: engineering-backend-architect
**Completed**: 2026-10-10
**Failure Class**: BLOCKER — src/server/rooms.ts(1,39): error TS2307: Cannot find module 'node:crypto' or its corresponding type declarations.

## Agent Selection Rationale

| Candidate | Semantic | Heuristic | Memory | Total | Source |
|-----------|----------|-----------|--------|-------|--------|
| engineering-backend-architect | — | 8 | 3.33 | 11.33 | mandatory |
| testing-qa-verification-specialist | — | 12 | 4.5 | 16.5 | heuristic |
| engineering-senior-developer | — | 16 | 0 | 16 | heuristic |

- **Task type detected**: implementation
- **Confidence**: LOW
- **Adapter**: claude-code
- **Model tier**: sonnet

## Completed Tasks
- [x] Task 1: Town actions (done)
- [x] Task 2: PvP theft and boss bonus (done)
- [x] Task 3: Bot and simulation update (done)

## Files Modified
- `src/engine/bot.ts`
- `src/engine/combat.ts`
- `src/engine/game.ts`
- `src/engine/inventory.ts`
- `src/engine/movement.ts`
- `src/engine/types.ts`
- `tests/engine/combat.test.ts`
- `tests/engine/simulation.test.ts`
- `tests/engine/towns.test.ts`

## Verification Results
3/4 verification commands passed (run by Triad after the agent finished).

## Verification Commands
| Command | Exit Code | Result |
|---------|-----------|--------|
| `npx tsc --noEmit` | 2 | FAIL |
| `npx vitest run` | 0 | PASS |
| `npx vitest run tests/engine/towns.test.ts` | 0 | PASS |
| `npx vitest run tests/engine/combat.test.ts` | 0 | PASS |

## Key Decisions
- Theft reserves one copy of each equipped item id, so duplicate copies of an equipped item can still be stolen. It consumes an rng roll only when a candidate exists.
- No 'town-enter' event is emitted, because the existing movement test expects an empty event list when an owner lands on their own town. `leave-town`, `town-upgrade` and `town-capture` events are emitted by the actions.
- Town costs and the level cap are constants exported from movement.ts.

## Issues Encountered
- The tsc error above is in src/server/rooms.ts. It is probably missing @types/node or tsconfig types for the server code.
- BLOCKER: src/server/rooms.ts(1,39): error TS2307: Cannot find module 'node:crypto' or its corresponding type declarations.

## Escalations
| # | Severity | Type | Decision | Status | Resolution |
|---|----------|------|----------|--------|------------|
| 1 | blocker | quality | Resolve: src/server/rooms.ts(1,39): error TS2307: Cannot find module 'node:crypto' or its corresponding type declarations. | pending |  |

- #1 context: Verification failed (npx tsc --noEmit); a BLOCKER is not auto-fixed.

## Handoff Context
- **Key outputs**: src/engine/bot.ts; src/engine/combat.ts; src/engine/game.ts; src/engine/inventory.ts; src/engine/movement.ts; src/engine/types.ts; tests/engine/combat.test.ts; tests/engine/simulation.test.ts; tests/engine/towns.test.ts
- **Decisions made**: Theft reserves one copy of each equipped item id, so duplicate copies of an equipped item can still be stolen. It consumes an rng roll only when a candidate exists.; No 'town-enter' event is emitted, because the existing movement test expects an empty event list when an owner lands on their own town. `leave-town`, `town-upgrade` and `town-capture` events are emitted by the actions.; Town costs and the level cap are constants exported from movement.ts.
- **Open questions**: (none)
- **Conventions established**: The server must accept the Action types upgradeTown, captureTown and leaveTown, and handle Phase 'town'.; The new events are `item-stolen` {from, to, itemId}, `town-upgrade`, `town-capture` {fromId} and `leave-town`.; On a boss kill the game ends immediately via `advanceTurn(bossDefeated)`, and `winnerId` is the top scorer, not necessarily the slayer.

## Requirements Covered
- REQ-05
- REQ-07

## Error Details
Verification failed: npx tsc --noEmit

### Failed verification output
`npx tsc --noEmit`
```
src/server/rooms.ts(1,39): error TS2307: Cannot find module 'node:crypto' or its corresponding type declarations.

```

## Token Usage
8 requests, 253243 input tokens (211437 cached), 10177 output tokens, $0.2486
