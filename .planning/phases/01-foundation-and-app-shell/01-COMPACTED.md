---
phase: 01-foundation-and-app-shell
compacted: 2026-10-12
original_summaries: [01-01-SUMMARY.md, 01-02-SUMMARY.md, 01-03-SUMMARY.md, 01-04-SUMMARY.md]
requirements_satisfied: [REQ-01, REQ-02, REQ-04, REQ-18, REQ-03]
---

# Phase 1: Foundation and App Shell — Compacted Summary

## Deliverables
- 01-01 Monorepo scaffold and server core (Complete): .gitignore, README.md, package-lock.json, package.json, server/package.json, server/src/app.test.ts, server/src/app.ts, server/src/config.ts, server/src/db/index.ts, server/src/db/migrate.ts, server/src/db/migrations/0001_initial.sql, server/src/db/schema.ts, server/src/index.ts, server/src/plugins/auth.ts, server/src/routes/system.ts, server/src/test/helpers.ts, server/tsconfig.json, server/vitest.config.ts, shared/package.json, shared/src/events.ts, shared/src/index.ts, shared/src/qualities.test.ts, shared/src/qualities.ts, shared/src/schemas.ts, shared/tsconfig.json, shared/vitest.config.ts, tsconfig.base.json, web/index.html, web/package.json, web/src/App.test.tsx, web/src/App.tsx, web/src/main.tsx, web/src/styles/index.css, web/src/test/setup.ts, web/tsconfig.json, web/vite.config.ts, web/vitest.config.ts
- 01-02 Settings API, command queue and event stream (Complete): server/src/app.ts, server/src/routes/command.test.ts, server/src/routes/command.ts, server/src/routes/config.test.ts, server/src/routes/config.ts, server/src/routes/events.test.ts, server/src/routes/events.ts, server/src/routes/quality.test.ts, server/src/routes/quality.ts, server/src/routes/rootfolder.test.ts, server/src/routes/rootfolder.ts, server/src/routes/tag.test.ts, server/src/routes/tag.ts, server/src/services/commands.ts, server/src/services/events.ts, server/src/services/seed.ts, shared/src/schemas.ts
- 01-03 Modern app shell and design system (Complete): web/index.html, web/src/App.test.tsx, web/src/App.tsx, web/src/components/layout/AppLayout.tsx, web/src/components/layout/CommandPalette.tsx, web/src/components/layout/Header.tsx, web/src/components/layout/Sidebar.tsx, web/src/components/layout/layout.test.tsx, web/src/components/layout/navigation.ts, web/src/components/ui/Badge.tsx, web/src/components/ui/Button.tsx, web/src/components/ui/Card.tsx, web/src/components/ui/ConfirmDialog.tsx, web/src/components/ui/EmptyState.tsx, web/src/components/ui/FormField.tsx, web/src/components/ui/Input.tsx, web/src/components/ui/Modal.tsx, web/src/components/ui/PageHeader.tsx, web/src/components/ui/Select.tsx, web/src/components/ui/Spinner.tsx, web/src/components/ui/Switch.tsx, web/src/components/ui/Table.tsx, web/src/components/ui/Toast.tsx, web/src/components/ui/index.ts, web/src/components/ui/ui.test.tsx, web/src/lib/api.test.ts, web/src/lib/api.ts, web/src/lib/cn.ts, web/src/lib/events.ts, web/src/lib/theme.ts, web/src/main.tsx, web/src/pages/NotFound.tsx, web/src/pages/Placeholder.tsx, web/src/routes.tsx, web/src/styles/index.css
- 01-04 Settings pages (Complete): web/src/pages/settings/General.tsx, web/src/pages/settings/MediaManagement.tsx, web/src/pages/settings/Profiles.tsx, web/src/pages/settings/Quality.tsx, web/src/pages/settings/QualityProfileEditor.tsx, web/src/pages/settings/SettingsIndex.tsx, web/src/pages/settings/Tags.tsx, web/src/pages/settings/UiSettings.tsx, web/src/pages/settings/hooks.ts, web/src/pages/settings/settings.test.tsx, web/src/routes.tsx, web/src/test/server.ts

