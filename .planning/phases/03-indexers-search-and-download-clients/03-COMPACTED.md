---
phase: 03-indexers-search-and-download-clients
compacted: 2026-10-13
original_summaries: [03-01-SUMMARY.md, 03-02-SUMMARY.md, 03-03-SUMMARY.md, 03-05-SUMMARY.md]
requirements_satisfied: [REQ-09, REQ-10, REQ-11, REQ-08, REQ-03]
---

# Phase 3: Indexers, Search and Download Clients — Compacted Summary

## Deliverables
- 03-01 Phase 3 foundations: schema, shared types, scheduler, history and blocklist (Complete): server/src/app.test.ts, server/src/app.ts, server/src/db/migrations/0004_indexers_downloads.sql, server/src/db/schema.ts, server/src/routes/blocklist.ts, server/src/routes/downloadclient.ts, server/src/routes/history.test.ts, server/src/routes/history.ts, server/src/routes/indexer.ts, server/src/routes/system.ts, server/src/services/blocklist.ts, server/src/services/history.ts, server/src/services/scheduler.test.ts, server/src/services/scheduler.ts, server/src/test/helpers.ts, shared/src/index.ts, shared/src/indexers.ts
- 03-02 Newznab and Torznab indexers (Complete): server/src/indexers/newznab.test.ts, server/src/indexers/newznab.ts, server/src/indexers/registry.ts, server/src/indexers/types.ts, server/src/indexers/xml.test.ts, server/src/indexers/xml.ts, server/src/routes/indexer.test.ts, server/src/routes/indexer.ts, server/src/test/fakeIndexer.ts
- 03-03 Download clients and queue tracking (Complete): server/src/downloadClients/bencode.ts, server/src/downloadClients/clients.test.ts, server/src/downloadClients/nzbget.ts, server/src/downloadClients/qbittorrent.ts, server/src/downloadClients/registry.ts, server/src/downloadClients/sabnzbd.ts, server/src/downloadClients/transmission.ts, server/src/downloadClients/types.ts, server/src/routes/downloadclient.test.ts, server/src/routes/downloadclient.ts, server/src/services/queue.test.ts, server/src/services/queue.ts, server/src/test/fakeDownloadClient.ts
- 03-05 Indexer, download client, queue and interactive search UI (Complete with Warnings): web/src/lib/api.ts, web/src/lib/events.ts, web/src/pages/activity/Queue.tsx, web/src/pages/activity/RemoveQueueItemModal.tsx, web/src/pages/activity/hooks.ts, web/src/pages/activity/queue.test.tsx, web/src/pages/series/InteractiveSearchModal.tsx, web/src/pages/series/SeasonSection.tsx, web/src/pages/series/SeriesDetail.tsx, web/src/pages/series/hooks.ts, web/src/pages/series/interactiveSearch.test.tsx, web/src/pages/settings/DownloadClientModal.tsx, web/src/pages/settings/DownloadClients.tsx, web/src/pages/settings/IndexerModal.tsx, web/src/pages/settings/Indexers.tsx, web/src/pages/settings/providers.test.tsx, web/src/routes.tsx

## Decisions
- 03-01: The scheduler subscribes to command events lazily on its first enqueue. A subscription made in the constructor failed events.test.ts, which expects exactly one 
- 03-01: Tasks whose command is not registered are skipped without advancing next_execution, so commands registered later run on the next tick.
- 03-01: If a command with the task's name is queued or started, tick skips the task. Completion, failure or abort of a scheduler-enqueued command sets last_execution to
- 03-02: The indexers table has no protocol column, so protocol is derived from the implementation. The DB stores the implementation lowercase and the API shows Newznab 
- 03-02: apiKey is always shown as '********' in responses. A PUT or test body with '********' keeps the stored key. For /test the stored key is looked up when the body 
- 03-02: Backoff is in memory and keyed by indexer id, with a 5, 15, 30, 60, 180, 360, 720, 1440 minute ladder. getIndexerClients returns clients sorted by priority, the
- 03-03: DB stores implementation lowercase and the API uses the capitalised form. Factories receive a ClientConfig {id, name, implementation, settings} where settings i
- 03-03: clientFor(row) caches client instances per id and settings so qBittorrent cookies and Transmission session ids survive across polls. setDownloadClientFactory cl
- 03-03: pickClient: clients sharing a tag with the series win. If none share one, untagged clients are used, and a tagged client is never used for an untagged series. L
- 03-05: There is no settings hooks file in my list, so indexer hooks and shared provider helpers live in settings/IndexerModal.tsx and client hooks in settings/Download

