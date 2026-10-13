---
phase: 04-import-activity-wanted-and-calendar
compacted: 2026-10-13
original_summaries: [04-01-SUMMARY.md, 04-02-SUMMARY.md, 04-03-SUMMARY.md, 04-04-SUMMARY.md, 04-05-SUMMARY.md]
requirements_satisfied: [REQ-12, REQ-14, REQ-15, REQ-13, REQ-03]
---

# Phase 4: Import, Activity, Wanted and Calendar — Compacted Summary

## Deliverables
- 04-01 Phase 4 foundations: settings, naming engine and shared types (Complete): server/src/app.ts, server/src/naming/naming.test.ts, server/src/naming/naming.ts, server/src/naming/tokens.ts, server/src/routes/calendar.ts, server/src/routes/manualimport.ts, server/src/routes/mediaConfig.test.ts, server/src/routes/mediaConfig.ts, server/src/routes/rename.ts, server/src/routes/wanted.ts, server/src/services/mediaConfig.ts, server/src/services/series.ts, shared/src/index.ts, shared/src/mediaManagement.ts
- 04-02 Import pipeline, completed and failed download handling, manual import and rename (Complete with Warnings): server/src/decision/specifications.ts, server/src/import/decisions.ts, server/src/import/importer.test.ts, server/src/import/importer.ts, server/src/import/transfer.ts, server/src/import/types.ts, server/src/routes/manualimport.test.ts, server/src/routes/manualimport.ts, server/src/routes/rename.ts, server/src/services/diskScan.ts, server/src/services/downloadHandling.test.ts, server/src/services/downloadHandling.ts, server/src/services/episodeFiles.ts, server/src/services/queue.ts, server/src/services/rename.ts, server/src/test/e2e.test.ts
- 04-03 Wanted, calendar and iCal feed APIs (Complete): server/src/routes/calendar.test.ts, server/src/routes/calendar.ts, server/src/routes/wanted.test.ts, server/src/routes/wanted.ts, server/src/services/ical.ts, server/src/services/wanted.ts
- 04-04 History, Blocklist, Wanted and Calendar pages (Complete): web/src/components/layout/layout.test.tsx, web/src/lib/api.ts, web/src/lib/events.ts, web/src/pages/activity/Blocklist.tsx, web/src/pages/activity/History.tsx, web/src/pages/activity/history.test.tsx, web/src/pages/activity/historyHooks.ts, web/src/pages/calendar/AgendaView.tsx, web/src/pages/calendar/Calendar.tsx, web/src/pages/calendar/ICalModal.tsx, web/src/pages/calendar/MonthView.tsx, web/src/pages/calendar/WeekView.tsx, web/src/pages/calendar/calendar.test.tsx, web/src/pages/calendar/hooks.ts, web/src/pages/wanted/CutoffUnmet.tsx, web/src/pages/wanted/Missing.tsx, web/src/pages/wanted/WantedTable.tsx, web/src/pages/wanted/hooks.ts, web/src/pages/wanted/wanted.test.tsx, web/src/routes.tsx
- 04-05 Media management settings, manual import and rename UI (Complete)

