# Phase 1: Foundation and App Shell — Review Summary

## Result: ESCALATED

**Cycles Used**: 3
**Reviewers**: testing-qa-verification-specialist, engineering-senior-developer, engineering-frontend-developer, design-ux-architect
**Evaluators**: code-quality, ui-ux, integration, business-logic
**Completed**: 2026-10-12

## Findings Summary
- Must-fix (blocker, critical, major) found: 7; fixed: 4; unresolved: 3
- Suggestions (minor, advisory): 2
- Deferred (confidence 50-79%): 31
- Hot spots (flagged by 2+ reviewers): `server/src/app.ts`, `server/src/routes/quality.ts`, `server/src/routes/rootfolder.ts`, `web/src/components/layout/Sidebar.tsx`, `web/src/pages/settings/Profiles.tsx`, `web/src/pages/settings/Tags.tsx`, `server/src/index.ts`, `server/src/app.test.ts`

## Findings Detail
| ID | Severity | Location | Issue | Reviewers | Confidence | Status |
|----|----------|----------|-------|-----------|------------|--------|
| F-001 | major | `server/src/services/events.ts (consumer /home/user/Traid-tests/server/src/routes/events.ts):9-10` | `EventBus.nextId` starts at 1 on every process start, and the buffer lives only in memory. The route reads `Last-Event-ID` and then drops any event with `id <= high`. A browser that reconnects after a server restart sends its old last id, for example 40, while the new server is at id 3. The server then silently drops every event until its counter passes 40. | testing-qa-verification-specialist | 85% | fixed |
| F-002 | critical | `server/src/app.ts:94-103` | F-002 is still only partly fixed. `/initialize.json` is unauthenticated and now decides on two things: a loopback `request.ip` and the absence of five proxy headers. `trustProxy` is still unset. The header check only works if the proxy adds those headers. A stock nginx `proxy_pass` adds no X-Forwarded-*. Caddy `reverse_proxy` adds X-Forwarded-* by default, but Traefik and others can be configured to omit them. A proxy that sends none of them leaves the peer at 127.0.0.1, so any remote user gets the API key. A local process or a browser page can also read the key from loopback with no headers (for example via DNS rebinding, because Host is not checked). The reverse case is unchanged. With Docker port mapping, or with the UI opened from another LAN machine, the peer is not loopback. Those clients get `apiKey: ''` and every UI call returns 401 (the UI needs the key, and `/initialize.json` is where it gets it). | testing-qa-verification-specialist, evaluator:code-quality, evaluator:integration, evaluator:business-logic | 80% | open |
| F-003 | minor | `web/src/pages/settings/Profiles.tsx:10-11` | `schema` (the `qualityprofile/schema` query) has its error and loading state ignored. If it fails, "Add profile" stays disabled forever with no message and no retry. | engineering-frontend-developer | 80% | deferred |
| F-004 | major | `web/src/components/ui/Input.tsx (same tokens in Select.tsx, Switch.tsx), /home/user/Traid-tests/web/src/styles/index.css:9` | Form control boundaries use `border-border` against `bg-surface-sunken`. Light: #dbe0ea on #eceff5 is about 1.1:1. Dark: #263044 on #0a0e17 is about 1.4:1. The Switch off-state track border (`border-strong` #c3cad8 on a white card) is about 1.6:1. | design-ux-architect | 85% | fixed |
| F-005 | major | `web/src/components/layout/Sidebar.tsx:47-56` | The mobile drawer is an overlay that hides the page but is not modal. Focus is not trapped, so Tab leaves the drawer into the hidden page content and header. The rest of the page is not made inert. On close, via Escape, the overlay, the X button or a route change, focus is not returned to the "Open navigation" button, so it falls to `body`. | design-ux-architect | 80% | fixed |
| F-006 | minor | `server/package.json, server/src/app.ts:12-13` | `@fastify/static` is a declared dependency but nothing imports it. `npm start` runs the server only and never serves the built `web/dist`. The root `build` script only typechecks and builds the web package. | evaluator:code-quality | 80% | deferred |
| F-007 | major | `server/src/index.ts (also server/src/routes/config.ts, web/src/pages/settings/General.tsx):5-10` | The General settings page lets the user save `port` and `urlBase`. It tells them "Changes ... need a restart." The server never uses either value. It listens on `config.port` from the `SONARR_PORT` env var, defaulting to 8989. It registers all routes without a URL-base prefix. | evaluator:business-logic | 85% | fixed |
| F-008 | major | `server/src/index.ts:12-21` | The F-008 fix is correct in the code. `/sonarr?apikey=x` now becomes `/?apikey=x`, and paths outside the base are rewritten to a route nothing serves, so they 404. The rewrite sits in the entry point and is attached to the live HTTP server. No test covers it, because `app.test.ts` only uses `inject` through `createTestApp`, which never loads `index.ts`. The base-with-query case, the bare base, the base followed by a slash, and the outside-base 404 therefore have no regression guard. | testing-qa-verification-specialist, engineering-senior-developer, evaluator:business-logic | 85% | open |
| F-009 | major | `server/src/app.test.ts:22-40` | The test only asserts the heuristic behaviour (loopback gives the key, remote gives none, proxy headers give none). It has no case for a loopback peer with no proxy headers but a non-local Host header. It has no case for a non-loopback peer such as a Docker bridge address, which the UI cannot use. Nothing tests the URL-base rewrite in `server/src/index.ts` (lines 13-24). That rewrite is top-level code with no exported function, so the F-008 fixes (the `?` case, and requests outside the base returning 404) have no regression test. | testing-qa-verification-specialist, engineering-frontend-developer, evaluator:code-quality | 80% | open |

