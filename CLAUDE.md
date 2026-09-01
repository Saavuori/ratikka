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
- `src/lib/` — `api.ts` (backend client), `lerp.ts` (60fps interpolation), `polyline.ts`, `trip.ts`,
  `routeSlots.ts` (which offset slot each highlighted route takes) and `routeLineStyle.ts`
  (the paint expressions that turn a slot into pixels — see "Verifying the map").
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

Full pipeline reference (all three workflows, the deploy path, and a runbook):
`docs/CICD.md`. Summary below.

**The version comes from the commit messages.** On a push to `main`,
`.github/workflows/docker-build.yml` runs `paulhatch/semantic-version`, which
reads every commit since the last `v*` tag and picks the bump:

| commit contains | bump |
|---|---|
| `!:` or `BREAKING CHANGE:` | major |
| `feat:` / `feat(scope):` | minor |
| anything else, incl. `chore(deps):` | patch |

It then tags the commit `vX.Y.Z`, builds a multi-arch image (`linux/amd64`,
`linux/arm64`) and pushes it to `ghcr.io/saavuori/ratikka` tagged `latest`,
`vX.Y.Z`, and the commit SHA. The build injects `VERSION` / `BUILD_DATE` /
`GIT_SHA` via `-ldflags`, surfaced at `GET /api/v1/version` and in the frontend
`VersionBadge`. An auto-update cron on the host pulls the new `latest` image
(see `deploy.sh` / `docker-compose.yml`), so a merge to `main` deploys itself.

This means **Conventional Commits are load-bearing** — the prefix is not a
style preference, it is the version number. A `feat:` that should have been a
`fix:` ships a minor.

Doc-only changes are skipped (`paths-ignore` for `README.md`, `CLAUDE.md`,
`CHANGELOG.md`, `docs/**`, `monitoring/**`, `scripts/**`, `.claude/**`,
`deploy.sh`, `.gitignore`) — they don't cut a release.

**Do not create tags manually.** The workflow owns them.

### Why it is no longer the changelog

Until v0.50.4 the release tag was whatever the top `## [vX.Y.Z]` heading in
`CHANGELOG.md` said. That coupling had two failure modes, and both actually
happened:

- A merge that forgot to bump the heading shipped **nothing**, silently — the
  tag already existed, so the build skipped itself. v0.44.9 had to be re-cut as
  v0.44.10 for exactly this reason.
- Every open PR had to *predict* the next number, so two PRs in flight both
  wrote the same heading and conflicted in `CHANGELOG.md` by construction. PR
  #59 hit this against #60.

The scaffolding built to work around the second problem — Renovate's
`scripts/changelog-entry.js` post-upgrade task, the dependency-only fallback in
`scripts/derive-release.sh`, and the tests for both — was all in service of a
version number that no longer lives there. It is gone.

### CHANGELOG

`CHANGELOG.md` is documentation now, not machinery. It does not gate the build
and it does not choose the version, so it can never conflict over one.

- Maintained **by hand**, but **never write a version number in it.** Put the
  entry under `## [Unreleased]` with `### Added` / `### Fixed` / `### Changed`
  sections, separated from the entry below it by `---`. Add to the existing
  `## [Unreleased]` heading if one is already there.
- The release workflow stamps the heading. When `docker-build.yml` cuts a tag it
  rewrites `## [Unreleased]` to `## [vX.Y.Z] - YYYY-MM-DD` and commits that back
  to `main`, then `deploy-pages.yml` publishes it via `scripts/build-changelog.js`.
  A release with no pending entry stamps nothing and ships unannotated.
- CI rejects a `## [vX.Y.Z]` heading your branch adds unless that tag already
  exists. A branch cannot know its version — `semantic-version` picks it at merge
  time, and other releases land while yours is open — so any number written by
  hand is a guess. **The guesses drifted:** the heading labelled `v0.51.1` was
  carrying v0.51.4's and v0.51.9's work while six releases went unannotated, and
  further back `v0.44.2` names a release that was never tagged at all.
- Dependabot does not write entries. A dependency merge still releases (patch),
  it just arrives unannotated; fold it into the next entry, and expand it by
  hand when a bump actually matters.

## CI