## Decisions
- 01-01: app.decorate adds db, sqlite (raw better-sqlite3 handle) and dataDir. Module augmentation in app.ts. Exports getHostConfig(db) and ensureHostConfig(db) for late
- 01-01: Auth is registered as registerAuth(app, getApiKey) and reads the key from the config table on each request, so key changes in 01-02 take effect without a restar
- 01-01: The error handler returns 500 as {message:'Internal Server Error'} and other statuses with their own message.
- 01-02: Validation failures use a ZodError built by validationError(), so the existing error handler returns the Sonarr-style 400 with propertyName.
- 01-02: PUT config/host merges the body over the stored config and ignores apiKey and id. Changes are published as 'hostconfig' events with apiKey omitted. ui config ch
- 01-02: Profile items are stored as {quality: id, allowed} and re-expanded to full quality objects on read. Responses include items: [] on each item. Duplicate or unkno
- 01-03: The dark palette uses Sonarr's #35c5f4 cyan as the accent. Light mode uses #0a7fb0 so text keeps AA contrast.
- 01-04: Profile items stay in server order (lowest quality first). The UI shows them highest first, and "Move up" swaps toward the highest quality.
- 01-04: Disallowing the cutoff quality moves the cutoff to the highest allowed quality. If a profile is saved with no allowed qualities the cutoff is left unchanged, an
- 01-04: Quality definitions follow the server's range rules: min <= preferred <= max, each value 0-1000. An empty preferred or max is sent as null.

