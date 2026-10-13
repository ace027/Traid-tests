# Plan 02-02 Summary: Filename and release title parser

## Result
**Status**: Complete
**Wave**: 1
**Agent**: engineering-senior-developer
**Completed**: 2026-10-13

## Agent Selection Rationale

| Candidate | Semantic | Heuristic | Memory | Total | Source |
|-----------|----------|-----------|--------|-------|--------|
| engineering-senior-developer | — | 17 | 3.75 | 20.75 | heuristic |
| testing-qa-verification-specialist | — | 15 | 3.5 | 18.5 | heuristic |
| engineering-backend-architect | — | 8 | 4.25 | 12.25 | heuristic |

- **Task type detected**: implementation
- **Confidence**: MEDIUM
- **Adapter**: claude-code
- **Model tier**: sonnet

## Completed Tasks
- [x] Task 1: Quality parser (done)
- [x] Task 2: Episode title parser (done)

## Files Modified
- `server/src/parser/index.ts`
- `server/src/parser/parser.test.ts`
- `server/src/parser/parser.ts`
- `server/src/parser/quality.test.ts`
- `server/src/parser/quality.ts`
- `server/src/parser/types.ts`

## Verification Results
3/3 verification commands passed (run by Triad after the agent finished).

## Verification Commands
| Command | Exit Code | Result |
|---------|-----------|--------|
| `npm run typecheck -w @sonarr/server` | 0 | PASS |
| `npm test -w @sonarr/server -- parser` | 0 | PASS |
| `npm test -w @sonarr/server -- parser/quality` | 0 | PASS |

## Key Decisions
- Absolute-numbered (anime) and daily results use seasonNumber 0 and an empty episodeNumbers array. Match them with isAbsoluteNumbering plus absoluteEpisodeNumbers, or isDaily plus airDate.
- special is true for S00 episodes, and for absolute-numbered files under a folder named Specials. It is never true for daily.
- I added an optional `year?: number` to ParsedEpisodeInfo. It is only set from a parenthesised "(2005)" suffix, which is stripped from seriesTitle. A bare year such as "Doctor.Who.2005" stays in seriesTitle.
- Anime without a leading [Group] (for example "Title - 07v2") is only accepted with a vN marker or a trailing "[" or "(" tag. This avoids false positives, and "Title - 101" returns null as the plan says.
- It is tried after the standard, daily and season-pack patterns, not first as the plan lists it.
- A bare "Season 1" with no series title returns null, because it is a folder name rather than a release.
- Quality, languages and release group are parsed from the text after the matched episode token, so words in the series title cannot affect them.
- Input is capped at 4096 characters of basename and whitespace is collapsed up front. The regexes are flat, but this keeps the work bounded.
- "bd" alone is not treated as Bluray. Use bluray, bdrip or brrip.
- "x264v2" counts as version 2 (the `\dv[2-4]` rule), the same way "01v2" does.
- The release group is the trailing "-Group", optionally followed by "[tag]". Tokens such as DL, Ray, Rip, HD, pure digits and resolutions are rejected. It falls back to the leading [Group] bracket.

## Issues Encountered
(none)

## Escalations
(none)

## Handoff Context
- **Key outputs**: server/src/parser/index.ts; server/src/parser/parser.test.ts; server/src/parser/parser.ts; server/src/parser/quality.test.ts; server/src/parser/quality.ts; server/src/parser/types.ts
- **Decisions made**: Absolute-numbered (anime) and daily results use seasonNumber 0 and an empty episodeNumbers array. Match them with isAbsoluteNumbering plus absoluteEpisodeNumbers, or isDaily plus airDate.; special is true for S00 episodes, and for absolute-numbered files under a folder named Specials. It is never true for daily.; I added an optional `year?: number` to ParsedEpisodeInfo. It is only set from a parenthesised "(2005)" suffix, which is stripped from seriesTitle. A bare year such as "Doctor.Who.2005" stays in seriesTitle.; Anime without a leading [Group] (for example "Title - 07v2") is only accepted with a vN marker or a trailing "[" or "(" tag. This avoids false positives, and "Title - 101" returns null as the plan says.; It is tried after the standard, daily and season-pack patterns, not first as the plan lists it.; A bare "Season 1" with no series title returns null, because it is a folder name rather than a release.; Quality, languages and release group are parsed from the text after the matched episode token, so words in the series title cannot affect them.; Input is capped at 4096 characters of basename and whitespace is collapsed up front. The regexes are flat, but this keeps the work bounded.; "bd" alone is not treated as Bluray. Use bluray, bdrip or brrip.; "x264v2" counts as version 2 (the `\dv[2-4]` rule), the same way "01v2" does.; The release group is the trailing "-Group", optionally followed by "[tag]". Tokens such as DL, Ray, Rip, HD, pure digits and resolutions are rejected. It falls back to the leading [Group] bracket.
- **Open questions**: (none)
- **Conventions established**: Import with `import { parseTitle, parseQuality } from '../parser/index.js'`. The disk scan should match files in this order: airDate for daily, absoluteEpisodeNumbers for anime, season plus episodeNumbers otherwise.; parseTitle accepts a full path or a bare filename. It returns null for unparseable files, so the scan can report them.; quality is { quality: <shared QUALITIES object>, revision: { version, real, isRepack } }, which matches the episode_files.quality JSON shape in the phase context.; I did not write the SUMMARY.md or commit.

## Requirements Covered
- REQ-07

## Token Usage
10 requests, 423050 input tokens (370909 cached), 34405 output tokens, $0.5486
