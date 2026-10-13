# Phase 4: Import, Activity, Wanted and Calendar — Review Summary

## Result: PASSED

**Cycles Used**: 3
**Reviewers**: testing-qa-verification-specialist, engineering-senior-developer, design-ui-designer, design-ux-architect
**Evaluators**: code-quality, ui-ux, integration, business-logic
**Completed**: 2026-10-13

## Findings Summary
- Must-fix (blocker, critical, major) found: 4; fixed: 4; unresolved: 0
- Suggestions (minor, advisory): 0
- Deferred (confidence 50-79%): 22
- Hot spots (flagged by 2+ reviewers): `server/src/import/importer.ts`, `server/src/services/ical.ts`, `server/src/services/wanted.ts`, `web/src/pages/calendar/MonthView.tsx`, `server/src/routes/calendar.ts`, `server/src/import/importer.test.ts`

## Findings Detail
| ID | Severity | Location | Issue | Reviewers | Confidence | Status |
|----|----------|----------|-------|-----------|------------|--------|
| F-001 | major | `server/src/import/importer.ts:119-125` | An old episode file whose path equals the destination is deleted or recycled by `replaceOldFile` before `transferFile` runs. If the transfer then fails (source vanished, disk full, permission error), the catch returns "failed" but the old file is already gone from disk. Its DB row and episode link are gone too, and a history event has been written. | testing-qa-verification-specialist, evaluator:code-quality, evaluator:integration, evaluator:business-logic | 80% | fixed |
| F-002 | major | `server/src/routes/manualimport.ts:91-125` | There is no per-file try/catch in the ManualImport command loop. `getImportDecisions` can throw `ImportSourceError`, `fs.statSync` can throw, and `importDecisions` can throw (see finding 2). Any of these aborts the whole command, so no summary message is produced and the remaining files are skipped. Files already imported are not reported. | testing-qa-verification-specialist | 80% | fixed |
| F-003 | major | `server/src/services/wanted.ts:82-109` | `listCutoffUnmet` loads every monitored episode that has a file, parses each file's quality JSON in JS, and builds an `id in (...)` list with inlined ids. It then runs a second query to sort and page. The cost grows with library size on every request, and the SQL text grows with the number of cutoff-unmet episodes. | engineering-senior-developer, evaluator:code-quality, evaluator:integration, evaluator:business-logic | 80% | fixed |
| F-004 | major | `server/src/import/importer.test.ts:115-135` | Nothing tests the code that fixes F-001. That code is the transfer-before-replace order at importer.ts lines 117-141: the old file's path equals the destination, so the new file gets a " (n)" name, the old file is removed, and the new file is renamed to the destination. Nothing tests the failed-transfer case either: the old file, its DB row and its episode link must survive, and no `episodeFileDeleted` event may be written. The two upgrade tests only cover a different destination name. The earlier fix looks correct in the code (transfer runs first at line 120), but no test pins it. | evaluator:code-quality | 85% | fixed |

## Reviewer Verdicts
- Cycle 1, testing-qa-verification-specialist: **NEEDS WORK**
- Cycle 1, engineering-senior-developer: **NEEDS WORK**
- Cycle 1, design-ui-designer: **PASS**
- Cycle 1, design-ux-architect: **PASS**
- Cycle 1, evaluator:code-quality: **NEEDS WORK**
- Cycle 1, evaluator:ui-ux: **PASS**
- Cycle 1, evaluator:integration: **NEEDS WORK**
- Cycle 1, evaluator:business-logic: **NEEDS WORK**
- Cycle 2, testing-qa-verification-specialist: **NEEDS WORK**
- Cycle 2, engineering-senior-developer: **PASS**
- Cycle 2, design-ui-designer: **PASS**
- Cycle 2, design-ux-architect: **PASS**
- Cycle 2, evaluator:code-quality: **NEEDS WORK**
- Cycle 3, testing-qa-verification-specialist: **PASS**
- Cycle 3, engineering-senior-developer: **PASS**
- Cycle 3, design-ui-designer: **PASS**
- Cycle 3, design-ux-architect: **PASS**
- Cycle 3, evaluator:code-quality: **PASS**

## Suggestions (Not Required)
(none)

