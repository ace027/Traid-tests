# Phase 2: Series Library — Review Fixes

Fixes applied by the review loop, one section per cycle. Re-review decides whether each one holds.

## Cycle 1

**Date**: 2026-10-13
**Checks**: 16/16 passed
**Files changed**: `server/src/routes/rootfolder.ts`, `server/src/services/diskScan.test.ts`, `server/src/services/diskScan.ts`, `server/src/services/episodes.ts`, `server/src/services/series.ts`, `server/src/services/paths.ts`

| Finding | Severity | File | Agent | Status | Notes |
|---------|----------|------|-------|--------|-------|
| F-001 | critical | `server/src/services/diskScan.ts` | engineering-backend-architect | fix applied | F-001 fixed. `walk()` now returns `rootUnreadable` when the root `opendir` fails. `scanSeries` throws and removes nothing in two cases: that flag is set, or `realpathSync(series.path)` fails, and rows exist in both. Sub-directory read errors still just skip that directory. A missing folder with no existing rows still completes quietly. The removal path in the missing-folder case is gone, along with the `removeRows` helper. |
| F-002 | major | `server/src/services/series.ts (also server/src/services/diskScan.ts, server/src/services/episodes.ts, server/src/routes/rootfolder.ts)` | engineering-senior-developer | fix applied | Added server/src/services/paths.ts with isInside, realpathLoose and realRootFolders. realRootFolders has one return shape, `{path, real}[]`. series.ts, diskScan.ts, episodes.ts and rootfolder.ts now import from it, and the four local copies are gone, including `isStrictlyInside` in episodes.ts. In diskScan.ts the root-folder check now reads `r.real`. I also removed the imports this left unused (`Db` in diskScan.ts, `path` in episodes.ts). Nothing outside the four named files plus the new one was touched. |

## Cycle 2

**Date**: 2026-10-13
**Checks**: 16/16 passed
**Files changed**: `server/src/services/diskScan.test.ts`, `server/src/services/diskScan.ts`

| Finding | Severity | File | Agent | Status | Notes |
|---------|----------|------|-------|--------|-------|
| F-005 | major | `server/src/services/diskScan.ts` | engineering-backend-architect | fix applied | F-005 fixed. walk() now records unreadable subdirectories, and the scan records files whose stat failed. The sweep keeps any `episode_files` row under an unreadable directory or with a failed stat, and no longer unlinks it or counts it in `removed`. Files that are unparsed, duplicates or really gone still get deleted as before. The new test cannot exercise the fix here: the sandbox runs as root, so it returns early like the existing root-chmod test. |

## Cycle 3

**Date**: 2026-10-13
**Checks**: 16/16 passed
**Files changed**: `server/src/services/diskScan.test.ts`

| Finding | Severity | File | Agent | Status | Notes |
|---------|----------|------|-------|--------|-------|
| F-007 | major | `server/src/services/diskScan.test.ts` | engineering-backend-architect | fix applied | F-007 fixed. The unreadable-subfolder test now mocks `fs.promises.opendir` instead of using chmod. A new test mocks `fs.promises.stat` to fail for one file, which covers `statFailed`. I added an unreadable-root-folder test using `opendir` mocked to fail, and the chmod root test is kept under `it.skipIf(isRoot)` so a skip shows in the output. The new tests assert that rows and `episodeFileId` are kept and that the message reports 0 removed. I removed the `statFailed`/`unreadableDirs` guard at diskScan.ts:297 temporarily, and the subfolder and stat tests both failed. I restored it afterwards. |