## Conventions and Open Questions
- 03-01 convention: Plan 03-02 fills indexerRoutes in server/src/routes/indexer.ts and plan 03-03 fills downloadClientRoutes in server/src/routes/downloadclient.ts. Both are alread
- 03-01 convention: The input schemas are indexerInputSchema and downloadClientInputSchema in @sonarr/shared. Resources store implementation lowercase in the DB and use the capital
- 03-01 convention: Plans 03-03 and 03-04 register their commands with app.commands.register using the names RssSync, RefreshMonitoredDownloads and RefreshSeries. The scheduler's f
- 03-02 convention: Plan 03-04 should call getIndexerClients(app, {purpose}) and report each result with recordSuccess(row.id) or recordFailure(row.id, message). Tests can use setI
- 03-02 convention: ReleaseInfo.indexerPriority comes from the indexer row's priority. parseIndexerSettings(row) returns settings with defaults filled in, including the real apiKey
- 03-02 convention: The 'indexer' events are created, updated and deleted, with the masked resource as payload.
- 03-03 convention: registerQueue(app) returns the QueueService. getQueue(app) is an alias and QueueService.refresh() forces a poll.
- 03-03 convention: Tests and the grab flow can use setDownloadClientFactory((cfg) => fake) with FakeDownloadClient, and FakeDownloadClient.item({downloadId, ...}) to build items.
- 03-03 convention: The grab flow (03-04) calls pickClient(db, protocol, seriesTags), then clientFor(row).addRelease(release, torrentFile?). It should store the returned id as down
- 03-05 convention: queryKeys.queueAll ['queue'] is the prefix for all queue queries
- 03-05 convention: invalidate it after grabs. 'queue' and 'history' server events refresh them.

