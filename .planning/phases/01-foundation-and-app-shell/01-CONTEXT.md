# Phase 1: Foundation and App Shell -- Context

## Phase Goal
Working monorepo: Fastify server with SQLite, API key auth, /api/v3 system/status and settings resources (root folders, tags, quality definitions, quality profiles, host/UI config), a persisted command queue and SSE event stream, plus the modern React app shell (sidebar, theme, routing) and settings pages for those resources.

## Requirements Covered
- REQ-01
- REQ-02
- REQ-03
- REQ-04
- REQ-18

## What Already Exists (from prior phases)
- Empty repository on branch Sonarr-replica (all prior files deliberately removed by the user). Node 22 and npm 10 are installed.

## Key Design Decisions
- npm workspaces: shared/ (@sonarr/shared), server/ (@sonarr/server), web/ (@sonarr/web). shared exports TypeScript source directly (package.json exports './src/index.ts'); the server runs via tsx in dev and prod (`npm start` = tsx server/src/index.ts), so no shared build step. Typecheck with tsc --noEmit per package.
- Root scripts: dev (concurrently server tsx watch + vite), build (vite build of web + typecheck of all), start, test (`npm run test --workspaces --if-present`), typecheck (`npm run typecheck --workspaces --if-present`). Each package has its own vitest config.
- All npm dependencies for phase 1 are installed by plan 01-01; later plans of this phase must not add dependencies or edit package.json / package-lock.json.
- SQLite via better-sqlite3 with pragmas journal_mode=WAL, foreign_keys=ON, busy_timeout=5000. Migrations are versioned SQL files server/src/db/migrations/NNNN_name.sql applied in order by a runner that records them in a schema_migrations table; Drizzle ORM (drizzle-orm/better-sqlite3) schema in server/src/db/schema.ts mirrors the tables for typed queries. No drizzle-kit.
- Data dir from env SONARR_DATA (default ./data), DB file sonarr.db inside it; port from env SONARR_PORT (default 8989), bind address from host config (default 0.0.0.0).
- buildApp({ dataDir, logger?: boolean }) returns a ready Fastify instance (no listen) so tests use app.inject with a temp dir.
- API key: 32 lowercase hex chars generated with crypto.randomBytes on first run, stored in the config table (key 'host'). Accepted from X-Api-Key header or apikey query param, compared with crypto.timingSafeEqual (length check first). Unauthenticated routes: GET /ping, GET /initialize.json (returns {apiKey, urlBase, instanceName, version} for the bundled UI, as Sonarr does with initialize.js), and static UI files. Everything under /api and /feed requires the key -> 401 {message:'Unauthorized'} otherwise.
- Request bodies are validated with zod schemas from @sonarr/shared; failures return 400 with {message, errors:[{propertyName, errorMessage}]} like Sonarr's validation errors.
- Root folder paths: must be absolute, are normalized with path.resolve, must exist and be a directory, must not duplicate or be nested inside/contain an existing root folder; GET returns {id, path, accessible, freeSpace (fs.statfs), unmappedFolders: []}.
- Quality list and ids copied from Sonarr: Unknown 0, SDTV 1, DVD 2, WEBDL-1080p 3, HDTV-720p 4, WEBDL-720p 5, Bluray-720p 6, Bluray-1080p 7, WEBDL-480p 8, HDTV-1080p 9, Raw-HD 10, WEBRip-480p 12, Bluray-480p 13, WEBRip-720p 14, WEBRip-1080p 15, HDTV-2160p 16, WEBRip-2160p 17, WEBDL-2160p 18, Bluray-2160p 19, Bluray-1080p Remux 20, Bluray-2160p Remux 21; each with source (television, web, webRip, dvd, bluray, blurayRaw, unknown) and resolution. Default profiles seeded on first run: Any, SD, HD-720p, HD-1080p, Ultra-HD, HD - 720p/1080p.
- Command queue: commands persisted in a commands table (id, name, body JSON, status queued|started|completed|failed|aborted, priority, trigger manual|scheduled, message, queued_at, started_at, ended_at). Handlers registered by name; unknown names -> 400. One command runs at a time per name; on boot, rows left 'started' become 'failed' with message 'Interrupted by restart' and 'queued' rows run again. Built-in command in phase 1: 'Housekeeping' (no-op that completes).
- Event bus: typed envelope {id: monotonically increasing integer, name: resource name (e.g. 'rootfolder','tag','qualityprofile','command'), action: 'created'|'updated'|'deleted'|'sync', resource?: object, at: ISO string}. SSE at GET /api/v3/events (apikey query param allowed because EventSource cannot set headers), 15s heartbeat comment, Last-Event-ID resume from a 500-event ring buffer, listeners removed on close.
- UI design: Tailwind v4 (@tailwindcss/vite) consuming semantic CSS-variable tokens (surface, surface-raised, border, text, text-muted, accent, success, warning, danger, info) with dark-first palette; theme light/dark/system persisted in localStorage and applied by an inline script in index.html before first paint (no flash); respects prefers-reduced-motion. Sidebar with Sonarr navigation (Series: Add New, Library Import; Calendar; Activity: Queue, History, Blocklist; Wanted: Missing, Cutoff Unmet; Settings: Media Management, Profiles, Quality, Indexers, Download Clients, Import Lists, Connect, Metadata, Tags, General, UI; System: Status, Tasks, Backup, Updates, Events, Log Files), collapsible on desktop, off-canvas drawer below md. Command palette (Ctrl/Cmd+K) to jump to pages.
- Accessibility (board constraint): skip link, visible focus rings, labelled form controls, aria-live toasts, modal focus trap with Escape, quality ordering reorderable with up/down buttons (no drag-only), vitest-axe checks on shell and settings pages with zero violations.
- Board quick-assess red flag (empty branch) is expected: the project starts from scratch. Its recommendations are adopted as constraints above (constant-time key compare, pragmas, versioned migrations, persisted commands, typed events with Last-Event-ID, zod validation, canonical root folder paths, a11y criteria, breakpoints). Domain workflow: not used (autonomous default). Spec and architecture proposals: skipped (autonomous default).

## Plan Structure
- **Plan 01-01 (Wave 1)**: Monorepo scaffold and server core -- Create the npm-workspaces monorepo (shared, server, web) with all phase-1 dependencies, the shared API types/schemas, and the server core: config, SQLite with migrations, app factory, API key auth, /ping, /initialize.json and /api/v3/system/status.
- **Plan 01-02 (Wave 2)**: Settings API, command queue and event stream -- Implement the /api/v3 settings resources (rootfolder, tag, qualitydefinition, qualityprofile, config/host, config/ui), the persisted command queue (/api/v3/command) and the SSE event stream (/api/v3/events) with events published on every change.
- **Plan 01-03 (Wave 2)**: Modern app shell and design system -- Build the redesigned UI foundation: design tokens and themes, reusable accessible components, the sidebar/header layout with Sonarr's full navigation, routing with placeholder pages, the API client, query client and realtime SSE hook.
- **Plan 01-04 (Wave 3)**: Settings pages -- Build the Settings section pages wired to the API: Settings overview, Media Management (root folders), Profiles (quality profile editor), Quality (definitions), Tags, General (host config with API key) and UI settings.
