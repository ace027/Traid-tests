# Phase 1: Foundation and App Shell — Review Summary

## Result: PASSED

**Cycles Used**: 2
**Reviewers**: testing-qa-verification-specialist, engineering-senior-developer, engineering-frontend-developer, design-ux-architect
**Evaluators**: code-quality, ui-ux, integration, business-logic
**Completed**: 2026-10-13

## Findings Summary
- Must-fix (blocker, critical, major) found: 2; fixed: 2; unresolved: 0
- Suggestions (minor, advisory): 3
- Deferred (confidence 50-79%): 23
- Hot spots (flagged by 2+ reviewers): `server/src/routes/rootfolder.ts`, `shared/src/qualities.ts`

## Findings Detail
| ID | Severity | Location | Issue | Reviewers | Confidence | Status |
|----|----------|----------|-------|-----------|------------|--------|
| F-001 | minor | `server/src/routes/tag.ts (also rootfolder.ts, quality.ts, command.ts):9` | The same `parseId` helper, `(v) => /^\d+$/.test(v) ? Number(v) : -1`, is copy-pasted in four route files. Each file also repeats the `reply.code(404).send({ message: 'NotFound' })` block. In tag.ts and rootfolder.ts the helper is redefined inside the route function. In quality.ts and command.ts it sits at module level. | engineering-senior-developer | 85% | deferred |
| F-002 | major | `web/src/components/layout/AppLayout.tsx:52-55` | Client-side route changes only update document.title. Focus is not moved and no live-region announcement is made. After a sidebar link click, focus stays on the old link, or on `<body>` once the mobile drawer closes. The main region has tabIndex=-1 but is only used as the skip-link target. | design-ux-architect | 80% | fixed |
| F-003 | minor | `web/src/lib/api.ts:164-181` | `apiFetch` builds an `ApiError` inline from the response, and `errorFrom` does the same job separately. The two copies differ: only the inline one accepts a plain-string body or a bare array as the error list. | evaluator:code-quality | 80% | deferred |
| F-004 | major | `shared/src/qualities.ts:17-39` | `QUALITIES` is listed in Sonarr id order, not in quality order. Examples: WEBDL-1080p (id 3) comes before HDTV-720p (id 4), Raw-HD (10) comes before WEBRip-480p (12), and Bluray-480p (13) comes before HDTV-1080p's neighbours. `buildItems` is documented as "ordered lowest to highest" but just maps this array. `defaultQualityDefinitions` sets `weight` to `index + 1` from the same array. The profile editor shows `[...items].reverse()` as "Highest quality first". It also uses the last allowed item as the highest quality in `highestAllowed` and in the cutoff fallback. | evaluator:business-logic | 80% | fixed |
| F-005 | advisory | `shared/src/qualities.ts:52-53` | The comment says `[id, min, max, preferred]`, but the table is a `Record` keyed by id whose values are `[min, max, preferred]`. The id is not part of the tuple. | engineering-senior-developer, evaluator:business-logic | 90% | deferred |

## Reviewer Verdicts
- Cycle 1, testing-qa-verification-specialist: **PASS**
- Cycle 1, engineering-senior-developer: **PASS**
- Cycle 1, engineering-frontend-developer: **NEEDS WORK**
- Cycle 1, design-ux-architect: **NEEDS WORK**
- Cycle 1, evaluator:code-quality: **PASS**
- Cycle 1, evaluator:ui-ux: **PASS**
- Cycle 1, evaluator:integration: **NEEDS WORK**
- Cycle 1, evaluator:business-logic: **NEEDS WORK**
- Cycle 2, testing-qa-verification-specialist: **PASS**
- Cycle 2, engineering-senior-developer: **PASS**
- Cycle 2, engineering-frontend-developer: **PASS**
- Cycle 2, design-ux-architect: **PASS**
- Cycle 2, evaluator:business-logic: **PASS**

## Suggestions (Not Required)
- F-001 `server/src/routes/tag.ts (also rootfolder.ts, quality.ts, command.ts)`: The same `parseId` helper, `(v) => /^\d+$/.test(v) ? Number(v) : -1`, is copy-pasted in four route files. Each file also repeats the `reply.code(404).send({ message: 'NotFound' })` block. In tag.ts and rootfolder.ts the helper is redefined inside the route function. In quality.ts and command.ts it sits at module level. (fix: Add a shared `server/src/routes/util.ts` that exports `parseId` and a `notFound(reply)` helper. Import both in the route files.)
- F-003 `web/src/lib/api.ts`: `apiFetch` builds an `ApiError` inline from the response, and `errorFrom` does the same job separately. The two copies differ: only the inline one accepts a plain-string body or a bare array as the error list. (fix: Have `apiFetch` call `errorFrom`, folding in the string-body and array-body cases, and delete the inline copy.)
- F-005 `shared/src/qualities.ts`: The comment says `[id, min, max, preferred]`, but the table is a `Record` keyed by id whose values are `[min, max, preferred]`. The id is not part of the tuple. (fix: Change the comment to `id -> [min, max, preferred]`.)