## Deferred (Medium Confidence)
- `server/src/import/importer.ts` [major, 70%]: `fs.promises.stat(importedPath)` and `upsertEpisodeFile` sit outside the try/catch. If either throws, the file is already moved to the series folder and the old files already removed, but no episodeFile row or history event exists. The exception also propagates out of `importDecisions`, so the other decisions in the batch are never imported.
- `server/src/services/queue.ts` [minor, 50%]: `processCompleted` is retried on every refresh for an item left `importPending` with a warning, such as a rejected file or a missing output path. Each retry re-runs full decision-making and import for the same release. With hardlink or copy mode the source files remain after a partial import, so an already-imported sibling file may be re-evaluated and re-transferred as "name (1).ext" unless `getImportDecisions` filters it. I did not verify that filtering.
- `server/src/services/ical.ts` [minor, 55%]: With `asAllDay`, the date comes from the UTC date of `airDateUtc` instead of the episode's local `airDate`. For late-evening US air times the all-day event lands on the next calendar day.
- `server/src/services/wanted.ts and server/src/routes/calendar.ts` [minor, 70%]: Both files hand-roll the same enrichment: a per-request `Map<seriesId, Series>` cache, `getSeries`, `toApiEpisode` and attaching `.series`. The `monitored` conditions and the `coalesce(airDateUtc, airDate)` sort expression are also written twice.
- `server/src/routes/wanted.ts` [advisory, 60%]: `pagingSchema` is imported from `routes/history.js`, so one route module depends on another route module. `bool` is also redefined locally in `wanted.ts` and `calendar.ts`.
- `web/src/pages/wanted/WantedTable.tsx` [minor, 65%]: The "Select all" checkbox only has checked and unchecked states. When some rows are selected it shows unchecked, and its label stays "Select all".
- `web/src/pages/calendar/MonthView.tsx` [minor, 50%]: Each `role="gridcell"` has an `aria-label` that replaces its accessible name with a day and count summary, and it contains interactive chips (links) plus a `role="dialog"` popover. The popover dialog sits inside the gridcell, and nothing in the code I read moves focus back to the cell or the "+N more" trigger when it closes. The weekday `columnheader` elements also carry an `aria-label` that duplicates the visible text.
- `server/src/services/downloadHandling.ts` [minor, 50%]: `JSON.parse(grabbed.data)` is unguarded. A malformed history row throws before `downloadFailed` is recorded, on every poll.
- `server/src/import/importer.ts, /home/user/Traid-tests/server/src/services/rename.ts` [advisory, 75%]: `insideRealpath` in importer.ts and `realInside` in rename.ts are identical. `grabbedRows` in decisions.ts and `downloadEvents` in downloadHandling.ts both repeat the same three-way download-id case lookup.
- `web/src/pages/series/SeriesDetail.tsx` [minor, 70%]: A leftover `TODO(03-05 escalation)` keeps a special-case `unknownCommandMessage` ("Searching is available once indexers are configured"). Indexers and search now exist after phase 4.
- `server/src/services/rename.ts` [minor, 55%]: `transferFile` appends " (n)" when the target already exists. A file whose target name is taken is renamed to "name (1)" each time. The preview still differs from the expected name, so renaming can repeat endlessly. The file rename and the DB update are also not atomic: if the DB update throws, the file is already moved.
- `server/src/services/downloadHandling.test.ts` [minor, 60%]: No test covers a failed `importDecisions`, such as a transfer error leaving the item `importPending`. No test covers the upgrade-then-transfer-failure path from Finding 1. No test covers a malformed grabbed-data row.
- `web/src/pages/calendar/MonthView.tsx` [minor, 55%]: The "+N more" popover is a `role="dialog"` that takes focus on open but never closes on blur or Tab-out. It has no focus trap, and it is absolutely positioned inside a grid cell. The cell's roving-tabindex arrow-key handler (MonthView L199-206) can also move focus out while the panel stays open.
- `server/src/routes/calendar.ts` [minor, 50%]: The date-only fallback for episodes with a null `airDateUtc` compares `airDate` against the `startDay` and `endDay` slices of the UTC range. A range such as start=2026-10-01T00:00Z and end=2026-10-08T00:00Z includes null-UTC episodes dated the 8th, but excludes timed episodes airing later on the 8th. The calendar and the feed treat the two kinds of episode differently at the range edge.
- `server/src/import/decisions.ts` [major, 60%]: `upgradeRejection` only compares the new quality with the existing file's quality. It does not check the profile's `upgradeAllowed` flag or whether the existing file already meets the cutoff. A file better than the existing one is approved and replaces it even when the profile disallows upgrades or the cutoff is already met.
- `server/src/services/wanted.ts` [minor, 50%]: `listMissing` hard-excludes season 0 (`seasonNumber > 0`), so monitored, aired specials without a file never appear in Wanted. `listCutoffUnmet` does include specials, so the two lists are inconsistent.
- `server/src/import/decisions.ts` [minor, 50%]: The already-imported check rejects any file whose size equals that of an `episodeFiles` row at the destination path. A genuinely different release or upgrade with the same byte size and the same destination name is rejected as `alreadyImported`.
- `server/src/import/importer.ts` [major, 75%]: Only `transferFile` is wrapped in try/catch. After the transfer, `fs.promises.stat(importedPath)` and `upsertEpisodeFile` run unguarded, and so does `importOne` inside the `importDecisions` loop. `replaceOldFile` has already deleted or recycled the old file and dropped its row by that point. If `stat` or `upsertEpisodeFile` throws (for example a DB constraint error or the file vanishing), the new file is left on disk with no episode_file row and no history event, and the old file is gone. The exception then escapes `importDecisions`. The remaining decisions are skipped, and callers other than ManualImport get no per-file results.
- `server/src/import/importer.ts` [minor, 60%]: If `replaceOldFile` throws, the catch only calls `unlinkEpisodeFile`. It writes no `episodeFileDeleted` event and publishes no `episodefile` "deleted" event. The old file stays on disk as an orphan. When that file occupies the destination name, line 134 never renames the new file, so it keeps the " (n)" suffix.
- `server/src/services/wanted.ts` [minor, 60%]: `json_extract(episodeFiles.quality, '$.quality.id')` throws "malformed JSON" in SQLite if any single episode file row holds invalid JSON. That makes the whole cutoff-unmet query fail with a 500 for every page. Before the rewrite, parse errors could be handled per row. The WHERE clause also has no `json_valid` guard.
- `server/src/routes/manualimport.ts` [minor, 50%]: Per-file failures are collected into `lines`, but the command always completes normally. A run that imports 0 of N files is reported as a successful command, with the failure text only in the message.
- `server/src/import/importer.test.ts` [minor, 60%]: F-004 is resolved. The test "an upgrade whose old file holds the exact destination name ends up at that name" covers the transfer-before-replace path at importer.ts 117-141. It checks the final name, the single directory entry, the content, the single DB row with the correct path and relativePath, and the episode link. The test "a failed transfer during an upgrade keeps the old file, its row and link" covers the failed-transfer case. It checks that the old file, its row, the link and the source survive, and that the history is unchanged with no `episodeFileDeleted`. Two sibling branches are still untested. One is the `catch` at importer.ts 138-140, where the move to the destination name fails and the file keeps its " (n)" name. The other is the `catch` at 128-131, where `replaceOldFile` throws, the row is unlinked and the old file stays on disk. The exact-destination test also does not check history. It does not confirm that `episodeFileDeleted` is recorded exactly once, or that the recycle-bin variant of the same-name upgrade works.

