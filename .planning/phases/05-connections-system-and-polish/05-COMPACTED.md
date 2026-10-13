---
phase: 05-connections-system-and-polish
compacted: 2026-10-13
original_summaries: [05-01-SUMMARY.md, 05-02-SUMMARY.md, 05-03-SUMMARY.md, 05-04-SUMMARY.md, 05-05-SUMMARY.md, 05-06-SUMMARY.md]
requirements_satisfied: [REQ-17, REQ-18, REQ-16, REQ-03]
---

# Phase 5: Connections, System and Polish — Compacted Summary

## Deliverables
- 05-01 Phase 5 foundations: schema, types, logging, health, static UI and web plumbing (Complete): server/src/app.test.ts, server/src/app.ts, server/src/db/migrations/0005_notifications.sql, server/src/db/schema.ts, server/src/index.ts, server/src/plugins/staticUi.test.ts, server/src/plugins/staticUi.ts, server/src/routes/backup.ts, server/src/routes/notification.ts, server/src/routes/systemExtra.ts, server/src/services/health.test.ts, server/src/services/health.ts, server/src/services/logs.test.ts, server/src/services/logs.ts, shared/src/index.ts, shared/src/system.ts, web/src/components/ui/StatusBadge.tsx, web/src/components/ui/index.ts, web/src/lib/api.ts, web/src/lib/events.ts, web/src/pages/settings/Connect.tsx, web/src/pages/system/Backup.tsx, web/src/pages/system/Events.tsx, web/src/pages/system/LogFiles.tsx, web/src/pages/system/Status.tsx, web/src/pages/system/Tasks.tsx, web/src/pages/system/Updates.tsx, web/src/routes.tsx
- 05-02 Notifications: Webhook, Discord and Email (Complete): server/src/notifications/discord.ts, server/src/notifications/dispatcher.ts, server/src/notifications/email.ts, server/src/notifications/notifications.test.ts, server/src/notifications/payload.ts, server/src/notifications/smtp.test.ts, server/src/notifications/smtp.ts, server/src/notifications/types.ts, server/src/notifications/webhook.ts, server/src/routes/notification.test.ts, server/src/routes/notification.ts
- 05-03 Backups, restore, restart and housekeeping (Complete): server/src/db/index.ts, server/src/routes/backup.ts, server/src/services/backup.test.ts, server/src/services/backup.ts, server/src/services/housekeeping.test.ts, server/src/services/housekeeping.ts, server/src/services/zip.test.ts, server/src/services/zip.ts
- 05-04 System pages (Complete)
- 05-05 Connect settings and live command activity (Complete): web/src/components/layout/CommandActivity.tsx, web/src/components/layout/Header.tsx, web/src/components/layout/commandActivity.test.tsx, web/src/pages/settings/Connect.tsx, web/src/pages/settings/NotificationModal.tsx, web/src/pages/settings/connect.test.tsx
- 05-06 End-to-end smoke tests with Playwright (Complete)

## Decisions
- 05-01: CheckHealth task is registered in index.ts, not buildApp. scheduler.test.ts asserts the exact 4 default tasks and I could not edit it.
- 05-01: HealthService subscribes to events lazily on its first check(). events.test.ts asserts listenerCount is 1 then 0, and an eager subscription broke it.
- 05-01: Realtime debounce is leading-edge per query key: the first event invalidates at once, later ones within 250 ms collapse into one trailing invalidation. api.test
- 05-02: The dispatcher subscribes to events and health only once a notification exists. It activates at registration if rows already exist, and on the first POST /notif
- 05-02: Upgrade detection: episodeFileDeleted history rows carry no downloadId, so there is no shared downloadId to match on. The dispatcher marks the episode ids of an
- 05-02: Download notifications go to rows with onDownload, and for an upgrade only if onUpgrade is also set. This follows Sonarr.
- 05-03: `backupRoutes` sets `Symbol.for('skip-override')`, so `app.lifecycle` is on the root app and tests can replace it. The routes and the zip/multipart content-type
- 05-03: The weekly `Backup` task is created in an `onListen` hook, not at build time, because `scheduler.test.ts` asserts exactly 4 default tasks and I could not edit i
- 05-03: Restart closes the app first, then spawns the detached child, then exits, so the port is free when the child starts.
- 05-04: The Status page h1 stays "System", so layout.test.tsx does not need changing.
- 05-05: CommandActivity renders nothing when there is no QueryClient, following the Sidebar pattern. layout.test.tsx renders the header without one and I could not edit
- 05-05: The status 'connecting' maps to 'Reconnecting...'; the plan listed only that one in-between state.
- 05-05: The popover opens only while commands are queued or started. Idle hides the button and keeps the aria-live region.
- 05-06: none this run (nothing was changed)