## Unresolved Findings
| ID | Severity | Location | Issue | Reviewers | Confidence | Status |
|----|----------|----------|-------|-----------|------------|--------|
| F-002 | critical | `server/src/app.ts:94-103` | F-002 is still only partly fixed. `/initialize.json` is unauthenticated and now decides on two things: a loopback `request.ip` and the absence of five proxy headers. `trustProxy` is still unset. The header check only works if the proxy adds those headers. A stock nginx `proxy_pass` adds no X-Forwarded-*. Caddy `reverse_proxy` adds X-Forwarded-* by default, but Traefik and others can be configured to omit them. A proxy that sends none of them leaves the peer at 127.0.0.1, so any remote user gets the API key. A local process or a browser page can also read the key from loopback with no headers (for example via DNS rebinding, because Host is not checked). The reverse case is unchanged. With Docker port mapping, or with the UI opened from another LAN machine, the peer is not loopback. Those clients get `apiKey: ''` and every UI call returns 401 (the UI needs the key, and `/initialize.json` is where it gets it). | testing-qa-verification-specialist, evaluator:code-quality, evaluator:integration, evaluator:business-logic | 80% | open |
| F-008 | major | `server/src/index.ts:12-21` | The F-008 fix is correct in the code. `/sonarr?apikey=x` now becomes `/?apikey=x`, and paths outside the base are rewritten to a route nothing serves, so they 404. The rewrite sits in the entry point and is attached to the live HTTP server. No test covers it, because `app.test.ts` only uses `inject` through `createTestApp`, which never loads `index.ts`. The base-with-query case, the bare base, the base followed by a slash, and the outside-base 404 therefore have no regression guard. | testing-qa-verification-specialist, engineering-senior-developer, evaluator:business-logic | 85% | open |
| F-009 | major | `server/src/app.test.ts:22-40` | The test only asserts the heuristic behaviour (loopback gives the key, remote gives none, proxy headers give none). It has no case for a loopback peer with no proxy headers but a non-local Host header. It has no case for a non-loopback peer such as a Docker bridge address, which the UI cannot use. Nothing tests the URL-base rewrite in `server/src/index.ts` (lines 13-24). That rewrite is top-level code with no exported function, so the F-008 fixes (the `?` case, and requests outside the base returning 404) have no regression test. | testing-qa-verification-specialist, engineering-frontend-developer, evaluator:code-quality | 80% | open |

