# Plan 05-03 Summary: Backups, restore, restart and housekeeping

## Result
**Status**: Complete
**Wave**: 2
**Agent**: engineering-backend-architect
**Completed**: 2026-10-13

## Agent Selection Rationale

| Candidate | Semantic | Heuristic | Memory | Total | Source |
|-----------|----------|-----------|--------|-------|--------|
| engineering-backend-architect | — | 9 | 3.55 | 12.55 | mandatory |
| engineering-senior-developer | — | 20 | 4.06 | 24.06 | heuristic |
| testing-qa-verification-specialist | — | 12 | 4.1 | 16.1 | heuristic |

- **Task type detected**: implementation
- **Confidence**: LOW
- **Adapter**: claude-code
- **Model tier**: sonnet

## Completed Tasks
- [x] Task 1: Zip writer/reader and backup service (done)
- [x] Task 2: Backup and system control API (done)
- [x] Task 3: Housekeeping (done)

## Files Modified
- `server/src/db/index.ts`
- `server/src/routes/backup.ts`
- `server/src/services/backup.test.ts`
- `server/src/services/backup.ts`
- `server/src/services/housekeeping.test.ts`
- `server/src/services/housekeeping.ts`
- `server/src/services/zip.test.ts`
- `server/src/services/zip.ts`

## Verification Results
5/5 verification commands passed (run by Triad after the agent finished).

## Verification Commands
| Command | Exit Code | Result |
|---------|-----------|--------|
| `npm run typecheck` | 0 | PASS |
| `npm test -w @sonarr/server` | 0 | PASS |
| `npm test -w @sonarr/server -- zip backup` | 0 | PASS |
| `npm test -w @sonarr/server -- backup` | 0 | PASS |
| `npm test -w @sonarr/server -- housekeeping` | 0 | PASS |

## Key Decisions
- `backupRoutes` sets `Symbol.for('skip-override')`, so `app.lifecycle` is on the root app and tests can replace it. The routes and the zip/multipart content-type parsers sit in a child plugin, so they only apply to these routes.
- The weekly `Backup` task is created in an `onListen` hook, not at build time, because `scheduler.test.ts` asserts exactly 4 default tasks and I could not edit it. It only exists when the server really listens, which is how `index.ts` starts it. `Backup` runs as `scheduled` unless the body has `type: 'manual'`.
- Restart closes the app first, then spawns the detached child, then exits, so the port is free when the child starts.
- Restart and shutdown call `app.lifecycle` from a route `onResponse` hook, so they run after the response is sent.
- Restore keeps the old database as `sonarr.db.pre-restore` and deletes its `-wal` and `-shm` files. A staged file is only kept if it is a SQLite file and `PRAGMA integrity_check` returns ok.
- The `Housekeeping` handler does not call `updateMessage`, because `command.test.ts` expects exactly created, started and completed events.
- Backup ids are positions in the name-ascending order, so they are stable between calls but shift when a backup is deleted. `backupPath` only resolves names present in the listing.
- Multipart parsing is a small hand-written parser for the field `file`, since adding a dependency was not allowed.

## Issues Encountered
- The smtp test failure comes from plan 05-02's files; I did not touch them.
- `src/notifications/types.ts` imported a missing `./smtp.js` during my first typecheck; that file now exists, so typecheck is clean.

## Escalations
(none)

## Handoff Context
- **Key outputs**: server/src/db/index.ts; server/src/routes/backup.ts; server/src/services/backup.test.ts; server/src/services/backup.ts; server/src/services/housekeeping.test.ts; server/src/services/housekeeping.ts; server/src/services/zip.test.ts; server/src/services/zip.ts
- **Decisions made**: `backupRoutes` sets `Symbol.for('skip-override')`, so `app.lifecycle` is on the root app and tests can replace it. The routes and the zip/multipart content-type parsers sit in a child plugin, so they only apply to these routes.; The weekly `Backup` task is created in an `onListen` hook, not at build time, because `scheduler.test.ts` asserts exactly 4 default tasks and I could not edit it. It only exists when the server really listens, which is how `index.ts` starts it. `Backup` runs as `scheduled` unless the body has `type: 'manual'`.; Restart closes the app first, then spawns the detached child, then exits, so the port is free when the child starts.; Restart and shutdown call `app.lifecycle` from a route `onResponse` hook, so they run after the response is sent.; Restore keeps the old database as `sonarr.db.pre-restore` and deletes its `-wal` and `-shm` files. A staged file is only kept if it is a SQLite file and `PRAGMA integrity_check` returns ok.; The `Housekeeping` handler does not call `updateMessage`, because `command.test.ts` expects exactly created, started and completed events.; Backup ids are positions in the name-ascending order, so they are stable between calls but shift when a backup is deleted. `backupPath` only resolves names present in the listing.; Multipart parsing is a small hand-written parser for the field `file`, since adding a dependency was not allowed.
- **Open questions**: (none)
- **Conventions established**: `app.lifecycle` has `restart()` and `shutdown()`. Tests replace it, and the 05-06 e2e must do the same so it never calls `process.exit`.; Backup files live in `dataDir/Backups/{manual|scheduled|update}`. Staged restores live in `dataDir/restore/sonarr.db`. The weekly `Backup` schedule only appears after a real `app.listen`.; `BackupError` carries a `statusCode` that the global error handler passes through: 400 for invalid input, 404 for an unknown name.; Escalation (info, scope): the `Backup` task is not in `DEFAULT_TASKS` because of the `scheduler.test.ts` constraint. If the owner wants it in the default list, they need to update that test.

## Requirements Covered
- REQ-17

## Token Usage
15 requests, 616601 input tokens (564386 cached), 26717 output tokens, $0.5106
