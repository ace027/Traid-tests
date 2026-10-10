# Plan 02-02 Summary: Wire protocol and room manager

## Result
**Status**: Partial
**Wave**: 1
**Agent**: engineering-backend-architect
**Completed**: 2026-10-10
**Failure Class**: BLOCKER — src/server/rooms.ts(1,39): error TS2307: Cannot find module 'node:crypto' or its corresponding type declarations.

## Agent Selection Rationale

| Candidate | Semantic | Heuristic | Memory | Total | Source |
|-----------|----------|-----------|--------|-------|--------|
| engineering-backend-architect | — | 8 | 3.33 | 11.33 | mandatory |
| engineering-senior-developer | — | 18 | 0 | 18 | heuristic |
| testing-qa-verification-specialist | — | 11 | 4.5 | 15.5 | heuristic |

- **Task type detected**: implementation
- **Confidence**: LOW
- **Adapter**: claude-code
- **Model tier**: sonnet

## Completed Tasks
- [x] Task 1: Protocol and parser (done)
- [ ] Task 2: Room manager (partial)
- [x] Task 3: Room tests (done)

## Files Modified
- `src/server/rooms.ts`
- `src/shared/protocol.ts`
- `tests/server/rooms.test.ts`

## Verification Results
1/2 verification commands passed (run by Triad after the agent finished).

## Verification Commands
| Command | Exit Code | Result |
|---------|-----------|--------|
| `npx tsc --noEmit` | 2 | FAIL |
| `npx vitest run tests/server/rooms.test.ts` | 0 | PASS |

## Key Decisions
- In the lobby, disconnect removes the seat and passes host to the next connected seat. Once the game has started, it only marks the seat disconnected.
- The empty-room timer (`emptySince`) is set when the last connected seat leaves, and cleared on join or rejoin.
- `act` returns `state: GameState | null` so it can return an error before the game starts. Turn validation is left to the engine's applyAction.
- Duplicate names are compared case-insensitively and get a numeric suffix (Bob, Bob2), truncated so the result stays within 16 chars.
- `sweep` returns the number of rooms removed. The constructor takes an optional clock function for tests, and `lobbyView` returns null for an unknown room.
- ACTION_TYPES lists only the 9 action types currently in src/engine/types.ts.

## Issues Encountered
- tsc fails because `@types/node` is not a dependency.
- Blocked: tsc cannot pass until `@types/node` is added to package.json devDependencies. Adding a dependency is forbidden by the plan, and a `types` entry in tsconfig is also outside my file list.
- BLOCKER: src/server/rooms.ts(1,39): error TS2307: Cannot find module 'node:crypto' or its corresponding type declarations.

## Escalations
| # | Severity | Type | Decision | Status | Resolution |
|---|----------|------|----------|--------|------------|
| 1 | blocker | unplanned dependency | Add `@types/node` as a devDependency (preferred), or approve some other way for tsc to resolve `node:crypto`. | pending | INVALID: type "unplanned dependency" is not one of architecture, dependency, scope, schema, api, deletion, infrastructure, quality |
| 2 | blocker | quality | Resolve: src/server/rooms.ts(1,39): error TS2307: Cannot find module 'node:crypto' or its corresponding type declarations. | pending |  |

- #1 context: The plan requires `crypto.randomInt` and `crypto.randomUUID`, which needs Node typings. Once `@types/node` is installed, `npx tsc --noEmit` should pass with no code change. I did not add it.
- #2 context: Verification failed (npx tsc --noEmit); a BLOCKER is not auto-fixed.

## Handoff Context
- **Key outputs**: src/server/rooms.ts; src/shared/protocol.ts; tests/server/rooms.test.ts
- **Decisions made**: In the lobby, disconnect removes the seat and passes host to the next connected seat. Once the game has started, it only marks the seat disconnected.; The empty-room timer (`emptySince`) is set when the last connected seat leaves, and cleared on join or rejoin.; `act` returns `state: GameState | null` so it can return an error before the game starts. Turn validation is left to the engine's applyAction.; Duplicate names are compared case-insensitively and get a numeric suffix (Bob, Bob2), truncated so the result stays within 16 chars.; `sweep` returns the number of rooms removed. The constructor takes an optional clock function for tests, and `lobbyView` returns null for an unknown room.; ACTION_TYPES lists only the 9 action types currently in src/engine/types.ts.
- **Open questions**: (none)
- **Conventions established**: Plan 02-03 needs `@types/node` too, for `ws` and `process.env`.; If plan 02-01 adds town upgrade or capture actions to `Action`, add the new type names to ACTION_TYPES and parseAction in src/shared/protocol.ts. That file is not in 02-01's list, so 02-03 or the orchestrator should do it.; Server messages are built from `lobbyView(code)` and `{t:'state'}`. rooms.ts does no I/O.

## Requirements Covered
- REQ-01
- REQ-02

### Failed verification output
`npx tsc --noEmit`
```
src/server/rooms.ts(1,39): error TS2307: Cannot find module 'node:crypto' or its corresponding type declarations.

```

## Token Usage
7 requests, 136407 input tokens (114525 cached), 10603 output tokens, $0.1836
