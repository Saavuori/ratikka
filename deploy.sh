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
mkdir -p ~/ratikka/monitoring/alloy && cd ~/ratikka
curl -sSL -O https://raw.githubusercontent.com/Saavuori/ratikka/main/docker-compose.yml
curl -sSL -O https://raw.githubusercontent.com/Saavuori/ratikka/main/Caddyfile
curl -sSL -o monitoring/alloy/config.alloy https://raw.githubusercontent.com/Saavuori/ratikka/main/monitoring/alloy/config.alloy

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
set_env_var "GRAFANA_CLOUD_PROMETHEUS_URL" "Enter your GRAFANA_CLOUD_PROMETHEUS_URL (Optional, for monitoring)" "false"
set_env_var "GRAFANA_CLOUD_PROMETHEUS_USER" "Enter your GRAFANA_CLOUD_PROMETHEUS_USER (Optional, for monitoring)" "false"
set_env_var "GRAFANA_CLOUD_PROMETHEUS_TOKEN" "Enter your GRAFANA_CLOUD_PROMETHEUS_TOKEN (Optional, for monitoring)" "false"

export $(grep -v '^#' .env | xargs)
podman-compose up -d

echo "==> Deployment complete! Access the dashboard at http://localhost"

