#!/bin/bash
#
# ApiCharge Stellar RPC - Bare Metal Installer (Mainnet)
# Target: Ubuntu 22.04+ x64
#
# This script is IDEMPOTENT - safe to run multiple times for upgrades.
# - Binaries are always replaced
# - Configs are preserved (only copied if not existing)
# - Data in /var/lib/apicharge is NEVER touched
#
# Usage:
#   sudo ./install.sh
#
# For upgrades, just run again - existing configs and data are preserved.

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    log_error "Please run as root (sudo ./install.sh)"
    exit 1
fi

# Check architecture
ARCH=$(uname -m)
if [ "$ARCH" != "x86_64" ]; then
    log_error "This installer only supports x86_64 (amd64). Detected: $ARCH"
    exit 1
fi

# Check Ubuntu
if ! grep -q "Ubuntu" /etc/os-release 2>/dev/null; then
    log_warn "This installer is designed for Ubuntu. Your system may work but is untested."
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log_info "ApiCharge Stellar RPC Installer (Mainnet)"
log_info "========================================="

# ============================================================================
# STEP 1: Install system dependencies
# ============================================================================
log_info "Installing system dependencies..."

apt-get update -qq

# Redis
if ! command -v redis-server &> /dev/null; then
    log_info "Installing Redis..."
    apt-get install -y redis-server
    # Disable default redis service - we use our own
    systemctl stop redis-server 2>/dev/null || true
    systemctl disable redis-server 2>/dev/null || true
else
    log_info "Redis already installed"
fi

# Dependencies for Stellar
apt-get install -y curl wget libicu-dev

# ============================================================================
# STEP 2: Install Stellar binaries (stellar-core, stellar-rpc)
# ============================================================================
STELLAR_RPC_VERSION="22.1.0"
STELLAR_CORE_VERSION="22.0.1"

# Check if stellar-rpc needs install/update
INSTALL_STELLAR_RPC=false
if ! command -v stellar-rpc &> /dev/null; then
    INSTALL_STELLAR_RPC=true
    log_info "stellar-rpc not found, will install"
else
    CURRENT_VERSION=$(stellar-rpc version 2>/dev/null | grep -oP '\d+\.\d+\.\d+' | head -1 || echo "unknown")
    if [ "$CURRENT_VERSION" != "$STELLAR_RPC_VERSION" ]; then
        log_info "stellar-rpc version $CURRENT_VERSION found, will upgrade to $STELLAR_RPC_VERSION"
        INSTALL_STELLAR_RPC=true
    else
        log_info "stellar-rpc $STELLAR_RPC_VERSION already installed"
    fi
fi

if [ "$INSTALL_STELLAR_RPC" = true ]; then
    log_info "Downloading stellar-rpc $STELLAR_RPC_VERSION..."
    cd /tmp
    wget -q "https://github.com/stellar/stellar-rpc/releases/download/v${STELLAR_RPC_VERSION}/stellar-rpc_${STELLAR_RPC_VERSION}_linux_amd64.tar.gz" -O stellar-rpc.tar.gz
    tar -xzf stellar-rpc.tar.gz
    mv stellar-rpc /usr/bin/stellar-rpc
    chmod +x /usr/bin/stellar-rpc
    rm -f stellar-rpc.tar.gz
    log_info "stellar-rpc installed"
fi

# Check if stellar-core needs install/update
INSTALL_STELLAR_CORE=false
if ! command -v stellar-core &> /dev/null; then
    INSTALL_STELLAR_CORE=true
    log_info "stellar-core not found, will install"
else
    CURRENT_VERSION=$(stellar-core version 2>/dev/null | grep -oP 'v\d+\.\d+\.\d+' | head -1 | tr -d 'v' || echo "unknown")
    if [ "$CURRENT_VERSION" != "$STELLAR_CORE_VERSION" ]; then
        log_info "stellar-core version $CURRENT_VERSION found, will upgrade to $STELLAR_CORE_VERSION"
        INSTALL_STELLAR_CORE=true
    else
        log_info "stellar-core $STELLAR_CORE_VERSION already installed"
    fi
fi

if [ "$INSTALL_STELLAR_CORE" = true ]; then
    log_info "Downloading stellar-core $STELLAR_CORE_VERSION..."
    cd /tmp
    wget -q "https://github.com/stellar/stellar-core/releases/download/v${STELLAR_CORE_VERSION}/stellar-core_${STELLAR_CORE_VERSION}_amd64.deb" -O stellar-core.deb
    dpkg -i stellar-core.deb || apt-get install -f -y
    rm -f stellar-core.deb
    log_info "stellar-core installed"
fi

# ============================================================================
# STEP 3: Create apicharge user and directories
# ============================================================================
log_info "Setting up apicharge user and directories..."

# Create user if not exists
if ! id "apicharge" &>/dev/null; then
    useradd --system --no-create-home --shell /usr/sbin/nologin apicharge
    log_info "Created apicharge system user"
else
    log_info "apicharge user already exists"
fi

# Create directories
mkdir -p /opt/apicharge
mkdir -p /etc/apicharge/certs
mkdir -p /var/lib/apicharge/redis
mkdir -p /var/lib/apicharge/stellar/captive-core

# ============================================================================
# STEP 4: Check for existing data (warn but don't touch)
# ============================================================================
if [ -f "/var/lib/apicharge/stellar/soroban-rpc-db.sqlite" ]; then
    log_warn "Existing Stellar data found in /var/lib/apicharge/stellar/"
    log_warn "This data will be PRESERVED. To reset, manually delete the directory."
fi

if [ -f "/var/lib/apicharge/redis/appendonly.aof" ]; then
    log_warn "Existing Redis data found in /var/lib/apicharge/redis/"
    log_warn "This data will be PRESERVED."
