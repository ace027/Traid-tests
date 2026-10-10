---
phase: 03-browser-client
compacted: 2026-10-10
original_summaries: [03-01-SUMMARY.md, 03-02-SUMMARY.md, 03-03-SUMMARY.md, 03-04-SUMMARY.md]
requirements_satisfied: [REQ-01, REQ-09]
---

# Phase 3: Browser client — Compacted Summary

## Deliverables
- 03-01 Vite app shell, networking, store and lobby (Complete): index.html, package-lock.json, package.json, src/client/main.ts, src/client/net.ts, src/client/render/board.ts, src/client/store.ts, src/client/styles.css, src/client/ui/hud.ts, src/client/ui/lobby.ts, src/client/views.ts, tests/client/lobby.test.ts, tests/client/store.test.ts, tsconfig.json, vite.config.ts
- 03-02 Board renderer, dice and movement animation (Complete): src/client/render/animate.ts, src/client/render/art.ts, src/client/render/board.ts, tests/client/board.test.ts
- 03-03 HUD: turn controls, battle, shop, inventory, towns, log, game over (Complete): src/client/ui/battle.ts, src/client/ui/gameover.ts, src/client/ui/hud.css, src/client/ui/hud.ts, src/client/ui/inventory.ts, src/client/ui/log.ts, src/client/ui/shop.ts, src/client/ui/town.ts, tests/client/hud.test.ts
- 03-04 Two-tab browser smoke test and dev run script (Complete): package-lock.json, package.json, playwright.config.ts, scripts/dev.mjs, tests/e2e/smoke.spec.ts

## Decisions
- 03-01: sessionStorage keys are 'rr.code' and 'rr.token'
- 03-01: A server 'error' received right after a rejoin attempt clears the session and the store's code/token/playerId/lobby/state, which returns to the create/join scre
- 03-01: Tests use the `// @vitest-environment jsdom` per-file comment, so vitest.config.ts is unchanged.
- 03-02: Seat colour comes from the player's position in state.players (red, blue, yellow, green). The token letter is the first letter of classId in upper case.
- 03-03: board.ts has no setPathHandler yet, so hud.ts does `import * as board` and calls it only if present. Once 03-02 exports it, the handler sends choosePath. The ch
- 03-03: Portraits are coloured boxes, not art.drawMonster, because art.ts is created by 03-02 and the plan said not to import it.
- 03-03: The Inventory toggle is hidden during battle, choose-path and game-over.
- 03-04: The installed Playwright wants chromium_headless_shell-1248, which is missing here. The config falls back to /opt/pw-browsers/chromium-1194/chrome-linux/chrome 
- 03-04: The turn driver treats a "Waiting for ..." panel after a battle as the turn having passed automatically (roller defeated). I did not exercise that path, because
- 03-04: vite is started with --strictPort, and the webServer uses reuseExistingServer: false, so a busy port fails loudly.

## Conventions and Open Questions
- 03-01 convention: Plan 03-02 replaces mountBoard(canvas, store) in src/client/render/board.ts.
- 03-01 convention: Plan 03-03 replaces mountHud(root, store, send) in src/client/ui/hud.ts. The HUD root is a div.hud with pointer-events none on the container and auto on its chi
- 03-01 convention: Keep the signatures in src/client/views.ts unchanged.
- 03-02 convention: For 03-03 (HUD): call setPathHandler(tileId => send({t:'action', action:{type:'choosePath', tileId}})) so canvas clicks send the move. Pass null to clear it.
- 03-03 convention: 03-02 should export `setPathHandler(fn: ((tileId: string) => void) | null)` from src/client/render/board.ts. hud.ts already calls it when it exists.
- 03-03 convention: art.drawMonster is not wired into the battle panel. battle.ts `portrait()` is the single place to swap it in.
- 03-03 convention: hud.css assumes main.ts's `div.hud` container and uses the CSS variables from styles.css.
- 03-04 convention: Run the smoke test with `npm run e2e`. Run the dev stack with `npm run dev:all`. Both need ports 8787 and 5173 free.
- 03-04 convention: Set PW_CHROMIUM to use a different Chromium binary.