## Conventions and Open Questions
- 01-01 convention: Test pattern: createTestApp() returns {app, apiKey, dataDir, cleanup}. Call app.inject with the 'x-api-key' header and call cleanup() in afterEach.
- 01-01 convention: Add new migrations as server/src/db/migrations/000N_name.sql. The runner applies them in name order and is idempotent.
- 01-01 convention: Add routes as Fastify plugins that call app.get('/api/v3/...'). Auth already covers every /api and /feed path. Throw or parse with zod and ZodError becomes a 40
- 01-02 convention: Use app.events.publish(name, action, resource?) and app.commands.register(name, handler) / enqueue(name, body, trigger?).
- 01-02 convention: Events published: rootfolder, tag, qualitydefinition, qualityprofile, command, hostconfig and uiconfig.
- 01-02 convention: Tag usage arrays in tag/detail are empty and ready to fill in later phases.
- 01-03 convention: 01-04 should replace the elements in settingsRoutes (web/src/routes.tsx). Paths are relative to /settings, and { index: true } is the overview.
- 01-04 convention: hooks.ts exports the useXxx hooks for rootfolder, tag, qualitydefinition, qualityprofile, config/host and config/ui, plus errorMessage(error) and formatBytes(by
- 01-04 convention: test/server.ts mockApi(routes) can be reused for later page tests. Call api.restore() in afterEach.
- 01-04 convention: New pages should be wired through settingsRoutes in routes.tsx, using withQuery(...) if they use TanStack Query.

## Files Modified
| File | Change |
|------|--------|
| `.gitignore` | 01-01: Monorepo scaffold and server core |
| `README.md` | 01-01: Monorepo scaffold and server core |
| `package-lock.json` | 01-01: Monorepo scaffold and server core |
| `package.json` | 01-01: Monorepo scaffold and server core |
| `server/package.json` | 01-01: Monorepo scaffold and server core |
| `server/src/app.test.ts` | 01-01: Monorepo scaffold and server core |
| `server/src/app.ts` | 01-01: Monorepo scaffold and server core |
| `server/src/config.ts` | 01-01: Monorepo scaffold and server core |
| `server/src/db/index.ts` | 01-01: Monorepo scaffold and server core |
| `server/src/db/migrate.ts` | 01-01: Monorepo scaffold and server core |
| `server/src/db/migrations/0001_initial.sql` | 01-01: Monorepo scaffold and server core |
| `server/src/db/schema.ts` | 01-01: Monorepo scaffold and server core |
| `server/src/index.ts` | 01-01: Monorepo scaffold and server core |
| `server/src/plugins/auth.ts` | 01-01: Monorepo scaffold and server core |
| `server/src/routes/system.ts` | 01-01: Monorepo scaffold and server core |
| `server/src/test/helpers.ts` | 01-01: Monorepo scaffold and server core |
| `server/tsconfig.json` | 01-01: Monorepo scaffold and server core |
| `server/vitest.config.ts` | 01-01: Monorepo scaffold and server core |
| `shared/package.json` | 01-01: Monorepo scaffold and server core |
| `shared/src/events.ts` | 01-01: Monorepo scaffold and server core |
| `shared/src/index.ts` | 01-01: Monorepo scaffold and server core |
| `shared/src/qualities.test.ts` | 01-01: Monorepo scaffold and server core |
| `shared/src/qualities.ts` | 01-01: Monorepo scaffold and server core |
| `shared/src/schemas.ts` | 01-01: Monorepo scaffold and server core |
| `shared/tsconfig.json` | 01-01: Monorepo scaffold and server core |
| `shared/vitest.config.ts` | 01-01: Monorepo scaffold and server core |
| `tsconfig.base.json` | 01-01: Monorepo scaffold and server core |
| `web/index.html` | 01-01: Monorepo scaffold and server core |
| `web/package.json` | 01-01: Monorepo scaffold and server core |
| `web/src/App.test.tsx` | 01-01: Monorepo scaffold and server core |
| `web/src/App.tsx` | 01-01: Monorepo scaffold and server core |
| `web/src/main.tsx` | 01-01: Monorepo scaffold and server core |
| `web/src/styles/index.css` | 01-01: Monorepo scaffold and server core |
| `web/src/test/setup.ts` | 01-01: Monorepo scaffold and server core |
| `web/tsconfig.json` | 01-01: Monorepo scaffold and server core |
| `web/vite.config.ts` | 01-01: Monorepo scaffold and server core |
| `web/vitest.config.ts` | 01-01: Monorepo scaffold and server core |
| `server/src/app.ts` | 01-02: Settings API, command queue and event stream |
| `server/src/routes/command.test.ts` | 01-02: Settings API, command queue and event stream |
| `server/src/routes/command.ts` | 01-02: Settings API, command queue and event stream |
| `server/src/routes/config.test.ts` | 01-02: Settings API, command queue and event stream |
| `server/src/routes/config.ts` | 01-02: Settings API, command queue and event stream |
| `server/src/routes/events.test.ts` | 01-02: Settings API, command queue and event stream |
| `server/src/routes/events.ts` | 01-02: Settings API, command queue and event stream |
| `server/src/routes/quality.test.ts` | 01-02: Settings API, command queue and event stream |
| `server/src/routes/quality.ts` | 01-02: Settings API, command queue and event stream |
| `server/src/routes/rootfolder.test.ts` | 01-02: Settings API, command queue and event stream |
| `server/src/routes/rootfolder.ts` | 01-02: Settings API, command queue and event stream |
| `server/src/routes/tag.test.ts` | 01-02: Settings API, command queue and event stream |
| `server/src/routes/tag.ts` | 01-02: Settings API, command queue and event stream |
| `server/src/services/commands.ts` | 01-02: Settings API, command queue and event stream |
| `server/src/services/events.ts` | 01-02: Settings API, command queue and event stream |
| `server/src/services/seed.ts` | 01-02: Settings API, command queue and event stream |
| `shared/src/schemas.ts` | 01-02: Settings API, command queue and event stream |
| `web/index.html` | 01-03: Modern app shell and design system |
| `web/src/App.test.tsx` | 01-03: Modern app shell and design system |
| `web/src/App.tsx` | 01-03: Modern app shell and design system |
| `web/src/components/layout/AppLayout.tsx` | 01-03: Modern app shell and design system |
| `web/src/components/layout/CommandPalette.tsx` | 01-03: Modern app shell and design system |
| `web/src/components/layout/Header.tsx` | 01-03: Modern app shell and design system |
| `web/src/components/layout/Sidebar.tsx` | 01-03: Modern app shell and design system |
| `web/src/components/layout/layout.test.tsx` | 01-03: Modern app shell and design system |
| `web/src/components/layout/navigation.ts` | 01-03: Modern app shell and design system |
| `web/src/components/ui/Badge.tsx` | 01-03: Modern app shell and design system |
| `web/src/components/ui/Button.tsx` | 01-03: Modern app shell and design system |
| `web/src/components/ui/Card.tsx` | 01-03: Modern app shell and design system |
| `web/src/components/ui/ConfirmDialog.tsx` | 01-03: Modern app shell and design system |
| `web/src/components/ui/EmptyState.tsx` | 01-03: Modern app shell and design system |
| `web/src/components/ui/FormField.tsx` | 01-03: Modern app shell and design system |
| `web/src/components/ui/Input.tsx` | 01-03: Modern app shell and design system |
| `web/src/components/ui/Modal.tsx` | 01-03: Modern app shell and design system |
| `web/src/components/ui/PageHeader.tsx` | 01-03: Modern app shell and design system |
| `web/src/components/ui/Select.tsx` | 01-03: Modern app shell and design system |
| `web/src/components/ui/Spinner.tsx` | 01-03: Modern app shell and design system |
| `web/src/components/ui/Switch.tsx` | 01-03: Modern app shell and design system |
| `web/src/components/ui/Table.tsx` | 01-03: Modern app shell and design system |
| `web/src/components/ui/Toast.tsx` | 01-03: Modern app shell and design system |
| `web/src/components/ui/index.ts` | 01-03: Modern app shell and design system |
| `web/src/components/ui/ui.test.tsx` | 01-03: Modern app shell and design system |
| `web/src/lib/api.test.ts` | 01-03: Modern app shell and design system |
| `web/src/lib/api.ts` | 01-03: Modern app shell and design system |
| `web/src/lib/cn.ts` | 01-03: Modern app shell and design system |
| `web/src/lib/events.ts` | 01-03: Modern app shell and design system |
| `web/src/lib/theme.ts` | 01-03: Modern app shell and design system |
| `web/src/main.tsx` | 01-03: Modern app shell and design system |
| `web/src/pages/NotFound.tsx` | 01-03: Modern app shell and design system |
| `web/src/pages/Placeholder.tsx` | 01-03: Modern app shell and design system |
| `web/src/routes.tsx` | 01-03: Modern app shell and design system |
| `web/src/styles/index.css` | 01-03: Modern app shell and design system |
| `web/src/pages/settings/General.tsx` | 01-04: Settings pages |
| `web/src/pages/settings/MediaManagement.tsx` | 01-04: Settings pages |
| `web/src/pages/settings/Profiles.tsx` | 01-04: Settings pages |
| `web/src/pages/settings/Quality.tsx` | 01-04: Settings pages |
| `web/src/pages/settings/QualityProfileEditor.tsx` | 01-04: Settings pages |
| `web/src/pages/settings/SettingsIndex.tsx` | 01-04: Settings pages |
| `web/src/pages/settings/Tags.tsx` | 01-04: Settings pages |
| `web/src/pages/settings/UiSettings.tsx` | 01-04: Settings pages |
| `web/src/pages/settings/hooks.ts` | 01-04: Settings pages |
| `web/src/pages/settings/settings.test.tsx` | 01-04: Settings pages |
| `web/src/routes.tsx` | 01-04: Settings pages |
| `web/src/test/server.ts` | 01-04: Settings pages |

## Verification
- 01-01 (REQ-01, REQ-02): 10/10 verification commands passed
- 01-02 (REQ-02, REQ-04, REQ-18): 7/7 verification commands passed
- 01-03 (REQ-03, REQ-18): 6/6 verification commands passed
- 01-04 (REQ-03, REQ-04): 5/5 verification commands passed

## Agents
- 01-01: engineering-backend-architect
- 01-02: engineering-backend-architect
- 01-03: engineering-frontend-developer
- 01-04: engineering-frontend-developer
