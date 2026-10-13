# Plan 05-01 Summary: Phase 5 foundations: schema, types, logging, health, static UI and web plumbing

## Result
**Status**: Complete
**Wave**: 1
**Agent**: engineering-senior-developer
**Completed**: 2026-10-13

## Agent Selection Rationale

| Candidate | Semantic | Heuristic | Memory | Total | Source |
|-----------|----------|-----------|--------|-------|--------|
| engineering-senior-developer | — | 17 | 4.06 | 21.06 | heuristic |
| engineering-frontend-developer | — | 16 | 3.82 | 19.82 | heuristic |
| testing-qa-verification-specialist | — | 13 | 4.1 | 17.1 | heuristic |

- **Task type detected**: implementation
- **Confidence**: MEDIUM
- **Adapter**: claude-code
- **Model tier**: sonnet

## Completed Tasks
- [x] Task 1: Schema, shared types, log service and static UI (done)
- [x] Task 2: Health checks, disk space and system route stubs (done)
- [x] Task 3: Web plumbing, StatusBadge and stub pages (done)

## Files Modified
- `server/src/app.test.ts`
- `server/src/app.ts`
- `server/src/db/migrations/0005_notifications.sql`
- `server/src/db/schema.ts`
- `server/src/index.ts`
- `server/src/plugins/staticUi.test.ts`
- `server/src/plugins/staticUi.ts`
- `server/src/routes/backup.ts`
- `server/src/routes/notification.ts`
- `server/src/routes/systemExtra.ts`
- `server/src/services/health.test.ts`
- `server/src/services/health.ts`
- `server/src/services/logs.test.ts`
- `server/src/services/logs.ts`
- `shared/src/index.ts`
- `shared/src/system.ts`
- `web/src/components/ui/StatusBadge.tsx`
- `web/src/components/ui/index.ts`
- `web/src/lib/api.ts`
- `web/src/lib/events.ts`
- `web/src/pages/settings/Connect.tsx`
- `web/src/pages/system/Backup.tsx`
- `web/src/pages/system/Events.tsx`
- `web/src/pages/system/LogFiles.tsx`
- `web/src/pages/system/Status.tsx`
- `web/src/pages/system/Tasks.tsx`
- `web/src/pages/system/Updates.tsx`
- `web/src/routes.tsx`

## Verification Results
8/8 verification commands passed (run by Triad after the agent finished).

## Verification Commands
| Command | Exit Code | Result |
|---------|-----------|--------|
| `npm run typecheck` | 0 | PASS |
| `npm test` | 0 | PASS |
| `npm run build` | 0 | PASS |
| `npm test -w @sonarr/server -- logs staticUi app.test` | 0 | PASS |
| `npm test -w @sonarr/server -- health` | 0 | PASS |
| `npm test -w @sonarr/server` | 0 | PASS |
| `npm run typecheck -w @sonarr/web` | 0 | PASS |
| `npm test -w @sonarr/web` | 0 | PASS |

## Key Decisions
- CheckHealth task is registered in index.ts, not buildApp. scheduler.test.ts asserts the exact 4 default tasks and I could not edit it.
- HealthService subscribes to events lazily on its first check(). events.test.ts asserts listenerCount is 1 then 0, and an eager subscription broke it.
- Realtime debounce is leading-edge per query key: the first event invalidates at once, later ones within 250 ms collapse into one trailing invalidation. api.test.ts asserts synchronous invalidation, so a purely trailing debounce failed.
- The Status stub's h1 is "System". layout.test.tsx expects the nav label for /system/status.
- Log level filter matches the exact level. Log entries page size is capped at 200.
- DB stores the notification implementation lowercase (webhook|discord|email). The resource and input use Webhook|Discord|Email.
- staticUi serves index.html only when Accept contains text/html. It also prefixes root-absolute src/href values with urlBase, because vite.config.ts is not editable and the built assets use /assets/....
- Fastify logger now streams into LogService and is teed to stdout with redaction.
- Backup `path` in BackupResource is documented as the folder plus the name.

## Issues Encountered
- No web test covers the debounce or StatusBadge. No allowed web test file fits, and the plan says none is required for StatusBadge.
- Pre-existing, unchanged: the web build reports a chunk size over 500 kB.

