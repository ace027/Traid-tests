# Phase 4: Import, Activity, Wanted and Calendar — Review Fixes

Fixes applied by the review loop, one section per cycle. Re-review decides whether each one holds.

## Cycle 1

**Date**: 2026-10-13
**Checks**: 24/24 passed
**Files changed**: `server/src/import/importer.ts`, `server/src/routes/manualimport.ts`, `server/src/services/wanted.ts`

| Finding | Severity | File | Agent | Status | Notes |
|---------|----------|------|-------|--------|-------|
| F-001 | major | `server/src/import/importer.ts` | engineering-backend-architect | fix applied | F-001 to F-003 are fixed. - F-001: `importOne` now transfers first, so a failed transfer leaves the old file, its DB row and its history untouched. It then replaces every old file and renames the new file onto the exact destination name when an old file held it. - F-002: each file in the ManualImport loop is wrapped in try/catch, and an error adds a `name: message` line and the loop continues. The summary is always produced. - F-003: `listCutoffUnmet` is now one SQL query with joins to `episodeFiles` and `qualityProfiles`. It compares CASE-based quality weights, using `json_extract(quality, '$.quality.id')` for the file. Count, order, limit and offset run in SQL, with no inlined id list. |
| F-002 | major | `server/src/routes/manualimport.ts` | engineering-backend-architect | fix applied | F-001 to F-003 are fixed. - F-001: `importOne` now transfers first, so a failed transfer leaves the old file, its DB row and its history untouched. It then replaces every old file and renames the new file onto the exact destination name when an old file held it. - F-002: each file in the ManualImport loop is wrapped in try/catch, and an error adds a `name: message` line and the loop continues. The summary is always produced. - F-003: `listCutoffUnmet` is now one SQL query with joins to `episodeFiles` and `qualityProfiles`. It compares CASE-based quality weights, using `json_extract(quality, '$.quality.id')` for the file. Count, order, limit and offset run in SQL, with no inlined id list. |
| F-003 | major | `server/src/services/wanted.ts` | engineering-backend-architect | fix applied | F-001 to F-003 are fixed. - F-001: `importOne` now transfers first, so a failed transfer leaves the old file, its DB row and its history untouched. It then replaces every old file and renames the new file onto the exact destination name when an old file held it. - F-002: each file in the ManualImport loop is wrapped in try/catch, and an error adds a `name: message` line and the loop continues. The summary is always produced. - F-003: `listCutoffUnmet` is now one SQL query with joins to `episodeFiles` and `qualityProfiles`. It compares CASE-based quality weights, using `json_extract(quality, '$.quality.id')` for the file. Count, order, limit and offset run in SQL, with no inlined id list. |

## Cycle 2

**Date**: 2026-10-13
**Checks**: 24/24 passed
**Files changed**: `server/src/import/importer.test.ts`

| Finding | Severity | File | Agent | Status | Notes |
|---------|----------|------|-------|--------|-------|
| F-004 | major | `server/src/import/importer.test.ts` | engineering-backend-architect | fix applied | Added the two tests for F-004 to importer.test.ts. The first covers an upgrade whose old file holds the exact destination name. The second covers a failed transfer during an upgrade. - Same-name test: the naming format has no quality token, so the old file's path equals the computed destination. It asserts the final path is the exact destination, one file in the season folder, one `episodeFiles` row pointing to it, and the episode linked to that row. - Failed-transfer test: `rename` is mocked to fail with EROFS. It asserts the old file, its `episodeFiles` row and its episode link survive, the source is untouched, and history has no new events (so no `episodeFileDeleted`). |
