#!/bin/bash

# Kod Upgrade Script
# Standalone script to upgrade Kod to the latest version
# Can be run even if the main kod binary is broken
# Usage: curl -sSL https://releases.itskod.com/upgrade.sh | bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_error() {
    echo -e "${RED}Error: $1${NC}" >&2
}

print_success() {
    echo -e "${GREEN}$1${NC}"
}

print_info() {
    echo -e "${YELLOW}$1${NC}"
}

# Configuration
BIN_DIR="$HOME/.local/bin"
INSTALL_DIR="$HOME/.kod"
VERSION_FILE="$INSTALL_DIR/VERSION"
RELEASE_BASE_URL="https://releases.itskod.com"
VERSION_URL="$RELEASE_BASE_URL/VERSION"

print_info "Kod Upgrade Tool"
echo ""

# Check for required tools
if ! command -v curl &> /dev/null && ! command -v wget &> /dev/null; then
    print_error "Neither curl nor wget is available"
    echo "Please install curl or wget and try again"
    exit 1
fi

if ! command -v unzip &> /dev/null; then
    print_error "unzip is not available"
    echo "Please install unzip and try again"
    exit 1
fi

# Get current version
CURRENT_VERSION=""
if [ -f "$VERSION_FILE" ]; then
    CURRENT_VERSION=$(cat "$VERSION_FILE" | tr -d '[:space:]')
    print_info "Current version: v$CURRENT_VERSION"
elif [ -f "$BIN_DIR/kod" ]; then
    print_info "Current version: unknown (VERSION file missing)"
else
    print_info "Kod not installed. This will perform a fresh install."
fi

# Check latest version
print_info "Checking for latest version..."

if command -v curl &> /dev/null; then
    LATEST_VERSION=$(curl -fsSL "$VERSION_URL" 2>/dev/null || echo "")
elif command -v wget &> /dev/null; then
    LATEST_VERSION=$(wget -q -O - "$VERSION_URL" 2>/dev/null || echo "")
fi

LATEST_VERSION=$(echo "$LATEST_VERSION" | tr -d '[:space:]')

if [ -n "$LATEST_VERSION" ]; then
    print_info "Latest version: v$LATEST_VERSION"
else
    print_info "Could not determine latest version. Proceeding with upgrade anyway..."
fi

# Check if upgrade is needed
if [ -n "$CURRENT_VERSION" ] && [ -n "$LATEST_VERSION" ] && [ "$CURRENT_VERSION" = "$LATEST_VERSION" ]; then
    print_success "Kod is already up to date!"
    exit 0
fi

# Perform upgrade
if [ -n "$CURRENT_VERSION" ] && [ -n "$LATEST_VERSION" ]; then
    print_info "Upgrading from v$CURRENT_VERSION to v$LATEST_VERSION..."
elif [ -n "$LATEST_VERSION" ]; then
    print_info "Installing v$LATEST_VERSION..."
else
    print_info "Upgrading to latest version..."
fi

# Create directories
mkdir -p "$BIN_DIR"
mkdir -p "$INSTALL_DIR"

# Download latest release
TEMP_DIR=$(mktemp -d)
TEMP_ZIP="$TEMP_DIR/kod_latest.zip"

print_info "Downloading latest release..."
if command -v curl &> /dev/null; then
    curl -fsSL -o "$TEMP_ZIP" "$RELEASE_BASE_URL/kod_latest.zip"
elif command -v wget &> /dev/null; then
    wget -q -O "$TEMP_ZIP" "$RELEASE_BASE_URL/kod_latest.zip"
fi

# Extract
print_info "Extracting..."
unzip -q -o "$TEMP_ZIP" -d "$TEMP_DIR"

# Backup old version if exists
if [ -f "$BIN_DIR/kod" ]; then
    BACKUP_FILE="$BIN_DIR/kod.backup.$(date +%s)"
    cp "$BIN_DIR/kod" "$BACKUP_FILE"
    print_info "Backed up old version to $BACKUP_FILE"
fi

# Install new version
cp "$TEMP_DIR/kod/kod.mjs" "$BIN_DIR/kod"
chmod +x "$BIN_DIR/kod"

# Copy VERSION file if present
if [ -f "$TEMP_DIR/kod/VERSION" ]; then
    cp "$TEMP_DIR/kod/VERSION" "$VERSION_FILE"
fi

# Cleanup
rm -rf "$TEMP_DIR"

print_success "Kod upgraded successfully!"
echo ""

# Show new version
if [ -f "$VERSION_FILE" ]; then
    NEW_VERSION=$(cat "$VERSION_FILE" | tr -d '[:space:]')
    print_info "Installed version: v$NEW_VERSION"
fi

echo ""
print_info "Run 'kod --version' to verify the installation."
