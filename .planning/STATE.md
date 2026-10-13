# Project State

## Current Position
- **Phase**: 5 of 5 (complete)
- **Status**: Phase 5 shipped (2026-10-13)
- **Last Activity**: Phase 5 shipped (2026-10-13)

## Progress
```
[####################] 100% — 24/24 plans complete
```

## Recent Decisions
- Quick task (2026-10-13): fixed setup redirect race, light-theme contrast tokens and home-link name (axe clean), and grabs reusing a download id (latest grab wins; import/fail history scoped to that grab) found by the e2e suite
- Quick task (2026-10-13): Sonarr v4-style auth (forms login + sessions, Authentication Required enabled/disabledForLocalAddresses, external), initialize.json gives the API key only to authorized callers, URL base moved into buildApp — resolves review findings F-002/F-008/F-009
- Assumed: TypeScript full stack (Fastify + SQLite/Drizzle + React/Vite/Tailwind) instead of Sonarr's C#/.NET + React
- Assumed: TVmaze as the metadata provider
- Assumed: 'exact replica functionality-wise' covers Sonarr's core workflow (library, indexers, decision engine, download clients, import/rename, activity, wanted, calendar, notifications, system); long-tail providers are out of scope
- Assumed: API shaped after Sonarr's /api/v3 (resource names and main fields) with API key auth
- Assumed: modern redesign uses Tailwind with a dark-first theme, card/poster grid, sidebar, command-palette search
- Assumed: SSE for realtime events instead of SignalR

## Next Action
All phases complete — project review finished!

## Phase 1 Results
(build started 2026-10-12)
- Plan 01-01 (Wave 1): Monorepo scaffold and server core — Complete
- Plan 01-02 (Wave 2): Settings API, command queue and event stream — Complete
- Plan 01-03 (Wave 2): Modern app shell and design system — Complete
- Plan 01-04 (Wave 3): Settings pages — Complete

## Phase 2 Results
(build started 2026-10-13)
- Plan 02-01 (Wave 1): Series data model, TVmaze provider and series API — PARTIAL: Schema, shared types and monitoring, TVmaze provider with fake, and the /api/v3/series service and routes are all done and tested. Two stale assertions in server/src/app.test.ts fail, and that file is
- Plan 02-02 (Wave 1): Filename and release title parser — Complete
- Plan 02-01 (Wave 1): Series data model, TVmaze provider and series API — PARTIAL: All three tasks are implemented on disk. Typecheck passes, shared tests pass (12), and every series and tvmaze test passes. Full server suite has 2 failures (254 of 256 pass) in server/src/app.test.ts
- Plan 02-01 (Wave 1): Series data model, TVmaze provider and series API — Complete
- Plan 02-03 (Wave 2): Episodes API, refresh and disk scan commands, library import — Complete with Warnings
- Plan 02-04 (Wave 2): Series UI: add, library import, index and detail — Complete

## Phase 3 Results
(build started 2026-10-13)
- Plan 03-01 (Wave 1): Phase 3 foundations: schema, shared types, scheduler, history and blocklist — Complete
- Plan 03-02 (Wave 2): Newznab and Torznab indexers — Complete
- Plan 03-03 (Wave 2): Download clients and queue tracking — Complete
- Plan 03-05 (Wave 2): Indexer, download client, queue and interactive search UI — Complete with Warnings
- Plan 03-04 (Wave 3): Decision engine, search, RSS sync and grabbing — Complete

## Phase 4 Results
(build started 2026-10-13)
- Plan 04-01 (Wave 1): Phase 4 foundations: settings, naming engine and shared types — Complete
- Plan 04-02 (Wave 2): Import pipeline, completed and failed download handling, manual import and rename — Complete with Warnings
- Plan 04-03 (Wave 2): Wanted, calendar and iCal feed APIs — Complete
- Plan 04-04 (Wave 2): History, Blocklist, Wanted and Calendar pages — Complete
- Plan 04-05 (Wave 2): Media management settings, manual import and rename UI — PARTIAL: All three tasks are implemented and their targeted tests pass (18 tests). The full typecheck, full web suite and build are blocked by something outside this plan. web/src/routes.tsx imports ./pages/ca
- Plan 04-05 (Wave 2): Media management settings, manual import and rename UI — Complete

## Phase 5 Results
(build started 2026-10-13)
- Plan 05-01 (Wave 1): Phase 5 foundations: schema, types, logging, health, static UI and web plumbing — Complete
- Plan 05-02 (Wave 2): Notifications: Webhook, Discord and Email — Complete
- Plan 05-03 (Wave 2): Backups, restore, restart and housekeeping — Complete
- Plan 05-04 (Wave 2): System pages — PARTIAL: All six System pages, the system hooks and the sidebar health badge are built, along with 17 tests including axe checks. Web typecheck, the full web test suite (218 tests) and the web build all pass. 
- Plan 05-05 (Wave 2): Connect settings and live command activity — Complete
- Plan 05-04 (Wave 2): System pages — Complete
- Plan 05-06 (Wave 3): End-to-end smoke tests with Playwright — PARTIAL: Playwright e2e is set up and `npx playwright test` exits 0 (24 passed, 2 skipped). The full desktop flow passes. On mobile, steps 5 and 7 are test.fixme because they fail at the second import in one s
- Plan 05-06 (Wave 3): End-to-end smoke tests with Playwright — Complete