## Resolved Findings
| ID | Severity | Location | Issue | Reviewers | Confidence | Status |
|----|----------|----------|-------|-----------|------------|--------|
| F-001 | major | `server/src/services/events.ts (consumer /home/user/Traid-tests/server/src/routes/events.ts):9-10` | `EventBus.nextId` starts at 1 on every process start, and the buffer lives only in memory. The route reads `Last-Event-ID` and then drops any event with `id <= high`. A browser that reconnects after a server restart sends its old last id, for example 40, while the new server is at id 3. The server then silently drops every event until its counter passes 40. | testing-qa-verification-specialist | 85% | fixed |
| F-003 | minor | `web/src/pages/settings/Profiles.tsx:10-11` | `schema` (the `qualityprofile/schema` query) has its error and loading state ignored. If it fails, "Add profile" stays disabled forever with no message and no retry. | engineering-frontend-developer | 80% | deferred |
| F-004 | major | `web/src/components/ui/Input.tsx (same tokens in Select.tsx, Switch.tsx), /home/user/Traid-tests/web/src/styles/index.css:9` | Form control boundaries use `border-border` against `bg-surface-sunken`. Light: #dbe0ea on #eceff5 is about 1.1:1. Dark: #263044 on #0a0e17 is about 1.4:1. The Switch off-state track border (`border-strong` #c3cad8 on a white card) is about 1.6:1. | design-ux-architect | 85% | fixed |
| F-005 | major | `web/src/components/layout/Sidebar.tsx:47-56` | The mobile drawer is an overlay that hides the page but is not modal. Focus is not trapped, so Tab leaves the drawer into the hidden page content and header. The rest of the page is not made inert. On close, via Escape, the overlay, the X button or a route change, focus is not returned to the "Open navigation" button, so it falls to `body`. | design-ux-architect | 80% | fixed |
| F-006 | minor | `server/package.json, server/src/app.ts:12-13` | `@fastify/static` is a declared dependency but nothing imports it. `npm start` runs the server only and never serves the built `web/dist`. The root `build` script only typechecks and builds the web package. | evaluator:code-quality | 80% | deferred |
| F-007 | major | `server/src/index.ts (also server/src/routes/config.ts, web/src/pages/settings/General.tsx):5-10` | The General settings page lets the user save `port` and `urlBase`. It tells them "Changes ... need a restart." The server never uses either value. It listens on `config.port` from the `SONARR_PORT` env var, defaulting to 8989. It registers all routes without a URL-base prefix. | evaluator:business-logic | 85% | fixed |

## Recommendation
Fix the unresolved findings by hand, accept the phase as is, or investigate further.

<escalation>
severity: blocker
type: quality
decision: unresolved critical F-002 in server/src/app.ts
context: F-002 is still only partly fixed. `/initialize.json` is unauthenticated and now decides on two things: a loopback `request.ip` and the absence of five proxy headers. `trustProxy` is still unset. The header check only works if the proxy adds those headers. A stock nginx `proxy_pass` adds no X-Forwarded-*. Caddy `reverse_proxy` adds X-Forwarded-* by default, but Traefik and others can be configured to omit them. A proxy that sends none of them leaves the peer at 127.0.0.1, so any remote user gets the API key. A local process or a browser page can also read the key from loopback with no headers (for example via DNS rebinding, because Host is not checked). The reverse case is unchanged. With Docker port mapping, or with the UI opened from another LAN machine, the peer is not loopback. Those clients get `apiKey: ''` and every UI call returns 401 (the UI needs the key, and `/initialize.json` is where it gets it).
</escalation>

