# Plan 03-01 Summary: Phase 3 foundations: schema, shared types, scheduler, history and blocklist

## Result
**Status**: Complete
**Wave**: 1
**Agent**: engineering-backend-architect
**Completed**: 2026-10-13

## Agent Selection Rationale

| Candidate | Semantic | Heuristic | Memory | Total | Source |
|-----------|----------|-----------|--------|-------|--------|
| engineering-backend-architect | — | 13 | 3.17 | 16.17 | mandatory |
| engineering-senior-developer | — | 15 | 4.25 | 19.25 | heuristic |
| testing-qa-verification-specialist | — | 13 | 3.83 | 16.83 | heuristic |

- **Task type detected**: implementation
- **Confidence**: LOW
- **Adapter**: claude-code
- **Model tier**: sonnet

## Completed Tasks
- [x] Task 1: Schema and shared types (done)
- [x] Task 2: Scheduler service (done)
- [x] Task 3: History, blocklist and route stubs (done)

## Files Modified
- `server/src/app.test.ts`
- `server/src/app.ts`
- `server/src/db/migrations/0004_indexers_downloads.sql`
- `server/src/db/schema.ts`
- `server/src/routes/blocklist.ts`
- `server/src/routes/downloadclient.ts`
- `server/src/routes/history.test.ts`
- `server/src/routes/history.ts`
- `server/src/routes/indexer.ts`
- `server/src/routes/system.ts`
- `server/src/services/blocklist.ts`
- `server/src/services/history.ts`
- `server/src/services/scheduler.test.ts`
- `server/src/services/scheduler.ts`
- `server/src/test/helpers.ts`
- `shared/src/index.ts`
- `shared/src/indexers.ts`

## Verification Results
6/6 verification commands passed (run by Triad after the agent finished).

## Verification Commands
| Command | Exit Code | Result |
|---------|-----------|--------|
| `npm run typecheck` | 0 | PASS |
| `npm test -w @sonarr/shared` | 0 | PASS |
| `npm test -w @sonarr/server` | 0 | PASS |
| `npm run typecheck -w @sonarr/shared` | 0 | PASS |
| `npm test -w @sonarr/server -- app.test` | 0 | PASS |
| `npm test -w @sonarr/server -- scheduler` | 0 | PASS |

## Key Decisions
- The scheduler subscribes to command events lazily on its first enqueue. A subscription made in the constructor failed events.test.ts, which expects exactly one listener.
- Tasks whose command is not registered are skipped without advancing next_execution, so commands registered later run on the next tick.
- If a command with the task's name is queued or started, tick skips the task. Completion, failure or abort of a scheduler-enqueued command sets last_execution to its ended time and next_execution to last_execution plus the interval.
- ensureTask on an existing row keeps last_execution and recomputes next_execution as last_execution plus the new interval. Without a last_execution it keeps the stored next_execution.
- isBlocklisted compares info hashes (lowercased) when both sides have one. Otherwise it matches on normalized title plus a case-insensitive indexer, where a missing indexer counts as ''.
- recordEvent writes one row per episode, or a single row with a null episode when none are given.
- The settings input schemas leave categories optional, so the server applies the newznab or torznab defaults.

## Issues Encountered
(none)

## Escalations
(none)

## Handoff Context
- **Key outputs**: server/src/app.test.ts; server/src/app.ts; server/src/db/migrations/0004_indexers_downloads.sql; server/src/db/schema.ts; server/src/routes/blocklist.ts; server/src/routes/downloadclient.ts; server/src/routes/history.test.ts; server/src/routes/history.ts; server/src/routes/indexer.ts; server/src/routes/system.ts; server/src/services/blocklist.ts; server/src/services/history.ts; server/src/services/scheduler.test.ts; server/src/services/scheduler.ts; server/src/test/helpers.ts; shared/src/index.ts; shared/src/indexers.ts
- **Decisions made**: The scheduler subscribes to command events lazily on its first enqueue. A subscription made in the constructor failed events.test.ts, which expects exactly one listener.; Tasks whose command is not registered are skipped without advancing next_execution, so commands registered later run on the next tick.; If a command with the task's name is queued or started, tick skips the task. Completion, failure or abort of a scheduler-enqueued command sets last_execution to its ended time and next_execution to last_execution plus the interval.; ensureTask on an existing row keeps last_execution and recomputes next_execution as last_execution plus the new interval. Without a last_execution it keeps the stored next_execution.; isBlocklisted compares info hashes (lowercased) when both sides have one. Otherwise it matches on normalized title plus a case-insensitive indexer, where a missing indexer counts as ''.; recordEvent writes one row per episode, or a single row with a null episode when none are given.; The settings input schemas leave categories optional, so the server applies the newznab or torznab defaults.
- **Open questions**: (none)
- **Conventions established**: Plan 03-02 fills indexerRoutes in server/src/routes/indexer.ts and plan 03-03 fills downloadClientRoutes in server/src/routes/downloadclient.ts. Both are already registered in app.ts.; The input schemas are indexerInputSchema and downloadClientInputSchema in @sonarr/shared. Resources store implementation lowercase in the DB and use the capitalised form in the API (Newznab, Torznab, SABnzbd, NZBGet, QBittorrent, Transmission). Settings are stored as JSON in the settings column.; Plans 03-03 and 03-04 register their commands with app.commands.register using the names RssSync, RefreshMonitoredDownloads and RefreshSeries. The scheduler's four default tasks (RssSync, RefreshMonitoredDownloads, RefreshSeries, Housekeeping) pick them up on the next tick with trigger 'scheduled'. app.scheduler.runNow(name) enqueues a task immediately.; To record history call recordGrabbed or recordEvent(app, eventType, input). For blocklisting use addToBlocklist(app, input) and isBlocklisted(app.db, seriesId, release). The events published are 'history' created and 'blocklist' created or deleted.; pagingSchema is exported from server/src/routes/history.ts. The Paged<T> response shape is in @sonarr/shared.

## Requirements Covered
- REQ-09
- REQ-10
- REQ-11

## Token Usage
13 requests, 581510 input tokens (521871 cached), 23937 output tokens, $0.4928
