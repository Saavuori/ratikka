# CLAUDE.md

Guidance for Claude Code (and humans) working in this repository.

## What this is

**HSL - LIVE** (repo name `ratikka`) is a real-time map of Helsinki's trams, buses,
and City Bike stations. Live vehicle telemetry arrives over MQTT from HSL's public
broker, is cached in Redis, and is streamed to a React frontend over a WebSocket.
The Go backend also proxies Digitransit's map, geocoding, and routing APIs so the
Digitransit subscription key never reaches the browser.

- Live app: https://hsl-live.duckdns.org/
- Changelog (GitHub Pages): https://saavuori.github.io/ratikka/
- Deploy host runs behind a shared Caddy on an Oracle box — see memory `oracle-host-multi-app-deploy`.

## Architecture

```
HSL MQTT broker ──▶ backend (Go) ──▶ Redis (live coord cache)
                        │
   Digitransit APIs ◀───┤ (map key, geocode, routing — proxied, singleflight + cache)
                        │
                        └──▶ WebSocket /api/v1/stream ──▶ frontend (React + MapLibre)
```

### Backend — `backend/` (Go 1.26, module `ratikka`)
- `cmd/ratikka/main.go` — entrypoint: loads config, wires cache + MQTT + WS hub, serves HTTP.
- `internal/api/` — HTTP handlers, `router.go` (native `http.ServeMux`, Go 1.22+ method+pattern routing), `graphql_client.go` and `journey.go` (Digitransit GraphQL proxy), embedded frontend in `static.go` (`internal/api/dist/`).
- `internal/mqtt/` — HFP v2 ingestion (`/hfp/v2/journey/ongoing/vp/tram/#` and `.../bus/#`).
- `internal/cache/` — `Cache` interface with `redis.go` and `memory.go` (in-memory fallback when Redis is off).
- `internal/ws/` — WebSocket hub broadcasting live positions.
- `internal/config/` — env + `.env` + flag loading.
- Version strings (`Version`, `BuildDate`, `GitCommit`) live in `internal/api/handlers.go` and are injected at build time via `-ldflags` (default `"dev"`/`"unknown"` for local builds).

### Frontend — `frontend/` (React 19, TypeScript, Vite 8, MapLibre GL 5)
- `src/components/` — Map plus glassmorphic panels/popups (`Map.tsx`, `FilterPanel.tsx`, `TramPopup.tsx`, `StopPopup.tsx`, `BikePopup.tsx`, `JourneySearch.tsx`, `BottomNav.tsx`, `VersionBadge.tsx`).
- `src/hooks/` — `useWebSocket`, `useTramData`, `useGeolocation`, `useIsMobile`, `useSwipeGestures`, `useCollapsiblePanel`.
- `src/lib/` — `api.ts` (backend client), `lerp.ts` (60fps interpolation), `polyline.ts`, `trip.ts`.
- Vanilla CSS with theme variables in `index.css` / `App.css`.

## HTTP API

All under `/api/v1` (see `docs/API_REFERENCE.md` for schemas): `health`, `version`,
`config`, `alerts`, `trip/{id}`, `stop/{id}`, `route/{shortName}`, `bike-station/{id}`,
`geocode`, `plan`, and the `stream` WebSocket.

## Development

**Backend** (from `backend/`):
```bash
go run ./cmd/ratikka --no-redis   # in-memory cache, no Redis needed
go test ./...
```
Config comes from env vars (or a `.env` file): `DIGITRANSIT_API_KEY` (required for
map/geocode/routing), `REDIS_URL`, `MQTT_BROKER`, `PORT` (default 8080). `--no-redis`
or `NO_REDIS=true` uses the in-memory cache.

**Frontend** (from `frontend/`):
```bash
npm install
npm run dev      # Vite dev server; proxies /api and /api/v1/stream to 127.0.0.1:8080
npm run build    # tsc -b && vite build
npm run lint
```
Run the backend on :8080 first — the Vite dev server proxies API + WebSocket to it.

**Full stack via containers:**
```bash
docker compose up --build   # override file builds the backend image locally
```

## Versioning & Release

**Semantic versioning, driven by Conventional Commits, fully automated in CI.**
Do **not** hand-edit version numbers or create tags manually.

- Commit messages must follow Conventional Commits: `feat:`, `fix:`, `docs:`,
  `chore:`, etc. (scopes allowed, e.g. `fix(frontend): ...`).
- On push to `main`, `.github/workflows/docker-build.yml` runs
  `mathieudutour/github-tag-action`, which computes the next tag from the commits
  since the last tag: `feat` → **minor**, `fix` → **patch**, `BREAKING CHANGE` (or `!`)
  → **major**. Default bump is **patch**. It creates the `vX.Y.Z` git tag.
- The same workflow then builds a multi-arch image (`linux/amd64`, `linux/arm64`)
  and pushes to `ghcr.io/saavuori/ratikka` tagged `latest`, `vX.Y.Z`, and the commit SHA.
  The build injects `VERSION` / `BUILD_DATE` / `GIT_SHA` via `-ldflags`, surfaced at
  `GET /api/v1/version` and in the frontend `VersionBadge`.
- Watchtower on the host auto-pulls the new `latest` image (see `deploy.sh` /
  `docker-compose.yml`), so a merge to `main` deploys itself.
- Doc/infra-only changes are skipped (`paths-ignore` for `README.md`, `docs/**`,
  `monitoring/**`, `deploy.sh`, `.gitignore`) — they don't cut a release.

### CHANGELOG

- `CHANGELOG.md` is maintained **by hand**. Add an entry under a new
  `## [vX.Y.Z] - YYYY-MM-DD` heading with `### Added` / `### Fixed` sections.
- **The version heading must match the tag CI will actually generate** — mismatches
  have been fixed before (see the changelog itself). Match the bump to your commit
  types before writing the heading.
- Pushing a changed `CHANGELOG.md` to `main` triggers `deploy-pages.yml`, which
  compiles it via `scripts/build-changelog.js` and publishes to GitHub Pages.

## Conventions

- Backend uses only the Go standard library plus a few pinned deps (`coder/websocket`,
  `paho.mqtt.golang`, `go-redis`, `prometheus/client_golang`, `singleflight`) — prefer
  the stdlib and avoid adding dependencies casually.
- Keep the Digitransit key server-side; frontend fetches map config from `/api/v1/config`.
- Match surrounding style: Go idioms in the backend, functional React hooks + vanilla
  CSS variables in the frontend.
- Tests live beside code (`*_test.go`, `*.test.ts`). Run them before pushing to `main`,
  since a merge ships to production.