## Decisions
- 04-01: PUT on all three config routes merges a partial body onto the saved config, like the ui config route. The naming PUT also runs validateNaming and returns a 400 
- 04-01: Per-field replacements: '/' and '\' become '+', '?' becomes '!', '*' and '|' become '-', '"' becomes "'", and '<' and '>' are dropped.
- 04-01: Colons in titles follow colonReplacementFormat. 'smart' turns ': ' into ' - ' and a bare ':' into '-'.
- 04-02: Download handling runs from the RefreshMonitoredDownloads command (refresh() then processDownloads()), not inside doRefresh, so GET /queue requests never start 
- 04-03: Missing requires both the episode and its series to be monitored when monitored=true. With monitored=false it returns episodes or series that are unmonitored. T
- 04-03: Wanted sort defaults to airDateUtc, descending (pagingSchema default), with episode id as the tiebreak. Episodes with only an air_date use that date for sorting
- 04-03: Cutoff unmet only compares quality weight to the profile cutoff. I did not add the "upgradable revision when propers preferred" case, because search.ts's cutoff
- 04-04: queryKeys.history changed from a constant to history(params), as the plan specifies; the prefix is now historyAll and events.ts uses it (it was the only other u

## Conventions and Open Questions
- 04-01 convention: Use getNamingConfig, getMediaManagementConfig and getDownloadClientConfig from server/src/services/mediaConfig.ts.
- 04-01 convention: buildEpisodeFileName returns a name without an extension. It takes {series: {title, year, seriesType}, episodes (sorted), quality, releaseGroup?, sceneName?, or
- 04-01 convention: Use buildSeasonFolderName(seasonNumber, naming) for season folders. Season 0 uses specialsFolderFormat.
- 04-02 convention: Import API: getImportDecisions(app, sourcePath, {downloadId?, seriesId?, episodeIds?, quality?, releaseGroup?, filterExistingFiles?}) and importDecisions(app, d
- 04-03 convention: queryCalendar(app, {start, end, unmonitored, tags, includeSeries?, includeEpisodeFile?}) is exported from routes/calendar.ts and returns CalendarEpisode[].
- 04-03 convention: listMissing(app, opts, now?) and listCutoffUnmet(app, opts) are exported from services/wanted.ts.
- 04-03 convention: The Wanted UI calls /api/v3/wanted/missing and /cutoff with page, pageSize, sortKey, sortDirection, monitored and includeSeries. Records are Episode & {series}.
- 04-04 convention: Reusable table pieces (Pager, SkeletonRows, LoadError, SeriesLink, DateCell, useEpisodeLookup, useSeriesById) are exported from web/src/pages/activity/History.t

## Files Modified
| File | Change |
|------|--------|
| `server/src/app.ts` | 04-01: Phase 4 foundations: settings, naming engine and shared types |
| `server/src/naming/naming.test.ts` | 04-01: Phase 4 foundations: settings, naming engine and shared types |
| `server/src/naming/naming.ts` | 04-01: Phase 4 foundations: settings, naming engine and shared types |
| `server/src/naming/tokens.ts` | 04-01: Phase 4 foundations: settings, naming engine and shared types |
| `server/src/routes/calendar.ts` | 04-01: Phase 4 foundations: settings, naming engine and shared types |
| `server/src/routes/manualimport.ts` | 04-01: Phase 4 foundations: settings, naming engine and shared types |
| `server/src/routes/mediaConfig.test.ts` | 04-01: Phase 4 foundations: settings, naming engine and shared types |
| `server/src/routes/mediaConfig.ts` | 04-01: Phase 4 foundations: settings, naming engine and shared types |
| `server/src/routes/rename.ts` | 04-01: Phase 4 foundations: settings, naming engine and shared types |
| `server/src/routes/wanted.ts` | 04-01: Phase 4 foundations: settings, naming engine and shared types |
| `server/src/services/mediaConfig.ts` | 04-01: Phase 4 foundations: settings, naming engine and shared types |
| `server/src/services/series.ts` | 04-01: Phase 4 foundations: settings, naming engine and shared types |
| `shared/src/index.ts` | 04-01: Phase 4 foundations: settings, naming engine and shared types |
| `shared/src/mediaManagement.ts` | 04-01: Phase 4 foundations: settings, naming engine and shared types |
| `server/src/decision/specifications.ts` | 04-02: Import pipeline, completed and failed download handling, manual import and rename |
| `server/src/import/decisions.ts` | 04-02: Import pipeline, completed and failed download handling, manual import and rename |
| `server/src/import/importer.test.ts` | 04-02: Import pipeline, completed and failed download handling, manual import and rename |
| `server/src/import/importer.ts` | 04-02: Import pipeline, completed and failed download handling, manual import and rename |
| `server/src/import/transfer.ts` | 04-02: Import pipeline, completed and failed download handling, manual import and rename |
| `server/src/import/types.ts` | 04-02: Import pipeline, completed and failed download handling, manual import and rename |
| `server/src/routes/manualimport.test.ts` | 04-02: Import pipeline, completed and failed download handling, manual import and rename |
| `server/src/routes/manualimport.ts` | 04-02: Import pipeline, completed and failed download handling, manual import and rename |
| `server/src/routes/rename.ts` | 04-02: Import pipeline, completed and failed download handling, manual import and rename |
| `server/src/services/diskScan.ts` | 04-02: Import pipeline, completed and failed download handling, manual import and rename |
| `server/src/services/downloadHandling.test.ts` | 04-02: Import pipeline, completed and failed download handling, manual import and rename |
| `server/src/services/downloadHandling.ts` | 04-02: Import pipeline, completed and failed download handling, manual import and rename |
| `server/src/services/episodeFiles.ts` | 04-02: Import pipeline, completed and failed download handling, manual import and rename |
| `server/src/services/queue.ts` | 04-02: Import pipeline, completed and failed download handling, manual import and rename |
| `server/src/services/rename.ts` | 04-02: Import pipeline, completed and failed download handling, manual import and rename |
| `server/src/test/e2e.test.ts` | 04-02: Import pipeline, completed and failed download handling, manual import and rename |
| `server/src/routes/calendar.test.ts` | 04-03: Wanted, calendar and iCal feed APIs |
| `server/src/routes/calendar.ts` | 04-03: Wanted, calendar and iCal feed APIs |
| `server/src/routes/wanted.test.ts` | 04-03: Wanted, calendar and iCal feed APIs |
| `server/src/routes/wanted.ts` | 04-03: Wanted, calendar and iCal feed APIs |
| `server/src/services/ical.ts` | 04-03: Wanted, calendar and iCal feed APIs |
| `server/src/services/wanted.ts` | 04-03: Wanted, calendar and iCal feed APIs |
| `web/src/components/layout/layout.test.tsx` | 04-04: History, Blocklist, Wanted and Calendar pages |
| `web/src/lib/api.ts` | 04-04: History, Blocklist, Wanted and Calendar pages |
| `web/src/lib/events.ts` | 04-04: History, Blocklist, Wanted and Calendar pages |
| `web/src/pages/activity/Blocklist.tsx` | 04-04: History, Blocklist, Wanted and Calendar pages |
| `web/src/pages/activity/History.tsx` | 04-04: History, Blocklist, Wanted and Calendar pages |
| `web/src/pages/activity/history.test.tsx` | 04-04: History, Blocklist, Wanted and Calendar pages |
| `web/src/pages/activity/historyHooks.ts` | 04-04: History, Blocklist, Wanted and Calendar pages |
| `web/src/pages/calendar/AgendaView.tsx` | 04-04: History, Blocklist, Wanted and Calendar pages |
| `web/src/pages/calendar/Calendar.tsx` | 04-04: History, Blocklist, Wanted and Calendar pages |
| `web/src/pages/calendar/ICalModal.tsx` | 04-04: History, Blocklist, Wanted and Calendar pages |
| `web/src/pages/calendar/MonthView.tsx` | 04-04: History, Blocklist, Wanted and Calendar pages |
| `web/src/pages/calendar/WeekView.tsx` | 04-04: History, Blocklist, Wanted and Calendar pages |
| `web/src/pages/calendar/calendar.test.tsx` | 04-04: History, Blocklist, Wanted and Calendar pages |
| `web/src/pages/calendar/hooks.ts` | 04-04: History, Blocklist, Wanted and Calendar pages |
| `web/src/pages/wanted/CutoffUnmet.tsx` | 04-04: History, Blocklist, Wanted and Calendar pages |
| `web/src/pages/wanted/Missing.tsx` | 04-04: History, Blocklist, Wanted and Calendar pages |
| `web/src/pages/wanted/WantedTable.tsx` | 04-04: History, Blocklist, Wanted and Calendar pages |
| `web/src/pages/wanted/hooks.ts` | 04-04: History, Blocklist, Wanted and Calendar pages |
| `web/src/pages/wanted/wanted.test.tsx` | 04-04: History, Blocklist, Wanted and Calendar pages |
| `web/src/routes.tsx` | 04-04: History, Blocklist, Wanted and Calendar pages |

## Verification
- 04-01 (REQ-12, REQ-14, REQ-15): 7/7 verification commands passed
- 04-02 (REQ-12, REQ-13): 7/7 verification commands passed
- 04-03 (REQ-14, REQ-15): 4/4 verification commands passed
- 04-04 (REQ-13, REQ-14, REQ-15, REQ-03): 7/7 verification commands passed
- 04-05 (REQ-12, REQ-03): 6/6 verification commands passed

## Agents
- 04-01: engineering-backend-architect
- 04-02: engineering-senior-developer
- 04-03: engineering-backend-architect
- 04-04: engineering-frontend-developer
- 04-05: engineering-frontend-developer

## Also Covered
- web/src/pages/settings/MediaManagement.tsx
- web/src/pages/settings/NamingSettings.tsx
- web/src/pages/settings/mediaHooks.ts
- web/src/pages/settings/mediaManagement.test.tsx
- web/src/pages/settings/DownloadClients.tsx
- web/src/pages/activity/ManualImportModal.tsx
- web/src/pages/activity/Queue.tsx
- web/src/pages/activity/manualImport.test.tsx
- web/src/pages/series/RenamePreviewModal.tsx
- web/src/pages/series/SeriesDetail.tsx
- web/src/pages/series/rename.test.tsx
