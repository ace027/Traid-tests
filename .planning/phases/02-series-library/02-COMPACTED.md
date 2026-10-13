---
phase: 02-series-library
compacted: 2026-10-13
original_summaries: [02-01-SUMMARY.md, 02-02-SUMMARY.md, 02-03-SUMMARY.md, 02-04-SUMMARY.md]
requirements_satisfied: [REQ-05, REQ-06, REQ-07, REQ-03]
---

# Phase 2: Series Library — Compacted Summary

## Deliverables
- 02-01 Series data model, TVmaze provider and series API (Complete): server/src/app.test.ts
- 02-02 Filename and release title parser (Complete): server/src/parser/index.ts, server/src/parser/parser.test.ts, server/src/parser/parser.ts, server/src/parser/quality.test.ts, server/src/parser/quality.ts, server/src/parser/types.ts
- 02-03 Episodes API, refresh and disk scan commands, library import (Complete with Warnings): server/src/app.ts, server/src/routes/episode.test.ts, server/src/routes/episode.ts, server/src/routes/episodefile.ts, server/src/routes/rootfolder.test.ts, server/src/routes/rootfolder.ts, server/src/services/diskScan.test.ts, server/src/services/diskScan.ts, server/src/services/episodes.ts, server/src/services/refresh.test.ts, server/src/services/refresh.ts
- 02-04 Series UI: add, library import, index and detail (Complete): web/src/components/layout/CommandPalette.tsx, web/src/lib/api.ts, web/src/lib/events.ts, web/src/pages/series/AddNew.tsx, web/src/pages/series/AddSeriesModal.tsx, web/src/pages/series/DeleteSeriesModal.tsx, web/src/pages/series/EditSeriesModal.tsx, web/src/pages/series/LibraryImport.tsx, web/src/pages/series/SeasonSection.tsx, web/src/pages/series/SeriesDetail.tsx, web/src/pages/series/SeriesIndex.tsx, web/src/pages/series/SeriesPoster.tsx, web/src/pages/series/fixtures.ts, web/src/pages/series/hooks.ts, web/src/pages/series/series.test.tsx, web/src/routes.tsx

## Decisions
- 02-02: Absolute-numbered (anime) and daily results use seasonNumber 0 and an empty episodeNumbers array. Match them with isAbsoluteNumbering plus absoluteEpisodeNumber
- 02-02: special is true for S00 episodes, and for absolute-numbered files under a folder named Specials. It is never true for daily.
- 02-02: I added an optional `year?: number` to ParsedEpisodeInfo. It is only set from a parenthesised "(2005)" suffix, which is stripped from seriesTitle. A bare year s
- 02-03: Scan matching tries the filename first. If that yields no episode info and the parent folder is 'Season N' or 'Specials', a small fallback reads "E02", "02" or 
- 02-03: Anime absolute numbers use the stored absolute_episode_number. If no episode has one, an ordinal over season > 0 episodes is used instead.
- 02-03: Duplicates: candidates are sorted by size descending, then path. A candidate is dropped and reported as an unparsed duplicate if any of its episodes is already 
- 02-04: 'Already in library' is found by matching lookup tvMazeId against the series list, because the server lookup returns no id; a lookup id is still honoured if one

## Conventions and Open Questions
- 02-01 convention: app.test.ts is now updated, so nothing is left out of scope.
- 02-01 convention: Series routes, the monitoring function and the provider fake are all in place for plan 02-03.
- 02-02 convention: Import with `import { parseTitle, parseQuality } from '../parser/index.js'`. The disk scan should match files in this order: airDate for daily, absoluteEpisodeN
- 02-02 convention: parseTitle accepts a full path or a bare filename. It returns null for unparseable files, so the scan can report them.
- 02-02 convention: quality is { quality: <shared QUALITIES object>, revision: { version, real, isRepack } }, which matches the episode_files.quality JSON shape in the phase contex
- 02-03 convention: The RescanSeries and RefreshSeries commands are registered in app.ts. addSeries already enqueues RescanSeries, so a new series is scanned automatically once it 
- 02-03 convention: Command messages: the scan message reads "Scanned N series: X added, Y updated, Z removed, U unparsed" followed by up to 10 unparsed file lines.
- 02-03 convention: Episode event payloads are described under decisions, for the web event-to-query-key mapping.
- 02-04 convention: queryKeys.series, seriesDetail(id), seriesLookup(term), episodes(seriesId) and episodeFiles(seriesId) exist
- 02-04 convention: episode keys use the ['episode', seriesId] prefix.