## Reviewer Verdicts
- Cycle 1, testing-qa-verification-specialist: **NEEDS WORK**
- Cycle 1, engineering-senior-developer: **NEEDS WORK**
- Cycle 1, engineering-frontend-developer: **NEEDS WORK**
- Cycle 1, design-ux-architect: **NEEDS WORK**
- Cycle 1, evaluator:code-quality: **NEEDS WORK**
- Cycle 1, evaluator:ui-ux: **NEEDS WORK**
- Cycle 1, evaluator:integration: **NEEDS WORK**
- Cycle 1, evaluator:business-logic: **NEEDS WORK**
- Cycle 2, testing-qa-verification-specialist: **NEEDS WORK**
- Cycle 2, engineering-senior-developer: **NEEDS WORK**
- Cycle 2, engineering-frontend-developer: **PASS**
- Cycle 2, design-ux-architect: **PASS**
- Cycle 2, evaluator:code-quality: **NEEDS WORK**
- Cycle 2, evaluator:business-logic: **NEEDS WORK**
- Cycle 3, testing-qa-verification-specialist: **NEEDS WORK**
- Cycle 3, engineering-senior-developer: **NEEDS WORK**
- Cycle 3, engineering-frontend-developer: **NEEDS WORK**
- Cycle 3, design-ux-architect: **PASS**
- Cycle 3, evaluator:code-quality: **NEEDS WORK**
- Cycle 3, evaluator:business-logic: **NEEDS WORK**

## Suggestions (Not Required)
- F-003 `web/src/pages/settings/Profiles.tsx`: `schema` (the `qualityprofile/schema` query) has its error and loading state ignored. If it fails, "Add profile" stays disabled forever with no message and no retry. (fix: Show `errorMessage(schema.error)` (with `role="alert"`) when `schema.isError`. Alternatively, fetch the schema on click, or fall back to a client-built default from `@sonarr/shared`.)
- F-006 `server/package.json, server/src/app.ts`: `@fastify/static` is a declared dependency but nothing imports it. `npm start` runs the server only and never serves the built `web/dist`. The root `build` script only typechecks and builds the web package. (fix: Either register `@fastify/static` for `web/dist` with an SPA fallback, or remove the dependency and document dev-only UI usage in the README.)

