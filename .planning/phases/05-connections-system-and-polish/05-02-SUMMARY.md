# Plan 05-02 Summary: Notifications: Webhook, Discord and Email

## Result
**Status**: Complete
**Wave**: 2
**Agent**: engineering-backend-architect
**Completed**: 2026-10-13

## Agent Selection Rationale

| Candidate | Semantic | Heuristic | Memory | Total | Source |
|-----------|----------|-----------|--------|-------|--------|
| engineering-backend-architect | — | 9 | 3.55 | 12.55 | mandatory |
| engineering-senior-developer | — | 18 | 4.06 | 22.06 | heuristic |
| testing-qa-verification-specialist | — | 13 | 4.1 | 17.1 | heuristic |

- **Task type detected**: implementation
- **Confidence**: LOW
- **Adapter**: claude-code
- **Model tier**: sonnet

## Completed Tasks
- [x] Task 1: Providers and SMTP client (done)
- [x] Task 2: Dispatcher (done)
- [x] Task 3: Notification API (done)

## Files Modified
- `server/src/notifications/discord.ts`
- `server/src/notifications/dispatcher.ts`
- `server/src/notifications/email.ts`
- `server/src/notifications/notifications.test.ts`
- `server/src/notifications/payload.ts`
- `server/src/notifications/smtp.test.ts`
- `server/src/notifications/smtp.ts`
- `server/src/notifications/types.ts`
- `server/src/notifications/webhook.ts`
- `server/src/routes/notification.test.ts`
- `server/src/routes/notification.ts`

## Verification Results
5/5 verification commands passed (run by Triad after the agent finished).

## Verification Commands
| Command | Exit Code | Result |
|---------|-----------|--------|
| `npm run typecheck` | 0 | PASS |
| `npm test -w @sonarr/server` | 0 | PASS |
| `npm test -w @sonarr/server -- smtp` | 0 | PASS |
| `npm test -w @sonarr/server -- notifications` | 0 | PASS |
| `npm test -w @sonarr/server -- notification` | 0 | PASS |

## Key Decisions
- The dispatcher subscribes to events and health only once a notification exists. It activates at registration if rows already exist, and on the first POST /notification. Subscribing at startup would break events.test.ts, which asserts listenerCount is 1 then 0.
- Upgrade detection: episodeFileDeleted history rows carry no downloadId, so there is no shared downloadId to match on. The dispatcher marks the episode ids of an upgrade-delete, and the next import for those episodes (within 10 minutes) gets isUpgrade true. The mark is consumed on use.
- Download notifications go to rows with onDownload, and for an upgrade only if onUpgrade is also set. This follows Sonarr.
- onEpisodeFileDeleteForUpgrade is sent as eventType 'EpisodeFileDelete' with payload deleteReason 'upgrade'. The event union has no separate type for it.
- History rows are published one per episode, so rows with the same event, series, downloadId and title are grouped into one message. Renames are grouped per series within a 1 s window.
- SeriesDelete reads the title and tags from a series cache, because the row is gone by the time the event fires. The cache is filled at activation and kept up to date by series events.
- Health events skip the NotificationStatusCheck source, to avoid notifying about notification failures. Warnings only reach notifications with includeHealthWarnings. Tags are ignored for health events.
- Masking: a webhook url is returned masked if it has a query or credentials. A Discord webHookUrl is always masked. Passwords are masked when non-empty. '********' in PUT and test bodies is replaced with the stored value before validation.
- applicationUrl in payloads is '' because no such setting exists in host config.
- Tests use setNotificationProviderFactory. setNotificationProviderDeps was added for injecting fetch and sendMail into the real providers.

## Issues Encountered
- notification.test.ts duplicates a small fake SMTP server, because the fake in smtp.test.ts cannot be shared (exporting it from a test file would re-run its tests).
- The STARTTLS upgrade path itself is untested (no certificate fixture). Only 'always' failing without STARTTLS, 'preferred' falling back to plain, and implicit TLS code paths are covered.
- The health warning for a failing notification appears at the next health check (the 5-minute CheckHealth, or any check). The dispatcher does not trigger a check itself.

## Escalations
(none)

## Handoff Context
- **Key outputs**: server/src/notifications/discord.ts; server/src/notifications/dispatcher.ts; server/src/notifications/email.ts; server/src/notifications/notifications.test.ts; server/src/notifications/payload.ts; server/src/notifications/smtp.test.ts; server/src/notifications/smtp.ts; server/src/notifications/types.ts; server/src/notifications/webhook.ts; server/src/routes/notification.test.ts; server/src/routes/notification.ts
- **Decisions made**: The dispatcher subscribes to events and health only once a notification exists. It activates at registration if rows already exist, and on the first POST /notification. Subscribing at startup would break events.test.ts, which asserts listenerCount is 1 then 0.; Upgrade detection: episodeFileDeleted history rows carry no downloadId, so there is no shared downloadId to match on. The dispatcher marks the episode ids of an upgrade-delete, and the next import for those episodes (within 10 minutes) gets isUpgrade true. The mark is consumed on use.; Download notifications go to rows with onDownload, and for an upgrade only if onUpgrade is also set. This follows Sonarr.; onEpisodeFileDeleteForUpgrade is sent as eventType 'EpisodeFileDelete' with payload deleteReason 'upgrade'. The event union has no separate type for it.; History rows are published one per episode, so rows with the same event, series, downloadId and title are grouped into one message. Renames are grouped per series within a 1 s window.; SeriesDelete reads the title and tags from a series cache, because the row is gone by the time the event fires. The cache is filled at activation and kept up to date by series events.; Health events skip the NotificationStatusCheck source, to avoid notifying about notification failures. Warnings only reach notifications with includeHealthWarnings. Tags are ignored for health events.; Masking: a webhook url is returned masked if it has a query or credentials. A Discord webHookUrl is always masked. Passwords are masked when non-empty. '********' in PUT and test bodies is replaced with the stored value before validation.; applicationUrl in payloads is '' because no such setting exists in host config.; Tests use setNotificationProviderFactory. setNotificationProviderDeps was added for injecting fetch and sendMail into the real providers.
- **Open questions**: (none)
- **Conventions established**: Web (05-05): the resource shape is NotificationResource, with settings masked as '********'. Send '********' back unchanged to keep a stored secret on PUT and test. POST /api/v3/notification/test needs the full input (name included) and may carry an id. It returns 400 {message} on failure. testall returns [{id, isValid, validationFailures}].; Web (05-05): schema templates use implementationName and default onGrab/onDownload/onUpgrade true.; 05-06 e2e: setNotificationProviderFactory and setNotificationProviderDeps are exported from server/src/notifications/dispatcher.ts. Use them to fake outbound sends.; Events published: 'notification' created, updated or deleted, with the masked resource.; Escalation #1 (CheckHealth in buildApp) is unchanged and not touched by this plan.

## Requirements Covered
- REQ-16

## Token Usage
31 requests, 2483437 input tokens (2364404 cached), 65572 output tokens, $1.4262
