#!/bin/bash
set -euo pipefail

echo "============================================="
echo " Ratikka - Live Helsinki Tram Tracker"
echo " Production RHEL/Podman Deployment Script"
echo "============================================="

# 1. Check/Prompt for Digitransit API Key
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

# 2. RHEL Host Prerequisite Configurations
echo "Configuring host system permissions (requires sudo)..."
# Allow rootless Podman to bind directly to web ports 80 and 443
sudo sysctl -w net.ipv4.ip_unprivileged_port_start=80
echo "net.ipv4.ip_unprivileged_port_start=80" | sudo tee -a /etc/sysctl.d/99-podman-ports.conf > /dev/null

# Open firewalls for HTTP and HTTPS
echo "Configuring firewall..."
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload

# Install the minimal execution toolchain
echo "Installing toolchain (podman, podman-compose)..."
sudo dnf install -y podman podman-compose git

# 3. Start the application stack with rootless podman-compose
echo "Starting Ratikka via podman-compose..."
# Export environment variables from .env to ensure they are passed to podman-compose
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi
podman-compose up -d --build

echo "============================================="
echo " Deployment Complete!"
echo " Access the map dashboard at http://localhost"
echo " Verify backend health: curl http://localhost/api/v1/health"
echo "============================================="
