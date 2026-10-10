# Retrospective Log

Retrospective findings from completed phases and milestones.
Referenced by `/triad:plan` for continuous improvement.

## Phases 1-4 (whole project): Realm Rush — 2026-10-10

### Key Findings
Went well: all 4 phases built, reviewed and shipped (232 vitest tests + Playwright two-tab full-game e2e); reviews caught real defects (tautological simulation assertion in phase 1; seed/rngState leaked to clients in phase 2, fixed with publicState); must-fix fixed 2/2, 3/3, 8/8, 1/1; phase 4 light process passed both plans first try and fixed the phase 2 stalled-turn issue; screenshot iteration made the board legible (03-02).
Didn't work: plans' files_modified missed shared files (index.ts in 01-03, package.json/@types/node in 02-01/02-02, store.ts/inventory.ts for phase 3 fixers), causing build failures, invalid escalations and partial fixes; review fixes introduced new findings next cycle (phase 1 tsc break, phase 3 toast without CSS, replaced state in transient store.error, untested focus fix), first phase 3 review escalated with 17 findings; no phase passed review in one cycle; plugin friction (two-wave misdetection before 0.13.2, ship check rewriting SPEND.json); parallel plans 03-02/03-03 could not share modules; 67 findings deferred (incl. rate limiting, tier-1 monster balance).

### Action Items
| # | Action | Priority | Evidence |
|---|--------|----------|----------|
| 1 | Plan-check that each plan's files_modified covers its imports, dependencies and re-exports (index.ts, package.json, store.ts) | High | 01-03 invalid escalation; O-008/O-009 in 02-01/02-02; phase 3 skipped fixes |
| 2 | Review fixers must run tsc, add a regression test per fix, and get every file the finding touches as writable | High | Phase 1 tsc break; phase 3 F-017, toast CSS, `state as never` casts |
| 3 | Define shared interfaces in an earlier wave instead of between parallel plans | Medium | Phase 3 03-02/03-03 (art.ts, setPathHandler) |
| 4 | Triage the 67 deferred findings, starting with rate limiting and tier-1 monster balance | Medium | Phase 2 deferred rate limiting; 01-03 balance warning |
| 5 | Prefer engineering-frontend-developer and testing-qa-verification-specialist (83%) for UI and verification; give engineering-backend-architect (63%) plans an explicit dependency checklist | Medium | Memory scores; phase 1-2 backend failures |
| 6 | Each review fix must show it adds no new finding before the next cycle | Medium | Phase 3 first review escalated after 3 cycles, 17 findings |
| 7 | Keep .planning/SPEND.json gitignored; check plugin version >= 0.13.2 before build_phase | Low | Ship gate loop; phase 1 build misdetection |

### Metrics
- Phase 1 (rules engine): Plans completed 4; Review pass rate 0/1 (0%); Escalations 1 (0 blockers); Agents 2 (engineering-backend-architect, testing-qa-verification-specialist); Files modified 26.
- Phase 2 (multiplayer server): Plans completed 3; Review pass rate 0/1 (0%); Escalations 0 (0 blockers); Agents 2 (engineering-backend-architect, testing-api-tester); Files modified 5.
- Phase 3 (browser client): Plans completed 4; Review pass rate 0/1 (0%); Escalations 0 (0 blockers); Agents 3 (engineering-frontend-developer, design-ui-designer, testing-qa-verification-specialist); Files modified 30.
- Phase 4 (polish and playtest): Plans completed 2; Review pass rate 0/1 (0%); Escalations 0 (0 blockers); Agents 2 (engineering-backend-architect, engineering-frontend-developer); Files modified 13.

---