## Files Modified
| File | Change |
|------|--------|
| `server/src/app.test.ts` | 02-01: Series data model, TVmaze provider and series API |
| `server/src/parser/index.ts` | 02-02: Filename and release title parser |
| `server/src/parser/parser.test.ts` | 02-02: Filename and release title parser |
| `server/src/parser/parser.ts` | 02-02: Filename and release title parser |
| `server/src/parser/quality.test.ts` | 02-02: Filename and release title parser |
| `server/src/parser/quality.ts` | 02-02: Filename and release title parser |
| `server/src/parser/types.ts` | 02-02: Filename and release title parser |
| `server/src/app.ts` | 02-03: Episodes API, refresh and disk scan commands, library import |
| `server/src/routes/episode.test.ts` | 02-03: Episodes API, refresh and disk scan commands, library import |
| `server/src/routes/episode.ts` | 02-03: Episodes API, refresh and disk scan commands, library import |
| `server/src/routes/episodefile.ts` | 02-03: Episodes API, refresh and disk scan commands, library import |
| `server/src/routes/rootfolder.test.ts` | 02-03: Episodes API, refresh and disk scan commands, library import |
| `server/src/routes/rootfolder.ts` | 02-03: Episodes API, refresh and disk scan commands, library import |
| `server/src/services/diskScan.test.ts` | 02-03: Episodes API, refresh and disk scan commands, library import |
| `server/src/services/diskScan.ts` | 02-03: Episodes API, refresh and disk scan commands, library import |
| `server/src/services/episodes.ts` | 02-03: Episodes API, refresh and disk scan commands, library import |
| `server/src/services/refresh.test.ts` | 02-03: Episodes API, refresh and disk scan commands, library import |
| `server/src/services/refresh.ts` | 02-03: Episodes API, refresh and disk scan commands, library import |
| `web/src/components/layout/CommandPalette.tsx` | 02-04: Series UI: add, library import, index and detail |
| `web/src/lib/api.ts` | 02-04: Series UI: add, library import, index and detail |
| `web/src/lib/events.ts` | 02-04: Series UI: add, library import, index and detail |
| `web/src/pages/series/AddNew.tsx` | 02-04: Series UI: add, library import, index and detail |
| `web/src/pages/series/AddSeriesModal.tsx` | 02-04: Series UI: add, library import, index and detail |
| `web/src/pages/series/DeleteSeriesModal.tsx` | 02-04: Series UI: add, library import, index and detail |
| `web/src/pages/series/EditSeriesModal.tsx` | 02-04: Series UI: add, library import, index and detail |
| `web/src/pages/series/LibraryImport.tsx` | 02-04: Series UI: add, library import, index and detail |
| `web/src/pages/series/SeasonSection.tsx` | 02-04: Series UI: add, library import, index and detail |
| `web/src/pages/series/SeriesDetail.tsx` | 02-04: Series UI: add, library import, index and detail |
| `web/src/pages/series/SeriesIndex.tsx` | 02-04: Series UI: add, library import, index and detail |
| `web/src/pages/series/SeriesPoster.tsx` | 02-04: Series UI: add, library import, index and detail |
| `web/src/pages/series/fixtures.ts` | 02-04: Series UI: add, library import, index and detail |
| `web/src/pages/series/hooks.ts` | 02-04: Series UI: add, library import, index and detail |
| `web/src/pages/series/series.test.tsx` | 02-04: Series UI: add, library import, index and detail |
| `web/src/routes.tsx` | 02-04: Series UI: add, library import, index and detail |

## Verification
- 02-01 (REQ-05, REQ-06): 7/7 verification commands passed
- 02-02 (REQ-07): 3/3 verification commands passed
- 02-03 (REQ-06, REQ-07): 6/6 verification commands passed
- 02-04 (REQ-05, REQ-06, REQ-03): 4/4 verification commands passed

## Agents
- 02-01: engineering-backend-architect
- 02-02: engineering-senior-developer
- 02-03: engineering-backend-architect
- 02-04: engineering-frontend-developer

## Also Covered
- server/src/db/migrations/0003_series.sql
- server/src/db/schema.ts
- shared/src/series.ts
- shared/src/monitoring.ts
- shared/src/monitoring.test.ts
- shared/src/index.ts
- server/src/services/metadata/types.ts
- server/src/services/metadata/tvmaze.ts
- server/src/services/metadata/tvmaze.test.ts
- server/src/test/fakeMetadata.ts
- server/src/test/helpers.ts
- server/src/services/series.ts
- server/src/routes/series.ts
- server/src/routes/series.test.ts
- server/src/routes/quality.ts
- server/src/routes/tag.ts
