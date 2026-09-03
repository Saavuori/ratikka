# 🚋 HSL - LIVE — Live Helsinki Tram & Bus Tracker

[![Live Application](https://img.shields.io/badge/Live-hsl--live.duckdns.org-00b894?style=for-the-badge&logo=react)](https://hsl-live.duckdns.org/)
[![Changelog](https://img.shields.io/badge/Changelog-GitHub%20Pages-0984e3?style=for-the-badge&logo=github)](https://saavuori.github.io/ratikka/)

A premium, high-performance web application mapping **all active Helsinki trams, buses, metro, commuter trains, and City Bike stations** in real-time. Built with stunning glassmorphism aesthetics, fluid 60fps telemetry interpolation, and immersive interactive modes.

👉 **Experience the live dashboard at [hsl-live.duckdns.org](https://hsl-live.duckdns.org/)**

📖 **Check out recent updates and release history on the [Live Changelog](https://saavuori.github.io/ratikka/)**

---

## 📸 Screenshots & UI

![HSL - LIVE Dashboard](docs/screenshots/hsl_live_dashboard.png)

---

## ✨ Key Features

### Live Map

* **Destination Journey Search**: A top-center "Where to?" search plans a trip from your current location (used by default) to any searched destination, ranks the routes that get you there, and highlights the exact stops to use — boarding stop in green, final stop in coral, transfers in gold — while drawing each transit and walking leg on the map and fitting the journey into view.
* **Real-time 60fps Vehicle Interpolation**: Live MQTT vehicle coordinate updates for **trams, buses, metro and commuter trains** are mathematically interpolated (lerp) for buttery-smooth vehicle movement.
* **Mode-Shaped, Line-Coloured Vehicle Icons**: Every vehicle is drawn as a directional carriage rotated to its live heading and tinted with its own line's colour — a tram, a bus, the metro's coupled pair of units, or a commuter train with the pantograph on its roof. The artwork swaps to a doors-open variant while HFP reports `drst`, and rear brake lights glow while the vehicle is stopped or braking hard.
* **Real-Scale 3D Vehicle Bodies**: In the tilted 3D view the flat icons crossfade into extruded bodies drawn at true scale in metres — a 27 m tram, a 12.5 m bus, the metro's coupled pair, a 75 m commuter train — with a window band around the flanks, per-side doors that go amber as they slide open, a pale cab patch at each driving end, and the train's pantograph. Dimensions are unit tested (`vehicleModels.test.ts`); `scripts/verify-vehicle-3d.mjs` checks the renderer agrees.
* **Metro Trains That Keep Moving Underground**: almost all of both metro lines is in tunnel, where HFP positions are dead-reckoned from odometry and arrive in bursts. Reported positions are projected onto the line's own track geometry (`metroTracks.ts`) and carried forward between reports by integrating the reported speed and acceleration along that track (`deadReckon.ts`), so a train glides down its tunnel instead of freezing and then lurching.
* **Immersive Chase Mode (Follow Vehicle)**: Lock onto any vehicle to automatically track it. The camera auto-centers and auto-rotates (bearing) matching the vehicle's live heading, and releases as soon as you drag the map.
* **Traffic-Sign Stop Symbols**: From zoom 15.5 the map swaps flat stop dots for sign-on-a-pole symbols, colour-coded per mode (tram, bus, metro and commuter rail), with gold-bordered variants for the selected and next stop.
* **Interactive Route Network & Highlights**: Toggle the background route network on the map. Click a stop to see all routes serving it highlighted, or click a vehicle to highlight its specific path plus a gold segment running to its next stop.
* **Live City Bike Station Capacity**: City Bike stations render with a live "bikes available" bubble; click one to fetch full availability (bikes available vs. empty spaces) from Digitransit.
* **Light / Dark Themes & 3D View**: Two chips in the map's top-left corner switch between the Digitransit HSL light basemap and a dark one, and tilt into the 3D view (extruded buildings plus the 3D vehicle bodies above). Both preferences persist in `localStorage`, as do the mode toggles and the selected lines.
* **Self-Location (GPS)**: A geolocate control tracks and centres on your own position, styled to match the glassmorphic theme.

### Telemetry & Diagnostics

* **Three-Tab Vehicle Panel**: Selecting a vehicle opens a `Telemetry` / `Schedule` / `Diagnostics` sidebar sourced from raw HSL HFP v2 fields.
* **Animated 2D Vehicle Schematic**: Mode-accurate vector layouts — 3 door pairs for trams, 2 for buses, the metro's two coupled units with a cab at each outer end, and the commuter train's raked nose, pantograph and paired bogie wheels — that open doors live from the `drst` flag, blink boarding indicators, and spin wheels at a rate proportional to velocity. See [docs/ICONS_AND_ANIMATIONS.md](docs/ICONS_AND_ANIMATIONS.md) for a full catalogue of every tram/bus icon and animation with source examples.
* **Arc Speedometer & Acceleration Gauges**: Custom SVG speedometer and schedule-deviation dials plus a bidirectional accelerometer bar showing cruising, acceleration, or active braking.
* **Likely-Waiting-At-Lights Explanation**: Helsinki's open dataset of signalized junctions (served by `/api/v1/traffic-lights`, CC BY 4.0) is drawn on the map from street level up. A tram stopped with its doors closed within ~35 m of one reads "Likely waiting at traffic lights" with the cross-street names, instead of an unexplained "stopped". It is a location dataset, not a live signal feed, so the label is offered as the likely explanation rather than a confirmed one.
* **Deep Diagnostics**: Operator registry name, chassis ID, occupancy %, GPS source, odometer, HFP update drift in ms, and the underlying GTFS route/direction/trip identifiers.

### Data & Performance

* **Real-time HSL Service Disruptions**: Active disruptions, detours, and delay alerts are fetched from Digitransit's Routing API and shown in the sidebar. The feed is contextual — it narrows to the selected vehicle, the selected stop and its serving routes, or your active line filters, and falls back to network-wide announcements only when nothing is selected.
* **Request Coalescing & Response Caching**: Go's `singleflight.Group` deduplicates concurrent upstream queries, backed by an in-memory response cache — trip timetables and stop departures (10s TTL), bike capacities (15s), journey plans and the bike-station collection (20s), service alerts and geocoding (60s), route geometries (1h), and the traffic-light dataset (24h) — keeping vehicle-selection latency in the low milliseconds.
* **Flexible Filtering**: A 190px left panel with a 2-column line button grid (supporting 4-character line names) and the contextual service-alert feed. The switches themselves live on the map: the four vehicle-mode chips in the top-right corner, the theme and 3D chips in the top-left.
* **Glassmorphic, Gesture-Driven UI**: Responsive control cards across mobile and desktop. Collapsed sidebars leave a 16px glass edge peeking out and respond to click or swipe, with inline stop telemetry on the top info card.

---

## Technical Stack

* **Backend**: Go 1.26, using native `http.ServeMux` method-and-pattern routing (Go 1.22+), `coder/websocket` for streaming, `eclipse/paho.mqtt.golang` to ingest live telemetry from HSL's public broker, and `golang.org/x/sync/singleflight` for query deduplication.
* **MQTT Ingestion**: HFP v2 on `tls://mqtt.hsl.fi:8883`. Trams (`/hfp/v2/journey/ongoing/vp/tram/#`) are always subscribed; the `bus`, `metro` and `train` topics are subscribed on demand — the WebSocket hub counts demand per mode, subscribing at the first client that asks for it (`{"modes": {...}}`) and unsubscribing when the last one leaves.
* **State Store**: Redis 8 (Alpine), acting as a low-overhead live coordinate cache with a 64 MB `allkeys-lru` cap, tracking unique operator-prefixed vehicle IDs (`{operator}-{vehicle}`). An in-memory map is used instead when Redis is disabled.
* **Frontend**: React 19, TypeScript 6, Vite 8, MapLibre GL JS 6.x, Lucide icons, and vanilla CSS with custom theme variables. Tests run on Vitest.
* **Map Tile Stream**: Digitransit Map API v3 (vector `style.json`, stop POI tiles, and rental-station tiles).
* **Routing API**: Digitransit Routing API v2 (GraphQL proxied server-side so the API key never reaches the browser, including a fuzzy trip lookup fallback).
* **Open City Data**: Helsinki's `Liikennevalot_piste` / `Varoitusvalot_piste` WFS layers (CC BY 4.0) for signalized-junction positions, fetched server-side and cached for a day.
* **Observability**: Prometheus metrics on `/metrics`, scraped by a Grafana Alloy sidecar and remote-written to Grafana Cloud.
* **Reverse Proxy**: Caddy 2 (Alpine) with gzip/zstd compression.
* **CI/CD**: GitHub Actions — a PR gate (`go vet`, `go test`, `go mod tidy`, frontend lint/build/test, changelog render, amd64 Docker build), a release workflow auto-tagging semver from the commit messages and building multi-arch images (`linux/amd64`, `linux/arm64`) to GitHub Packages, and a Pages workflow publishing the changelog. Full pipeline, release rules and runbook: [docs/CICD.md](docs/CICD.md).

---

## HTTP API

All endpoints are served by the Go backend under `/api/v1`. See [docs/API_REFERENCE.md](docs/API_REFERENCE.md) for payload schemas.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/health` | Liveness plus `mqtt_connected`, `redis_connected`, `active_vehicles`, `uptime_seconds` |
| `GET` | `/api/v1/version` | Build `version`, `build_date`, and `git_sha` (injected via ldflags) |
| `GET` | `/api/v1/config` | Digitransit map subscription key for the frontend tile requests |
| `GET` | `/api/v1/alerts` | Active HSL service disruptions |
| `GET` | `/api/v1/trip/{tripId}` | Trip route, headsign, stop timeline, and geometry |
| `GET` | `/api/v1/stop/{stopId}` | Stop details and upcoming departures (`?departures=N`) |
| `GET` | `/api/v1/route/{shortName}` | Route geometry and colour by short name |
| `GET` | `/api/v1/bike-station/{stationId}` | Live City Bike capacity |
| `GET` | `/api/v1/bike-stations` | All City Bike stations with live counts (GeoJSON) |
| `GET` | `/api/v1/traffic-lights` | Helsinki signalized-junction locations (GeoJSON, Helsinki open data) |
| `GET` | `/api/v1/geocode` | Destination search (Digitransit geocoding, `?text=&lat=&lon=`) |
| `GET` | `/api/v1/plan` | Journey planning between two points (`?fromLat=&fromLon=&toLat=&toLon=`) |
| `GET` | `/api/v1/stream` | WebSocket stream of live vehicle positions |
| `GET` | `/metrics` | Prometheus exposition format |
| `GET` | `/` | Embedded React SPA (go:embed static fallback) |

---

## Project Structure

```
ratikka/
├── backend/                  # Go application source
│   ├── cmd/ratikka/          # main entry point
│   ├── internal/             # config, cache, mqtt, ws, api packages
│   └── go.mod
├── frontend/                 # React 19 TypeScript client source
│   ├── src/                  # components, hooks, lib, styles, types
│   └── package.json
├── docs/                     # Detailed architectural documents
│   ├── API_REFERENCE.md      # REST/WS/external endpoint specs
│   ├── CICD.md               # Workflows, release rules, deploy path, runbook
│   ├── ICONS_AND_ANIMATIONS.md # Tram/bus marker icons and animation reference
│   ├── LOCAL_DEVELOPMENT.md  # How to run and test locally
│   ├── MONITORING.md         # Metrics pipeline and dashboard import
│   ├── PLAN.md               # Feature lists and mermaid architecture
│   ├── TECH_STACK_UPGRADE_PLAN.md # Stack inventory and upgrade rationale
│   ├── VERIFICATION.md       # Quality gates and validation plans
│   └── screenshots/
├── monitoring/
│   ├── alloy/config.alloy    # Grafana Alloy scrape + remote_write config
│   └── grafana/dashboard.json# Importable APM dashboard
├── scripts/                  # Changelog site generator + the four map verification scripts
├── dist-changelog/           # Generated changelog site (GitHub Pages)
├── .github/workflows/        # CI gate, multi-arch image build, Pages deploy
├── .agents/workflows/        # Custom pair-programming guidelines
│   ├── committing.md         # Commit rules
│   ├── map-features.md       # Map layer conventions
│   └── versioning.md         # CI/CD version bump rules
├── Caddyfile                 # Caddy reverse proxy rules
├── Dockerfile                # Multi-stage build context
├── docker-compose.yml        # Orchestrated compose definition
├── deploy.sh                 # One-shot RHEL/Podman provisioning script
└── CHANGELOG.md              # Release history
```

---

## Configuration

Set the following in `.env` or in your environment. The backend auto-loads a `.env` file from the working directory, its parent, or `backend/`; real environment variables always take precedence.

### Backend

| Variable | Description | Default |
|---|---|---|
| `DIGITRANSIT_API_KEY` | Subscription key for the Digitransit GraphQL and Map APIs | *(Required)* |
| `DIGITRANSIT_MAP_API_KEY` | Optional separate key served to browsers for map tiles (`/api/v1/config`). Use a dedicated rate-limited key here so the server-side routing key stays private | Falls back to `DIGITRANSIT_API_KEY` |
| `REDIS_URL` | Redis cache connection string | `redis://ratikka-cache:6379` |
| `MQTT_BROKER` | HSL public MQTT endpoint | `tls://mqtt.hsl.fi:8883` |
| `PORT` | Go backend server port | `8080` |
| `NO_REDIS` | Set to `true` to use an in-memory cache instead of Redis (same as `--no-redis`) | `false` |

### Monitoring sidecar

Consumed by the Grafana Alloy container in `docker-compose.yml`, not by the Go backend. Omit them to run without remote metrics.

| Variable | Description |
|---|---|
| `GRAFANA_CLOUD_PROMETHEUS_URL` | Prometheus remote-write URL |
| `GRAFANA_CLOUD_PROMETHEUS_USER` | Prometheus username / instance ID |
| `GRAFANA_CLOUD_PROMETHEUS_TOKEN` | Prometheus access token |

See [docs/MONITORING.md](docs/MONITORING.md) for the full telemetry pipeline and dashboard import steps.

---

## Local Development Setup

To run a fast development loop locally, see [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md) for full options.

### 1. Run Backend (No Redis needed)

Pass `--no-redis` to skip running a local Redis container:
```bash
cd backend
go run ./cmd/ratikka --no-redis
```
*(Server listens on port `:8080`)*

### 2. Run Frontend Dev Server

```bash
cd frontend
npm install
npm run dev
```
*(Vite runs on port `:5173` and automatically proxies `/api` and the `/api/v1/stream` WebSocket to `:8080`)*

### 3. Run Unit Tests

* **Backend**: `cd backend && go test ./...` — covers MQTT payload parsing/thinning, cache behaviour, config loading, WebSocket hub fan-out, and REST/GraphQL-proxy serialization.
* **Frontend**: `cd frontend && npm test` — covers interpolation and heading wrap-around maths, metro track projection and dead reckoning, route colours and offset slots, the route-offset zoom stops (through MapLibre's own style spec), 3D vehicle dimensions, stop-alert collapsing and the vehicle schematic.
* **Lint**: `cd frontend && npm run lint`
* **Map**: none of the map's behaviour is covered by `tsc` or the unit tests — run the four verification scripts in `scripts/` by hand (layer specs, real rendering, route placement, 3D bodies). See `CLAUDE.md` § "Verifying the map".

---

## Deployment

### Local Deployment (Docker Compose)

Builds the Node frontend, embeds the assets into the Go binary, and launches the full stack (Caddy, backend, Redis, Alloy):

```bash
# Set your API Key
export DIGITRANSIT_API_KEY="your-key"   # Linux/macOS
# or $env:DIGITRANSIT_API_KEY="your-key"  # Windows PowerShell

# Build and start services
docker compose up --build -d

# Verify server health
curl http://localhost/api/v1/health
```

Access the map dashboard in your web browser at `http://localhost`.

### Production Deployment (RHEL & Podman)

To deploy the application on a clean RHEL system:

```bash
curl -sSL -O https://raw.githubusercontent.com/Saavuori/ratikka/main/deploy.sh && bash deploy.sh
```

*(The script configures unprivileged port binding, sets the firewall, installs Podman, downloads `docker-compose.yml`, `Caddyfile`, and `config.alloy` from the repository, prompts for API/monitoring keys, and starts the container stack. Images are refreshed by an `update.sh` cron job every 5 minutes rather than Watchtower, which is incompatible with rootless Podman.)*

## 🔄 Dependency updates

**Dependabot** opens one grouped minor/patch pull request per ecosystem every Monday morning, covering every place the repo pins a version — `backend/go.mod`, `frontend/package.json`, the GitHub Actions in `.github/workflows/`, the `Dockerfile` build and runtime stages, and the images in `docker-compose.yml`. Major updates come as their own PR; MapLibre majors are ignored entirely, because they need all three map checks run by hand (see `CLAUDE.md`). Config lives in [`.github/dependabot.yml`](.github/dependabot.yml).

Dependabot needs no secrets, no GitHub App and no scheduled workflow of its own — GitHub runs it. That is the whole reason it replaced the self-hosted Renovate setup. Renovate was self-hosted only because it had to run a post-upgrade command to write a `CHANGELOG.md` entry, and that entry was required because the top changelog heading *was* the release tag. The version now comes from the commit messages instead, so nothing has to be written for a dependency merge to ship, and the App could go away.

Dependency PRs use the `chore(deps)` / `chore(deps-dev)` commit prefix, which keeps them out of the `feat:` pattern — a batch of them cuts a patch release, not a minor. They write no changelog entry; fold them into the next hand-written one, and expand it when a bump actually matters.

The full flow — grouping rules, majors, hand sweeps, and what to do when a Monday passes with no PR — is [docs/CICD.md §7](docs/CICD.md#7-dependency-updates).
