# Plan 04-03 Summary: Wanted, calendar and iCal feed APIs

## Result
**Status**: Complete
**Wave**: 2
**Agent**: engineering-backend-architect
**Completed**: 2026-10-13

## Agent Selection Rationale

| Candidate | Semantic | Heuristic | Memory | Total | Source |
|-----------|----------|-----------|--------|-------|--------|
| engineering-backend-architect | — | 11 | 3.44 | 14.44 | mandatory |
| engineering-senior-developer | — | 20 | 4.33 | 24.33 | heuristic |
| testing-qa-verification-specialist | — | 14 | 4 | 18 | heuristic |

- **Task type detected**: implementation
- **Confidence**: LOW
- **Adapter**: claude-code
- **Model tier**: sonnet

## Completed Tasks
- [x] Task 1: Wanted API (done)
- [x] Task 2: Calendar API and iCal feed (done)

## Files Modified
- `server/src/routes/calendar.test.ts`
- `server/src/routes/calendar.ts`
- `server/src/routes/wanted.test.ts`
- `server/src/routes/wanted.ts`
- `server/src/services/ical.ts`
- `server/src/services/wanted.ts`

## Verification Results
4/4 verification commands passed (run by Triad after the agent finished).

## Verification Commands
| Command | Exit Code | Result |
|---------|-----------|--------|
| `npm run typecheck` | 0 | PASS |
| `npm test -w @sonarr/server` | 0 | PASS |
| `npm test -w @sonarr/server -- wanted` | 0 | PASS |
| `npm test -w @sonarr/server -- calendar` | 0 | PASS |

## Key Decisions
- Missing requires both the episode and its series to be monitored when monitored=true. With monitored=false it returns episodes or series that are unmonitored. The calendar uses the same rule when unmonitored=false, so a monitored episode of an unmonitored series is hidden.
- Wanted sort defaults to airDateUtc, descending (pagingSchema default), with episode id as the tiebreak. Episodes with only an air_date use that date for sorting and for the aired check.
- Cutoff unmet only compares quality weight to the profile cutoff. I did not add the "upgradable revision when propers preferred" case, because search.ts's cutoffUnmetEpisodeIds does not have it either.
- Calendar defaults to today (UTC midnight) through +7 days. A range over 92 days, an end before the start, an unparseable date or a non-numeric tags value gives 400 through ZodError.
- In the calendar, an episode with no air time matches on its air_date within the start and end days.
- Feed pastDays and futureDays are 0..365, and anything outside that gives 400. premieresOnly keeps episode number 1.
- iCal events with air time use the episode runtime, then the series runtime, then 30 minutes. VALUE=DATE (all-day) is used for asAllDay or when there is no time. Episodes with no date at all are skipped.
- iCal lines fold at 75 octets including the leading space on continuation lines, and never split a code point.

## Issues Encountered
- In one test run I used `git stash` to check whether typecheck failed before my changes, then ran `git stash pop`. That briefly touched other agents' modified tracked files in web/. Status afterwards showed them as modified again, but 04-02, 04-04 and 04-05 should check their web/ edits are intact.

## Escalations
(none)

## Handoff Context
- **Key outputs**: server/src/routes/calendar.test.ts; server/src/routes/calendar.ts; server/src/routes/wanted.test.ts; server/src/routes/wanted.ts; server/src/services/ical.ts; server/src/services/wanted.ts
- **Decisions made**: Missing requires both the episode and its series to be monitored when monitored=true. With monitored=false it returns episodes or series that are unmonitored. The calendar uses the same rule when unmonitored=false, so a monitored episode of an unmonitored series is hidden.; Wanted sort defaults to airDateUtc, descending (pagingSchema default), with episode id as the tiebreak. Episodes with only an air_date use that date for sorting and for the aired check.; Cutoff unmet only compares quality weight to the profile cutoff. I did not add the "upgradable revision when propers preferred" case, because search.ts's cutoffUnmetEpisodeIds does not have it either.; Calendar defaults to today (UTC midnight) through +7 days. A range over 92 days, an end before the start, an unparseable date or a non-numeric tags value gives 400 through ZodError.; In the calendar, an episode with no air time matches on its air_date within the start and end days.; Feed pastDays and futureDays are 0..365, and anything outside that gives 400. premieresOnly keeps episode number 1.; iCal events with air time use the episode runtime, then the series runtime, then 30 minutes. VALUE=DATE (all-day) is used for asAllDay or when there is no time. Episodes with no date at all are skipped.; iCal lines fold at 75 octets including the leading space on continuation lines, and never split a code point.
- **Open questions**: (none)
- **Conventions established**: queryCalendar(app, {start, end, unmonitored, tags, includeSeries?, includeEpisodeFile?}) is exported from routes/calendar.ts and returns CalendarEpisode[].; listMissing(app, opts, now?) and listCutoffUnmet(app, opts) are exported from services/wanted.ts.; The Wanted UI calls /api/v3/wanted/missing and /cutoff with page, pageSize, sortKey, sortDirection, monitored and includeSeries. Records are Episode & {series}.

## Requirements Covered
- REQ-14
- REQ-15

## Token Usage
24 requests, 1181172 input tokens (1123598 cached), 22387 output tokens, $0.5925
