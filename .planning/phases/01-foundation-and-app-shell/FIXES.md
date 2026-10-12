# Phase 1: Foundation and App Shell — Review Fixes

Fixes applied by the review loop, one section per cycle. Re-review decides whether each one holds.

## Cycle 1

**Date**: 2026-10-12
**Checks**: 17/17 passed
**Files changed**: `server/src/app.test.ts`, `server/src/app.ts`, `server/src/index.ts`, `server/src/routes/events.test.ts`, `server/src/services/events.ts`, `web/src/components/layout/Sidebar.tsx`, `web/src/components/ui/Input.tsx`, `web/src/components/ui/Switch.tsx`, `web/src/styles/index.css`

| Finding | Severity | File | Agent | Status | Notes |
|---------|----------|------|-------|--------|-------|
| F-001 | major | `server/src/services/events.ts (consumer /home/user/Traid-tests/server/src/routes/events.ts)` | engineering-senior-developer | fix applied | F-001 fixed. EventBus ids are now seeded from Date.now() (constructor takes an optional startId). A client reconnecting after a restart with an old id such as 40 therefore gets the buffered events instead of silent drops. I added a regression test for that case. |
| F-002 | critical | `server/src/app.ts` | engineering-backend-architect | fix applied | F-002 fixed. `/initialize.json` now returns `host.apiKey` only to loopback clients (127.x, ::1, ::ffff:127.x). Other callers get `apiKey: ''` plus the public fields. The local web UI still bootstraps as before. `app.test.ts` now checks both cases. |
| F-004 | major | `web/src/components/ui/Input.tsx (same tokens in Select.tsx, Switch.tsx), /home/user/Traid-tests/web/src/styles/index.css` | engineering-frontend-developer | fix applied | F-004, F-005 and F-007 are fixed. I did not run the new startup code in index.ts or the new Sidebar focus handling, and I added no tests for them. - F-004: new `--control-border` token (light #76829a, dark #6b7a96) used on inputs, selects and the switch off-track. I computed the contrast against the fills and surfaces it sits on: 3.4 to 3.9:1 in light, 3.9 to 4.5:1 in dark. - F-005: while the drawer is open, the Sidebar moves focus in, traps Tab, closes on Escape, sets `inert` on the page content, and restores focus to the opener on close. - F-007: `index.ts` now listens on `host.port` (the `SONARR_PORT` env var overrides it). It also strips the persisted `urlBase` from incoming requests before routing, so `/sonarr/api/v3/...` resolves. |
| F-005 | major | `web/src/components/layout/Sidebar.tsx` | engineering-frontend-developer | fix applied | F-004, F-005 and F-007 are fixed. I did not run the new startup code in index.ts or the new Sidebar focus handling, and I added no tests for them. - F-004: new `--control-border` token (light #76829a, dark #6b7a96) used on inputs, selects and the switch off-track. I computed the contrast against the fills and surfaces it sits on: 3.4 to 3.9:1 in light, 3.9 to 4.5:1 in dark. - F-005: while the drawer is open, the Sidebar moves focus in, traps Tab, closes on Escape, sets `inert` on the page content, and restores focus to the opener on close. - F-007: `index.ts` now listens on `host.port` (the `SONARR_PORT` env var overrides it). It also strips the persisted `urlBase` from incoming requests before routing, so `/sonarr/api/v3/...` resolves. |
| F-007 | major | `server/src/index.ts (also server/src/routes/config.ts, web/src/pages/settings/General.tsx)` | engineering-frontend-developer | fix applied | F-004, F-005 and F-007 are fixed. I did not run the new startup code in index.ts or the new Sidebar focus handling, and I added no tests for them. - F-004: new `--control-border` token (light #76829a, dark #6b7a96) used on inputs, selects and the switch off-track. I computed the contrast against the fills and surfaces it sits on: 3.4 to 3.9:1 in light, 3.9 to 4.5:1 in dark. - F-005: while the drawer is open, the Sidebar moves focus in, traps Tab, closes on Escape, sets `inert` on the page content, and restores focus to the opener on close. - F-007: `index.ts` now listens on `host.port` (the `SONARR_PORT` env var overrides it). It also strips the persisted `urlBase` from incoming requests before routing, so `/sonarr/api/v3/...` resolves. |

## Cycle 2

**Date**: 2026-10-12
**Checks**: 17/17 passed
**Files changed**: `server/src/app.test.ts`, `server/src/app.ts`, `server/src/index.ts`

| Finding | Severity | File | Agent | Status | Notes |
|---------|----------|------|-------|--------|-------|
| F-002 | critical | `server/src/app.ts` | engineering-backend-architect | not fixed | partial |
| F-008 | major | `server/src/index.ts` | engineering-backend-architect | not fixed | partial |