## Conventions and Open Questions
- 05-01 convention: app.health: check(), current() (async), onChange(fn({added, removed, current})), reportNotificationFailure(id), clearNotificationFailure(id), diskSpace(). The f
- 05-01 convention: app.logs.write({level, message, logger?, exception?}) redacts and writes to file and ring.
- 05-01 convention: Plan 05-02 notification dispatch: subscribe to app.health.onChange for Health and HealthRestored.
- 05-02 convention: Web (05-05): the resource shape is NotificationResource, with settings masked as '********'. Send '********' back unchanged to keep a stored secret on PUT and t
- 05-02 convention: Web (05-05): schema templates use implementationName and default onGrab/onDownload/onUpgrade true.
- 05-02 convention: 05-06 e2e: setNotificationProviderFactory and setNotificationProviderDeps are exported from server/src/notifications/dispatcher.ts. Use them to fake outbound se
- 05-03 convention: `app.lifecycle` has `restart()` and `shutdown()`. Tests replace it, and the 05-06 e2e must do the same so it never calls `process.exit`.
- 05-03 convention: Backup files live in `dataDir/Backups/{manual|scheduled|update}`. Staged restores live in `dataDir/restore/sonarr.db`. The weekly `Backup` schedule only appears
- 05-03 convention: `BackupError` carries a `statusCode` that the global error handler passes through: 400 for invalid input, 404 for an unknown name.
- 05-04 convention: system/hooks.ts exports healthIssues(items), isActiveCommand, downloadApiFile(path, filename), waitForRestart(urlBase, onBack?) and systemEnv (timings and reloa
- 05-05 convention: useNotifications, useNotificationSchema, triggerLabels and NotificationTemplatePicker are exported from NotificationModal.tsx.
- 05-05 convention: The announcer element has data-testid="command-announcer".
- 05-05 convention: Any test that renders the full AppLayout with a QueryClient will now fetch GET command, so mock it.
- 05-06 convention: `npm run e2e` runs a build first, then starts a fresh server on 127.0.0.1:8990 through `npx tsx server/src/e2e/start.ts`.
- 05-06 convention: The mobile project depends on the desktop project and starts from a fresh state through its own setup.
- 05-06 convention: The Chromium path comes from PLAYWRIGHT_CHROMIUM_PATH, otherwise from the newest chromium-* under /opt/pw-browsers.

## Files Modified
| File | Change |
|------|--------|
| `server/src/app.test.ts` | 05-01: Phase 5 foundations: schema, types, logging, health, static UI and web plumbing |
| `server/src/app.ts` | 05-01: Phase 5 foundations: schema, types, logging, health, static UI and web plumbing |
| `server/src/db/migrations/0005_notifications.sql` | 05-01: Phase 5 foundations: schema, types, logging, health, static UI and web plumbing |
| `server/src/db/schema.ts` | 05-01: Phase 5 foundations: schema, types, logging, health, static UI and web plumbing |
| `server/src/index.ts` | 05-01: Phase 5 foundations: schema, types, logging, health, static UI and web plumbing |
| `server/src/plugins/staticUi.test.ts` | 05-01: Phase 5 foundations: schema, types, logging, health, static UI and web plumbing |
| `server/src/plugins/staticUi.ts` | 05-01: Phase 5 foundations: schema, types, logging, health, static UI and web plumbing |
| `server/src/routes/backup.ts` | 05-01: Phase 5 foundations: schema, types, logging, health, static UI and web plumbing |
| `server/src/routes/notification.ts` | 05-01: Phase 5 foundations: schema, types, logging, health, static UI and web plumbing |
| `server/src/routes/systemExtra.ts` | 05-01: Phase 5 foundations: schema, types, logging, health, static UI and web plumbing |
| `server/src/services/health.test.ts` | 05-01: Phase 5 foundations: schema, types, logging, health, static UI and web plumbing |
| `server/src/services/health.ts` | 05-01: Phase 5 foundations: schema, types, logging, health, static UI and web plumbing |
| `server/src/services/logs.test.ts` | 05-01: Phase 5 foundations: schema, types, logging, health, static UI and web plumbing |
| `server/src/services/logs.ts` | 05-01: Phase 5 foundations: schema, types, logging, health, static UI and web plumbing |
| `shared/src/index.ts` | 05-01: Phase 5 foundations: schema, types, logging, health, static UI and web plumbing |
| `shared/src/system.ts` | 05-01: Phase 5 foundations: schema, types, logging, health, static UI and web plumbing |
| `web/src/components/ui/StatusBadge.tsx` | 05-01: Phase 5 foundations: schema, types, logging, health, static UI and web plumbing |
| `web/src/components/ui/index.ts` | 05-01: Phase 5 foundations: schema, types, logging, health, static UI and web plumbing |
| `web/src/lib/api.ts` | 05-01: Phase 5 foundations: schema, types, logging, health, static UI and web plumbing |
| `web/src/lib/events.ts` | 05-01: Phase 5 foundations: schema, types, logging, health, static UI and web plumbing |
| `web/src/pages/settings/Connect.tsx` | 05-01: Phase 5 foundations: schema, types, logging, health, static UI and web plumbing |
| `web/src/pages/system/Backup.tsx` | 05-01: Phase 5 foundations: schema, types, logging, health, static UI and web plumbing |
| `web/src/pages/system/Events.tsx` | 05-01: Phase 5 foundations: schema, types, logging, health, static UI and web plumbing |
| `web/src/pages/system/LogFiles.tsx` | 05-01: Phase 5 foundations: schema, types, logging, health, static UI and web plumbing |
| `web/src/pages/system/Status.tsx` | 05-01: Phase 5 foundations: schema, types, logging, health, static UI and web plumbing |
| `web/src/pages/system/Tasks.tsx` | 05-01: Phase 5 foundations: schema, types, logging, health, static UI and web plumbing |
| `web/src/pages/system/Updates.tsx` | 05-01: Phase 5 foundations: schema, types, logging, health, static UI and web plumbing |
| `web/src/routes.tsx` | 05-01: Phase 5 foundations: schema, types, logging, health, static UI and web plumbing |
| `server/src/notifications/discord.ts` | 05-02: Notifications: Webhook, Discord and Email |
| `server/src/notifications/dispatcher.ts` | 05-02: Notifications: Webhook, Discord and Email |
| `server/src/notifications/email.ts` | 05-02: Notifications: Webhook, Discord and Email |
| `server/src/notifications/notifications.test.ts` | 05-02: Notifications: Webhook, Discord and Email |
| `server/src/notifications/payload.ts` | 05-02: Notifications: Webhook, Discord and Email |
| `server/src/notifications/smtp.test.ts` | 05-02: Notifications: Webhook, Discord and Email |
| `server/src/notifications/smtp.ts` | 05-02: Notifications: Webhook, Discord and Email |
| `server/src/notifications/types.ts` | 05-02: Notifications: Webhook, Discord and Email |
| `server/src/notifications/webhook.ts` | 05-02: Notifications: Webhook, Discord and Email |
| `server/src/routes/notification.test.ts` | 05-02: Notifications: Webhook, Discord and Email |
| `server/src/routes/notification.ts` | 05-02: Notifications: Webhook, Discord and Email |
| `server/src/db/index.ts` | 05-03: Backups, restore, restart and housekeeping |
| `server/src/routes/backup.ts` | 05-03: Backups, restore, restart and housekeeping |
| `server/src/services/backup.test.ts` | 05-03: Backups, restore, restart and housekeeping |
| `server/src/services/backup.ts` | 05-03: Backups, restore, restart and housekeeping |
| `server/src/services/housekeeping.test.ts` | 05-03: Backups, restore, restart and housekeeping |
| `server/src/services/housekeeping.ts` | 05-03: Backups, restore, restart and housekeeping |
| `server/src/services/zip.test.ts` | 05-03: Backups, restore, restart and housekeeping |
| `server/src/services/zip.ts` | 05-03: Backups, restore, restart and housekeeping |
| `web/src/components/layout/CommandActivity.tsx` | 05-05: Connect settings and live command activity |
| `web/src/components/layout/Header.tsx` | 05-05: Connect settings and live command activity |
| `web/src/components/layout/commandActivity.test.tsx` | 05-05: Connect settings and live command activity |
| `web/src/pages/settings/Connect.tsx` | 05-05: Connect settings and live command activity |
| `web/src/pages/settings/NotificationModal.tsx` | 05-05: Connect settings and live command activity |
| `web/src/pages/settings/connect.test.tsx` | 05-05: Connect settings and live command activity |

## Verification
- 05-01 (REQ-17, REQ-18): 8/8 verification commands passed
- 05-02 (REQ-16): 5/5 verification commands passed
- 05-03 (REQ-17): 5/5 verification commands passed
- 05-04 (REQ-17, REQ-03): 4/4 verification commands passed
- 05-05 (REQ-16, REQ-18): 4/4 verification commands passed
- 05-06 (REQ-16, REQ-17, REQ-18, REQ-03): 6/6 verification commands passed

## Agents
- 05-01: engineering-senior-developer
- 05-02: engineering-backend-architect
- 05-03: engineering-backend-architect
- 05-04: engineering-frontend-developer
- 05-05: engineering-frontend-developer
- 05-06: testing-qa-verification-specialist

## Also Covered
- web/src/pages/system/hooks.ts
- web/src/pages/system/system.test.tsx
- web/src/components/layout/Sidebar.tsx
- package.json
- package-lock.json
- playwright.config.ts
- e2e/smoke.spec.ts
- e2e/helpers.ts
- README.md
- .gitignore
