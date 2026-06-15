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

Because the application is built and published by the CI/CD workflow, the pre-compiled production images are hosted on the GitHub Container Registry (`ghcr.io/saavuori/ratikka`). **There is no need to clone the repository or compile source code on the production host.**

#### Automated Deployment (Bootstrap Script)

You can deploy the application on a clean RHEL system by downloading and executing the standalone bootstrap script:

```bash
# 1. Download the deployment script
curl -sSL -o deploy.sh https://raw.githubusercontent.com/Saavuori/ratikka/main/deploy.sh

# 2. Make it executable and run it
chmod +x deploy.sh
./deploy.sh
```

The script will configure unprivileged ports, set the firewall, install `podman` and `podman-compose`, create a deployment directory (`~/ratikka`), write the required configuration files (`Caddyfile` and `docker-compose.yml`), and start the container stack.

#### Manual Deployment (Without Cloning)

If you prefer configuring the system manually:

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
   sudo firewall-cmd --reload || echo "Firewall configuration skipped or firewalld not running"
   ```

3. **Install Podman and Podman Compose**:
   ```bash
   sudo dnf install -y podman podman-compose
   ```

4. **Prepare Deployment Workspace**:
   Create a directory `~/ratikka` and add the configurations:
   
   *Create `~/ratikka/Caddyfile`:*
   ```caddy
   :80 {
       reverse_proxy ratikka-backend:8080
       encode gzip zstd
   }
   ```

   *Create `~/ratikka/docker-compose.yml`:*
   ```yaml
   services:
     ratikka-caddy:
       image: docker.io/library/caddy:2-alpine
       restart: unless-stopped
       ports:
         - "80:80"
         - "443:443"
         - "443:443/udp"
       volumes:
         - ./Caddyfile:/etc/caddy/Caddyfile:ro,Z
         - caddy-data:/data:Z
         - caddy-config:/config:Z
       depends_on:
         - ratikka-backend

     ratikka-backend:
       image: ghcr.io/saavuori/ratikka:latest
       restart: unless-stopped
       environment:
         - DIGITRANSIT_API_KEY=${DIGITRANSIT_API_KEY}
         - REDIS_URL=redis://ratikka-cache:6379
         - MQTT_BROKER=tls://mqtt.hsl.fi:8883
         - PORT=8080
       depends_on:
         - ratikka-cache

     ratikka-cache:
       image: docker.io/library/redis:7-alpine
       restart: unless-stopped
       command: redis-server --appendonly no --maxmemory 64mb --maxmemory-policy allkeys-lru

   volumes:
     caddy-data:
     caddy-config:
   ```

5. **Initialize Environment and Start**:
   ```bash
   echo "DIGITRANSIT_API_KEY=your_api_key_here" > .env
   export $(grep -v '^#' .env | xargs)
   podman-compose up -d
   ```


