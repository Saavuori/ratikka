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
npm test         # vitest run
```
Run the backend on :8080 first — the Vite dev server proxies API + WebSocket to it.

**Full stack via containers:**
```bash
docker compose up --build   # override file builds the backend image locally
```

## Versioning & Release

**`CHANGELOG.md` is the single source of truth for the version.** The release
tag is whatever the top `## [vX.Y.Z]` heading says, so the deployed version and
the changelog cannot drift apart. Do **not** create tags manually.

**To cut a release: bump the heading in `CHANGELOG.md`.** That is the whole
trigger. If the heading is unchanged, the tag already exists and
`.github/workflows/docker-build.yml` skips the build entirely — so a merge to
`main` that forgets the changelog bump ships nothing, silently. (This has
bitten before: v0.44.9 had to be re-cut as v0.44.10 for exactly this reason.)

- On push to `main`, `docker-build.yml` greps the first `## [vX.Y.Z]` heading
  out of `CHANGELOG.md` and tags the commit `vX.Y.Z`. There is no automatic
  bump computation — you choose the number by writing the heading.
- Pick the number semantically: new feature → minor, bugfix → patch,
  breaking change → major.
- The same workflow then builds a multi-arch image (`linux/amd64`, `linux/arm64`)
  and pushes to `ghcr.io/saavuori/ratikka` tagged `latest`, `vX.Y.Z`, and the commit SHA.
  The build injects `VERSION` / `BUILD_DATE` / `GIT_SHA` via `-ldflags`, surfaced at
  `GET /api/v1/version` and in the frontend `VersionBadge`.
- An auto-update cron on the host pulls the new `latest` image (see `deploy.sh` /
  `docker-compose.yml`), so a merge to `main` with a bumped changelog deploys itself.
- Doc/infra-only changes are skipped (`paths-ignore` for `README.md`, `docs/**`,
  `monitoring/**`, `deploy.sh`, `.gitignore`) — they don't cut a release.

Commit messages still follow Conventional Commits (`feat:`, `fix:`, `docs:`,
`chore:`, scopes allowed) — they are how the changelog gets written, they just
no longer drive the version number.

### CHANGELOG

- `CHANGELOG.md` is maintained **by hand**. Add an entry under a new
  `## [vX.Y.Z] - YYYY-MM-DD` heading with `### Added` / `### Fixed` /
  `### Changed` sections.
- Pushing a changed `CHANGELOG.md` to `main` triggers `deploy-pages.yml`, which
  compiles it via `scripts/build-changelog.js` and publishes to GitHub Pages.

## CI

`.github/workflows/ci.yml` runs on every PR and on `main`: `go vet` + `go test ./...`
+ a `go mod tidy` check for the backend, `npm run lint`/`build`/`test` for the
frontend, and an amd64-only Docker build. A merge to `main` deploys itself, so
this is the gate — keep it green.

Dependency updates arrive as weekly grouped Dependabot PRs
(`.github/dependabot.yml`). MapLibre majors are deliberately excluded; see
`docs/TECH_STACK_UPGRADE_PLAN.md`.

### Verifying map layers

MapLibre expressions are validated at runtime in a browser, not by `tsc` — so
neither the build nor the tests can tell you a layer was rejected. Because most
layers anchor to `trams-circles` via `beforeId`, one bad expression silently
takes the stops, route path and journey overlay with it (this is what happened
in v0.44.7). **After any change to layer specs in `Map.tsx`, run:**

```bash
cd frontend && npm run build && cd ..
npx playwright@latest install chromium    # once
node scripts/verify-map-layers.mjs        # exits non-zero on a rejected layer
```

Playwright is intentionally not a devDependency, to keep `npm install` lean.

## Conventions

- Backend uses only the Go standard library plus a few pinned deps (`coder/websocket`,
  `paho.mqtt.golang`, `go-redis`, `prometheus/client_golang`, `singleflight`) — prefer
  the stdlib and avoid adding dependencies casually.
- Keep the Digitransit key server-side; frontend fetches map config from `/api/v1/config`.
- Match surrounding style: Go idioms in the backend, functional React hooks + vanilla
  CSS variables in the frontend.
- Tests live beside code (`*_test.go`, `*.test.ts`). Run them before pushing to `main`,
  since a merge ships to production.
