# Phase 4: Polish and playtest — Review Summary

## Result: PASSED

**Cycles Used**: 2
**Reviewers**: testing-qa-verification-specialist, engineering-senior-developer
**Completed**: 2026-10-10

## Findings Summary
- Must-fix (blocker, critical, major) found: 1; fixed: 1; unresolved: 0
- Suggestions (minor, advisory): 2
- Deferred (confidence 50-79%): 5
- Hot spots (flagged by 2+ reviewers): `README.md`

## Findings Detail
| ID | Severity | Location | Issue | Reviewers | Confidence | Status |
|----|----------|----------|-------|-----------|------------|--------|
| F-001 | major | `tests/e2e/smoke.spec.ts:108-109` | The full-game test asserts the banner matches `/wins!/Game over/`. `src/client/ui/gameover.ts` (lines 20-21) renders `"X and Y share the win!"` when scores tie. That text matches neither alternative, so the test fails on a tie. | testing-qa-verification-specialist | 85% | fixed |
| F-002 | minor | `README.md:1` | The title is "Realm Rivals". The product name is "Realm Rush" in index.html:6, lobby.ts:45, main.ts:12-13 and the package name. | testing-qa-verification-specialist, engineering-senior-developer | 90% | deferred |
| F-003 | minor | `src/server/server.ts:78` | The literal `45_000` is repeated as the fallback for `offlineTurnMs`. `src/server/rooms.ts:10` already exports `DEFAULT_OFFLINE_TURN_MS = 45_000`, and the `RoomManager` constructor (rooms.ts:42) defaults to it. | engineering-senior-developer | 90% | deferred |

## Reviewer Verdicts
- Cycle 1, testing-qa-verification-specialist: **NEEDS WORK**
- Cycle 1, engineering-senior-developer: **PASS**
- Cycle 2, testing-qa-verification-specialist: **PASS**
- Cycle 2, engineering-senior-developer: **PASS**

## Suggestions (Not Required)
- F-002 `README.md`: The title is "Realm Rivals". The product name is "Realm Rush" in index.html:6, lobby.ts:45, main.ts:12-13 and the package name. (fix: Change the README heading to "Realm Rush".)
- F-003 `src/server/server.ts`: The literal `45_000` is repeated as the fallback for `offlineTurnMs`. `src/server/rooms.ts:10` already exports `DEFAULT_OFFLINE_TURN_MS = 45_000`, and the `RoomManager` constructor (rooms.ts:42) defaults to it. (fix: Use `new RoomManager(opts.now ?? Date.now, opts.offlineTurnMs)` so the constructor default applies. Alternatively, import `DEFAULT_OFFLINE_TURN_MS` in server.ts.)

## Deferred (Medium Confidence)
- `playwright.config.ts` [major, 65%]: The e2e web server runs `node scripts/dev.mjs`, which starts Vite on port 5173 plus the game server. The production path, `npm start` (`vite build && tsx src/server/main.ts`, static files and `/ws` on 8787), has no automated coverage. `tests/server/static.test.ts` exercises the static handler, but nothing checks that the built client connects to `/ws` on the same origin.
- `tests/e2e/smoke.spec.ts` [minor, 55%]: `playTurn` swallows click failures with `.catch(() => {})`. It returns silently when it sees any `.waiting` text starting with "Waiting for". The outer loop then re-polls with no progress check, relying only on the 420s deadline. A stuck game surfaces as a late "winner-banner not visible" failure with no diagnostic.
- `src/client/ui/gameover.ts` [advisory, 60%]: `computeScore(state as never, p.id)` bypasses the type system with a cast to `never`. `PublicGameState` is passed where the engine expects `GameState`.
- `src/client/ui/battle.ts` [advisory, 50%]: The "Unknown foe" fallback builds `{ hp, maxHp: hp } as Stats`, a partial object cast to `Stats`. `portrait()` also mixes canvas drawing with a hash-colour fallback in one function.
- `tests/e2e/smoke.spec.ts` [advisory, 50%]: F-001 is fixed. The regex is now `/wins!|share the win!|Game over/`, which matches the tie text from `src/client/ui/gameover.ts` line 19. The `Game over` alternative also accepts the no-winner banner, so the test cannot tell a genuine winner from a missing `winnerId`. I did not run the e2e suite. This is based on reading both files.

## Fixes Applied
- cycle 1: engineering-backend-architect on F-001 (done); checks 9/9 passed
- minor findings: engineering-senior-developer on F-002 (done); engineering-backend-architect on F-003, F-006, F-007 (done); left as is: F-006 not fixed: it needs `computeScore`'s parameter narrowed in src/engine/calendar.ts, which is not in my writable list. Once that is narrowed, the `as never` cast in gameover.ts can be dropped.; checks 9/9 passed, 3 file(s) changed

## Cycle Delta
- cycle 1: 1 must-fix, 2 suggestions, 4 deferred, 0 dropped (low confidence)
- cycle 2: 0 must-fix (resolved 1, new 0, unchanged 0), 0 suggestions, 1 deferred, 0 dropped (low confidence)

## Coverage
No coverage data found (looked for coverage/coverage-summary.json, coverage-summary.json, coverage/lcov.info, lcov.info, coverage.xml, coverage/cobertura-coverage.xml, coverage/coverage.xml, coverage.txt, coverage/coverage.txt). Advisory only: run the test suite with coverage to check review.coverage_thresholds.
