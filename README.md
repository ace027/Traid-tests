# Sonarr Replica

Self-hosted TV series PVR built with TypeScript (Fastify + SQLite + React/Vite/Tailwind).

## Layout
- `shared/` zod schemas and types (`@sonarr/shared`)
- `server/` Fastify API (`@sonarr/server`)
- `web/` React UI (`@sonarr/web`)

## Commands
- `npm install`
- `npm run dev` start server (port 8989) and Vite (port 5173)
- `npm start` start the server
- `npm test` run all unit tests
- `npm run typecheck`
- `npm run build`

## Configuration
- `SONARR_DATA` data directory (default `./data`)
- `SONARR_PORT` port (default `8989`)

The API key is generated on first run. Send it in the `X-Api-Key` header. The `apikey` query parameter is accepted only on `/api/v3/events` (EventSource cannot set headers) and `/feed/*`, and it is redacted from logs.

## Authentication
The model follows Sonarr v4:

- **Forms** (default): on first run the UI asks you to create a username and password (`POST /initialize/setup`, minimum 6 characters; it returns 409 once a password exists). Until then every `/api` call needs the API key. Signing in (`POST /login`) sets an `HttpOnly`, `SameSite=Strict` `SonarrAuth` cookie scoped to the URL base. It lasts 12 hours, or 30 days with "Remember me". `POST /logout` revokes it. Passwords are stored as scrypt hashes, and the session table stores only a SHA-256 of each token. Changing the username or password signs out every other session.
- **External**: a reverse proxy in front of Sonarr handles authentication, and Sonarr requires no login. Use this only when nothing can reach Sonarr except through that proxy.
- **Authentication required**: `enabled` (default) or `disabledForLocalAddresses`. The second skips the login for peers on loopback, 10/8, 172.16/12, 192.168/16, 169.254/16, ::1, fc00::/7 and fe80::/10. A request carrying `X-Forwarded-For`, `Forwarded`, `X-Real-IP`, `X-Forwarded-Host` or `X-Forwarded-Proto` is never treated as local. The bypass stays off until a password has been set.

`/api` and `/feed` accept the API key, a session cookie, or one of the bypasses above. `GET /initialize.json` is public and returns the API key only to a caller that is already authorized. State-changing requests that are not authorized by the API key must send `Content-Type: application/json` or an `X-Requested-With` header (CSRF protection). The web client does this.

**Reverse-proxy caveats**
- With `disabledForLocalAddresses` behind a proxy on the same host, the proxy **must** send `X-Forwarded-For` (or another header listed above). Otherwise every proxied visitor arrives from 127.0.0.1 and skips the login. If you cannot guarantee the header, use `enabled`.
- Sonarr does not trust proxy headers for client addresses (`trustProxy` is off). The failed-login limit (5 failures per IP per 5 minutes, then HTTP 429) therefore counts the proxy's address. Behind a proxy, 5 bad attempts from anyone lock out every user for up to 5 minutes. Add rate limiting at the proxy if that matters.

## URL base
Set **URL base** (Settings > General) to serve Sonarr under a sub-path such as `/sonarr`. It is normalized: leading `/`, no trailing `/`, only `A-Z a-z 0-9 . _ ~ / -`. It is read at startup, so a change needs a restart. With a base set:
- `/sonarr`, `/sonarr/` and `/sonarr/...` are served.
- Everything outside the base (including `/sonarrx`) returns `404 {"message":"NotFound"}`.
- `/ping` answers both at the root and under the base, for health checks.

The server does not yet serve the built web UI. When you host `web/dist` under a URL base, add `<base href="/sonarr/">` to its `index.html`. The client derives its URL base from `<base href>` to find `initialize.json`, and assumes the root without one.

## Running

    npm install
    npm run dev          # API on 8989 and the Vite dev server

## Production build

    npm run build && npm start   # serves the built UI and the API on http://localhost:8989

## End-to-end tests

`npm run e2e` builds the UI and runs the Playwright smoke suite (desktop 1280x800 and mobile 390x844)
against `server/src/e2e/start.ts`: the real app on port 8990 with fake metadata, indexer and download
client, a temp data directory and test-only endpoints on port 8991. It uses the preinstalled Chromium
(`PLAYWRIGHT_CHROMIUM_PATH`, or the newest chromium-* under `PLAYWRIGHT_BROWSERS_PATH`, default `/opt/pw-browsers`).
The first build is slow. Free ports 8990 and 8991 before running.

## Feature overview

| Sonarr area | Pages |
| --- | --- |
| Series | Series, Add New, Library Import, series detail with interactive search |
| Calendar | Calendar |
| Activity | Queue, History, Blocklist |
| Wanted | Missing, Cutoff Unmet |
| Settings | Media Management, Profiles, Quality, Indexers, Download Clients, Connect, Tags, General, UI |
| System | Status, Tasks, Backup, Updates, Events, Log Files |