## Deferred (Medium Confidence)
- `server/src/routes/config.ts, /home/user/Traid-tests/server/src/index.ts` [minor, 70%]: `PUT /config/host` accepts and persists `port`, `bindAddress` and `urlBase`. `index.ts` listens using `config.port` from the environment, not `host.port`. `urlBase` is never applied to routing. `urlBase` is validated only for a leading `/`, so `//`, `/a b` and a trailing `/` are accepted.
- `server/src/routes/quality.ts` [minor, 60%]: `saveDef` publishes an SSE event inside the `app.db.transaction`. If a later item throws, the DB changes roll back but the events for earlier items were already emitted.
- `server/src/index.ts` [minor, 65%]: `shutdown` has no try/catch, and `app.close()` waits on `commands.waitForIdle()` with no timeout. A hung command handler blocks SIGTERM forever. A rejection from `close()` becomes an unhandled rejection. Repeated signals call `close` repeatedly.
- `server/src/routes/rootfolder.ts, /home/user/Traid-tests/server/src/routes/tag.ts` [minor, 70%]: The `parseId` helper is copy-pasted into each route file, as is the `find` by id lookup and the `reply.code(404).send({ message: 'NotFound' })` response. The `rootfolder.ts` and `tag.ts` files I read both do this. I did not open the other route files.
- `server/src/app.ts` [minor, 60%]: `getHostConfig` only calls `ensureHostConfig`, so it is a redundant alias. Each call also does a DB read and `JSON.parse`. `registerAuth` and the system routes call it on every request through closures.
- `server/src/routes/rootfolder.ts` [minor, 50%]: POST validates the folder with an async `fs.stat`, then checks for duplicates and inserts later. Two concurrent POSTs for the same path can both pass the duplicate check. Unless the SQL has a UNIQUE constraint on path, the duplicate is persisted. I did not confirm the UNIQUE constraint in 0001_initial.sql.
- `web/src/components/layout/Sidebar.tsx` [minor, 70%]: The mobile drawer is a modal-style overlay but has no focus trap and does not make the main content inert. Tab moves focus out of the open drawer into the page behind it. Sub-nav links are `h-8` (32px) and the collapse and close controls are small, so touch targets on mobile are under the usual 44px guideline.
- `web/src/components/ui/Modal.tsx` [minor, 75%]: The panel has no `max-height` and no scrolling body. Tall dialogs (the quality profile editor, with about 20 qualities) scroll the whole overlay, so the footer Save and Cancel buttons scroll off-screen on short or mobile viewports. Default initial focus also lands on the header Close button, not the first form field, because it is the first focusable element.
- `web/src/pages/settings/QualityProfileEditor.tsx` [advisory, 55%]: `onSuccess: onClose` is passed to the hook and `onSaved` is passed again at the `mutate` call site. Cancel and Escape stay enabled while a save is pending. Closing mid-request unmounts the editor, so the `mutate` call-level `onSuccess` (`onSaved`) will not fire.
- `web/src/components/layout/AppLayout.tsx` [minor, 70%]: On client-side route changes only `document.title` is updated. Focus is not moved to `main` or the new h1, and nothing is announced. `titleForPath` also matches exact paths only, so unlisted or 404 paths keep the title "Sonarr".
- `web/src/styles/index.css` [minor, 65%]: In the light theme `--accent` #0a7fb0 is used as text (`text-accent` for the active sidebar leaf and the icon, among others). It is about 4.5:1 on white and about 4.2:1 on `--surface` #f6f7fb. Over `accent-soft` tinted backgrounds it is lower.
- `web/src/pages/settings/Tags.tsx` [advisory, 60%]: The page has an `h1` "Tags" immediately followed by a Card `h2` also titled "Tags". Section headings repeat the page title and add no information.
- `server/src/app.ts, server/src/routes/config.ts` [major, 75%]: `PUT /config/host` accepts and persists `urlBase`, `port`, `bindAddress` and `logLevel`. The server ignores all of them at runtime. Routes are not prefixed with `urlBase`, and `index.ts` uses `SONARR_PORT` rather than `host.port`. The web client prefixes every request with `urlBase` (`buildApiUrl`).
- `server/src/routes/quality.ts` [minor, 55%]: `toProfile` calls `JSON.parse(row.items)` with no guard. It silently drops items whose quality id is not in `QUALITIES`. A profile's `cutoff` can then reference a dropped quality. The `PUT` handlers run `parse` before the 404 check, so a bad body on an unknown id returns 400 instead of 404. The PUT profile 404 check and name-uniqueness check are two separate reads and writes, not one transaction.
- `server/src/routes/quality.ts, server/src/routes/rootfolder.ts, server/src/routes/command.ts, server/src/routes/tag.ts` [minor, 70%]: `parseId` is copy-pasted in four route files. Several places cast with `as unknown as Record<string, unknown>` (`quality.ts` 83, `rootfolder.ts` 64, `commands.ts` 110, 124, 139). `getHostConfig` is a trivial wrapper over `ensureHostConfig`. `routes/config.ts` imports from `../app.js`, which creates a circular import.
- `web/src/test/setup.ts, web/src/components/layout/layout.test.tsx` [advisory, 50%]: Web tests emit repeated "Not implemented: HTMLCanvasElement getContext" jsdom errors.
- `web/src/pages/settings/Tags.tsx` [advisory, 55%]: The icon-only `Button size="sm"` is 32px high and used as the edit and delete controls. The Add button is aligned with the input through a hard-coded `className="mt-6"` that assumes the label height.
- `web/src/pages/settings/Profiles.tsx` [minor, 60%]: "Add profile" is disabled while the schema query is loading or has failed, with no explanation. A schema fetch error is never shown to the user.
- `web/src/lib/events.ts, server/src/plugins/auth.ts` [minor, 65%]: EventSource cannot set headers, so the API key travels in the `?apikey=` query string. Fastify request logging includes the URL, so the key lands in the logs (`logger: true` in index.ts).
- `server/src/routes/config.ts, server/src/index.ts, server/src/config.ts` [minor, 70%]: The host config fields `port`, `bindAddress` and `urlBase` are editable through PUT /config/host. At startup, however, the port comes only from the `SONARR_PORT` env var (default 8989). `bindAddress` is read from the DB. `urlBase` is never applied to route prefixes. `port` is ignored.
- `server/src/app.ts, server/package.json` [major, 75%]: The production server never serves the built web app. `@fastify/static` is a declared dependency but nothing uses it. There is no SPA fallback route.
- `server/src/routes/quality.ts` [minor, 55%]: Profile validation checks name uniqueness with a case-sensitive `eq`. Names such as "HD" and "hd" are treated as different. The "last profile" delete check reads the count with no transaction around the delete.
- `server/src/routes/tag.ts, server/src/routes/rootfolder.ts, server/src/routes/quality.ts` [advisory, 50%]: Nothing in this phase tests delete protection for in-use tags or root folders. This is acceptable now, since no series exist yet.
- `web/src/components/layout/Sidebar.tsx` [major, 70%]: While `mobileOpen` is true, every sibling of the nav (header and main) gets `inert`. Nothing clears `mobileOpen` when the viewport crosses the `md` breakpoint (rotating a tablet, resizing a window). At >= md the overlay is `md:hidden` and the nav is a visible sticky sidebar, but `inert` stays on the whole page. The page stays unclickable and unfocusable, the Escape and Tab traps stay active, and there is no visible overlay to click. The only way out is Escape or a nav link.
- `server/src/services/events.ts` [minor, 60%]: Seeding `nextId` with `Date.now()` fixes F-001 only if the clock never moves backwards across restarts. Ids are about 1.7e12, which is below MAX_SAFE_INTEGER, so that part is fine. However, the `/^\d+$/` parse and `Number()` in routes/events.ts are fine, but nothing tests a Last-Event-ID larger than the current counter. events.test.ts uses `new EventBus(1)` throughout and never exercises the default seed or a stale-id reconnect.
- `server/src/app.test.ts` [minor, 70%]: The test checks only 127.0.0.1 and one public IP. It does not cover `::1`, `::ffff:127.0.0.1`, forwarded headers, or a `trustProxy` setup.
- `server/src/routes/events.test.ts` [minor, 55%]: The streaming tests call `ctl.abort()` at the end of the test body and not in a `finally` block. If an assertion fails first, the SSE connections stay open and `readUntil` can hang up to its 5 second deadline. The `afterEach` cleanup is also affected, because the open streams delay `app.close()`.
- `server/src/app.ts` [minor, 60%]: `JSON.parse(row.value) as HostConfig` is an unchecked cast of persisted data. Missing or invalid fields, for example from an older version or a hand-edited DB, flow straight into `host.apiKey`, `bindAddress` and `urlBase`. `host.urlBase.replace` in `index.ts` then throws a TypeError.
- `server/src/app.ts` [minor, 65%]: The global error handler has no tests. That covers the Zod 400 shape, the 4xx passthrough, and the 500 masking.
- `server/src/app.ts` [advisory, 50%]: `getHostConfig` is a pure alias of `ensureHostConfig`. The `Housekeeping` command handler is an empty no-op stub. `ensureHostConfig` is called twice at startup, once in `buildApp` and again via `index.ts`.
- `server/src/app.test.ts` [minor, 60%]: The success criterion says `GET /api/v3/system/status` returns "version and paths". The test asserts only `appName` and `version`. No path fields such as `appData` or `startupPath` are checked.

## Fixes Applied
- cycle 1: engineering-senior-developer on F-001 (done); engineering-backend-architect on F-002 (done); engineering-frontend-developer on F-004, F-005, F-007 (done); checks 17/17 passed
- cycle 2: engineering-backend-architect on F-002, F-008 (partial); checks 17/17 passed

## Cycle Delta
- cycle 1: 5 must-fix, 2 suggestions, 23 deferred, 0 dropped (low confidence)
- cycle 2: 2 must-fix (resolved 4, new 1, unchanged 1), 0 suggestions, 4 deferred, 0 dropped (low confidence)
- cycle 3: 3 must-fix (resolved 0, new 1, unchanged 2), 0 suggestions, 4 deferred, 0 dropped (low confidence)

## Coverage
No coverage data found (looked for coverage/coverage-summary.json, coverage-summary.json, coverage/lcov.info, lcov.info, coverage.xml, coverage/cobertura-coverage.xml, coverage/coverage.xml, coverage.txt, coverage/coverage.txt). Advisory only: run the test suite with coverage to check review.coverage_thresholds.
