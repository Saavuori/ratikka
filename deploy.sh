#!/bin/bash
set -euo pipefail

echo "============================================="
echo " Ratikka - Live Helsinki Tram Tracker"
echo " Production RHEL/Podman Deployment Script"
echo "============================================="

# 1. RHEL Host Prerequisite Configurations
echo "Configuring host system permissions (requires sudo)..."
# Allow rootless Podman to bind directly to web ports 80 and 443
sudo sysctl -w net.ipv4.ip_unprivileged_port_start=80
echo "net.ipv4.ip_unprivileged_port_start=80" | sudo tee -a /etc/sysctl.d/99-podman-ports.conf > /dev/null

# Open firewalls for HTTP and HTTPS
echo "Configuring firewall..."
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload || echo "Firewall configuration skipped or firewalld not running"

# Install the minimal execution toolchain (podman & podman-compose only)
echo "Installing toolchain (podman, podman-compose)..."
sudo dnf install -y podman podman-compose

# 2. Setup Deployment Directory
DEPLOY_DIR="$HOME/ratikka"
echo "Creating deployment directory at: $DEPLOY_DIR"
mkdir -p "$DEPLOY_DIR"
cd "$DEPLOY_DIR"

# 3. Create Caddyfile Configuration
echo "Creating Caddyfile..."
cat << 'EOF' > Caddyfile
:80 {
    reverse_proxy ratikka-backend:8080
    encode gzip zstd
}
EOF

# 4. Create Production Orchestration File (using pre-built image)
echo "Creating docker-compose.yml..."
cat << 'EOF' > docker-compose.yml
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
EOF

# 5. Check/Prompt for Digitransit API Key
if [ -z "${DIGITRANSIT_API_KEY:-}" ]; then
    if [ -f .env ]; then
        echo "Found existing .env file."
    else
        read -rp "Enter your DIGITRANSIT_API_KEY: " api_key
        if [ -z "$api_key" ]; then
            echo "Error: DIGITRANSIT_API_KEY is required."
            exit 1
        fi
        echo "DIGITRANSIT_API_KEY=$api_key" > .env
        echo "Saved API key to .env"
    fi
else
    echo "Using DIGITRANSIT_API_KEY from environment."
    echo "DIGITRANSIT_API_KEY=$DIGITRANSIT_API_KEY" > .env
fi

# 6. Start the application stack with rootless podman-compose
echo "Starting Ratikka via podman-compose..."
# Export environment variables from .env to ensure they are passed to podman-compose
export $(grep -v '^#' .env | xargs)
podman-compose up -d

echo "============================================="
echo " Deployment Complete!"
echo " Access the map dashboard at http://localhost"
echo " Verify backend health: curl http://localhost/api/v1/health"
echo "============================================="

