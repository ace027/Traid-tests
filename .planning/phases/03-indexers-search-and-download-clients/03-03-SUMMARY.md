# Plan 03-03 Summary: Download clients and queue tracking

## Result
**Status**: Complete
**Wave**: 2
**Agent**: engineering-backend-architect
**Completed**: 2026-10-13

## Agent Selection Rationale

| Candidate | Semantic | Heuristic | Memory | Total | Source |
|-----------|----------|-----------|--------|-------|--------|
| engineering-backend-architect | — | 11 | 3.17 | 14.17 | mandatory |
| engineering-senior-developer | — | 23 | 4.25 | 27.25 | heuristic |
| testing-qa-verification-specialist | — | 16 | 3.83 | 19.83 | heuristic |

- **Task type detected**: implementation
- **Confidence**: LOW
- **Adapter**: claude-code
- **Model tier**: sonnet

## Completed Tasks
- [x] Task 1: Client implementations (done)
- [x] Task 2: Download client API and registry (done)
- [x] Task 3: Tracked downloads and queue API (done)

## Files Modified
- `server/src/downloadClients/bencode.ts`
- `server/src/downloadClients/clients.test.ts`
- `server/src/downloadClients/nzbget.ts`
- `server/src/downloadClients/qbittorrent.ts`
- `server/src/downloadClients/registry.ts`
- `server/src/downloadClients/sabnzbd.ts`
- `server/src/downloadClients/transmission.ts`
- `server/src/downloadClients/types.ts`
- `server/src/routes/downloadclient.test.ts`
- `server/src/routes/downloadclient.ts`
- `server/src/services/queue.test.ts`
- `server/src/services/queue.ts`
- `server/src/test/fakeDownloadClient.ts`

## Verification Results
6/6 verification commands passed (run by Triad after the agent finished).

## Verification Commands
| Command | Exit Code | Result |
|---------|-----------|--------|
| `npm run typecheck` | 0 | PASS |
| `npm test -w @sonarr/server` | 0 | PASS |
| `npm test -w @sonarr/server -- clients` | 0 | PASS |
| `npm test -w @sonarr/server -- downloadclient` | 0 | PASS |
| `npm test -w @sonarr/server -- queue` | 0 | PASS |
| `npm run typecheck -w @sonarr/server` | 0 | PASS |

## Key Decisions
- DB stores implementation lowercase and the API uses the capitalised form. Factories receive a ClientConfig {id, name, implementation, settings} where settings is already parsed. createClient accepts either that or a DB row.
- clientFor(row) caches client instances per id and settings so qBittorrent cookies and Transmission session ids survive across polls. setDownloadClientFactory clears the cache.
- pickClient: clients sharing a tag with the series win. If none share one, untagged clients are used, and a tagged client is never used for an untagged series. Lowest priority value wins, and equal priorities rotate round-robin.
- registerQueue is idempotent, keyed on app.events, so 03-04 can call it from app.ts as well as through downloadClientRoutes without registering twice.
- Queue ids are in-memory per (clientId, downloadId). Download id matching against history tries exact, lowercase and uppercase.
- Removing with removeFromClient=false hides the item in memory only. It reappears after a restart.
- Queue list defaults to sortKey timeleft, ascending.
- /queue/status errors and warnings are booleans, as in Sonarr. Client-unreachable messages are available via QueueService.health() only.
- Testall returns 400 if any client fails. The test endpoint accepts an optional id so masked secrets resolve from the stored client.
- Transmission requests the extra torrent-get field 'error'. Only error code 3 maps to failed.
- qBittorrent sends both paused=false and stopped=false on add.

## Issues Encountered
- The root `npm run typecheck` ran past the 120 s tool timeout. The server workspace typecheck passed.

## Escalations
(none)

## Handoff Context
- **Key outputs**: server/src/downloadClients/bencode.ts; server/src/downloadClients/clients.test.ts; server/src/downloadClients/nzbget.ts; server/src/downloadClients/qbittorrent.ts; server/src/downloadClients/registry.ts; server/src/downloadClients/sabnzbd.ts; server/src/downloadClients/transmission.ts; server/src/downloadClients/types.ts; server/src/routes/downloadclient.test.ts; server/src/routes/downloadclient.ts; server/src/services/queue.test.ts; server/src/services/queue.ts; server/src/test/fakeDownloadClient.ts
- **Decisions made**: DB stores implementation lowercase and the API uses the capitalised form. Factories receive a ClientConfig {id, name, implementation, settings} where settings is already parsed. createClient accepts either that or a DB row.; clientFor(row) caches client instances per id and settings so qBittorrent cookies and Transmission session ids survive across polls. setDownloadClientFactory clears the cache.; pickClient: clients sharing a tag with the series win. If none share one, untagged clients are used, and a tagged client is never used for an untagged series. Lowest priority value wins, and equal priorities rotate round-robin.; registerQueue is idempotent, keyed on app.events, so 03-04 can call it from app.ts as well as through downloadClientRoutes without registering twice.; Queue ids are in-memory per (clientId, downloadId). Download id matching against history tries exact, lowercase and uppercase.; Removing with removeFromClient=false hides the item in memory only. It reappears after a restart.; Queue list defaults to sortKey timeleft, ascending.; /queue/status errors and warnings are booleans, as in Sonarr. Client-unreachable messages are available via QueueService.health() only.; Testall returns 400 if any client fails. The test endpoint accepts an optional id so masked secrets resolve from the stored client.; Transmission requests the extra torrent-get field 'error'. Only error code 3 maps to failed.; qBittorrent sends both paused=false and stopped=false on add.
- **Open questions**: (none)
- **Conventions established**: registerQueue(app) returns the QueueService. getQueue(app) is an alias and QueueService.refresh() forces a poll.; Tests and the grab flow can use setDownloadClientFactory((cfg) => fake) with FakeDownloadClient, and FakeDownloadClient.item({downloadId, ...}) to build items.; The grab flow (03-04) calls pickClient(db, protocol, seriesTags), then clientFor(row).addRelease(release, torrentFile?). It should store the returned id as downloadId via recordGrabbed, with data.indexer set so the queue shows the indexer. For torrents the queue matches case-insensitively.; Torrents without a magnet need the .torrent bytes passed as the second argument to addRelease. The client computes the info hash from them.; Completed items map to trackedDownloadState importPending. Phase 4 imports should use item.outputPath, canMoveFiles and canBeRemoved.; The queue publishes 'queue' updated and deleted events, and the route layer publishes 'downloadclient' created, updated and deleted.

## Requirements Covered
- REQ-11

## Token Usage
28 requests, 1971133 input tokens (1870810 cached), 65275 output tokens, $1.2777
