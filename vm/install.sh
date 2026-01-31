#!/bin/bash
set -e

echo "=== Kod Instance Setup ==="
echo "Starting provisioning at $(date)"

# Variables - EDIT THESE BEFORE RUNNING
export KOD_DOMAIN="git.example.com"

# Validate required variables
echo "Validating required environment variables..."
if [ "$KOD_DOMAIN" = "git.example.com" ]; then
    echo "ERROR: Please edit this script and set KOD_DOMAIN to your actual domain"
    echo "Example: export KOD_DOMAIN=\"git.mycompany.com\""
    exit 1
fi

echo "Domain: $KOD_DOMAIN"
echo ""

# System updates
echo "Updating system packages..."
apt-get update && apt-get upgrade -y
apt-get install -y curl unzip jq cron git

# UFW configuration
echo "Configuring firewall..."
apt-get install -y ufw
ufw --force enable
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP (Caddy will redirect to HTTPS)
ufw allow 443/tcp   # HTTPS

# Node.js 24 installation
echo "Installing Node.js 24..."
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs

# Install Caddy
echo "Installing Caddy..."
curl -L -o /tmp/caddy "https://caddyserver.com/api/download?os=linux&arch=amd64"
mv /tmp/caddy /usr/bin/caddy
chmod +x /usr/bin/caddy

# Create Caddy user and group
groupadd --system caddy || true
useradd --system --gid caddy --create-home --home-dir /var/lib/caddy --shell /usr/sbin/nologin caddy || true

# Create Caddy systemd service
cat > /etc/systemd/system/caddy.service << 'CADDY_SERVICE_EOF'
[Unit]
Description=Caddy
Documentation=https://caddyserver.com/docs/
After=network.target network-online.target
Requires=network-online.target

[Service]
Type=notify
User=caddy
Group=caddy
ExecStart=/usr/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile --force
TimeoutStopSec=5s
LimitNOFILE=1048576
LimitNPROC=512
PrivateTmp=true
ProtectSystem=full
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
CADDY_SERVICE_EOF

# Create Caddy configuration directory
mkdir -p /etc/caddy

# Configure Caddy for Kod
echo "Configuring Caddy reverse proxy..."
cat > /etc/caddy/Caddyfile << EOF
${KOD_DOMAIN} {
    reverse_proxy localhost:3000

    # Enable compression
    encode gzip

    # Security headers
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Frame-Options "SAMEORIGIN"
        X-Content-Type-Options "nosniff"
        X-XSS-Protection "1; mode=block"
    }

    # Logging
    log {
        output file /var/log/caddy/access.log
    }
}
EOF

# Create Caddy log directory
mkdir -p /var/log/caddy
chown caddy:caddy /var/log/caddy

# Enable and start Caddy
systemctl enable caddy
systemctl restart caddy

# Enable unattended security updates
echo "Configuring automatic security updates..."
apt-get install -y unattended-upgrades
cat > /etc/apt/apt.conf.d/50unattended-upgrades << 'UNATTENDED_EOF'
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
};
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "03:00";
Unattended-Upgrade::Mail "root";
UNATTENDED_EOF

dpkg-reconfigure -plow unattended-upgrades

# Create dedicated Kod user
echo "Creating kod user..."
useradd -r -m -s /bin/bash kod || true

# Create directories
mkdir -p /var/log/kod
mkdir -p /home/kod/.kod/data
mkdir -p /home/kod/.kod/repos
chown -R kod:kod /var/log/kod
chown -R kod:kod /home/kod/.kod

# Install Kod
echo "Installing Kod..."
curl -fsSL https://itskod.com/release/kod_latest.zip -o /tmp/kod.zip
unzip -o /tmp/kod.zip -d /tmp/
mv /tmp/kod/kod.js /home/kod/.local/bin/kod || {
    mkdir -p /home/kod/.local/bin
    mv /tmp/kod/kod.js /home/kod/.local/bin/kod
}
chmod +x /home/kod/.local/bin/kod
chown -R kod:kod /home/kod/.local
rm -rf /tmp/kod /tmp/kod.zip

# Generate API token
echo "Generating API token..."
KOD_API_TOKEN="kod_$(openssl rand -hex 24)"
echo "$KOD_API_TOKEN" > /home/kod/.kod/api-token
chown kod:kod /home/kod/.kod/api-token
chmod 600 /home/kod/.kod/api-token