## Escalations
| # | Severity | Type | Decision | Status | Resolution |
|---|----------|------|----------|--------|------------|
| 1 | info | scope | Whether to move ensureTask('CheckHealth') into buildApp and update server/src/services/scheduler.test.ts, which asserts exactly 4 default tasks | pending |  |

- #1 context: That test file is outside this plan's files_modified. I placed the task registration in index.ts so the existing suite passes. Moving it is a one-line change in app.ts plus a test update.

## Handoff Context
- **Key outputs**: server/src/app.test.ts; server/src/app.ts; server/src/db/migrations/0005_notifications.sql; server/src/db/schema.ts; server/src/index.ts; server/src/plugins/staticUi.test.ts; server/src/plugins/staticUi.ts; server/src/routes/backup.ts; server/src/routes/notification.ts; server/src/routes/systemExtra.ts; server/src/services/health.test.ts; server/src/services/health.ts; server/src/services/logs.test.ts; server/src/services/logs.ts; shared/src/index.ts; shared/src/system.ts; web/src/components/ui/StatusBadge.tsx; web/src/components/ui/index.ts; web/src/lib/api.ts; web/src/lib/events.ts; web/src/pages/settings/Connect.tsx; web/src/pages/system/Backup.tsx; web/src/pages/system/Events.tsx; web/src/pages/system/LogFiles.tsx; web/src/pages/system/Status.tsx; web/src/pages/system/Tasks.tsx; web/src/pages/system/Updates.tsx; web/src/routes.tsx
- **Decisions made**: CheckHealth task is registered in index.ts, not buildApp. scheduler.test.ts asserts the exact 4 default tasks and I could not edit it.; HealthService subscribes to events lazily on its first check(). events.test.ts asserts listenerCount is 1 then 0, and an eager subscription broke it.; Realtime debounce is leading-edge per query key: the first event invalidates at once, later ones within 250 ms collapse into one trailing invalidation. api.test.ts asserts synchronous invalidation, so a purely trailing debounce failed.; The Status stub's h1 is "System". layout.test.tsx expects the nav label for /system/status.; Log level filter matches the exact level. Log entries page size is capped at 200.; DB stores the notification implementation lowercase (webhook|discord|email). The resource and input use Webhook|Discord|Email.; staticUi serves index.html only when Accept contains text/html. It also prefixes root-absolute src/href values with urlBase, because vite.config.ts is not editable and the built assets use /assets/....; Fastify logger now streams into LogService and is teed to stdout with redaction.; Backup `path` in BackupResource is documented as the folder plus the name.
- **Open questions**: (none)
- **Conventions established**: app.health: check(), current() (async), onChange(fn({added, removed, current})), reportNotificationFailure(id), clearNotificationFailure(id), diskSpace(). The failure message is built from the notifications table names.; app.logs.write({level, message, logger?, exception?}) redacts and writes to file and ring.; Plan 05-02 notification dispatch: subscribe to app.health.onChange for Health and HealthRestored.; 05-02 and 05-03 fill notificationRoutes and backupRoutes (stubs already registered). 05-04 should update the layout.test.tsx pageTitles map if it renames the Status heading.; 05-06 e2e: pass buildApp `webDist` and `statfs` if needed, and call `app.scheduler.ensureTask('CheckHealth', 'CheckHealth', 5)` since buildApp no longer does.; Web queryKeys added: health, diskSpace, tasks, logs(params), logFiles, backups, updates, notifications, notificationSchema.; Event names: health, notification, backup invalidate their keys; command also invalidates tasks. `StatusBadge` is imported from components/ui with props status (StatusKind), label, icon.; Health route publishes ('health', 'updated', {records}). Source names: IndexerRssCheck, IndexerSearchCheck, IndexerStatusCheck, DownloadClientCheck, DownloadClientStatusCheck, RootFolderCheck, DiskSpaceCheck, RecycleBinCheck, NotificationStatusCheck, AuthenticationCheck.

## Requirements Covered
- REQ-17
- REQ-18

## Token Usage
35 requests, 2729710 input tokens (2622904 cached), 44212 output tokens, $1.2337
