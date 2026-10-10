# Phase 1: Rules engine and project foundation — Review Summary

## Result: PASSED

**Cycles Used**: 3
**Reviewers**: testing-qa-verification-specialist, engineering-senior-developer, engineering-frontend-developer
**Evaluators**: code-quality, integration, business-logic
**Completed**: 2026-10-10

## Findings Summary
- Must-fix (blocker, critical, major) found: 2; fixed: 2; unresolved: 0
- Suggestions (minor, advisory): 3
- Deferred (confidence 50-79%): 19
- Hot spots (flagged by 2+ reviewers): `src/engine/bot.ts`, `src/engine/game.ts`, `src/engine/calendar.ts`, `tests/engine/simulation.test.ts`, `src/engine/movement.ts`, `src/engine/combat.ts`

## Findings Detail
| ID | Severity | Location | Issue | Reviewers | Confidence | Status |
|----|----------|----------|-------|-----------|------------|--------|
| F-001 | major | `tests/engine/simulation.test.ts:36-41` | The assertion `expect(state.week >= 4 // bossDead)` cannot fail. A finished game always ends at week 5, because `advanceTurn` only returns game-over once `week > LAST_WEEK`, so the clause is always true. Nothing asserts that a boss battle started, that a full week elapsed, or that boss-defeated fired. I ran the bot sim over seeds 1-10 with 2 and 4 players. The bot never killed the boss in any run (`boss-defeated` count 0). The boss battle began in only 11 of 20 runs. | testing-qa-verification-specialist, evaluator:code-quality, evaluator:integration, evaluator:business-logic | 90% | fixed |
| F-002 | minor | `src/engine/movement.ts:36` | The final-week rule is hardcoded as the literal `4` (`state.week === 4`, `state.week !== 4`, `Math.min(4, state.week)`). `calendar.ts` already exports `LAST_WEEK` and `isBossEnabled`, but nothing uses `isBossEnabled`, and only `calendar.ts` uses `LAST_WEEK`. | engineering-senior-developer, evaluator:code-quality, evaluator:integration | 90% | deferred |
| F-003 | minor | `src/engine/game.ts (with src/engine/movement.ts):80-103` | `resolveTile` emits a placeholder monster id (`'boss'`, `'monster-tier-N'`). `realiseMonsterBattle` in game.ts then regex-parses that string, clamps the tier, rolls the RNG to pick a monster, and mutates the already-emitted `battle-start` event (`e.monsterId = monsterId`). It also builds a `battle` object without `monsterHp` in `resolveTile` and then discards it. | engineering-senior-developer | 80% | deferred |
| F-004 | major | `tests/engine/simulation.test.ts:71` | `(defeated[0] as { playerId: string }).playerId` fails type-check. `GameEvent` is `{ type: string; [k: string]: unknown }` (src/engine/types.ts:118). `npx tsc --noEmit` reports `tests/engine/simulation.test.ts(71,38): error TS2352: Conversion of type 'GameEvent' to type '{ playerId: string; }' may be a mistake`. vitest passes because it does not type-check. The tsconfig `include` covers `tests`, so the project's own tsc verification command fails. | testing-qa-verification-specialist | 97% | fixed |
| F-005 | minor | `tests/engine/simulation.test.ts:48` | `events` is destructured from `play(seed, n)` but never used in the "finishes" tests. | testing-qa-verification-specialist, engineering-senior-developer, evaluator:code-quality | 95% | deferred |

## Reviewer Verdicts
- Cycle 1, testing-qa-verification-specialist: **NEEDS WORK**
- Cycle 1, engineering-senior-developer: **NEEDS WORK**
- Cycle 1, engineering-frontend-developer: **PASS**
- Cycle 1, evaluator:code-quality: **NEEDS WORK**
- Cycle 1, evaluator:integration: **NEEDS WORK**
- Cycle 1, evaluator:business-logic: **NEEDS WORK**
- Cycle 2, testing-qa-verification-specialist: **NEEDS WORK**
- Cycle 2, engineering-senior-developer: **PASS**
- Cycle 2, engineering-frontend-developer: **PASS**
- Cycle 2, evaluator:code-quality: **PASS**
- Cycle 3, testing-qa-verification-specialist: **PASS**
- Cycle 3, engineering-senior-developer: **PASS**
- Cycle 3, engineering-frontend-developer: **PASS**

