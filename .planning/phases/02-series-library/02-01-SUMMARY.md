# Plan 02-01 Summary: Series data model, TVmaze provider and series API

## Result
**Status**: Partial
**Wave**: 1
**Agent**: engineering-backend-architect
**Completed**: 2026-10-13
**Failure Class**: BLOCKER — AssertionError: expected { n: 3 } to deeply equal { n: 2 }

## Agent Selection Rationale

| Candidate | Semantic | Heuristic | Memory | Total | Source |
|-----------|----------|-----------|--------|-------|--------|
| engineering-backend-architect | — | 12 | 4.25 | 16.25 | mandatory |
| engineering-senior-developer | — | 21 | 3.75 | 24.75 | heuristic |
| testing-qa-verification-specialist | — | 18 | 3.5 | 21.5 | heuristic |

- **Task type detected**: implementation
- **Confidence**: LOW
- **Adapter**: claude-code
- **Model tier**: sonnet

## Completed Tasks
- [x] Task 1: Schema, shared types and monitoring (done)
- [x] Task 2: TVmaze metadata provider and fake (done)
- [x] Task 3: Series service and /api/v3/series routes (done)

## Files Modified
- `server/src/app.ts`
- `server/src/db/migrations/0003_series.sql`
- `server/src/db/schema.ts`
- `server/src/routes/quality.ts`
- `server/src/routes/series.test.ts`
- `server/src/routes/series.ts`
- `server/src/routes/tag.ts`
- `server/src/services/metadata/tvmaze.test.ts`
- `server/src/services/metadata/tvmaze.ts`
- `server/src/services/metadata/types.ts`
- `server/src/services/series.ts`
- `server/src/test/fakeMetadata.ts`
- `server/src/test/helpers.ts`
- `shared/src/index.ts`
- `shared/src/monitoring.test.ts`
- `shared/src/monitoring.ts`
- `shared/src/series.ts`

## Verification Results
6/7 verification commands passed (run by Triad after the agent finished).

## Verification Commands
| Command | Exit Code | Result |
|---------|-----------|--------|
| `npm run typecheck` | 0 | PASS |
| `npm test -w @sonarr/shared` | 0 | PASS |
| `npm test -w @sonarr/server` | 1 | FAIL |
| `npm run typecheck -w @sonarr/shared` | 0 | PASS |
| `npm test -w @sonarr/server -- tvmaze` | 0 | PASS |
| `npm run typecheck -w @sonarr/server` | 0 | PASS |
| `npm test -w @sonarr/server -- series` | 0 | PASS |

## Key Decisions
- lookup 404 or no hit returns []. Provider 404 on add returns 400 on tvMazeId. Other provider errors return 503.
- Duplicate tvmaze/tvdb ids return 400 with propertyName tvdbId. Explicit paths use realpath of the nearest existing ancestor.
- titleSlug collision tries -year, then -2, -3. A folder path collision appends " (tvmazeId)". No premiere year gives a folder name without a year.
- air_date_utc is stored normalized to toISOString so statistics can compare strings.
- Statistics come from two grouped queries. seasonCount excludes season 0. percentOfEpisodes is capped at 100, and is 100 when episodeCount is 0.
- Series.tvdbId is returned as 0 when the DB value is null.
- deleteFiles=true on a folder outside the root folders returns 400 and deletes nothing.
- The quality-profile in-use check runs before the last-profile check.
- Tags are validated to exist on add and update.
- TvMazeProvider takes extra injectable options: sleep and now.
- Fanart is only used if the show payload embeds images. The provider does not request them, so fanart is omitted today.

## Issues Encountered
- server/src/app.test.ts is not in my write list. Its "records each migration once" test and its migration-count test (expects n: 2) now fail because 0003_series exists.
- BLOCKER: AssertionError: expected { n: 3 } to deeply equal { n: 2 }

