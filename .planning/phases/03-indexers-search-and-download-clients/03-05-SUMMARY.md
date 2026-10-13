# Plan 03-05 Summary: Indexer, download client, queue and interactive search UI

## Result
**Status**: Complete with Warnings
**Wave**: 2
**Agent**: engineering-frontend-developer
**Completed**: 2026-10-13

## Agent Selection Rationale

| Candidate | Semantic | Heuristic | Memory | Total | Source |
|-----------|----------|-----------|--------|-------|--------|
| engineering-frontend-developer | — | 11 | 4.17 | 15.17 | mandatory |
| engineering-senior-developer | — | 15 | 4.25 | 19.25 | heuristic |
| testing-qa-verification-specialist | — | 15 | 3.83 | 18.83 | heuristic |

- **Task type detected**: implementation
- **Confidence**: LOW
- **Adapter**: claude-code
- **Model tier**: sonnet

## Completed Tasks
- [x] Task 1: Indexers and Download Clients settings (done)
- [x] Task 2: Activity queue page (done)
- [x] Task 3: Interactive search and search actions on series detail (done)

## Files Modified
- `web/src/lib/api.ts`
- `web/src/lib/events.ts`
- `web/src/pages/activity/Queue.tsx`
- `web/src/pages/activity/RemoveQueueItemModal.tsx`
- `web/src/pages/activity/hooks.ts`
- `web/src/pages/activity/queue.test.tsx`
- `web/src/pages/series/InteractiveSearchModal.tsx`
- `web/src/pages/series/SeasonSection.tsx`
- `web/src/pages/series/SeriesDetail.tsx`
- `web/src/pages/series/hooks.ts`
- `web/src/pages/series/interactiveSearch.test.tsx`
- `web/src/pages/settings/DownloadClientModal.tsx`
- `web/src/pages/settings/DownloadClients.tsx`
- `web/src/pages/settings/IndexerModal.tsx`
- `web/src/pages/settings/Indexers.tsx`
- `web/src/pages/settings/providers.test.tsx`
- `web/src/routes.tsx`

## Verification Results
6/6 verification commands passed (run by Triad after the agent finished).

## Verification Commands
| Command | Exit Code | Result |
|---------|-----------|--------|
| `npm run typecheck -w @sonarr/web` | 0 | PASS |
| `npm test -w @sonarr/web` | 0 | PASS |
| `npm run build` | 0 | PASS |
| `npm test -w @sonarr/web -- providers` | 0 | PASS |
| `npm test -w @sonarr/web -- queue` | 0 | PASS |
| `npm test -w @sonarr/web -- interactiveSearch` | 0 | PASS |

## Key Decisions
- There is no settings hooks file in my list, so indexer hooks and shared provider helpers live in settings/IndexerModal.tsx and client hooks in settings/DownloadClientModal.tsx.

## Issues Encountered
- SeriesDetail still passes unknownCommandMessage to the Search Monitored command. The plan says to remove this, but series.test.tsx:323-330 (not in my file list) still expects the "Searching is available once indexers are configured" toast. A TODO comment marks the line.

## Escalations
| # | Severity | Type | Decision | Status | Resolution |
|---|----------|------|----------|--------|------------|
| 1 | warning | out-of-scope-file | Remove the unknown-command special case from SeriesDetail's Search Monitored button (plan task 3). | pending | INVALID: type "out-of-scope-file" is not one of architecture, dependency, scope, schema, api, deletion, infrastructure, quality |
| 2 | info | out-of-scope-file | Page h1 at /activity/queue. | pending | INVALID: type "out-of-scope-file" is not one of architecture, dependency, scope, schema, api, deletion, infrastructure, quality |

- #1 context: web/src/pages/series/series.test.tsx:323-330 asserts the info toast for 400 'Unknown command' and is not in this plan's files. To finish the plan: delete the `{ unknownCommandMessage: ... }` argument at web/src/pages/series/SeriesDetail.tsx (the line under the TODO). Then change that test to expect the generic error toast with the server message, or remove it.
- #2 context: web/src/components/layout/layout.test.tsx checks each nav path for an h1 named after the first nav entry, which is 'Activity' for /activity/queue. The plan asks for a 'Queue' header. Queue.tsx has a hidden <h1>Activity</h1> next to the visible 'Queue' h1. A cleaner option is to update layout.test.tsx to expect 'Queue' for /activity/queue and then drop the hidden heading.

## Handoff Context
- **Key outputs**: web/src/lib/api.ts; web/src/lib/events.ts; web/src/pages/activity/Queue.tsx; web/src/pages/activity/RemoveQueueItemModal.tsx; web/src/pages/activity/hooks.ts; web/src/pages/activity/queue.test.tsx; web/src/pages/series/InteractiveSearchModal.tsx; web/src/pages/series/SeasonSection.tsx; web/src/pages/series/SeriesDetail.tsx; web/src/pages/series/hooks.ts; web/src/pages/series/interactiveSearch.test.tsx; web/src/pages/settings/DownloadClientModal.tsx; web/src/pages/settings/DownloadClients.tsx; web/src/pages/settings/IndexerModal.tsx; web/src/pages/settings/Indexers.tsx; web/src/pages/settings/providers.test.tsx; web/src/routes.tsx
- **Decisions made**: There is no settings hooks file in my list, so indexer hooks and shared provider helpers live in settings/IndexerModal.tsx and client hooks in settings/DownloadClientModal.tsx.
- **Open questions**: (none)
- **Conventions established**: queryKeys.queueAll ['queue'] is the prefix for all queue queries; invalidate it after grabs. 'queue' and 'history' server events refresh them.

## Requirements Covered
- REQ-08
- REQ-10
- REQ-11
- REQ-03

## Token Usage
50 requests, 5608798 input tokens (5432174 cached), 87533 output tokens, $3.7201