## Deferred (Medium Confidence)
- `server/src/services/commands.ts` [minor, 55%]: `run()` makes its first `this.update(..., 'started')` call outside the `try`. The `catch` and `.finally(() => this.kick())` also make synchronous DB calls. If any of them throws, for example on SQLITE_BUSY or a closed DB, the promise `p` rejects. Nothing handles that rejection, because `active` is only consumed through `allSettled`. The `.finally` chain also leaves that rejection unhandled.
- `server/src/routes/rootfolder.ts` [minor, 70%]: `body as unknown as Record<string, unknown>` is a double cast to get `RootFolder` past `events.publish`. The tag routes pass rows straight through, so the two sets of routes don't follow the same pattern.
- `web/src/components/ui/Button.tsx` [minor, 70%]: The `sm` size is h-8 (32px) and `md` is h-10 (40px). Icon-only `sm` buttons with `px-3` are used for the Edit/Delete actions in Profiles.tsx (61-62) and the move up/down arrows in QualityProfileEditor.tsx (150-165). These sit next to each other and are below the 44px touch target.
- `web/src/pages/settings/Quality.tsx` [minor, 60%]: `drafts` is seeded once from `definitions` via a `useState` initializer. `errors`, `dirty` and the render all read `drafts[d.id]` for every current definition. If `definitions` later gains an id that has no draft (a refetch after a server-side change or an SSE-driven invalidation), `validateDraft(undefined)` throws and the page crashes. Draft values for existing ids also never resync with fresher server data.
- `web/src/pages/settings/Profiles.tsx` [minor, 75%]: The `useQualityProfileSchema()` query's loading and error state is never surfaced. If the schema request fails, "Add profile" stays disabled with no tooltip, message or retry.
- `web/src/pages/settings/QualityProfileEditor.tsx` [advisory, 55%]: Both `create` and `update` mutations are instantiated on every render, and `isNew` selects between them. Success is handled twice: the hook-level `onSuccess: onClose` and the per-call `onSuccess: done`. Because the hook-level callback runs first, `onClose` unmounts the editor before `onSaved` fires, and the per-call callback may never run on an unmounted observer.
- `web/src/styles/index.css` [minor, 60%]: In the light theme, `--accent` #0a7fb0 has a contrast of about 4.4:1 on white. On `--accent-soft` (accent at 10% over the surface) it is about 4.0:1. It is used as text on those backgrounds: the active sidebar leaf link (`text-accent` on `surface-raised`), the section icon, and the SettingsIndex icon tiles. All of this is 14px text, which is not "large text", so 4.5:1 is required.
- `web/src/components/ui/Toast.tsx` [minor, 65%]: Every toast, including error toasts, auto-dismisses after 5 seconds. The timer does not pause on hover or focus. Error toasts are also announced with `aria-live="polite"` rather than assertively.
- `web/src/components/layout/Sidebar.tsx` [minor, 50%]: Sub-pages are rendered only for the active section. When the sidebar is collapsed on desktop, they are `md:hidden`. A collapsed-sidebar user can reach the other Settings pages only by going through the Settings index page. Collapsed items rely on `title` for a tooltip and on an `sr-only` label, with no focus-visible tooltip.
- `server/src/routes/rootfolder.ts` [minor, 75%]: `isInside` uses `rel.startsWith('..')`. A child directory whose name begins with two dots (for example `/media/..hidden`) is treated as outside its parent.
- `server/src/routes/quality.ts, server/src/routes/rootfolder.ts, server/src/routes/tag.ts` [advisory, 70%]: `parseId` and the repeated 404 reply `{ message: 'NotFound' }` are copied into each route file.
- `server/src/routes/rootfolder.ts` [advisory, 55%]: `describe` swallows every error with an empty catch, and `unmappedFolders` is always `[]`.
- `web/src/pages/settings/Tags.tsx` [minor, 60%]: The "Add tag" button is aligned with the input using a hard-coded `mt-6` offset. It assumes the FormField label is exactly 24px tall, with `items-start` on the form. The same pattern appears in the root folder add form in MediaManagement.tsx.
- `web/src/pages/settings/Tags.tsx` [advisory, 50%]: Each tag chip has two icon-only `sm` buttons that are 32px high (`h-8`). With no padding, they sit tightly together.
- `web/vite.config.ts` [major, 70%]: The dev proxy forwards /api, /feed, /ping and /initialize.json only. The web client's `authPost` (web/src/lib/api.ts:196-207) POSTs to `/login`, `/logout` and `/initialize/setup`. In `npm run dev` those requests go to Vite, not to the server on 8989.
- `server/src/app.ts` [major, 75%]: The server never serves the built web UI. `@fastify/static` is declared in server/package.json but is not imported anywhere. README.md:43 says "The server does not yet serve the built web UI". `npm start` therefore gives an API only.
- `server/src/routes/quality.ts` [minor, 50%]: Deleting a quality profile does no in-use check. The server only blocks deleting the last profile. The `cutoff` rules sit in the shared Zod schema, which the routes use. Nothing references profiles yet, so this is latent.
- `server/src/routes/config.ts` [advisory, 60%]: `eq` is imported but unused. The route also imports `getHostConfig` from '../app.js', which creates a circular import (app.ts imports config.ts).
- `web/src/pages/settings/UiSettings.tsx (with /home/user/Traid-tests/web/src/lib/theme.ts)` [minor, 60%]: The theme exists in two stores that never sync. `UiConfig.theme` lives on the server. The sidebar/header toggle and `getTheme` use only localStorage. Changing the Theme select calls `setTheme`, which writes localStorage immediately, even if the user never clicks Save. Nothing applies the server `config.theme` on load, and the header toggle never updates the server.
- `server/src/routes/quality.ts (with /home/user/Traid-tests/shared/src/schemas.ts)` [minor, 70%]: `qualityDefinitionSchema.title` is a plain `z.string()` and is not trimmed or checked for emptiness on the server. Only the web form rejects an empty title. `weight` and `quality` from the body are silently ignored.
- `server/src/plugins/auth.ts` [advisory, 50%]: The stated criterion is "requests without a valid API key get 401". The `external` method and the `disabledForLocalAddresses` setting let keyless requests through. A PUT to `config/host` can switch a running instance to `external` mode.
- `shared/src/qualities.ts (seeding in server/src/services/seed.ts)` [advisory, 55%]: `seed()` inserts quality definitions only when the table is empty. A database seeded before the F-004 reorder keeps the old id-order weights, and its `weight` values now disagree with `QUALITIES` order. Profile `items` JSON stored by the old code also keeps the old order.
- `shared/src/qualities.test.ts` [minor, 60%]: The `weights` sorted-order assertion (lines 17-18) is tautological, because `weight` is `index + 1` of the same array. The real F-004 regression guard is the resolution-nondecreasing loop and the four named comparisons. Nothing asserts that `defaultQualityProfiles[].items` follows the lowest-to-highest order that the profile editor relies on, or that the highest allowed item is the last one.