fi

# ============================================================================
# STEP 5: Install ApiCharge binary (always replace)
# ============================================================================
log_info "Installing ApiCharge binary..."

if [ -f "$SCRIPT_DIR/ApiChargePrototype" ]; then
    cp "$SCRIPT_DIR/ApiChargePrototype" /opt/apicharge/ApiChargePrototype
    chmod +x /opt/apicharge/ApiChargePrototype
    log_info "ApiCharge binary installed from local directory"
else
    log_error "ApiChargePrototype binary not found in $SCRIPT_DIR"
    log_error "Please place the ApiChargePrototype binary in the same directory as this script"
    exit 1
fi

# ============================================================================
# STEP 6: Install config files (preserve existing)
# ============================================================================
log_info "Installing configuration files..."

# Copy configs only if they don't exist (cp -n)
cp -n "$SCRIPT_DIR/redis.conf" /etc/apicharge/redis.conf 2>/dev/null && log_info "Installed redis.conf" || log_info "redis.conf already exists, preserved"
cp -n "$SCRIPT_DIR/soroban-rpc.toml" /etc/apicharge/soroban-rpc.toml 2>/dev/null && log_info "Installed soroban-rpc.toml" || log_info "soroban-rpc.toml already exists, preserved"
cp -n "$SCRIPT_DIR/stellar-core.cfg" /etc/apicharge/stellar-core.cfg 2>/dev/null && log_info "Installed stellar-core.cfg" || log_info "stellar-core.cfg already exists, preserved"
cp -n "$SCRIPT_DIR/appsettings.json" /etc/apicharge/appsettings.json 2>/dev/null && log_info "Installed appsettings.json" || log_info "appsettings.json already exists, preserved"

# Environment file (secrets) - only copy example if no env file exists
if [ ! -f /etc/apicharge/apicharge.env ]; then
    cp "$SCRIPT_DIR/apicharge.env.example" /etc/apicharge/apicharge.env
    chmod 600 /etc/apicharge/apicharge.env
    log_warn "Created /etc/apicharge/apicharge.env from example"
    log_warn "IMPORTANT: Edit this file and add your APICHARGE_SIGNING_KEY"
else
    log_info "apicharge.env already exists, preserved"
fi

# Welcome page (can be replaced)
if [ -f "$SCRIPT_DIR/welcome.html" ]; then
    cp "$SCRIPT_DIR/welcome.html" /etc/apicharge/welcome.html
    log_info "Installed welcome.html"
fi

# ============================================================================
# STEP 7: Set permissions
# ============================================================================
log_info "Setting permissions..."

chown -R apicharge:apicharge /opt/apicharge
chown -R apicharge:apicharge /etc/apicharge
chown -R apicharge:apicharge /var/lib/apicharge

chmod 755 /opt/apicharge
chmod 755 /etc/apicharge
chmod 700 /etc/apicharge/certs
chmod 600 /etc/apicharge/apicharge.env

# ============================================================================
# STEP 8: Install systemd units (always replace)
# ============================================================================
log_info "Installing systemd service files..."

cp "$SCRIPT_DIR/systemd/apicharge-redis.service" /etc/systemd/system/
cp "$SCRIPT_DIR/systemd/apicharge-soroban-rpc.service" /etc/systemd/system/
cp "$SCRIPT_DIR/systemd/apicharge.service" /etc/systemd/system/

systemctl daemon-reload

# ============================================================================
# STEP 9: Enable and start services
# ============================================================================
log_info "Enabling services..."

systemctl enable apicharge-redis
systemctl enable apicharge-soroban-rpc
systemctl enable apicharge

# Check if we should start services
if systemctl is-active --quiet apicharge; then
    log_info "ApiCharge is already running. Restarting services..."
    systemctl restart apicharge-redis
    systemctl restart apicharge-soroban-rpc
    systemctl restart apicharge
else
    log_info "Starting services..."
    systemctl start apicharge-redis

    log_info "Waiting for Redis to be ready..."
    sleep 2

    systemctl start apicharge-soroban-rpc

    log_info "Waiting for Soroban RPC to sync (this may take several minutes on first run)..."
    log_info "You can monitor progress with: journalctl -u apicharge-soroban-rpc -f"
    sleep 5

    systemctl start apicharge
fi

# ============================================================================
# DONE
# ============================================================================
echo ""
log_info "========================================="
log_info "Installation complete!"
log_info "========================================="
echo ""
log_info "Services:"
log_info "  - apicharge-redis:      $(systemctl is-active apicharge-redis)"
log_info "  - apicharge-soroban-rpc: $(systemctl is-active apicharge-soroban-rpc)"
log_info "  - apicharge:            $(systemctl is-active apicharge)"
echo ""
log_info "Useful commands:"
log_info "  Check status:    systemctl status apicharge"
log_info "  View logs:       journalctl -u apicharge -f"
log_info "  Restart:         systemctl restart apicharge"
echo ""

if [ ! -f /etc/apicharge/certs/certificate.pfx ]; then
    log_warn "HTTPS certificate not found!"
    log_warn "Place your certificate.pfx in /etc/apicharge/certs/"
    log_warn "Then update the password in /etc/apicharge/appsettings.json"
fi

if grep -q "SXXXXXXXXX" /etc/apicharge/apicharge.env 2>/dev/null; then
    log_warn "Signing key not configured!"
    log_warn "Edit /etc/apicharge/apicharge.env and set APICHARGE_SIGNING_KEY"
fi

echo ""
log_info "ApiCharge is listening on:"
log_info "  HTTP:  http://your-server:80"
log_info "  HTTPS: https://your-server:443 (requires certificate)"
echo ""
