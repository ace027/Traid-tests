# Phase 1: Rules engine and project foundation — Review Fixes

Fixes applied by the review loop, one section per cycle. Re-review decides whether each one holds.

## Cycle 1

**Date**: 2026-10-10
**Checks**: 13/14 passed
**Files changed**: `tests/engine/simulation.test.ts`

| Finding | Severity | File | Agent | Status | Notes |
|---------|----------|------|-------|--------|-------|
| F-001 | major | `tests/engine/simulation.test.ts` | engineering-backend-architect | fix applied | Removed the tautological `week >= 4 // bossDead` assertion from the finish test, which now asserts `phase === 'game-over'`. Added a test that runs buffed bots (huge hp/atk/def) for 2 and 4 players over seeds 1-3. It checks that every week 1-4 and every day 1-7 of week 1 is reached, that a `battle-start` event with BOSS_ID occurs, that `boss-defeated` fires exactly once, and that `winnerId` equals the boss slayer. The bots reach and kill the boss in all six runs. |

## Cycle 2

**Date**: 2026-10-10
**Checks**: 14/14 passed
**Files changed**: `tests/engine/simulation.test.ts`

| Finding | Severity | File | Agent | Status | Notes |
|---------|----------|------|-------|--------|-------|
| F-004 | major | `tests/engine/simulation.test.ts` | engineering-backend-architect | fix applied | F-004 fixed. Line 71 of simulation.test.ts now reads `expect(state.winnerId).toBe(defeated[0].playerId)`, with no cast. The GameEvent index signature allows that access. |