## Fixes Applied
- cycle 1: engineering-frontend-developer on F-002 (done); engineering-backend-architect on F-004 (done); checks 17/17 passed
- minor findings: engineering-backend-architect on F-003, F-005, F-001, F-003 (partial); engineering-frontend-developer on F-004, F-005, F-006, F-007 (done); left as is: F-003 rootfolder.ts:55 (the cast is at line 64 now): not fixed. The fix is to widen the `publish` payload type in server/src/services/events.ts, which is not in my writable list. The same `as unknown as Record<string, unknown>` cast also appears in commands.ts, so one signature change there would clean up all of them. / F-004 (partial): the sidebar close button, leaf links (h-8) and collapse button (h-9) are not fixed. They are in the sidebar component, which is not in my writable list. The editor arrow buttons are covered by the `Button` change, since they use `size="sm"`. / F-005 (partial): drafts still do not resync with fresher server data for ids that already exist. Only the render crash is fixed; resyncing needs a design decision. / F-007 (hook change): the hooks in `hooks.ts` (not writable) take no data argument in the hook-level `onSuccess`, so I used the per-call option rather than the hook-level one. / Mid-task oddity: partway through, a `grep` and `git status` showed my Button, Quality and Profiles edits missing from disk. A later check found all edits present, and the final tsc and tests passed with them. I did not find the cause.; checks 17/17 passed, 7 file(s) changed

## Cycle Delta
- cycle 1: 2 must-fix, 2 suggestions, 21 deferred, 0 dropped (low confidence)
- cycle 2: 2 out-of-domain finding(s) filtered (testing-qa-verification-specialist on frontend, owner engineering-frontend-developer; engineering-senior-developer on frontend, owner engineering-frontend-developer); see .planning/logs/authority-decisions-2026-10-13.log
- cycle 2: 0 must-fix (resolved 2, new 0, unchanged 0), 1 suggestions, 2 deferred, 0 dropped (low confidence)

## Coverage
No coverage data found (looked for coverage/coverage-summary.json, coverage-summary.json, coverage/lcov.info, lcov.info, coverage.xml, coverage/cobertura-coverage.xml, coverage/coverage.xml, coverage.txt, coverage/coverage.txt). Advisory only: run the test suite with coverage to check review.coverage_thresholds.