## Fixes Applied
- cycle 1: engineering-backend-architect on F-001, F-002, F-003 (done); checks 24/24 passed
- cycle 2: engineering-backend-architect on F-004 (done); checks 24/24 passed
- minor findings: engineering-backend-architect on F-002, F-004, F-005, F-008, F-011 (done); engineering-frontend-developer on F-009, F-010, F-013 (done); left as is: F-004: not fixed. Skipping already-imported files or backing off retries is a design decision, and it needs new test scenarios in `queue.ts`. I did not check whether `getImportDecisions` already filters already-imported files. / F-008: not fixed. Moving `pagingSchema` and `bool` into a shared module means editing `routes/history.ts` and `routes/calendar.ts`, and neither is in the writable list. The finding is also advisory. / F-002 rollback: the move-mode orphan is logged at error level but not rolled back. Rollback would be a design decision. / F-010 (move the popover outside the grid via a portal): not done, because it is a structural change that needs a design decision. / F-010 (focus return on close): the code already returns focus to the "+N more" trigger on Escape and on the Close button (`close()` in MorePopover), so I changed nothing. Closing by outside click deliberately leaves focus where the user clicked.; checks 24/24 passed, 6 file(s) changed

## Cycle Delta
- cycle 1: 3 must-fix, 0 suggestions, 17 deferred, 0 dropped (low confidence)
- cycle 2: 1 must-fix (resolved 3, new 1, unchanged 0), 0 suggestions, 4 deferred, 0 dropped (low confidence)
- cycle 3: 0 must-fix (resolved 1, new 0, unchanged 0), 0 suggestions, 1 deferred, 0 dropped (low confidence)

## Coverage
No coverage data found (looked for coverage/coverage-summary.json, coverage-summary.json, coverage/lcov.info, lcov.info, coverage.xml, coverage/cobertura-coverage.xml, coverage/coverage.xml, coverage.txt, coverage/coverage.txt). Advisory only: run the test suite with coverage to check review.coverage_thresholds.
