# Phase 3: Browser client — Review Fixes

Fixes applied by the review loop, one section per cycle. Re-review decides whether each one holds.

## Cycle 1

**Date**: 2026-10-10
**Checks**: 10/10 passed
**Files changed**: `src/client/render/board.ts`, `src/client/ui/battle.ts`, `src/client/ui/hud.css`, `src/client/ui/hud.ts`, `src/client/ui/log.ts`, `tests/client/hud.test.ts`, `tests/e2e/smoke.spec.ts`, `tests/client/animate.test.ts`, `tests/client/log-render.test.ts`, `tests/client/log.test.ts`, `tests/client/main.test.ts`, `tests/client/net.test.ts`, `tests/client/ui.test.ts`

| Finding | Severity | File | Agent | Status | Notes |
|---------|----------|------|-------|--------|-------|
| F-001 | major | `src/client/ui/hud.ts` | engineering-backend-architect | fix applied | Fixed F-001, F-008, F-009, F-010 and F-012. The HUD now imports setPathHandler directly with no cast. The HUD error uses the `toast` element, which is already in hud.ts with role=alert. Choose-path destinations are an ordered list of buttons, and the canvas aria-label tracks turn, position and destinations. Log, turn indicator and battle round events are live regions. |
| F-008 | major | `tests/e2e/smoke.spec.ts` | engineering-backend-architect | fix applied | Fixed F-001, F-008, F-009, F-010 and F-012. The HUD now imports setPathHandler directly with no cast. The HUD error uses the `toast` element, which is already in hud.ts with role=alert. Choose-path destinations are an ordered list of buttons, and the canvas aria-label tracks turn, position and destinations. Log, turn indicator and battle round events are live regions. |
| F-009 | major | `src/client/render/board.ts` | engineering-backend-architect | fix applied | Fixed F-001, F-008, F-009, F-010 and F-012. The HUD now imports setPathHandler directly with no cast. The HUD error uses the `toast` element, which is already in hud.ts with role=alert. Choose-path destinations are an ordered list of buttons, and the canvas aria-label tracks turn, position and destinations. Log, turn indicator and battle round events are live regions. |
| F-010 | major | `src/client/ui/hud.ts, src/client/ui/log.ts, src/client/ui/battle.ts` | engineering-backend-architect | fix applied | Fixed F-001, F-008, F-009, F-010 and F-012. The HUD now imports setPathHandler directly with no cast. The HUD error uses the `toast` element, which is already in hud.ts with role=alert. Choose-path destinations are an ordered list of buttons, and the canvas aria-label tracks turn, position and destinations. Log, turn indicator and battle round events are live regions. |
| F-012 | major | `src/client/ui/hud.ts` | engineering-backend-architect | fix applied | Fixed F-001, F-008, F-009, F-010 and F-012. The HUD now imports setPathHandler directly with no cast. The HUD error uses the `toast` element, which is already in hud.ts with role=alert. Choose-path destinations are an ordered list of buttons, and the canvas aria-label tracks turn, position and destinations. Log, turn indicator and battle round events are live regions. |
| F-002 | major | `src/client/ui/hud.css` | design-ux-architect | fix applied | F-002 fixed in hud.css. Below 800px the HUD now has an explicit empty spacer row (minmax(45vh,1fr)) that keeps the board canvas visible and clickable. Panels stack below it, and `.hud` has `overflow-y: auto` so overflow scrolls. Removed `!important` in favor of specific selectors, and lifted the fixed max-heights on the context and log panels on mobile. |
| F-007 | major | `tests/client/ (missing tests)` | engineering-senior-developer | fix applied | F-011: the HUD now shows `store.error` in a `role="alert"` element, hidden when the error is null. It clears on the next state, joined or lobby message because the reducer resets `error`. F-007: added direct tests for net, log, animate, battle, shop, town, inventory, gameover and main; hud gets an error-toast test. I made no change to `main.ts`, because the HUD it already mounts handles the toast. The toast has no CSS, so it renders as a plain paragraph. I skipped styling because `hud.css` wasn't in my writable list. |
| F-011 | major | `src/client/main.ts (also src/client/ui/hud.ts)` | engineering-senior-developer | fix applied | F-011: the HUD now shows `store.error` in a `role="alert"` element, hidden when the error is null. It clears on the next state, joined or lobby message because the reducer resets `error`. F-007: added direct tests for net, log, animate, battle, shop, town, inventory, gameover and main; hud gets an error-toast test. I made no change to `main.ts`, because the HUD it already mounts handles the toast. The toast has no CSS, so it renders as a plain paragraph. I skipped styling because `hud.css` wasn't in my writable list. |

## Cycle 2

**Date**: 2026-10-10
**Checks**: 10/10 passed
**Files changed**: `src/client/ui/hud.css`, `src/client/ui/hud.ts`, `tests/client/hud.test.ts`

| Finding | Severity | File | Agent | Status | Notes |
|---------|----------|------|-------|--------|-------|
| F-013 | major | `src/client/ui/hud.ts (with src/client/ui/hud.css)` | engineering-senior-developer | fix applied | F-013 fixed. The error toast now has CSS in hud.css: on desktop it sits in column 2, row 2, centred and aligned to the top, in `--danger` colours with padding. On mobile it is `position: absolute`, so it adds no grid row and cannot shift the 45vh board spacer. hud.ts clears the error automatically after 4 seconds. I added a test for the auto-clear. |
| F-012 | major | `src/client/ui/hud.ts` | engineering-backend-architect | fix applied | F-012 fixed in hud.ts. A new `patch()` helper builds each region's nodes off-DOM and compares the markup with the live markup. If they match, it keeps the existing nodes, so focus survives. If they differ, it rebuilds the region and refocuses the control at the same index with the same label. It is used for top, side, ctx and invBox. I did not add a regression test for the focus behaviour. |
