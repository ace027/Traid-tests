# Phase 3: Browser client — Review Fixes

Fixes applied by the review loop, one section per cycle. Re-review decides whether each one holds.

## Cycle 1

**Date**: 2026-10-10
**Checks**: 10/10 passed
**Files changed**: `src/client/main.ts`, `src/client/net.ts`, `src/client/ui/hud.ts`, `tests/client/store.test.ts`

| Finding | Severity | File | Agent | Status | Notes |
|---------|----------|------|-------|--------|-------|
| F-001 | major | `src/client/net.ts` | engineering-backend-architect | fix applied | F-001: `rawSend` in net.ts now returns a boolean. When the socket is not open it sets `store.error = 'Not connected'` and returns false. `Connection.send` now returns boolean. F-010: `canInv` in hud.ts now also requires `current?.id === me.id`, so the inventory toggle and panel show only on the viewer's turn. |
| F-010 | major | `src/client/ui/hud.ts` | engineering-backend-architect | fix applied | F-001: `rawSend` in net.ts now returns a boolean. When the socket is not open it sets `store.error = 'Not connected'` and returns false. `Connection.send` now returns boolean. F-010: `canInv` in hud.ts now also requires `current?.id === me.id`, so the inventory toggle and panel show only on the viewer's turn. |
| F-007 | major | `src/client/net.ts (with src/client/main.ts)` | engineering-senior-developer | fix applied | A close with code 4000 now sets connection 'closed' and error "Session opened elsewhere", and the client still doesn't auto-reconnect. main.ts shows an alert notice with a Reconnect button that reloads the page. Reloading rejoins using the saved sessionStorage session. |

## Cycle 2

**Date**: 2026-10-10
**Checks**: 10/10 passed
**Files changed**: `src/client/main.ts`, `src/client/net.ts`, `src/client/ui/hud.ts`, `tests/client/hud.test.ts`, `tests/client/store.test.ts`

| Finding | Severity | File | Agent | Status | Notes |
|---------|----------|------|-------|--------|-------|
| F-012 | major | `src/client/ui/hud.ts (with src/client/net.ts)` | engineering-senior-developer | fix applied | F-012, F-014, F-015 and F-016 fixed with one change set. I did not add a dedicated store field because src/client/store.ts is not in my writable list. I took the finding's alternative instead and kept `isReplaced` reading `error === REPLACED_MESSAGE`, but made that value durable. The HUD no longer toasts or expires it. `rawSend` no longer overwrites it. main.ts hides the "Reconnecting" banner while replaced. |
| F-014 | major | `src/client/net.ts (with src/client/ui/hud.ts)` | engineering-senior-developer | fix applied | F-012, F-014, F-015 and F-016 fixed with one change set. I did not add a dedicated store field because src/client/store.ts is not in my writable list. I took the finding's alternative instead and kept `isReplaced` reading `error === REPLACED_MESSAGE`, but made that value durable. The HUD no longer toasts or expires it. `rawSend` no longer overwrites it. main.ts hides the "Reconnecting" banner while replaced. |
| F-015 | major | `src/client/net.ts (with src/client/ui/hud.ts)` | engineering-senior-developer | fix applied | F-012, F-014, F-015 and F-016 fixed with one change set. I did not add a dedicated store field because src/client/store.ts is not in my writable list. I took the finding's alternative instead and kept `isReplaced` reading `error === REPLACED_MESSAGE`, but made that value durable. The HUD no longer toasts or expires it. `rawSend` no longer overwrites it. main.ts hides the "Reconnecting" banner while replaced. |
| F-016 | major | `src/client/ui/hud.ts (with src/client/main.ts, src/client/net.ts)` | engineering-senior-developer | fix applied | F-012, F-014, F-015 and F-016 fixed with one change set. I did not add a dedicated store field because src/client/store.ts is not in my writable list. I took the finding's alternative instead and kept `isReplaced` reading `error === REPLACED_MESSAGE`, but made that value durable. The HUD no longer toasts or expires it. `rawSend` no longer overwrites it. main.ts hides the "Reconnecting" banner while replaced. |
| F-017 | major | `tests/client/store.test.ts` | engineering-backend-architect | fix applied | Added a "hud inventory gate" describe block to the existing tests/client/hud.test.ts, which mounts the real mountHud with a real store and a mocked send. - It asserts toggle and panel hidden for a non-current player (also after a click, with an empty panel), and for the current player in battle, choose-path and game-over. - It asserts the toggle is shown for the current player in roll, shop, town and end-turn, and that clicking it opens the panel. - The first run failed with `REPLACED_MESSAGE is not defined` in src/client/ui/hud.ts because another agent's edit to that file was half-applied. It passed once their import landed. |
