# Project State

## Current Position
- **Phase**: 1 of 5 (planned)
- **Status**: Phase 1 planned -- 4 plans across 3 waves
- **Last Activity**: Phase 1 planning (2026-10-12)

## Progress
```
[....................] 0% — 0/19 plans complete
```

## Recent Decisions
- Assumed: TypeScript full stack (Fastify + SQLite/Drizzle + React/Vite/Tailwind) instead of Sonarr's C#/.NET + React
- Assumed: TVmaze as the metadata provider
- Assumed: 'exact replica functionality-wise' covers Sonarr's core workflow (library, indexers, decision engine, download clients, import/rename, activity, wanted, calendar, notifications, system); long-tail providers are out of scope
- Assumed: API shaped after Sonarr's /api/v3 (resource names and main fields) with API key auth
- Assumed: modern redesign uses Tailwind with a dark-first theme, card/poster grid, sidebar, command-palette search
- Assumed: SSE for realtime events instead of SignalR

## Next Action
Run `/triad:build` to execute Phase 1: Foundation and App Shell
