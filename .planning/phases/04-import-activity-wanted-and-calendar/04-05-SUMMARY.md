# Plan 04-05 Summary: Media management settings, manual import and rename UI

## Result
**Status**: Partial
**Wave**: 2
**Agent**: engineering-frontend-developer
**Completed**: 2026-10-13

## Agent Selection Rationale

| Candidate | Semantic | Heuristic | Memory | Total | Source |
|-----------|----------|-----------|--------|-------|--------|
| engineering-frontend-developer | — | 7 | 3.94 | 10.94 | mandatory |
| engineering-senior-developer | — | 14 | 4.33 | 18.33 | heuristic |
| testing-qa-verification-specialist | — | 13 | 4 | 17 | heuristic |

- **Task type detected**: implementation
- **Confidence**: LOW
- **Adapter**: claude-code
- **Model tier**: sonnet

## Completed Tasks
- [x] Task 1: Media management and naming settings (done)
- [x] Task 2: Manual import modal (done)
- [x] Task 3: Rename preview modal (done)

## Files Modified
- `web/src/pages/activity/ManualImportModal.tsx`
- `web/src/pages/activity/Queue.tsx`
- `web/src/pages/activity/manualImport.test.tsx`
- `web/src/pages/series/RenamePreviewModal.tsx`
- `web/src/pages/series/SeriesDetail.tsx`
- `web/src/pages/series/rename.test.tsx`
- `web/src/pages/settings/DownloadClients.tsx`
- `web/src/pages/settings/MediaManagement.tsx`
- `web/src/pages/settings/NamingSettings.tsx`
- `web/src/pages/settings/mediaHooks.ts`
- `web/src/pages/settings/mediaManagement.test.tsx`

## Verification Results
6/6 verification commands passed (run by Triad after the agent finished).

## Verification Commands
| Command | Exit Code | Result |
|---------|-----------|--------|
| `npm run typecheck -w @sonarr/web` | 0 | PASS |
| `npm test -w @sonarr/web` | 0 | PASS |
| `npm run build` | 0 | PASS |
| `npm test -w @sonarr/web -- mediaManagement` | 0 | PASS |
| `npm test -w @sonarr/web -- manualImport` | 0 | PASS |
| `npm test -w @sonarr/web -- rename` | 0 | PASS |

## Key Decisions
- Server naming validation errors come from the PUT 400 response and are shown on the matching format field. The examples endpoint does not validate, so the preview still renders for an invalid draft.
- Edits are kept as partial overlays on the server config, so there is no sync effect, and Save sends only changed fields. Media management and naming are saved in turn.
- Manual import rows are checked by default only when they have a series, at least one episode and no rejections. Changing the series clears season and episodes, and changing the season clears episodes.
- Import mode values are auto, move and copy, sent as importMode on the ManualImport command.
- RenameFiles sends {seriesId, files: [episodeFileId...]}. Both manualimport and rename are still stubs on the server, so the query params (downloadId, folder, seriesId, seasonNumber) and the command shapes are my reading of the shared types and the plan.
- In the Tokens button, the accessible name "Tokens for <field>" is set with aria-label, because adjacent sr-only spans lose their space in the accessible name.
- The tests assert axe with `expect((await axe(x)).violations).toEqual([])`, the existing repo pattern, because the toHaveNoViolations matcher is not typed here.

## Issues Encountered
- Typecheck, full test run and build cannot go green until web/src/pages/calendar/Calendar.tsx exists. routes.tsx and the calendar folder are forbidden to me. Re-run those three commands after 04-04 lands.

## Escalations
(none)

## Handoff Context
- **Key outputs**: web/src/pages/activity/ManualImportModal.tsx; web/src/pages/activity/Queue.tsx; web/src/pages/activity/manualImport.test.tsx; web/src/pages/series/RenamePreviewModal.tsx; web/src/pages/series/SeriesDetail.tsx; web/src/pages/series/rename.test.tsx; web/src/pages/settings/DownloadClients.tsx; web/src/pages/settings/MediaManagement.tsx; web/src/pages/settings/NamingSettings.tsx; web/src/pages/settings/mediaHooks.ts; web/src/pages/settings/mediaManagement.test.tsx
- **Decisions made**: Server naming validation errors come from the PUT 400 response and are shown on the matching format field. The examples endpoint does not validate, so the preview still renders for an invalid draft.; Edits are kept as partial overlays on the server config, so there is no sync effect, and Save sends only changed fields. Media management and naming are saved in turn.; Manual import rows are checked by default only when they have a series, at least one episode and no rejections. Changing the series clears season and episodes, and changing the season clears episodes.; Import mode values are auto, move and copy, sent as importMode on the ManualImport command.; RenameFiles sends {seriesId, files: [episodeFileId...]}. Both manualimport and rename are still stubs on the server, so the query params (downloadId, folder, seriesId, seasonNumber) and the command shapes are my reading of the shared types and the plan.; In the Tokens button, the accessible name "Tokens for <field>" is set with aria-label, because adjacent sr-only spans lose their space in the accessible name.; The tests assert axe with `expect((await axe(x)).violations).toEqual([])`, the existing repo pattern, because the toHaveNoViolations matcher is not typed here.
- **Open questions**: (none)
- **Conventions established**: mediaHooks.ts exports mediaKeys and the config hooks. The ManualImport and RenameFiles command payloads above are what the server plans 04-02 must accept.

## Requirements Covered
- REQ-12
- REQ-03

## Token Usage
28 requests, 2063374 input tokens (1971696 cached), 32673 output tokens, $0.9502