## Files Modified
| File | Change |
|------|--------|
| `index.html` | 03-01: Vite app shell, networking, store and lobby |
| `package-lock.json` | 03-01: Vite app shell, networking, store and lobby |
| `package.json` | 03-01: Vite app shell, networking, store and lobby |
| `src/client/main.ts` | 03-01: Vite app shell, networking, store and lobby |
| `src/client/net.ts` | 03-01: Vite app shell, networking, store and lobby |
| `src/client/render/board.ts` | 03-01: Vite app shell, networking, store and lobby |
| `src/client/store.ts` | 03-01: Vite app shell, networking, store and lobby |
| `src/client/styles.css` | 03-01: Vite app shell, networking, store and lobby |
| `src/client/ui/hud.ts` | 03-01: Vite app shell, networking, store and lobby |
| `src/client/ui/lobby.ts` | 03-01: Vite app shell, networking, store and lobby |
| `src/client/views.ts` | 03-01: Vite app shell, networking, store and lobby |
| `tests/client/lobby.test.ts` | 03-01: Vite app shell, networking, store and lobby |
| `tests/client/store.test.ts` | 03-01: Vite app shell, networking, store and lobby |
| `tsconfig.json` | 03-01: Vite app shell, networking, store and lobby |
| `vite.config.ts` | 03-01: Vite app shell, networking, store and lobby |
| `src/client/render/animate.ts` | 03-02: Board renderer, dice and movement animation |
| `src/client/render/art.ts` | 03-02: Board renderer, dice and movement animation |
| `src/client/render/board.ts` | 03-02: Board renderer, dice and movement animation |
| `tests/client/board.test.ts` | 03-02: Board renderer, dice and movement animation |
| `src/client/ui/battle.ts` | 03-03: HUD: turn controls, battle, shop, inventory, towns, log, game over |
| `src/client/ui/gameover.ts` | 03-03: HUD: turn controls, battle, shop, inventory, towns, log, game over |
| `src/client/ui/hud.css` | 03-03: HUD: turn controls, battle, shop, inventory, towns, log, game over |
| `src/client/ui/hud.ts` | 03-03: HUD: turn controls, battle, shop, inventory, towns, log, game over |
| `src/client/ui/inventory.ts` | 03-03: HUD: turn controls, battle, shop, inventory, towns, log, game over |
| `src/client/ui/log.ts` | 03-03: HUD: turn controls, battle, shop, inventory, towns, log, game over |
| `src/client/ui/shop.ts` | 03-03: HUD: turn controls, battle, shop, inventory, towns, log, game over |
| `src/client/ui/town.ts` | 03-03: HUD: turn controls, battle, shop, inventory, towns, log, game over |
| `tests/client/hud.test.ts` | 03-03: HUD: turn controls, battle, shop, inventory, towns, log, game over |
| `package-lock.json` | 03-04: Two-tab browser smoke test and dev run script |
| `package.json` | 03-04: Two-tab browser smoke test and dev run script |
| `playwright.config.ts` | 03-04: Two-tab browser smoke test and dev run script |
| `scripts/dev.mjs` | 03-04: Two-tab browser smoke test and dev run script |
| `tests/e2e/smoke.spec.ts` | 03-04: Two-tab browser smoke test and dev run script |

## Verification
- 03-01 (REQ-01, REQ-09): 5/5 verification commands passed
- 03-02 (REQ-09): 4/4 verification commands passed
- 03-03 (REQ-09): 4/4 verification commands passed
- 03-04 (REQ-01, REQ-09): 4/4 verification commands passed

## Agents
- 03-01: engineering-frontend-developer
- 03-02: engineering-frontend-developer
- 03-03: engineering-frontend-developer
- 03-04: testing-qa-verification-specialist
