# Plan 02-03 Summary: Episodes API, refresh and disk scan commands, library import

## Result
**Status**: Complete with Warnings
**Wave**: 2
**Agent**: engineering-backend-architect
**Completed**: 2026-10-13

## Agent Selection Rationale

| Candidate | Semantic | Heuristic | Memory | Total | Source |
|-----------|----------|-----------|--------|-------|--------|
| engineering-backend-architect | — | 10 | 3.38 | 13.379999999999999 | mandatory |
| engineering-senior-developer | — | 17 | 4 | 21 | heuristic |
| testing-qa-verification-specialist | — | 14 | 3.5 | 17.5 | heuristic |

- **Task type detected**: implementation
- **Confidence**: LOW
- **Adapter**: claude-code
- **Model tier**: sonnet

## Completed Tasks
- [x] Task 1: Episodes and episode files API (done)
- [x] Task 2: RefreshSeries and RescanSeries commands (done)
- [x] Task 3: Library import: unmapped folders (done)

## Files Modified
- `server/src/app.ts`
- `server/src/routes/episode.test.ts`
- `server/src/routes/episode.ts`
- `server/src/routes/episodefile.ts`
- `server/src/routes/rootfolder.test.ts`
- `server/src/routes/rootfolder.ts`
- `server/src/services/diskScan.test.ts`
- `server/src/services/diskScan.ts`
- `server/src/services/episodes.ts`
- `server/src/services/refresh.test.ts`
- `server/src/services/refresh.ts`

## Verification Results
6/6 verification commands passed (run by Triad after the agent finished).

## Verification Commands
| Command | Exit Code | Result |
|---------|-----------|--------|
| `npm run typecheck` | 0 | PASS |
| `npm test -w @sonarr/server` | 0 | PASS |
| `npm test -w @sonarr/server -- episode` | 0 | PASS |
| `npm test -w @sonarr/server -- refresh diskScan` | 0 | PASS |
| `npm test -w @sonarr/server -- rootfolder` | 0 | PASS |
| `npm run typecheck -w @sonarr/server` | 0 | PASS |

## Key Decisions
- Scan matching tries the filename first. If that yields no episode info and the parent folder is 'Season N' or 'Specials', a small fallback reads "E02", "02" or " - 02" from the filename. That fallback is my own addition, not from the plan.
- Anime absolute numbers use the stored absolute_episode_number. If no episode has one, an ordinal over season > 0 episodes is used instead.
- Duplicates: candidates are sorted by size descending, then path. A candidate is dropped and reported as an unparsed duplicate if any of its episodes is already claimed.
- Rows for files that were rejected or have disappeared are deleted, and their episodes are unlinked. If the walk hit the 20000-entry cap, rows for files that still exist on disk are kept.
- If the series folder is missing, add_options is left untouched and the scan returns early.
- RefreshSeries enqueues RescanSeries after its loop even when some series failed, then throws with the collected errors. With a single seriesId the original error is rethrown, so the message is 'Series folder is outside root folders' for the confinement failure.
- Episode events: single PUT publishes the episode resource. Bulk monitor, file delete and scan publish {episodeIds or seriesId, ...}. Scans publish 'episodefile' and 'episode' updated only when something changed, and 'series' updated always.
- Directories named extras, featurettes, @eaDir, #recycle, $recycle.bin and lost+found are skipped during the walk, as are dot-entries.

## Issues Encountered
- None. The planned file list was enough.

## Escalations
| # | Severity | Type | Decision | Status | Resolution |
|---|----------|------|----------|--------|------------|
| 1 | info | shared-contract | shared/src/schemas.ts rootFolderSchema.unmappedFolders is typed {name, path} and lacks relativePath | pending | INVALID: type "shared-contract" is not one of architecture, dependency, scope, schema, api, deletion, infrastructure, quality |

- #1 context: The API returns relativePath as the plan requires. I did not edit shared/ because it is forbidden. Someone with authority over shared/ should add relativePath so the web client types match.

## Handoff Context
- **Key outputs**: server/src/app.ts; server/src/routes/episode.test.ts; server/src/routes/episode.ts; server/src/routes/episodefile.ts; server/src/routes/rootfolder.test.ts; server/src/routes/rootfolder.ts; server/src/services/diskScan.test.ts; server/src/services/diskScan.ts; server/src/services/episodes.ts; server/src/services/refresh.test.ts; server/src/services/refresh.ts
- **Decisions made**: Scan matching tries the filename first. If that yields no episode info and the parent folder is 'Season N' or 'Specials', a small fallback reads "E02", "02" or " - 02" from the filename. That fallback is my own addition, not from the plan.; Anime absolute numbers use the stored absolute_episode_number. If no episode has one, an ordinal over season > 0 episodes is used instead.; Duplicates: candidates are sorted by size descending, then path. A candidate is dropped and reported as an unparsed duplicate if any of its episodes is already claimed.; Rows for files that were rejected or have disappeared are deleted, and their episodes are unlinked. If the walk hit the 20000-entry cap, rows for files that still exist on disk are kept.; If the series folder is missing, add_options is left untouched and the scan returns early.; RefreshSeries enqueues RescanSeries after its loop even when some series failed, then throws with the collected errors. With a single seriesId the original error is rethrown, so the message is 'Series folder is outside root folders' for the confinement failure.; Episode events: single PUT publishes the episode resource. Bulk monitor, file delete and scan publish {episodeIds or seriesId, ...}. Scans publish 'episodefile' and 'episode' updated only when something changed, and 'series' updated always.; Directories named extras, featurettes, @eaDir, #recycle, $recycle.bin and lost+found are skipped during the walk, as are dot-entries.
- **Open questions**: (none)
- **Conventions established**: The RescanSeries and RefreshSeries commands are registered in app.ts. addSeries already enqueues RescanSeries, so a new series is scanned automatically once it exists.; Command messages: the scan message reads "Scanned N series: X added, Y updated, Z removed, U unparsed" followed by up to 10 unparsed file lines.; Episode event payloads are described under decisions, for the web event-to-query-key mapping.; unmappedFolders items now carry relativePath, but the shared RootFolder type only has {name, path}. A local type in rootfolder.ts covers it.; GET /api/v3/episodefile also accepts episodeFileIds=1,2.

## Requirements Covered
- REQ-06
- REQ-07

## Token Usage
20 requests, 1116073 input tokens (1032621 cached), 38711 output tokens, $0.8022