## Files Modified
| File | Change |
|------|--------|
| `server/src/app.test.ts` | 03-01: Phase 3 foundations: schema, shared types, scheduler, history and blocklist |
| `server/src/app.ts` | 03-01: Phase 3 foundations: schema, shared types, scheduler, history and blocklist |
| `server/src/db/migrations/0004_indexers_downloads.sql` | 03-01: Phase 3 foundations: schema, shared types, scheduler, history and blocklist |
| `server/src/db/schema.ts` | 03-01: Phase 3 foundations: schema, shared types, scheduler, history and blocklist |
| `server/src/routes/blocklist.ts` | 03-01: Phase 3 foundations: schema, shared types, scheduler, history and blocklist |
| `server/src/routes/downloadclient.ts` | 03-01: Phase 3 foundations: schema, shared types, scheduler, history and blocklist |
| `server/src/routes/history.test.ts` | 03-01: Phase 3 foundations: schema, shared types, scheduler, history and blocklist |
| `server/src/routes/history.ts` | 03-01: Phase 3 foundations: schema, shared types, scheduler, history and blocklist |
| `server/src/routes/indexer.ts` | 03-01: Phase 3 foundations: schema, shared types, scheduler, history and blocklist |
| `server/src/routes/system.ts` | 03-01: Phase 3 foundations: schema, shared types, scheduler, history and blocklist |
| `server/src/services/blocklist.ts` | 03-01: Phase 3 foundations: schema, shared types, scheduler, history and blocklist |
| `server/src/services/history.ts` | 03-01: Phase 3 foundations: schema, shared types, scheduler, history and blocklist |
| `server/src/services/scheduler.test.ts` | 03-01: Phase 3 foundations: schema, shared types, scheduler, history and blocklist |
| `server/src/services/scheduler.ts` | 03-01: Phase 3 foundations: schema, shared types, scheduler, history and blocklist |
| `server/src/test/helpers.ts` | 03-01: Phase 3 foundations: schema, shared types, scheduler, history and blocklist |
| `shared/src/index.ts` | 03-01: Phase 3 foundations: schema, shared types, scheduler, history and blocklist |
| `shared/src/indexers.ts` | 03-01: Phase 3 foundations: schema, shared types, scheduler, history and blocklist |
| `server/src/indexers/newznab.test.ts` | 03-02: Newznab and Torznab indexers |
| `server/src/indexers/newznab.ts` | 03-02: Newznab and Torznab indexers |
| `server/src/indexers/registry.ts` | 03-02: Newznab and Torznab indexers |
| `server/src/indexers/types.ts` | 03-02: Newznab and Torznab indexers |
| `server/src/indexers/xml.test.ts` | 03-02: Newznab and Torznab indexers |
| `server/src/indexers/xml.ts` | 03-02: Newznab and Torznab indexers |
| `server/src/routes/indexer.test.ts` | 03-02: Newznab and Torznab indexers |
| `server/src/routes/indexer.ts` | 03-02: Newznab and Torznab indexers |
| `server/src/test/fakeIndexer.ts` | 03-02: Newznab and Torznab indexers |
| `server/src/downloadClients/bencode.ts` | 03-03: Download clients and queue tracking |
| `server/src/downloadClients/clients.test.ts` | 03-03: Download clients and queue tracking |
| `server/src/downloadClients/nzbget.ts` | 03-03: Download clients and queue tracking |
| `server/src/downloadClients/qbittorrent.ts` | 03-03: Download clients and queue tracking |
| `server/src/downloadClients/registry.ts` | 03-03: Download clients and queue tracking |
| `server/src/downloadClients/sabnzbd.ts` | 03-03: Download clients and queue tracking |
| `server/src/downloadClients/transmission.ts` | 03-03: Download clients and queue tracking |
| `server/src/downloadClients/types.ts` | 03-03: Download clients and queue tracking |
| `server/src/routes/downloadclient.test.ts` | 03-03: Download clients and queue tracking |
| `server/src/routes/downloadclient.ts` | 03-03: Download clients and queue tracking |
| `server/src/services/queue.test.ts` | 03-03: Download clients and queue tracking |
| `server/src/services/queue.ts` | 03-03: Download clients and queue tracking |
| `server/src/test/fakeDownloadClient.ts` | 03-03: Download clients and queue tracking |
| `web/src/lib/api.ts` | 03-05: Indexer, download client, queue and interactive search UI |
| `web/src/lib/events.ts` | 03-05: Indexer, download client, queue and interactive search UI |
| `web/src/pages/activity/Queue.tsx` | 03-05: Indexer, download client, queue and interactive search UI |
| `web/src/pages/activity/RemoveQueueItemModal.tsx` | 03-05: Indexer, download client, queue and interactive search UI |
| `web/src/pages/activity/hooks.ts` | 03-05: Indexer, download client, queue and interactive search UI |
| `web/src/pages/activity/queue.test.tsx` | 03-05: Indexer, download client, queue and interactive search UI |
| `web/src/pages/series/InteractiveSearchModal.tsx` | 03-05: Indexer, download client, queue and interactive search UI |
| `web/src/pages/series/SeasonSection.tsx` | 03-05: Indexer, download client, queue and interactive search UI |
| `web/src/pages/series/SeriesDetail.tsx` | 03-05: Indexer, download client, queue and interactive search UI |
| `web/src/pages/series/hooks.ts` | 03-05: Indexer, download client, queue and interactive search UI |
| `web/src/pages/series/interactiveSearch.test.tsx` | 03-05: Indexer, download client, queue and interactive search UI |
| `web/src/pages/settings/DownloadClientModal.tsx` | 03-05: Indexer, download client, queue and interactive search UI |
| `web/src/pages/settings/DownloadClients.tsx` | 03-05: Indexer, download client, queue and interactive search UI |
| `web/src/pages/settings/IndexerModal.tsx` | 03-05: Indexer, download client, queue and interactive search UI |
| `web/src/pages/settings/Indexers.tsx` | 03-05: Indexer, download client, queue and interactive search UI |
| `web/src/pages/settings/providers.test.tsx` | 03-05: Indexer, download client, queue and interactive search UI |
| `web/src/routes.tsx` | 03-05: Indexer, download client, queue and interactive search UI |

## Verification
- 03-01 (REQ-09, REQ-10, REQ-11): 6/6 verification commands passed
- 03-02 (REQ-08): 5/5 verification commands passed
- 03-03 (REQ-11): 6/6 verification commands passed
- 03-05 (REQ-08, REQ-10, REQ-11, REQ-03): 6/6 verification commands passed

## Agents
- 03-01: engineering-backend-architect
- 03-02: engineering-backend-architect
- 03-03: engineering-backend-architect
- 03-05: engineering-frontend-developer
