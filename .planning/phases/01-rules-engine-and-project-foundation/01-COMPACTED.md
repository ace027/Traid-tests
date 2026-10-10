---
phase: 01-rules-engine-and-project-foundation
compacted: 2026-10-10
original_summaries: [01-01-SUMMARY.md, 01-02-SUMMARY.md, 01-03-SUMMARY.md, 01-04-SUMMARY.md]
requirements_satisfied: [REQ-03, REQ-10, REQ-08, REQ-04, REQ-05, REQ-06]
---

# Phase 1: Rules engine and project foundation — Compacted Summary

## Deliverables
- 01-01 Project scaffold, core types and seeded RNG (Complete): package.json, src/engine/index.ts, src/engine/rng.ts, src/engine/types.ts, tests/engine/rng.test.ts, tsconfig.json, vitest.config.ts
- 01-02 Map graph, movement, tile effects and calendar (Complete): src/engine/calendar.ts, src/engine/map.ts, src/engine/movement.ts, tests/engine/calendar.test.ts, tests/engine/map.test.ts, tests/engine/movement.test.ts
- 01-03 Content data, combat math and shops (Complete with Warnings): src/engine/combat.ts, src/engine/data/classes.ts, src/engine/data/items.ts, src/engine/data/monsters.ts, src/engine/inventory.ts, tests/engine/combat.test.ts, tests/engine/inventory.test.ts
- 01-04 Game reducer and headless full-game simulation (Complete): src/engine/bot.ts, src/engine/game.ts, src/engine/index.ts, tests/engine/game.test.ts, tests/engine/simulation.test.ts

## Decisions
- 01-01: .gitignore already listed node_modules/, dist/ and coverage/, so I did not edit it.
- 01-01: createRng(seed) returns seed|0. nextFloat advances the state by 0x6D2B79F5 and then mixes it, so the returned state is the pre-mix counter.
- 01-01: nextInt always advances the state once, even when min==max, so call sequences stay consistent.
- 01-02: The plan did not specify these, so I chose them; plan 01-04 may override any of them.
- 01-02: `Action` has no claim action, so `resolveTile` claims an unowned town automatically when gold >= 100. Below 100 nothing happens.
- 01-02: Toll is `town.income * town.level`, capped at the payer's gold. Income is 20 in `buildDefaultTowns`.
- 01-03: startMonsterBattle, startPlayerBattle and resolveBattleAction throw an Error on invalid input (unknown ids, a defeated combatant, no battle in progress, a faile
- 01-04: The `monster-tier-N` placeholder maps to a real monster: a random one from `monstersForTier(min(3, N))`, drawn with state.rngState. The boss tile uses BOSS_ID. 
- 01-04: Players ending movement on the start tile never fight each other (safe zone). PvP only triggers against a non-defeated player on a non-start tile.
- 01-04: When the boss dies, combat.ts already sets game-over and winnerId, so the reducer never calls advanceTurn with bossDefeated.

## Conventions and Open Questions
- 01-01 convention: Import from src/engine (index) using extensionless paths, which Bundler resolution supports.
- 01-01 convention: RNG usage pattern: const [v, next] = nextInt(state.rngState, a, b)
- 01-01 convention: then store next back into state.rngState.
- 01-02 convention: Plan 01-04 should map `monster-tier-N` to real monsters, or change `monsterIdForTier`.
- 01-02 convention: The reducer must pass `{ bossDefeated: true }` to `advanceTurn` after the boss is killed.
- 01-02 convention: The reducer should call `autoAdvance` after a roll and set `pendingMoves` itself.
- 01-03 convention: Item ids: healing-draught, trail-ration, fury-tonic, warp-scroll
- 01-03 convention: weapons oak-cudgel, ironbite-sword, starfall-blade, runed-glaive
- 01-03 convention: armors quilted-vest, scaleweave-mail, bastion-plate, aegis-of-dawn
- 01-04 convention: Escalation #1 (combat, inventory and data/* not exported from index.ts) is resolved. No export-name collisions showed up under tsc.
- 01-04 convention: Bots never stall. The calendar ends the game after week 4 regardless of the boss, so a game can end without anyone reaching it.
- 01-04 convention: The state log grows without bound

## Files Modified
| File | Change |
|------|--------|
| `package.json` | 01-01: Project scaffold, core types and seeded RNG |
| `src/engine/index.ts` | 01-01: Project scaffold, core types and seeded RNG |
| `src/engine/rng.ts` | 01-01: Project scaffold, core types and seeded RNG |
| `src/engine/types.ts` | 01-01: Project scaffold, core types and seeded RNG |
| `tests/engine/rng.test.ts` | 01-01: Project scaffold, core types and seeded RNG |
| `tsconfig.json` | 01-01: Project scaffold, core types and seeded RNG |
| `vitest.config.ts` | 01-01: Project scaffold, core types and seeded RNG |
| `src/engine/calendar.ts` | 01-02: Map graph, movement, tile effects and calendar |
| `src/engine/map.ts` | 01-02: Map graph, movement, tile effects and calendar |
| `src/engine/movement.ts` | 01-02: Map graph, movement, tile effects and calendar |
| `tests/engine/calendar.test.ts` | 01-02: Map graph, movement, tile effects and calendar |
| `tests/engine/map.test.ts` | 01-02: Map graph, movement, tile effects and calendar |
| `tests/engine/movement.test.ts` | 01-02: Map graph, movement, tile effects and calendar |
| `src/engine/combat.ts` | 01-03: Content data, combat math and shops |
| `src/engine/data/classes.ts` | 01-03: Content data, combat math and shops |
| `src/engine/data/items.ts` | 01-03: Content data, combat math and shops |
| `src/engine/data/monsters.ts` | 01-03: Content data, combat math and shops |
| `src/engine/inventory.ts` | 01-03: Content data, combat math and shops |
| `tests/engine/combat.test.ts` | 01-03: Content data, combat math and shops |
| `tests/engine/inventory.test.ts` | 01-03: Content data, combat math and shops |
| `src/engine/bot.ts` | 01-04: Game reducer and headless full-game simulation |
| `src/engine/game.ts` | 01-04: Game reducer and headless full-game simulation |
| `src/engine/index.ts` | 01-04: Game reducer and headless full-game simulation |
| `tests/engine/game.test.ts` | 01-04: Game reducer and headless full-game simulation |
| `tests/engine/simulation.test.ts` | 01-04: Game reducer and headless full-game simulation |

## Verification
- 01-01 (REQ-03, REQ-10): 4/4 verification commands passed
- 01-02 (REQ-03, REQ-08): 5/5 verification commands passed
- 01-03 (REQ-04, REQ-05, REQ-06): 4/4 verification commands passed
- 01-04 (REQ-03, REQ-04, REQ-08, REQ-10): 4/4 verification commands passed

## Agents
- 01-01: engineering-backend-architect
- 01-02: engineering-backend-architect
- 01-03: engineering-backend-architect
- 01-04: testing-qa-verification-specialist