# Create disk space monitoring script
echo "Creating disk space monitoring..."
cat > /usr/local/bin/check-disk-space.sh << 'DISK_EOF'
#!/bin/bash
THRESHOLD=80
USAGE=$(df / | tail -1 | awk '{print $5}' | sed 's/%//')

if [ "$USAGE" -gt "$THRESHOLD" ]; then
    logger "Disk space alert: ${USAGE}% used"
fi
DISK_EOF

chmod +x /usr/local/bin/check-disk-space.sh

# Create health check script
echo "Creating health check script..."
cat > /usr/local/bin/kod-healthcheck.sh << 'HEALTH_EOF'
#!/bin/bash
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health 2>/dev/null || echo "000")

if [ "$RESPONSE" != "200" ]; then
    logger "Kod health check failed: HTTP $RESPONSE"
fi
HEALTH_EOF

chmod +x /usr/local/bin/kod-healthcheck.sh

# Create backup script
echo "Creating backup script..."
cat > /usr/local/bin/kod-backup.sh << 'BACKUP_EOF'
#!/bin/bash
set -e

BACKUP_DIR="/home/kod/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/kod_backup_$TIMESTAMP.tar.gz"

mkdir -p "$BACKUP_DIR"

# Backup data and repos
tar -czf "$BACKUP_FILE" -C /home/kod/.kod data repos 2>/dev/null || true

# Keep only last 7 backups
ls -t "$BACKUP_DIR"/kod_backup_*.tar.gz 2>/dev/null | tail -n +8 | xargs -r rm

logger "Kod backup completed: $BACKUP_FILE"
BACKUP_EOF

chmod +x /usr/local/bin/kod-backup.sh
chown kod:kod /usr/local/bin/kod-backup.sh

# Create upgrade script
echo "Creating upgrade script..."
cat > /usr/local/bin/kod-upgrade.sh << 'UPGRADE_EOF'
#!/bin/bash
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_error() { echo -e "${RED}Error: $1${NC}" >&2; }
print_success() { echo -e "${GREEN}$1${NC}"; }
print_info() { echo -e "${YELLOW}$1${NC}"; }

BIN_DIR="/home/kod/.local/bin"
INSTALL_DIR="/home/kod/.kod"
VERSION_FILE="$INSTALL_DIR/VERSION"
RELEASE_URL="https://itskod.com/release"

print_info "Kod Upgrade Tool"
echo ""

# Get current version
CURRENT_VERSION=""
if [ -f "$VERSION_FILE" ]; then
    CURRENT_VERSION=$(cat "$VERSION_FILE" | tr -d '[:space:]')
    print_info "Current version: v$CURRENT_VERSION"
fi

# Check latest version
print_info "Checking for latest version..."
VERSION_JSON=$(curl -sSL "https://api.itskod.com/version" 2>/dev/null || echo "")
LATEST_VERSION=""
if [ -n "$VERSION_JSON" ]; then
    LATEST_VERSION=$(echo "$VERSION_JSON" | grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*"\([^"]*\)"$/\1/' 2>/dev/null || echo "")
    LATEST_VERSION=$(echo "$LATEST_VERSION" | tr -d '[:space:]')
fi

if [ -n "$LATEST_VERSION" ]; then
    print_info "Latest version: v$LATEST_VERSION"
fi

if [ -n "$CURRENT_VERSION" ] && [ -n "$LATEST_VERSION" ] && [ "$CURRENT_VERSION" = "$LATEST_VERSION" ]; then
    print_success "Kod is already up to date!"
    exit 0
fi

print_info "Upgrading..."

# Download and extract
TEMP_DIR=$(mktemp -d)
curl -fsSL -o "$TEMP_DIR/kod.zip" "$RELEASE_URL/latest.zip"
unzip -q -o "$TEMP_DIR/kod.zip" -d "$TEMP_DIR"

# Backup and install
if [ -f "$BIN_DIR/kod" ]; then
    cp "$BIN_DIR/kod" "$BIN_DIR/kod.backup.$(date +%s)"
fi

mv "$TEMP_DIR/kod/kod.js" "$BIN_DIR/kod"
chmod +x "$BIN_DIR/kod"

if [ -f "$TEMP_DIR/kod/VERSION" ]; then
    cp "$TEMP_DIR/kod/VERSION" "$VERSION_FILE"
fi

rm -rf "$TEMP_DIR"

print_success "Kod upgraded successfully!"

# Restart service
print_info "Restarting Kod service..."
systemctl restart kod.service

sleep 3
if systemctl is-active --quiet kod.service; then
    print_success "Kod service restarted successfully!"
