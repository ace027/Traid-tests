# Milestone 1: v1 Sonarr Replica — Summary

## Completed
2026-10-13

## Goal
A self-hosted TV series PVR with Sonarr's core feature set (library, indexers, decision engine, download clients, import/rename, activity, wanted, calendar, notifications, system) in modern TypeScript with a redesigned modern UI.

## Metrics
| Metric | Value |
|--------|-------|
| Phases | 5 |
| Plans completed | 24/24 |
| Requirements satisfied | n/a |
| Key files | 254 created/modified |

## Phase Outcomes
| Phase | Name | Plans | Key Deliverable |
|-------|------|-------|-----------------|
| 1 | Foundation and App Shell | 4/4 | npm-workspaces TypeScript monorepo (Fastify + SQLite, React + Vite + Tailwind) with Sonarr v4-style forms auth, /api/v3 settings resources, persisted command queue, SSE events and the redesigned app shell with settings pages |
| 2 | Series Library | 4/4 | Series library: TVmaze lookup and add-series flow, linear-time release/filename parser, refresh and disk-scan commands, library import, and poster/overview/table index plus series detail with monitoring |
| 3 | Indexers, Search and Download Clients | 5/5 | Newznab/Torznab indexers, Sonarr-rule decision engine with rejection reasons, automatic/interactive search and scheduled RSS sync, SABnzbd/NZBGet/qBittorrent/Transmission clients and a live queue |
| 4 | Import, Activity, Wanted and Calendar | 5/5 | Import pipeline with naming templates, upgrades and recycle bin, completed/failed download handling, manual import and rename, History/Blocklist/Wanted pages, and month/week/agenda calendar with an RFC 5545 iCal feed |
| 5 | Connections, System and Polish | 6/6 | Webhook/Discord/Email notifications, health checks, logs, zip backups with restore and restart, system pages, live command activity, the server serving the built UI, and Playwright e2e smoke tests at desktop and mobile sizes |

## Key Decisions
- TypeScript full stack (Fastify + SQLite/Drizzle + React/Vite/Tailwind) instead of Sonarr's C#/.NET
- TVmaze as the metadata provider (free, no API key)
- Scope covers Sonarr's core workflow; long-tail providers, import lists, custom formats and self-update are out of scope
- API shaped after Sonarr's /api/v3 with API key auth, plus Sonarr v4-style forms login and sessions
- Modern dark-first Tailwind design with sidebar, poster grid and command palette; WCAG AA contrast and axe-clean pages
- SSE for realtime events instead of SignalR
- No new runtime dependencies beyond the initial stack: XML reader, bencode, SMTP client and zip writer are built in-house
- Grabs reusing a download id map to the latest grab only (found by the e2e suite)
- Triad's SPEND.json cost log is not tracked in git