## Suggestions (Not Required)
- F-002 `src/engine/movement.ts`: The final-week rule is hardcoded as the literal `4` (`state.week === 4`, `state.week !== 4`, `Math.min(4, state.week)`). `calendar.ts` already exports `LAST_WEEK` and `isBossEnabled`, but nothing uses `isBossEnabled`, and only `calendar.ts` uses `LAST_WEEK`. (fix: Import `isBossEnabled` and `LAST_WEEK` into movement.ts and use them at all three sites. Check for an import cycle first (calendar.ts imports only types, so it should be fine). Use `monstersForTier`'s tier range instead of the literal `4` for the tier clamp.)
- F-003 `src/engine/game.ts (with src/engine/movement.ts)`: `resolveTile` emits a placeholder monster id (`'boss'`, `'monster-tier-N'`). `realiseMonsterBattle` in game.ts then regex-parses that string, clamps the tier, rolls the RNG to pick a monster, and mutates the already-emitted `battle-start` event (`e.monsterId = monsterId`). It also builds a `battle` object without `monsterHp` in `resolveTile` and then discards it. (fix: Have `resolveTile` return a typed intent such as `{ encounter: { tier } | { boss: true } }`, or call `startMonsterBattle` directly with the chosen monster. Do the RNG pick in one place and emit `battle-start` once, after the monster is known. Drop the regex and the event mutation.)
- F-005 `tests/engine/simulation.test.ts`: `events` is destructured from `play(seed, n)` but never used in the "finishes" tests. (fix: Change to `const { state } = play(seed, n);`.)

## Deferred (Medium Confidence)
- `src/engine/bot.ts` [minor, 60%]: In the `choose-path` case, `steps[Math.floor(rand() * steps.length)]` returns `undefined` when the tile has no `next`. The bot then emits `{type:'choosePath', tileId: undefined}`, which the engine rejects with "tile undefined is not reachable".
- `src/engine/game.ts` [minor, 55%]: If a tile has zero outgoing `next` while `pendingMoves > 0`, `autoAdvance` stops (steps.length !== 1). `afterStep` then sets phase `choose-path` with no legal choice.
- `src/engine/calendar.ts` [minor, 60%]: `respawn` hardcodes `tileId: 'start'`. `inventory.startTileId` and `createGame` look the start tile up by `kind === 'start'`.
- `src/engine/rng.ts` [minor, 60%]: `nextInt` has no guard for `min > maxInclusive`. It returns a value below `min`, or `NaN` for non-finite input.
- `src/engine/game.ts` [advisory, 70%]: The try/catch converts every thrown error, including TypeErrors from malformed actions such as `null` or a missing `action.action`, into `{error}`. Unknown battle sub-actions are not validated: the `switch (action.action)` in `combat.ts` has no `default`, so an unrecognised action silently becomes a no-op turn in which the enemy still strikes.
- `src/engine/calendar.ts` [minor, 75%]: `respawn` hardcodes the tile id `'start'`. `game.ts` instead locates the start tile by `kind === 'start'` (lines 53-54), so the start tile is resolved in two different ways.
- `src/engine/bot.ts` [advisory, 55%]: The bot builds a throwaway RNG by XOR-mixing `rngState`, a salt and `log.length`. It also only offers a path-choice action when `steps` is non-empty and indexes `steps[...]` without a guard. `localRandom` re-implements an RNG-advance loop that rng.ts should expose.
- `src/engine/game.ts` [minor, 60%]: `realiseMonsterBattle` mutates event objects in place (`e.monsterId = monsterId`). `resolveTile` also returns a `battle` whose defender id is a placeholder (`boss` or `monster-tier-N`) with no `monsterHp`. If a caller uses `resolveTile` directly, `resolveBattleAction` throws `Unknown monster`.
- `src/engine/bot.ts` [minor, 55%]: The `choose-path` case indexes `steps[Math.floor(rand() * steps.length)]`. If `steps` is empty, the action carries `tileId: undefined`, which the types hide because `noUncheckedIndexedAccess` is off. Related: `autoAdvance` (movement.ts 45-53) and `afterStep` set `phase: 'choose-path'` with no valid options when a tile has `next: []`. `createGame` never runs `validateMap`, so such a state would be unrecoverable.
- `src/engine/combat.ts` [minor, 50%]: On level-up, `maxHp` grows but `hp` is not raised. It is only clamped down. Equipping a maxHp item (inventory.ts 29-37) likewise does not raise current HP.
- `src/engine/combat.ts` [advisory, 60%]: `clone()` (a JSON round-trip of the whole state) is duplicated in `combat.ts` and `inventory.ts`. It runs on every battle action, and it would silently drop `undefined` values or any non-JSON data added to the state later.
- `tests/engine/game.test.ts, tests/engine/combat.test.ts` [minor, 65%]: There is no direct test of the `applyAction` flow for these paths: `realiseMonsterBattle` (tier id mapped to a real monster, drawing from rng), the `settle` auto-end-turn for a defeated current player, or `bot.ts` behavior (the shop and heal decisions). Bot logic is covered only indirectly through the sim.
- `src/engine/calendar.ts` [minor, 60%]: `respawn` hard-codes `tileId: 'start'`. `createGame` instead looks up the tile with `kind === 'start'`. The two derive the start tile differently.
- `src/engine/combat.ts (also src/engine/calendar.ts)` [major, 70%]: The design context says "winner = most gold plus town value plus boss bonus". Boss defeat is implemented two ways that disagree. `finishBattle` sets `phase='game-over'` and `winnerId=actor.id`, so the slayer wins outright whatever the scores. `advanceTurn({bossDefeated})` calls `gameOver`, which uses `determineWinner`, and `game.ts` never calls it. No boss bonus exists in `computeScore`. The `bossDefeated` option is dead code, and the calendar test covers the path the reducer never uses.
- `src/engine/movement.ts; src/engine/game.ts` [minor, 60%]: `resolveTile` emits `monster-tier-${min(4, week)}`, and the test asserts tier-4 for week 4 and week 5. `realiseMonsterBattle` clamps that to 3, so weeks 3 and 4 both spawn tier 3. No normal tile ever spawns a tier-4 monster, and the "tier 4" placeholder is never used for regular tiles. The mismatch is undocumented.
- `src/engine/movement.ts` [minor, 55%]: Towns can only be claimed or tolled. An owner who lands on their own town gets nothing, and `town.level` is never increased anywhere. A claimed town can never be taken over by another player.
- `src/engine/combat.ts` [minor, 50%]: Fleeing is allowed from the final boss, and a successful flee ends the turn with no consequence. Skills (lines 208-241) have no cost or cooldown. Knight, mage and rogue skills are strictly better than `attack`, so `attack` is dominated, and the cleric skill is a free heal every round. The rogue's double loot applies only when the skill delivers the killing blow.
- `src/engine/movement.ts; src/engine/game.ts` [minor, 50%]: When a PvP battle triggers (`finishMovement`), the tile effect of the landing tile is skipped (a shop, a town claim or toll, an event or heal). The same happens if the landing tile is a boss tile in week 4. `PvP` also never triggers when the mover lands on the start tile, and passing through a rival does nothing.
- `tests/engine/simulation.test.ts` [advisory, 55%]: The `seen` check covers days 1-7 only for week 1. For weeks 2-4 it only checks that some day of the week appears.

## Fixes Applied
- cycle 1: engineering-backend-architect on F-001 (done); checks 13/14 passed
- cycle 2: engineering-backend-architect on F-004 (done); checks 14/14 passed
- minor findings: engineering-backend-architect on F-002, F-005, F-001, F-002, F-003, F-004, F-006, F-009 (done); left as is: F-003/F-009 (partial): src/engine/inventory.ts still has its own startTileId() lookup and falls back to the literal 'start'. It is outside my writable list, so I did not switch it to getStartTileId. / The helper lives in calendar.ts, not map.ts, because map.ts was not writable. Move it later if you prefer. / F-006: I did not add an action-shape check inside combat.ts. applyAction rejects a missing or non-string `type`, and an unknown battle sub-action now throws, which applyAction turns into `{error}`. / Import-cycle check for F-002 (movement.ts): calendar.ts imports only types, so there is no cycle.; checks 14/14 passed, 8 file(s) changed

## Cycle Delta
- cycle 1: 1 must-fix, 2 suggestions, 18 deferred, 0 dropped (low confidence)
- cycle 2: 1 must-fix (resolved 1, new 1, unchanged 0), 1 suggestions, 1 deferred, 0 dropped (low confidence)
- cycle 3: 0 must-fix (resolved 1, new 0, unchanged 0), 0 suggestions, 0 deferred, 0 dropped (low confidence)

## Coverage
No coverage data found (looked for coverage/coverage-summary.json, coverage-summary.json, coverage/lcov.info, lcov.info, coverage.xml, coverage/cobertura-coverage.xml, coverage/coverage.xml, coverage.txt, coverage/coverage.txt). Advisory only: run the test suite with coverage to check review.coverage_thresholds.
