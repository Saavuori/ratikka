# Ratikka — Live Helsinki Tram Tracker

A real-time containerized web application that maps **all active Helsinki trams** on a vector map. Users can filter vehicles by line, click stops to view timetables, and track specific tram trip geometries with stop ETAs.

Designed for standalone high-performance operation on an **aarch64 (ARM64) Linux instance** (Oracle Linux 9 / UEK), but fully supports local Windows/Linux development.

---

## Technical Stack

* **Backend**: Go (1.24+), utilizing native HTTP Mux routing (Go 1.22+), `coder/websocket` for streaming, and `eclipse/paho.mqtt.golang`.
* **State Store**: Redis 7 (Alpine), acting as a low-overhead live coordinate cache.
* **Frontend**: React 19, TypeScript, MapLibre GL JS 5.x, Lucide icons, and Vanilla CSS with custom theme variables.
* **Map Tile Stream**: Digitransit Map API v3 (Vector style style.json + stop POI tiles).
* **Routing API**: Digitransit Routing API v2 (GraphQL proxies protecting API keys).
* **Reverse Proxy**: Caddy 2 (Alpine) with auto-compression.
* **CI/CD**: GitHub Actions building multi-arch tags (`linux/amd64`, `linux/arm64`) to GitHub Packages.

---

## Project Structure

```
ratikka/
├── backend/                  # Go application source
│   ├── cmd/ratikka/          # main entry point
│   ├── internal/             # internal packages (config, cache, mqtt, ws, api)
│   └── go.mod
├── frontend/                 # React 19 TypeScript client source
│   ├── src/                  # App components, hooks, styles, types
│   └── package.json
├── docs/                     # Detailed architectural documents
│   ├── API_REFERENCE.md      # REST/WS/external endpoints specs
│   ├── LOCAL_DEVELOPMENT.md  # How to run and test locally
│   └── VERIFICATION.md       # Quality gates and validation plans
├── .agents/workflows/        # Custom pair-programming guidelines
│   ├── committing.md         # Commit rules
│   └── versioning.md         # CI/CD version bump rules
├── Caddyfile                 # Caddy reverse proxy rules
├── Dockerfile                # Multi-stage build context
├── docker-compose.yml        # Orchestrated compose definition
└── PLAN.md                   # Feature lists and mermaid architecture
```

---

## Configuration

Set the following environment variables in `.env` or in your environment:

| Variable | Description | Default |
|---|---|---|
| `DIGITRANSIT_API_KEY` | Subscription key for Digitransit GraphQL API | *(Required)* |
| `REDIS_URL` | Redis cache connection string | `redis://ratikka-cache:6379` |
| `MQTT_BROKER` | HSL public MQTT endpoint | `tls://mqtt.hsl.fi:8883` |
| `PORT` | Go backend server port | `8080` |

---

## Local Development Setup

To run a fast development loop locally, see [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md) for full options.

### 1. Run Backend (No Redis needed)

Accepts `--no-redis` to bypass running a local Redis container:
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
*(Vite runs on port `:5173` and automatically proxies `/api` and `/api/v1/stream` WebSocket requests to `:8080`)*

### 3. Run Unit Tests

* **Backend**: `go test -v ./...` (runs parsed MQTT thinning and REST serialization mocks)
* **Frontend**: `npm run test` (runs Vitest linear coordinate interpolation and heading wrap-around maths)

---

## Deployment

### Local Deployment (Docker Compose)

Builds the Node frontend, copies assets, compiles Go, and launches the entire network stack:

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

For deployment on a clean RHEL system (using rootless Podman and Podman Compose):

#### Automated Deployment
An automated installer script [deploy.sh](./deploy.sh) is provided to configure the environment:

1. Clone the repository to the RHEL host.
2. Run the deployment script:
   ```bash
   chmod +x deploy.sh
   ./deploy.sh
   ```

#### Manual Deployment
If you prefer configuring the system manually, follow these steps:

1. **Allow Rootless Port Binding**:
   Allow rootless Podman to bind directly to web ports 80 and 443:
   ```bash
   sudo sysctl -w net.ipv4.ip_unprivileged_port_start=80
   echo "net.ipv4.ip_unprivileged_port_start=80" | sudo tee -a /etc/sysctl.d/99-podman-ports.conf
   ```

2. **Configure Firewall**:
   Open host-level firewalls for public HTTP/HTTPS traffic:
   ```bash
   sudo firewall-cmd --permanent --add-service=http
   sudo firewall-cmd --permanent --add-service=https
   sudo firewall-cmd --reload
   ```

3. **Install Core Toolchain**:
   Install Podman, Podman Compose, and Git:
   ```bash
   sudo dnf install -y podman podman-compose git
   ```

4. **Initialize Environment**:
   Create a `.env` file in the project root containing your API key:
   ```bash
   echo "DIGITRANSIT_API_KEY=your_api_key_here" > .env
   ```

5. **Start Services**:
   Launch the container stack:
   ```bash
   export $(grep -v '^#' .env | xargs)
   podman-compose up -d --build
   ```

