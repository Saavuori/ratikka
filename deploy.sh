#!/bin/bash
set -euo pipefail

# 1. Configure host port binding & firewall
echo "==> Configuring host system..."
sudo sysctl -w net.ipv4.ip_unprivileged_port_start=80
echo "net.ipv4.ip_unprivileged_port_start=80" | sudo tee -a /etc/sysctl.d/99-podman-ports.conf > /dev/null

sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload || echo "Firewall reload skipped (firewalld may not be active)"

# 2. Install Podman & Podman Compose
echo "==> Installing Podman & Podman Compose..."
sudo dnf install -y podman podman-compose

# 3. Create directory and configurations
echo "==> Setting up deployment directory and configurations..."
mkdir -p ~/ratikka/monitoring/alloy && cd ~/ratikka

# Caddyfile will be generated dynamically below based on domain configuration

cat << 'COMPOSE' > docker-compose.yml
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
    labels:
      - "com.centurylinklabs.watchtower.scope=ratikka"
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

  ratikka-watchtower:
    image: docker.io/containrrr/watchtower
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - WATCHTOWER_POLL_INTERVAL=300
      - WATCHTOWER_SCOPE=ratikka
      - WATCHTOWER_CLEANUP=true
      - WATCHTOWER_LOG_LEVEL=info
      - DOCKER_API_VERSION=1.45
    labels:
      - "com.centurylinklabs.watchtower.scope=ratikka"


  ratikka-alloy:
    image: docker.io/grafana/alloy:latest
    restart: unless-stopped
    volumes:
      - ./monitoring/alloy/config.alloy:/etc/alloy/config.alloy:ro,Z
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /:/rootfs:ro
    environment:
      - GRAFANA_CLOUD_PROMETHEUS_URL=${GRAFANA_CLOUD_PROMETHEUS_URL}
      - GRAFANA_CLOUD_PROMETHEUS_USER=${GRAFANA_CLOUD_PROMETHEUS_USER}
      - GRAFANA_CLOUD_PROMETHEUS_TOKEN=${GRAFANA_CLOUD_PROMETHEUS_TOKEN}
    depends_on:
      - ratikka-backend

volumes:
  caddy-data:
  caddy-config:
COMPOSE

cat << 'ALLOY' > monitoring/alloy/config.alloy
prometheus.exporter.unix "node" {
  procfs_path = "/host/proc"
  sysfs_path  = "/host/sys"
  rootfs_path = "/rootfs"
}

prometheus.scrape "scrape_node" {
  targets    = prometheus.exporter.unix.node.targets
  forward_to = [prometheus.remote_write.grafana_cloud.receiver]
}

prometheus.scrape "scrape_backend" {
  targets = [
    {"__address__" = "ratikka-backend:8080"},
  ]
  forward_to = [prometheus.remote_write.grafana_cloud.receiver]
}


prometheus.remote_write "grafana_cloud" {
  endpoint {
    url = sys.env("GRAFANA_CLOUD_PROMETHEUS_URL")

    basic_auth {
      username = sys.env("GRAFANA_CLOUD_PROMETHEUS_USER")
      password = sys.env("GRAFANA_CLOUD_PROMETHEUS_TOKEN")
    }
  }
}
ALLOY

# 4. Set environment configurations
if [ -f .env ]; then
    echo "Found existing .env file."
else
    touch .env
fi

set_env_var() {
    local var_name=$1
    local prompt_text=$2
    local is_required=$3
    
    if grep -q "^${var_name}=" .env; then
        echo "Using ${var_name} from existing .env"
    elif [ ! -z "${!var_name:-}" ]; then
        echo "Using ${var_name} from environment"
        echo "${var_name}=${!var_name}" >> .env
    else
        read -rp "${prompt_text}: " user_val
        if [ -z "$user_val" ] && [ "$is_required" = "true" ]; then
            echo "Error: ${var_name} is required."
            exit 1
        fi
        if [ ! -z "$user_val" ]; then
            echo "${var_name}=${user_val}" >> .env
        fi
    fi
}

set_env_var "DIGITRANSIT_API_KEY" "Enter your DIGITRANSIT_API_KEY (Required)" "true"
set_env_var "DOMAIN_NAME" "Enter your Domain Name (e.g. hsl-live.duckdns.org, leave blank for :80)" "false"
set_env_var "GRAFANA_CLOUD_PROMETHEUS_URL" "Enter your GRAFANA_CLOUD_PROMETHEUS_URL (Optional, for monitoring)" "false"
set_env_var "GRAFANA_CLOUD_PROMETHEUS_USER" "Enter your GRAFANA_CLOUD_PROMETHEUS_USER (Optional, for monitoring)" "false"
set_env_var "GRAFANA_CLOUD_PROMETHEUS_TOKEN" "Enter your GRAFANA_CLOUD_PROMETHEUS_TOKEN (Optional, for monitoring)" "false"

export $(grep -v '^#' .env | xargs)

# 5. Generate Caddyfile based on configured domain
echo "==> Configuring Caddy gateway..."
caddy_domain=${DOMAIN_NAME:-:80}
cat << CADDY > Caddyfile
$caddy_domain {
    reverse_proxy ratikka-backend:8080
    encode gzip zstd
}
CADDY

podman-compose up -d

if [ "$caddy_domain" = ":80" ]; then
    echo "==> Deployment complete! Access the dashboard at http://localhost"
else
    echo "==> Deployment complete! Access the dashboard at https://$caddy_domain"
fi