else
    print_error "Kod service failed to start. Check logs: journalctl -u kod.service"
    exit 1
fi
UPGRADE_EOF

chmod +x /usr/local/bin/kod-upgrade.sh

# Configure log rotation
echo "Configuring log rotation..."
cat > /etc/logrotate.d/kod << 'LOGROTATE_EOF'
/var/log/kod/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0640 kod kod
    sharedscripts
    postrotate
        systemctl reload kod.service > /dev/null 2>&1 || true
    endscript
}

/var/log/caddy/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0640 caddy caddy
}
LOGROTATE_EOF

# Create restart notification script
echo "Creating restart notification script..."
cat > /usr/local/bin/notify-kod-restart.sh << 'NOTIFY_EOF'
#!/bin/bash
TIMESTAMP=$(date -Iseconds)
logger "Kod service restarted at $TIMESTAMP"
NOTIFY_EOF

chmod +x /usr/local/bin/notify-kod-restart.sh

# Create systemd service
echo "Creating Kod systemd service..."
cat > /etc/systemd/system/kod.service << SERVICE_EOF
[Unit]
Description=Kod Git Server
After=network-online.target
Wants=network-online.target
OnFailure=kod-notify-restart.service

[Service]
Type=simple
User=kod
Group=kod
WorkingDirectory=/home/kod/.kod
Environment="PATH=/home/kod/.local/bin:/usr/local/bin:/usr/bin:/bin"
Environment="KOD_API_TOKEN=${KOD_API_TOKEN}"
Environment="KOD_DATA_DIR=/home/kod/.kod/data"
Environment="KOD_REPOS_DIR=/home/kod/.kod/repos"
ExecStart=/home/kod/.local/bin/kod serve --port 3000
Restart=always
RestartSec=10
StandardOutput=append:/var/log/kod/server.log
StandardError=append:/var/log/kod/server-error.log

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/home/kod /var/log/kod

# Resource limits
MemoryMax=1G
CPUQuota=100%

[Install]
WantedBy=multi-user.target
SERVICE_EOF

# Create notification service for restarts
cat > /etc/systemd/system/kod-notify-restart.service << 'NOTIFY_SERVICE_EOF'
[Unit]
Description=Notify on Kod service failure

[Service]
Type=oneshot
ExecStart=/usr/local/bin/notify-kod-restart.sh
NOTIFY_SERVICE_EOF

# Setup cron jobs
echo "Setting up cron jobs..."
systemctl enable cron
systemctl start cron

cat > /tmp/kod-cron << 'CRON_EOF'
# Check disk space every 15 minutes
*/15 * * * * /usr/local/bin/check-disk-space.sh

# Health check every 5 minutes
*/5 * * * * /usr/local/bin/kod-healthcheck.sh

# Daily backup at 2am
0 2 * * * /usr/local/bin/kod-backup.sh
CRON_EOF

crontab /tmp/kod-cron
rm /tmp/kod-cron

# Enable and start Kod service
echo "Starting Kod service..."
systemctl daemon-reload
systemctl enable kod.service
systemctl start kod.service

# Wait for service to be ready
echo "Waiting for Kod to start..."
sleep 5

# Final status check
echo ""
echo "=== Installation Complete ==="
echo ""
echo "Kod service status:"
systemctl status kod.service --no-pager || true
echo ""
echo "Caddy status:"
systemctl status caddy --no-pager || true
echo ""
echo "Installation completed at $(date)"
echo ""
echo "=========================================="
echo "Domain: https://${KOD_DOMAIN}"
echo ""
echo "API Token (save this!):"
echo "  $KOD_API_TOKEN"
echo ""
echo "Token also saved to: /home/kod/.kod/api-token"
echo "=========================================="
echo ""
echo "Logs:"
echo "  - Kod Server: /var/log/kod/server.log"
echo "  - Kod Errors: /var/log/kod/server-error.log"
echo "  - Caddy Access: /var/log/caddy/access.log"
echo ""
echo "Maintenance:"
echo "  - Upgrade: sudo /usr/local/bin/kod-upgrade.sh"
echo "  - Health check: /usr/local/bin/kod-healthcheck.sh"
echo "  - Backup: /usr/local/bin/kod-backup.sh"
echo "  - Backups stored in: /home/kod/backups/"
echo ""
echo "To use Kod CLI locally, run:"
echo "  kod init"
echo "  # Enter: https://${KOD_DOMAIN}"
echo "  # Enter: $KOD_API_TOKEN"
