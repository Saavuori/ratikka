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

# 3. Create directory and download configurations
echo "==> Setting up deployment directory and configurations..."
mkdir -p ~/ratikka && cd ~/ratikka
curl -sSL -O https://raw.githubusercontent.com/Saavuori/ratikka/main/docker-compose.yml
curl -sSL -O https://raw.githubusercontent.com/Saavuori/ratikka/main/Caddyfile

# 4. Set API Key and start the container stack
if [ -z "${DIGITRANSIT_API_KEY:-}" ]; then
    read -rp "Enter your DIGITRANSIT_API_KEY: " api_key
    echo "DIGITRANSIT_API_KEY=$api_key" > .env
else
    echo "DIGITRANSIT_API_KEY=$DIGITRANSIT_API_KEY" > .env
fi

export $(grep -v '^#' .env | xargs)
podman-compose up -d

echo "==> Deployment complete! Access the dashboard at http://localhost"
