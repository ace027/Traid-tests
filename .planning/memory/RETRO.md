# Retrospective Log

Retrospective findings from completed phases and milestones.
Referenced by `/triad:plan` for continuous improvement.

## Milestone 1 (v1 Sonarr Replica) — Phases 1-5 — 2026-10-13

### Key Findings
Went well: all 24 plans completed and every phase review passed (must-fix 2/2, 4/4, 1/1, 4/4, 3/3); stub-first wave-1 plans (03-01, 04-01, 05-01) enabled 3-4 conflict-free parallel wave-2 plans; reviews caught data-loss risks in file handling (phase 2 diskScan, phase 4 importer, phase 5 restore); the Playwright suite (05-06) found 3 bugs unit tests missed (setup redirect race in web/src/lib/api.ts, light-theme contrast, reused download ids in server/src/services/history.ts), all fixed, 28/28 e2e pass; the phase 1 API-key exposure (O-005..O-008) was fixed with Sonarr v4-style forms auth; deterministic backend plans on Sonnet mostly passed first try (03-01..03-03, 04-01, 04-03, 05-02, 05-03).
Didn't work: 0/5 phases passed review on the first cycle (phase 2 needed 4 cycles, phase 4 needed 3); five plans went Partial from cross-plan boundaries, not bad code (02-01: app.test.ts outside files_modified; 04-05: imported Calendar.tsx before parallel 04-04 created it; 05-04: type error in parallel 05-02; 05-06); out-of-scope tests forced workarounds (scheduler.test.ts in 05-01/05-03, events.test.ts in 05-01/05-02, layout.test.tsx in 03-05/04-04); deferred review items stayed high (22-33 per phase); pre-plan board assessments in phases 2-5 had little signal; plans 02-03, 03-05 and 04-02 completed with warnings; tracked SPEND.json blocked the ship clean-tree gate.

### Action Items
| # | Action | Priority | Evidence |
|---|--------|----------|----------|
| 1 | During planning, grep for existing tests that pin counts, listeners or titles and add them to files_modified | High | 02-01 (O-013, O-015); 05-01/05-03 scheduler.test.ts; 05-01/05-02 events.test.ts; 03-05/04-04 layout.test.tsx |
| 2 | Pre-wave check: parallel plans must not import or type-depend on each other's files; otherwise sequence them | High | 04-05 (O-036); 05-04 (O-045) |
| 3 | Add an authentication and secrets check to early planning, covering unauthenticated endpoints | High | Phase 1 escalation (O-005..O-008) |
| 4 | Introduce e2e smoke tests earlier (one smoke plan per phase) | Medium | 05-06 findings (web/src/lib/api.ts, server/src/services/history.ts) |
| 5 | Triage the deferred review backlog in hot-spot files | Medium | Phase 2 diskScan.ts/series.ts; Phase 3 search.ts/grab.ts; Phase 5 backup.ts |
| 6 | Run board quick-assess only once plans exist | Medium | Phases 2-5 CONCERNS/REJECT verdicts |
| 7 | prefer engineering-backend-architect for deterministic backend and route-stub plans | Low | 03-01, 03-02, 03-03, 04-01, 04-03, 05-02, 05-03 |
| 8 | prefer engineering-frontend-developer (opus) for open-ended UI plans, with a stub-dependency check for pages imported by routes.tsx | Low | 02-04, 03-05, 04-04, 04-05, 05-04 |
| 9 | prefer testing-qa-verification-specialist for e2e and cross-cutting verification plans | Low | 05-06 |
| 10 | Keep .planning/SPEND.json untracked so the ship gate passes | Low | Phase 5 ship |

### Metrics
- Plans completed: 24
- Review pass rate: 0/5 (0%) (first-cycle passes; every phase review eventually PASSED)
- Escalations: 5 (0 blockers)
- Agents used: 5 (engineering-backend-architect, engineering-frontend-developer, design-ui-designer, engineering-senior-developer, testing-qa-verification-specialist)
- Files modified: 256

---
