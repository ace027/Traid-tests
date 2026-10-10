# Plan 01-04 Summary: Game reducer and headless full-game simulation

## Result
**Status**: Complete
**Wave**: 3
**Agent**: testing-qa-verification-specialist
**Completed**: 2026-10-10

## Agent Selection Rationale

| Candidate | Semantic | Heuristic | Memory | Total | Source |
|-----------|----------|-----------|--------|-------|--------|
| testing-qa-verification-specialist | — | 14 | 0 | 14 | mandatory |
| engineering-senior-developer | — | 15 | 0 | 15 | heuristic |
| project-manager-senior | — | 12 | 0 | 12 | heuristic |

- **Task type detected**: quality-review
- **Confidence**: LOW
- **Adapter**: claude-code
- **Model tier**: sonnet

## Completed Tasks
- [x] Task 1: Reducer (done)
- [x] Task 2: Reducer tests (done)
- [x] Task 3: Bot and full simulation (done)

## Files Modified
- `src/engine/bot.ts`
- `src/engine/game.ts`
- `src/engine/index.ts`
- `tests/engine/game.test.ts`
- `tests/engine/simulation.test.ts`

## Verification Results
4/4 verification commands passed (run by Triad after the agent finished).

## Verification Commands
| Command | Exit Code | Result |
|---------|-----------|--------|
| `npx tsc --noEmit` | 0 | PASS |
| `npx vitest run` | 0 | PASS |
| `npx vitest run tests/engine/game.test.ts` | 0 | PASS |
| `npx vitest run tests/engine/simulation.test.ts` | 0 | PASS |

## Key Decisions
- The `monster-tier-N` placeholder maps to a real monster: a random one from `monstersForTier(min(3, N))`, drawn with state.rngState. The boss tile uses BOSS_ID. The reducer then calls startMonsterBattle.
- Players ending movement on the start tile never fight each other (safe zone). PvP only triggers against a non-defeated player on a non-start tile.
- When the boss dies, combat.ts already sets game-over and winnerId, so the reducer never calls advanceTurn with bossDefeated.
- Defeat is handled by `settle`: in phase end-turn with the current player defeated, it calls advanceTurn automatically.
- equip and useItem are allowed in every phase except battle and choose-path; buy and sell only in shop. leaveShop moves to end-turn, and endTurn is valid only in end-turn.
- Errors, including exceptions thrown by combat and movement, come back as `{state (unchanged), events: [], error}`. Any action after game-over returns the error "The game is over".
- Bot priorities, in order:
- Heal with a consumable when HP is below 50%.
- Choose the path randomly.
- Flee when HP is below 30%.
- A cleric uses its skill when HP is below 50%.
- Otherwise attack.
- In a shop, equip the best owned weapon if it beats the equipped one, then buy the best affordable weapon that beats it, then leave.
- Towns are claimed automatically by resolveTile.

## Issues Encountered
(none)

## Escalations
(none)

## Handoff Context
- **Key outputs**: src/engine/bot.ts; src/engine/game.ts; src/engine/index.ts; tests/engine/game.test.ts; tests/engine/simulation.test.ts
- **Decisions made**: The `monster-tier-N` placeholder maps to a real monster: a random one from `monstersForTier(min(3, N))`, drawn with state.rngState. The boss tile uses BOSS_ID. The reducer then calls startMonsterBattle.; Players ending movement on the start tile never fight each other (safe zone). PvP only triggers against a non-defeated player on a non-start tile.; When the boss dies, combat.ts already sets game-over and winnerId, so the reducer never calls advanceTurn with bossDefeated.; Defeat is handled by `settle`: in phase end-turn with the current player defeated, it calls advanceTurn automatically.; equip and useItem are allowed in every phase except battle and choose-path; buy and sell only in shop. leaveShop moves to end-turn, and endTurn is valid only in end-turn.; Errors, including exceptions thrown by combat and movement, come back as `{state (unchanged), events: [], error}`. Any action after game-over returns the error "The game is over".; Bot priorities, in order:; Heal with a consumable when HP is below 50%.; Choose the path randomly.; Flee when HP is below 30%.; A cleric uses its skill when HP is below 50%.; Otherwise attack.; In a shop, equip the best owned weapon if it beats the equipped one, then buy the best affordable weapon that beats it, then leave.; Towns are claimed automatically by resolveTile.
- **Open questions**: (none)
- **Conventions established**: Escalation #1 (combat, inventory and data/* not exported from index.ts) is resolved. No export-name collisions showed up under tsc.; Bots never stall. The calendar ends the game after week 4 regardless of the boss, so a game can end without anyone reaching it.; The state log grows without bound; the UI may want to cap it.

## Requirements Covered
- REQ-03
- REQ-04
- REQ-08
- REQ-10

## Token Usage
8 requests, 240000 input tokens (195856 cached), 13582 output tokens, $0.2853
