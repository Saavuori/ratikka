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

Full pipeline reference (all three workflows, the release decision table,
the deploy path, and a runbook): `docs/CICD.md`. Summary below.

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

**Dependency updates write their own entry.** Renovate runs
`scripts/changelog-entry.js` as a post-upgrade task, so the entry — and
therefore the bumped heading — is part of Renovate's own commit on the branch.
A dependency PR then releases itself through the ordinary path above, and the
text is reviewable before it ships rather than after. The version is a
prediction (base heading, patch + 1); Renovate regenerates it on every rebase,
so it corrects itself if another PR merges first and takes that number.

**The fallback in `scripts/derive-release.sh` is now a safety net, not the
mechanism.** If a dependency branch reaches `main` with the heading unmoved —
the post-upgrade task failed, or the bot was swapped out — then when *every*
new non-merge commit since the current tag is prefixed `chore(deps)` or
`chore(deps-dev)`, it generates the entry, bumps the **patch**, and releases. A
single human commit in the batch disables it: the heading stays put and nothing
ships until a human writes an entry. This is why `renovate.json5` must keep the
`chore(deps)` commit prefix on **every** manager, GitHub Actions included — the
fallback keys off that exact string, and a prettier `ci(deps)` would silently
disable it.

Both scripts are release-critical, so both are tested outside CI's YAML and run
in the `release-logic` job: `scripts/derive-release.test.sh` covers the four
release-decision paths, `scripts/changelog-entry.test.sh` covers what the
generated entry says and the no-op cases.

### CHANGELOG

- `CHANGELOG.md` is maintained **by hand**. Add an entry under a new
  `## [vX.Y.Z] - YYYY-MM-DD` heading with `### Added` / `### Fixed` /
  `### Changed` sections, separated from the entry below it by `---`.
- The sole exception is dependency PRs, where Renovate writes the entry. That
  text is factual only — what moved, between which versions — so expand it by
  hand when a bump actually matters.
- Pushing a changed `CHANGELOG.md` to `main` triggers `deploy-pages.yml`, which
  compiles it via `scripts/build-changelog.js` and publishes to GitHub Pages.

## CI

`.github/workflows/ci.yml` runs on every PR and on `main`: `go vet` + `go test ./...`
+ a `go mod tidy` check for the backend, `npm run lint`/`build`/`test` for the
frontend, and an amd64-only Docker build. A merge to `main` deploys itself, so
this is the gate — keep it green.

Dependency updates arrive as **one** grouped Renovate PR every Monday covering
every pinned surface — `backend/go.mod`, `frontend/package.json`, the GitHub
Actions, the `Dockerfile` stages and the `docker-compose.yml` images. Config is
`renovate.json5`; the schedule is the cron in `.github/workflows/renovate.yml`.
Majors come as their own PR, and MapLibre majors are disabled outright — v0.46.0
shipped a blank map through a green CI, so those need both map checks run by
hand. Adding a new kind of pinned version means adding a pattern to `SOURCES` in
`scripts/changelog-entry.js`, or its bump lands in the PR with no changelog line.

Renovate is self-hosted (the Mend-hosted app won't run post-upgrade commands)
and authenticates as a GitHub App — see README, "Dependency updates", for the
two secrets it needs and why `GITHUB_TOKEN` cannot be used.

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