`.github/workflows/ci.yml` runs on every PR and on `main`: `go vet` +
`go test ./...` + a `go mod tidy` check for the backend, `npm run lint`/`build`
/`test` for the frontend, a changelog guard (no invented version headings, no
stranded `[Unreleased]`) plus a render of `scripts/build-changelog.js`, and an amd64-only Docker build. A merge to `main`
deploys itself, so this is the gate — keep it green.

Dependency updates arrive as **Dependabot** PRs every Monday, configured in
`.github/dependabot.yml`, one grouped minor/patch PR per ecosystem:
`backend/go.mod`, `frontend/package.json`, the GitHub Actions, the `Dockerfile`
stages and the `docker-compose.yml` images. Majors come as their own PR, and
MapLibre majors are ignored outright — v0.46.0 shipped a blank map through a
green CI, so those need all three map checks run by hand.

Every ecosystem uses the `chore(deps)` / `chore(deps-dev)` commit prefix. That
no longer decides whether a release happens, but it keeps dependency commits
out of the `feat:` pattern so a batch of them cuts a patch, not a minor.

### Verifying the map

Nothing about the map is checked by `tsc` or the unit tests. There are three
separate failure modes and a script for each — **run all three**; passing one
proves nothing about the others.

```bash
cd frontend && npm run build && cd ..
npx playwright@latest install chromium    # once
npm i --no-save playwright                # from the repo root, once per checkout

node scripts/verify-map-layers.mjs        # 1. are the layer specs valid?
DIGITRANSIT_API_KEY=... node scripts/verify-map-renders.mjs   # 2. does it draw?
node scripts/verify-route-offsets.mjs     # 3. does it draw in the right place?
```

Playwright is intentionally not a devDependency, to keep `npm install` lean.

**1. Layer specs** (`verify-map-layers.mjs`) — MapLibre validates expressions at
runtime in a browser. Because most layers anchor to `trams-circles` via
`beforeId`, one bad expression silently takes the stops, route path and journey
overlay with it (v0.44.7). This script stubs every external asset, so it is
purely a spec check.

**2. Actual rendering** (`verify-map-renders.mjs`) — hits the real Digitransit
basemap with a real subscription key, then asserts vector tiles came back and
`isStyleLoaded()` is true. This exists because v0.46.0 passed the spec check and
still shipped a completely blank map: the stubs meant no tile was ever parsed,
so nothing downstream of the worker was exercised. "The specs are valid" and
"pixels appear" are different claims and need different checks.

Get the key from the deploy host's `.env` (see memory `oracle-host-multi-app-deploy`).
This check is not in CI — it needs a real key as a secret.

**3. Placement** (`verify-route-offsets.mjs`) — draws synthetic route geometry
with the app's own paint expressions and measures, pixel by pixel, how far the
painted ribbon lands from the coordinates it was given. Needs no key: the
basemap is blank and the geometry is made up.

This exists because a map can pass both checks above and still be wrong. Routes
sharing a street are fanned into parallel ribbons with MapLibre's `line-offset`
(`frontend/src/lib/routeLineStyle.ts`, slots assigned in `routeSlots.ts`), and
**`line-offset` is measured in pixels** — the same nudge covers more and more
*ground* the further you zoom out. In v0.50.2 an uncapped fan therefore drew
tram lines a block off the street they follow at city zoom, several of them out
in the sea, plus blobs of solid colour at the terminal loops, where an offset
wider than the turn folds the offset geometry in on itself. Every layer spec was
valid and every tile rendered.

Two rules keep it honest, and both are asserted by the script: the fan tapers to
zero below zoom 12, and the slot is capped so the outermost ribbon stays within
about a street of its route. The offset expression's zoom stops are also unit
tested in CI (`routeLineStyle.test.ts`, evaluated through MapLibre's own style
spec), so the arithmetic is guarded on every PR; the script is what proves the
renderer agrees.

## Conventions

- Backend uses only the Go standard library plus a few pinned deps (`coder/websocket`,
  `paho.mqtt.golang`, `go-redis`, `prometheus/client_golang`, `singleflight`) — prefer
  the stdlib and avoid adding dependencies casually.
- Keep the Digitransit key server-side; frontend fetches map config from `/api/v1/config`.
- Match surrounding style: Go idioms in the backend, functional React hooks + vanilla
  CSS variables in the frontend.
- Tests live beside code (`*_test.go`, `*.test.ts`). Run them before pushing to `main`,
  since a merge ships to production.
- Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`,
  scopes allowed) and the prefix **is** the version bump — see "Versioning & Release".
