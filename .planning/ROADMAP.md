# Sonarr Replica — Roadmap

## Phases

- [x] Phase 1: Foundation and App Shell (4 plans)
- [x] Phase 2: Series Library (4 plans)
- [x] Phase 3: Indexers, Search and Download Clients (4 plans)
- [x] Phase 4: Import, Activity, Wanted and Calendar (4 plans)
- [x] Phase 5: Connections, System and Polish (3 plans)

## Phase Details

### Phase 1: Foundation and App Shell
**Goal**: Working monorepo: Fastify server with SQLite/Drizzle, API key auth, /api/v3 system/status and settings resources (root folders, tags, quality definitions, quality profiles, general/UI config), command queue and SSE event stream skeleton, plus the modern React app shell (sidebar, theme, routing, settings pages for those resources).
**Requirements**: REQ-01, REQ-02, REQ-03, REQ-04, REQ-18
**Recommended Agents**: engineering-backend-architect, engineering-frontend-developer, design-ui-designer
**Success Criteria**:
- [ ] npm install && npm run build && npm test pass from a clean checkout
- [ ] Requests without a valid API key get 401; with it, GET /api/v3/system/status returns version and paths
- [ ] Root folders, tags and quality profiles can be created, edited and deleted in the UI and persist across restart
- [ ] UI has a sidebar with all Sonarr sections, dark/light toggle, and works at mobile width
**Plans**: 4

### Phase 2: Series Library
**Goal**: Add, browse and manage series: TVmaze metadata lookup, add-series flow, series/season/episode storage, series index views and series detail with monitoring, edit/delete/refresh, and disk scan that parses filenames and links existing episode files.
**Requirements**: REQ-05, REQ-06, REQ-07
**Recommended Agents**: engineering-backend-architect, engineering-frontend-developer
**Success Criteria**:
- [ ] Searching a show name returns lookup results (fake provider in tests) and adding it creates series, seasons and episodes
- [ ] Series index shows poster, overview and table views with sort and filter
- [ ] Episode monitoring toggles persist per episode and season
- [ ] Disk scan of a folder with S01E01-style files links them as episode files with detected quality
**Plans**: 4

### Phase 3: Indexers, Search and Download Clients
**Goal**: Find and grab releases: Newznab/Torznab indexers, the release title parser and decision engine, automatic/interactive search, scheduled RSS sync, download clients (SABnzbd, NZBGet, qBittorrent, Transmission) and the activity queue.
**Requirements**: REQ-08, REQ-09, REQ-10, REQ-11
**Recommended Agents**: engineering-backend-architect, engineering-senior-developer, engineering-frontend-developer
**Success Criteria**:
- [ ] Parser unit tests cover standard, daily, anime and multi-episode titles with quality detection
- [ ] Decision engine rejects releases outside the profile, below cutoff upgrades, wrong size or blocklisted, with reasons
- [ ] Interactive search shows releases with rejections and a grab sends the release to a (fake) download client
- [ ] Queue shows items reported by download clients with progress
**Plans**: 4

### Phase 4: Import, Activity, Wanted and Calendar
**Goal**: Close the loop: completed download handling with naming templates and upgrades, history and blocklist, Wanted (missing/cutoff unmet) with searches, calendar views and iCal feed, and media management settings.
**Requirements**: REQ-12, REQ-13, REQ-14, REQ-15
**Recommended Agents**: engineering-backend-architect, engineering-frontend-developer
**Success Criteria**:
- [ ] A completed download is imported, renamed by the template into the series/season folder and recorded in history
- [ ] An upgrade replaces the old file (recycle bin optional)
- [ ] Wanted lists missing and cutoff-unmet episodes and can trigger searches
- [ ] Calendar shows upcoming episodes by month/week/agenda and /feed/v3/calendar/sonarr.ics returns valid iCal
**Plans**: 4

### Phase 5: Connections, System and Polish
**Goal**: Notifications (Webhook, Discord, Email), system pages (status, health, tasks with run-now, logs, backups), realtime UI updates wired across pages, and e2e smoke tests of the main workflow.
**Requirements**: REQ-16, REQ-17, REQ-18
**Recommended Agents**: engineering-senior-developer, engineering-frontend-developer, testing-qa-verification-specialist
**Success Criteria**:
- [ ] Notifications fire on the selected events and can be tested from the UI
- [ ] System pages show status, health issues, scheduled tasks (run now works), logs and backups (create, download, restore)
- [ ] Queue and command progress update live without a page reload
- [ ] Playwright smoke test adds a series, runs a search and sees the queue using fakes
**Plans**: 3

## Milestones

### Milestone 1: v1 Sonarr Replica
- **Phases**: 1-5
- **Goal**: A self-hosted TV series PVR with Sonarr's core feature set (library, indexers, decision engine, download clients, import/rename, activity, wanted, calendar, notifications, system) in modern TypeScript with a redesigned modern UI.
- **Status**: Complete
- **Completed**: 2026-10-13

## Progress

| Phase | Plans | Completed | Status |
|-------|-------|-----------|--------|
| 1 | 4 | 4 | Complete |
| 2 | 4 | 4 | Complete |
| 3 | 5 | 5 | Complete |
| 4 | 5 | 5 | Complete |
| 5 | 6 | 6 | Shipped |