## Files Created
- README.md
- package-lock.json
- package.json
- server/package.json
- server/src/app.test.ts
- server/src/app.ts
- server/src/config.ts
- server/src/db/index.ts
- server/src/db/migrate.ts
- server/src/db/migrations/0001_initial.sql
- server/src/db/migrations/0004_indexers_downloads.sql
- server/src/db/migrations/0005_notifications.sql
- server/src/db/schema.ts
- server/src/decision/engine.test.ts
- server/src/decision/engine.ts
- server/src/decision/prioritize.ts
- server/src/decision/specifications.ts
- server/src/decision/types.ts
- server/src/downloadClients/bencode.ts
- server/src/downloadClients/clients.test.ts
- server/src/downloadClients/nzbget.ts
- server/src/downloadClients/qbittorrent.ts
- server/src/downloadClients/registry.ts
- server/src/downloadClients/sabnzbd.ts
- server/src/downloadClients/transmission.ts
- server/src/downloadClients/types.ts
- server/src/import/decisions.ts
- server/src/import/importer.test.ts
- server/src/import/importer.ts
- server/src/import/transfer.ts
- server/src/import/types.ts
- server/src/index.ts
- server/src/indexers/newznab.test.ts
- server/src/indexers/newznab.ts
- server/src/indexers/registry.ts
- server/src/indexers/types.ts
- server/src/indexers/xml.test.ts
- server/src/indexers/xml.ts
- server/src/naming/naming.test.ts
- server/src/naming/naming.ts
- server/src/naming/tokens.ts
- server/src/notifications/discord.ts
- server/src/notifications/dispatcher.ts
- server/src/notifications/email.ts
- server/src/notifications/notifications.test.ts
- server/src/notifications/payload.ts
- server/src/notifications/smtp.test.ts
- server/src/notifications/smtp.ts
- server/src/notifications/types.ts
- server/src/notifications/webhook.ts
- server/src/parser/index.ts
- server/src/parser/parser.test.ts
- server/src/parser/parser.ts
- server/src/parser/quality.test.ts
- server/src/parser/quality.ts
- server/src/parser/types.ts
- server/src/plugins/auth.ts
- server/src/plugins/staticUi.test.ts
- server/src/plugins/staticUi.ts
- server/src/routes/backup.ts
- server/src/routes/blocklist.ts
- server/src/routes/calendar.test.ts
- server/src/routes/calendar.ts
- server/src/routes/command.test.ts
- server/src/routes/command.ts
- server/src/routes/config.test.ts
- server/src/routes/config.ts
- server/src/routes/downloadclient.test.ts
- server/src/routes/downloadclient.ts
- server/src/routes/episode.test.ts
- server/src/routes/episode.ts
- server/src/routes/episodefile.ts
- server/src/routes/events.test.ts
- server/src/routes/events.ts
- server/src/routes/history.test.ts
- server/src/routes/history.ts
- server/src/routes/indexer.test.ts
- server/src/routes/indexer.ts
- server/src/routes/manualimport.test.ts
- server/src/routes/manualimport.ts
- server/src/routes/mediaConfig.test.ts
- server/src/routes/mediaConfig.ts
- server/src/routes/notification.test.ts
- server/src/routes/notification.ts
- server/src/routes/quality.test.ts
- server/src/routes/quality.ts
- server/src/routes/release.test.ts
- server/src/routes/release.ts
- server/src/routes/rename.ts
- server/src/routes/rootfolder.test.ts
- server/src/routes/rootfolder.ts
- server/src/routes/system.ts
- server/src/routes/systemExtra.ts
- server/src/routes/tag.test.ts
- server/src/routes/tag.ts
- server/src/routes/wanted.test.ts
- server/src/routes/wanted.ts
- server/src/services/backup.test.ts
- server/src/services/backup.ts
- server/src/services/blocklist.ts
- server/src/services/commands.ts
- server/src/services/diskScan.test.ts
- server/src/services/diskScan.ts
- server/src/services/downloadHandling.test.ts
- server/src/services/downloadHandling.ts
- server/src/services/episodeFiles.ts
- server/src/services/episodes.ts
- server/src/services/events.ts
- server/src/services/grab.ts
- server/src/services/health.test.ts
- server/src/services/health.ts
- server/src/services/history.ts
- server/src/services/housekeeping.test.ts
- server/src/services/housekeeping.ts
- server/src/services/ical.ts
- server/src/services/logs.test.ts
- server/src/services/logs.ts
- server/src/services/mediaConfig.ts
- server/src/services/queue.test.ts
- server/src/services/queue.ts
- server/src/services/refresh.test.ts
- server/src/services/refresh.ts
- server/src/services/rename.ts
- server/src/services/rss.ts
- server/src/services/scheduler.test.ts
- server/src/services/scheduler.ts
- server/src/services/search.test.ts
- server/src/services/search.ts
- server/src/services/seed.ts
- server/src/services/series.ts
- server/src/services/wanted.ts
- server/src/services/zip.test.ts
- server/src/services/zip.ts
- server/src/test/e2e.test.ts
- server/src/test/fakeDownloadClient.ts
- server/src/test/fakeIndexer.ts
- server/src/test/helpers.ts
- server/tsconfig.json
- server/vitest.config.ts
- shared/package.json
- shared/src/events.ts
- shared/src/index.ts
- shared/src/indexers.ts
- shared/src/mediaManagement.ts
- shared/src/qualities.test.ts
- shared/src/qualities.ts
- shared/src/schemas.ts
- shared/src/system.ts
- shared/tsconfig.json
- shared/vitest.config.ts
- src/notifications/types.ts
- tsconfig.base.json
- web/index.html
- web/package.json
- web/src/App.test.tsx
- web/src/App.tsx
- web/src/components/layout/AppLayout.tsx
- web/src/components/layout/CommandActivity.tsx
- web/src/components/layout/CommandPalette.tsx
- web/src/components/layout/Header.tsx
- web/src/components/layout/Sidebar.tsx
- web/src/components/layout/commandActivity.test.tsx
- web/src/components/layout/layout.test.tsx
- web/src/components/layout/navigation.ts
- web/src/components/ui/Badge.tsx
- web/src/components/ui/Button.tsx
- web/src/components/ui/Card.tsx
- web/src/components/ui/ConfirmDialog.tsx
- web/src/components/ui/EmptyState.tsx
- web/src/components/ui/FormField.tsx
- web/src/components/ui/Input.tsx
- web/src/components/ui/Modal.tsx
- web/src/components/ui/PageHeader.tsx
- web/src/components/ui/Select.tsx
- web/src/components/ui/Spinner.tsx
- web/src/components/ui/StatusBadge.tsx
- web/src/components/ui/Switch.tsx
- web/src/components/ui/Table.tsx
- web/src/components/ui/Toast.tsx
- web/src/components/ui/index.ts
- web/src/components/ui/ui.test.tsx
- web/src/lib/api.test.ts
- web/src/lib/api.ts
- web/src/lib/cn.ts
- web/src/lib/events.ts
- web/src/lib/theme.ts
- web/src/main.tsx
- web/src/pages/NotFound.tsx
- web/src/pages/Placeholder.tsx
- web/src/pages/activity/Blocklist.tsx
- web/src/pages/activity/History.tsx
- web/src/pages/activity/Queue.tsx
- web/src/pages/activity/RemoveQueueItemModal.tsx
- web/src/pages/activity/history.test.tsx
- web/src/pages/activity/historyHooks.ts
- web/src/pages/activity/hooks.ts
- web/src/pages/activity/queue.test.tsx
- web/src/pages/calendar/AgendaView.tsx
- web/src/pages/calendar/Calendar.tsx
- web/src/pages/calendar/ICalModal.tsx
- web/src/pages/calendar/MonthView.tsx
- web/src/pages/calendar/WeekView.tsx
- web/src/pages/calendar/calendar.test.tsx
- web/src/pages/calendar/hooks.ts
- web/src/pages/series/AddNew.tsx
- web/src/pages/series/AddSeriesModal.tsx
- web/src/pages/series/DeleteSeriesModal.tsx
- web/src/pages/series/EditSeriesModal.tsx
- web/src/pages/series/InteractiveSearchModal.tsx
- web/src/pages/series/LibraryImport.tsx
- web/src/pages/series/SeasonSection.tsx
- web/src/pages/series/SeriesDetail.tsx
- web/src/pages/series/SeriesIndex.tsx
- web/src/pages/series/SeriesPoster.tsx
- web/src/pages/series/fixtures.ts
- web/src/pages/series/hooks.ts
- web/src/pages/series/interactiveSearch.test.tsx
- web/src/pages/series/series.test.tsx
- web/src/pages/settings/Connect.tsx
- web/src/pages/settings/DownloadClientModal.tsx
- web/src/pages/settings/DownloadClients.tsx
- web/src/pages/settings/General.tsx
- web/src/pages/settings/IndexerModal.tsx
- web/src/pages/settings/Indexers.tsx
- web/src/pages/settings/MediaManagement.tsx
- web/src/pages/settings/NotificationModal.tsx
- web/src/pages/settings/Profiles.tsx
- web/src/pages/settings/Quality.tsx
- web/src/pages/settings/QualityProfileEditor.tsx
- web/src/pages/settings/SettingsIndex.tsx
- web/src/pages/settings/Tags.tsx
- web/src/pages/settings/UiSettings.tsx
- web/src/pages/settings/connect.test.tsx
- web/src/pages/settings/hooks.ts
- web/src/pages/settings/providers.test.tsx
- web/src/pages/settings/settings.test.tsx
- web/src/pages/system/Backup.tsx
- web/src/pages/system/Events.tsx
- web/src/pages/system/LogFiles.tsx
- web/src/pages/system/Status.tsx
- web/src/pages/system/Tasks.tsx
- web/src/pages/system/Updates.tsx
- web/src/pages/wanted/CutoffUnmet.tsx
- web/src/pages/wanted/Missing.tsx
- web/src/pages/wanted/WantedTable.tsx
- web/src/pages/wanted/hooks.ts
- web/src/pages/wanted/wanted.test.tsx
- web/src/routes.tsx
- web/src/styles/index.css
- web/src/test/server.ts
- web/src/test/setup.ts
- web/tsconfig.json
- web/vite.config.ts
- web/vitest.config.ts

## Archive Location
.planning/archive/milestone-1/
