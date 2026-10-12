# Sonarr Replica

## What This Is
A self-hosted TV series PVR that matches Sonarr's core feature set. It manages a series library, monitors episodes, searches Usenet and torrent indexers, sends releases to download clients and imports and renames completed downloads. It is built in modern TypeScript and has a redesigned, modern web UI.

## Core Value
Hands-off TV library automation: add a show once and every episode is found, downloaded, renamed and filed. It works the way Sonarr users expect, behind a modern UI.

## Who It's For
Home-media enthusiasts who self-host a TV library (the existing Sonarr audience) and want the same automation with a cleaner, modern interface.

## Requirements

### Validated
(None yet — ship to validate)

### Active
- REQ-01: Monorepo with a TypeScript backend (Fastify, SQLite) and a React + Vite + Tailwind frontend, started by a single `npm run dev` / `npm start`, with `npm test` running every unit test
- REQ-02: REST API under /api/v3 modelled on Sonarr's v3 resources, protected by an API key (X-Api-Key header or apikey query), the key shown in Settings > General
- REQ-03: Modern GUI: collapsible sidebar matching Sonarr's navigation (Series, Calendar, Activity, Wanted, Settings, System), dark/light theme, responsive layout, toasts, keyboard-friendly search
- REQ-04: Settings: root folders (with free space), tags, quality definitions (size limits per quality) and quality profiles (allowed qualities, order, cutoff, upgrades allowed), plus general and UI settings
- REQ-05: Series metadata lookup and add-series flow (search by name, choose root folder, quality profile, monitor option, series type standard/daily/anime, season folders, tags, start search for missing)
- REQ-06: Series index (poster, overview and table views, sort, filter, search) and series detail (seasons, episodes, per-season/episode monitoring, file status, edit, delete with optional file deletion, refresh)
- REQ-07: Disk scan and library import: parse episode filenames (SxxEyy, daily dates, absolute numbers, quality and resolution) and link existing files to episodes
- REQ-08: Indexers: Newznab and Torznab providers with test, categories, enable RSS / automatic / interactive search, priority
- REQ-09: Release parsing and decision engine: series/episode matching, quality detection, profile allowed/cutoff/upgrade rules, size limits, blocklist rejection, with rejection reasons shown
- REQ-10: Automatic search (series, season, episode, missing, cutoff unmet), interactive search with a release table showing rejections, manual grab, and a scheduled RSS sync
- REQ-11: Download clients: SABnzbd, NZBGet, qBittorrent and Transmission with test, category and priority; queue page showing progress, status and remove/blocklist actions
- REQ-12: Completed download handling: import finished downloads into the series folder using configurable naming templates (standard/daily/anime episode format, series and season folder format), upgrade replacement, recycle bin optional
- REQ-13: Activity: queue, history (grabbed, imported, failed, deleted, renamed with filters) and blocklist management
- REQ-14: Wanted: Missing and Cutoff Unmet lists with search selected / search all
- REQ-15: Calendar (month/week/agenda views with episode status colours) and an iCal feed endpoint
- REQ-16: Connections/notifications: Webhook, Discord and Email (SMTP) on grab, import, upgrade, rename, series add/delete, health issue, with test
- REQ-17: System: status (version, paths, DB, uptime), health checks, scheduled tasks list with run-now, log viewer, backups (create/download/restore), updates page placeholder
- REQ-18: Realtime UI updates over a WebSocket/SSE event stream (queue progress, command status, series changes) and a command queue (/api/v3/command) like Sonarr's

### Out of Scope
- Sonarr's SkyHook/TheTVDB proprietary metadata API (TVmaze public API is used instead)
- Import lists (Trakt, Plex watchlists), custom formats scoring engine and release profiles beyond simple must-contain/must-not-contain
- Language profiles, Plex/Kodi/Emby library notifications and the 20+ other notification and download-client providers beyond those listed
- Self-updating binaries, Windows service/tray installers, and multi-user authentication (forms login is optional; API key auth is required)
- Migrating an existing Sonarr database

## Constraints
- Node.js 22, TypeScript strict throughout, npm workspaces (server/, web/, shared/)
- SQLite via better-sqlite3 with Drizzle ORM and migrations; single data directory configurable by env SONARR_DATA (default ./data)
- No paid or keyed external services required to run; external HTTP calls (TVmaze, indexers, download clients) behind interfaces so tests use fakes, never the network
- Vitest for unit/integration tests (server with Fastify inject, web with Testing Library); Playwright with the preinstalled Chromium for a few e2e smoke tests
- Default port 8989 like Sonarr

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Assumed: TypeScript full stack (Fastify + SQLite/Drizzle + React/Vite/Tailwind) instead of Sonarr's C#/.NET + React | Goal leaves stack open; one language across server and UI is the simplest modern option and keeps shared API types | Pending |
| Assumed: TVmaze as the metadata provider | Free, no API key, exposes TVDB ids, so the app runs with no setup; Sonarr's SkyHook is private | Pending |
| Assumed: 'exact replica functionality-wise' covers Sonarr's core workflow (library, indexers, decision engine, download clients, import/rename, activity, wanted, calendar, notifications, system); long-tail providers are out of scope | Full parity with every Sonarr provider is unbounded; the core loop is what makes it Sonarr | Pending |
| Assumed: API shaped after Sonarr's /api/v3 (resource names and main fields) with API key auth | Keeps it familiar and lets third-party tools that hit the common endpoints work | Pending |
| Assumed: modern redesign uses Tailwind with a dark-first theme, card/poster grid, sidebar, command-palette search | User asked for a modern updated GUI; Tailwind is the simplest path to a consistent design system | Pending |
| Assumed: SSE for realtime events instead of SignalR | Native in browsers and Fastify, no extra dependency | Pending |

## Architecture Influences
npm workspaces monorepo. shared/: zod schemas and TS types for API resources. server/: Fastify app factory (buildApp for tests), plugin per resource under /api/v3, services layer (series, episodes, parser, decision engine, indexers, download clients, import, naming, notifications, scheduler, command queue, event bus), Drizzle schema + migrations on better-sqlite3, SSE endpoint for realtime events; serves the built web/ in production. web/: React 18 + Vite + TypeScript + Tailwind + TanStack Query + React Router, a small in-house component set (Radix-style primitives built on Tailwind), lucide-react icons, dark/light theme via CSS variables.

---
*Last updated: 2026-10-12 after initialization*
