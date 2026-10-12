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

The API key is generated on first run and accepted via the `X-Api-Key` header or `apikey` query parameter.