## Escalations
| # | Severity | Type | Decision | Status | Resolution |
|---|----------|------|----------|--------|------------|
| 1 | warning | out-of-scope file | update server/src/app.test.ts so the expected migrations are [0001_initial, 0002_auth, 0003_series] and the count is 3 | approved | Autonomous run default: approved (same change as #2: app.test.ts migration expectations). |
| 2 | blocker | schema | Resolve: AssertionError: expected { n: 3 } to deeply equal { n: 2 } | approved | Autonomous run default: approved updating server/src/app.test.ts migration expectations to [0001_initial, 0002_auth, 0003_series] and count 3; it is a mechanical consequence of the planned migration 0003. |

- #1 context: This is a mechanical two-line change forced by the new migration, but the file is not in files_modified. Please approve it or apply it.
- #2 context: Verification failed (npm test -w @sonarr/server); a BLOCKER is not auto-fixed.

## Handoff Context
- **Key outputs**: server/src/app.ts; server/src/db/migrations/0003_series.sql; server/src/db/schema.ts; server/src/routes/quality.ts; server/src/routes/series.test.ts; server/src/routes/series.ts; server/src/routes/tag.ts; server/src/services/metadata/tvmaze.test.ts; server/src/services/metadata/tvmaze.ts; server/src/services/metadata/types.ts; server/src/services/series.ts; server/src/test/fakeMetadata.ts; server/src/test/helpers.ts; shared/src/index.ts; shared/src/monitoring.test.ts; shared/src/monitoring.ts; shared/src/series.ts
- **Decisions made**: lookup 404 or no hit returns []. Provider 404 on add returns 400 on tvMazeId. Other provider errors return 503.; Duplicate tvmaze/tvdb ids return 400 with propertyName tvdbId. Explicit paths use realpath of the nearest existing ancestor.; titleSlug collision tries -year, then -2, -3. A folder path collision appends " (tvmazeId)". No premiere year gives a folder name without a year.; air_date_utc is stored normalized to toISOString so statistics can compare strings.; Statistics come from two grouped queries. seasonCount excludes season 0. percentOfEpisodes is capped at 100, and is 100 when episodeCount is 0.; Series.tvdbId is returned as 0 when the DB value is null.; deleteFiles=true on a folder outside the root folders returns 400 and deletes nothing.; The quality-profile in-use check runs before the last-profile check.; Tags are validated to exist on add and update.; TvMazeProvider takes extra injectable options: sleep and now.; Fanart is only used if the show payload embeds images. The provider does not request them, so fanart is omitted today.
- **Open questions**: (none)
- **Conventions established**: Use app.metadata (MetadataProvider) in refresh commands; getSeries returns the series plus ProviderEpisode[]. Tests use createTestApp({metadataProvider}) and the exported FakeMetadataProvider (addEpisode, removeEpisode, failWith).; RescanSeries is enqueued after add with {seriesId} if registered. series.add_options is stored as JSON, and the first rescan should apply it with file knowledge and then clear it.; services/series.ts exports getSeriesStatistics, getSeries, toApiSeries, listSeries. episode_files.quality is a JSON string.; Event names used: series created/updated/deleted.; Whoever owns the migration list must update server/src/app.test.ts to include 0003_series and a count of 3.

## Requirements Covered
- REQ-05
- REQ-06

### Failed verification output
`npm test -w @sonarr/server`
```
   },
  ]

 ❯ src/app.test.ts:76:18
     74|     t = await createTestApp();
     75|     const rows = t.app.sqlite.prepare('select version from schema_migr…
     76|     expect(rows).toEqual([{ version: '0001_initial' }, { version: '000…
       |                  ^
     77|   });
     78|

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 FAIL  src/app.test.ts > server core > keeps the api key across restarts and creates a missing data dir
AssertionError: expected { n: 3 } to deeply equal { n: 2 }

- Expected
+ Received

  {
-   "n": 2,
+   "n": 3,
  }

 ❯ src/app.test.ts:89:20
     87|       expect(getHostConfig(b.db).apiKey).toBe(key);
     88|       const rows = b.sqlite.prepare('select count(*) as n from schema_…
     89|       expect(rows).toEqual({ n: 2 });
       |                    ^
     90|       await b.close();
     91|     } finally {

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯


 Test Files  1 failed | 11 passed (12)
      Tests  2 failed | 254 passed (256)
   Start at  01:41:35
   Duration  5.56s (tests 62%, import 36%, transform 1%)

    Isolate  12 workers spawned · ~130ms startup each (spawn + environment, per file)
             at least ~391ms faster with isolate: false — reuses workers across files instead of one per file

npm error Lifecycle script `test` failed with error:
npm error code 1
npm error path /home/user/Traid-tests/server
npm error workspace @sonarr/server@0.1.0
npm error location /home/user/Traid-tests/server
npm error command failed
npm error command sh -c vitest run

```

## Token Usage
16 requests, 820345 input tokens (750379 cached), 40546 output tokens, $0.7304
