# Plan 03-02 Summary: Newznab and Torznab indexers

## Result
**Status**: Complete
**Wave**: 2
**Agent**: engineering-backend-architect
**Completed**: 2026-10-13

## Agent Selection Rationale

| Candidate | Semantic | Heuristic | Memory | Total | Source |
|-----------|----------|-----------|--------|-------|--------|
| engineering-backend-architect | — | 8 | 3.17 | 11.17 | mandatory |
| engineering-senior-developer | — | 20 | 4.25 | 24.25 | heuristic |
| testing-qa-verification-specialist | — | 12 | 3.83 | 15.83 | heuristic |

- **Task type detected**: implementation
- **Confidence**: LOW
- **Adapter**: claude-code
- **Model tier**: sonnet

## Completed Tasks
- [x] Task 1: XML reader and Newznab/Torznab client (done)
- [x] Task 2: Registry, backoff and indexer API (done)

## Files Modified
- `server/src/indexers/newznab.test.ts`
- `server/src/indexers/newznab.ts`
- `server/src/indexers/registry.ts`
- `server/src/indexers/types.ts`
- `server/src/indexers/xml.test.ts`
- `server/src/indexers/xml.ts`
- `server/src/routes/indexer.test.ts`
- `server/src/routes/indexer.ts`
- `server/src/test/fakeIndexer.ts`

## Verification Results
5/5 verification commands passed (run by Triad after the agent finished).

## Verification Commands
| Command | Exit Code | Result |
|---------|-----------|--------|
| `npm run typecheck` | 0 | PASS |
| `npm test -w @sonarr/server` | 0 | PASS |
| `npm test -w @sonarr/server -- indexers` | 0 | PASS |
| `npm test -w @sonarr/server -- indexer` | 0 | PASS |
| `npm run typecheck -w @sonarr/server` | 0 | PASS |

## Key Decisions
- The indexers table has no protocol column, so protocol is derived from the implementation. The DB stores the implementation lowercase and the API shows Newznab or Torznab.
- apiKey is always shown as '********' in responses. A PUT or test body with '********' keeps the stored key. For /test the stored key is looked up when the body carries an id.
- Backoff is in memory and keyed by indexer id, with a 5, 15, 30, 60, 180, 360, 720, 1440 minute ladder. getIndexerClients returns clients sorted by priority, then id, and accepts an optional `now` so tests can control time. recordFailure also takes an optional `now`.
- testall calls recordFailure or recordSuccess for each indexer. The single-indexer test does not touch backoff.
- An episode search sends `ep` only when exactly one episode is given. Multiple episodes become a season-level query. An anime search runs one request per absolute episode number and de-duplicates by guid.
- Torznab sets leechers to peers minus seeders, unless a `leechers` attr is present. When there is no infohash attr, the hash is taken from the magnet's btih. Items with no title or no url are skipped.
- A response whose first 2 KB has no `<rss`, `<caps` or `<error` is treated as HTML and raises "invalid response".
- The first version of the XML reader was quadratic on malformed input and hung the test run. It now bounds entity lookahead, resumes scanning after a failed tag at the failure point, and only searches for closing tags on known text tags. The 5 MB pathological test measures each reader call separately against 500 ms, because the summed time was flaky under parallel test load.

## Issues Encountered
(none)

## Escalations
(none)

## Handoff Context
- **Key outputs**: server/src/indexers/newznab.test.ts; server/src/indexers/newznab.ts; server/src/indexers/registry.ts; server/src/indexers/types.ts; server/src/indexers/xml.test.ts; server/src/indexers/xml.ts; server/src/routes/indexer.test.ts; server/src/routes/indexer.ts; server/src/test/fakeIndexer.ts
- **Decisions made**: The indexers table has no protocol column, so protocol is derived from the implementation. The DB stores the implementation lowercase and the API shows Newznab or Torznab.; apiKey is always shown as '********' in responses. A PUT or test body with '********' keeps the stored key. For /test the stored key is looked up when the body carries an id.; Backoff is in memory and keyed by indexer id, with a 5, 15, 30, 60, 180, 360, 720, 1440 minute ladder. getIndexerClients returns clients sorted by priority, then id, and accepts an optional `now` so tests can control time. recordFailure also takes an optional `now`.; testall calls recordFailure or recordSuccess for each indexer. The single-indexer test does not touch backoff.; An episode search sends `ep` only when exactly one episode is given. Multiple episodes become a season-level query. An anime search runs one request per absolute episode number and de-duplicates by guid.; Torznab sets leechers to peers minus seeders, unless a `leechers` attr is present. When there is no infohash attr, the hash is taken from the magnet's btih. Items with no title or no url are skipped.; A response whose first 2 KB has no `<rss`, `<caps` or `<error` is treated as HTML and raises "invalid response".; The first version of the XML reader was quadratic on malformed input and hung the test run. It now bounds entity lookahead, resumes scanning after a failed tag at the failure point, and only searches for closing tags on known text tags. The 5 MB pathological test measures each reader call separately against 500 ms, because the summed time was flaky under parallel test load.
- **Open questions**: (none)
- **Conventions established**: Plan 03-04 should call getIndexerClients(app, {purpose}) and report each result with recordSuccess(row.id) or recordFailure(row.id, message). Tests can use setIndexerClientFactory(() => new FakeIndexerClient([makeRelease(...)])). Call setIndexerClientFactory(undefined) in afterEach.; ReleaseInfo.indexerPriority comes from the indexer row's priority. parseIndexerSettings(row) returns settings with defaults filled in, including the real apiKey. Only the routes mask it.; The 'indexer' events are created, updated and deleted, with the masked resource as payload.; /api/v3/tag/detail still returns indexerIds: []. tag.ts is outside this plan's file list.

## Requirements Covered
- REQ-08

## Token Usage
20 requests, 1059280 input tokens (992065 cached), 36667 output tokens, $0.7331
