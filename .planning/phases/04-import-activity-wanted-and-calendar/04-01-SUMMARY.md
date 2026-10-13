# Plan 04-01 Summary: Phase 4 foundations: settings, naming engine and shared types

## Result
**Status**: Complete
**Wave**: 1
**Agent**: engineering-backend-architect
**Completed**: 2026-10-13

## Agent Selection Rationale

| Candidate | Semantic | Heuristic | Memory | Total | Source |
|-----------|----------|-----------|--------|-------|--------|
| engineering-backend-architect | — | 11 | 3.44 | 14.44 | mandatory |
| engineering-senior-developer | — | 18 | 4.33 | 22.33 | heuristic |
| testing-qa-verification-specialist | — | 14 | 4 | 18 | heuristic |

- **Task type detected**: implementation
- **Confidence**: LOW
- **Adapter**: claude-code
- **Model tier**: sonnet

## Completed Tasks
- [x] Task 1: Shared types and config services (done)
- [x] Task 2: Naming engine and examples (done)
- [x] Task 3: Route stubs for wave 2 (done)

## Files Modified
- `server/src/app.ts`
- `server/src/naming/naming.test.ts`
- `server/src/naming/naming.ts`
- `server/src/naming/tokens.ts`
- `server/src/routes/calendar.ts`
- `server/src/routes/manualimport.ts`
- `server/src/routes/mediaConfig.test.ts`
- `server/src/routes/mediaConfig.ts`
- `server/src/routes/rename.ts`
- `server/src/routes/wanted.ts`
- `server/src/services/mediaConfig.ts`
- `server/src/services/series.ts`
- `shared/src/index.ts`
- `shared/src/mediaManagement.ts`

## Verification Results
7/7 verification commands passed (run by Triad after the agent finished).

## Verification Commands
| Command | Exit Code | Result |
|---------|-----------|--------|
| `npm run typecheck` | 0 | PASS |
| `npm test -w @sonarr/shared` | 0 | PASS |
| `npm test -w @sonarr/server` | 0 | PASS |
| `npm run typecheck -w @sonarr/shared` | 0 | PASS |
| `npm test -w @sonarr/server -- mediaConfig` | 0 | PASS |
| `npm test -w @sonarr/server -- naming` | 0 | PASS |
| `npm test -w @sonarr/server -- series` | 0 | PASS |

## Key Decisions
- PUT on all three config routes merges a partial body onto the saved config, like the ui config route. The naming PUT also runs validateNaming and returns a 400 with one error per problem.
- Per-field replacements: '/' and '\' become '+', '?' becomes '!', '*' and '|' become '-', '"' becomes "'", and '<' and '>' are dropped.
- Colons in titles follow colonReplacementFormat. 'smart' turns ': ' into ' - ' and a bare ':' into '-'.
- The daily format is used only for daily series whose first episode has an airDate. The anime format is used only for anime series with an absolute number. Otherwise the standard format is used.
- The 'duplicate' multi-episode style joins with '.', so it gives S01E01.S01E02.
- With renameEpisodes off, buildEpisodeFileName returns originalFileName with its extension stripped.
- folderName in services/series.ts now takes db as its first argument. Its only callers are in the same file.
- validateNaming also requires a Series token in seriesFolderFormat and a season token in seasonFolderFormat. It reports nested braces, unmatched braces and bad number formats such as {season:xx}.

## Issues Encountered
- parseTitle reads the default anime format "S01E12 - 012 - ..." as season 1, episode 12 and returns no absolute numbers. The anime round-trip test therefore checks season and episode only. An absolute-only anime format ("{Series Title} - {absolute:000} - ...") also did not parse to absolute numbers, so I dropped that extra test. The parser is off limits, so I left it.
- Default folder naming now replaces colons (smart mode gives "A - B") instead of deleting them as the old folderName did. Titles without illegal characters give the same "Title (Year)". No existing test broke.

## Escalations
(none)

## Handoff Context
- **Key outputs**: server/src/app.ts; server/src/naming/naming.test.ts; server/src/naming/naming.ts; server/src/naming/tokens.ts; server/src/routes/calendar.ts; server/src/routes/manualimport.ts; server/src/routes/mediaConfig.test.ts; server/src/routes/mediaConfig.ts; server/src/routes/rename.ts; server/src/routes/wanted.ts; server/src/services/mediaConfig.ts; server/src/services/series.ts; shared/src/index.ts; shared/src/mediaManagement.ts
- **Decisions made**: PUT on all three config routes merges a partial body onto the saved config, like the ui config route. The naming PUT also runs validateNaming and returns a 400 with one error per problem.; Per-field replacements: '/' and '\' become '+', '?' becomes '!', '*' and '|' become '-', '"' becomes "'", and '<' and '>' are dropped.; Colons in titles follow colonReplacementFormat. 'smart' turns ': ' into ' - ' and a bare ':' into '-'.; The daily format is used only for daily series whose first episode has an airDate. The anime format is used only for anime series with an absolute number. Otherwise the standard format is used.; The 'duplicate' multi-episode style joins with '.', so it gives S01E01.S01E02.; With renameEpisodes off, buildEpisodeFileName returns originalFileName with its extension stripped.; folderName in services/series.ts now takes db as its first argument. Its only callers are in the same file.; validateNaming also requires a Series token in seriesFolderFormat and a season token in seasonFolderFormat. It reports nested braces, unmatched braces and bad number formats such as {season:xx}.
- **Open questions**: (none)
- **Conventions established**: Use getNamingConfig, getMediaManagementConfig and getDownloadClientConfig from server/src/services/mediaConfig.ts.; buildEpisodeFileName returns a name without an extension. It takes {series: {title, year, seriesType}, episodes (sorted), quality, releaseGroup?, sceneName?, originalFileName?} and the NamingConfig.; Use buildSeasonFolderName(seasonNumber, naming) for season folders. Season 0 uses specialsFolderFormat.; 04-02 fills manualimport.ts and rename.ts and 04-03 fills wanted.ts and calendar.ts. Each exports an empty async plugin, already registered in app.ts, so neither plan needs to edit app.ts.; /feed/v3/calendar/sonarr.ics belongs in calendar.ts.; Config events are published as ('config', 'updated', {name}) with name 'mediamanagement', 'naming' or 'downloadclient'.

## Requirements Covered
- REQ-12
- REQ-14
- REQ-15

## Token Usage
12 requests, 667577 input tokens (590121 cached), 34567 output tokens, $0.6573
