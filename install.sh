#!/bin/bash

# Kod Installer
# Downloads and installs the Kod CLI to ~/.local/bin/kod
# Usage: curl -sSL https://releases.itskod.com/install.sh | bash

set -e

BIN_DIR="$HOME/.local/bin"
INSTALL_DIR="$HOME/.kod"
RELEASE_BASE_URL="https://releases.itskod.com"

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

# Check dependencies
check_dependencies() {
    local missing_deps=()

    if ! command -v curl &> /dev/null && ! command -v wget &> /dev/null; then
        missing_deps+=("curl or wget")
    fi

    if ! command -v unzip &> /dev/null; then
        missing_deps+=("unzip")
    fi

    if [ ${#missing_deps[@]} -gt 0 ]; then
        print_error "Missing required dependencies: ${missing_deps[*]}"
        echo "Please install the missing dependencies and try again."
        exit 1
    fi

    # Check for Node.js
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed. It is required to run Kod."
        echo "  Please install Node.js 24+ from https://nodejs.org/"
        exit 1
    else
        NODE_VERSION=$(node -v | cut -d 'v' -f 2 | cut -d '.' -f 1)
        if [ "$NODE_VERSION" -lt 24 ]; then
            print_error "Node.js version 24 or later is required (found v$NODE_VERSION)."
            echo "  Please upgrade Node.js from https://nodejs.org/"
            exit 1
        fi
    fi
}

print_info "Kod Installer"
echo ""

# Check dependencies before proceeding
check_dependencies
echo ""

# Create directories
mkdir -p "$BIN_DIR"
mkdir -p "$INSTALL_DIR"

# Download latest release
TEMP_DIR=$(mktemp -d)
TEMP_ZIP="$TEMP_DIR/kod_latest.zip"

print_info "Downloading latest Kod release..."

if command -v curl &> /dev/null; then
    curl -fsSL -o "$TEMP_ZIP" "$RELEASE_BASE_URL/kod_latest.zip"
elif command -v wget &> /dev/null; then
    wget -q -O "$TEMP_ZIP" "$RELEASE_BASE_URL/kod_latest.zip"
fi

# Extract
print_info "Extracting..."
unzip -q -o "$TEMP_ZIP" -d "$TEMP_DIR"

# Install binary
cp "$TEMP_DIR/kod/kod.mjs" "$BIN_DIR/kod"
chmod +x "$BIN_DIR/kod"

# Store VERSION file
if [ -f "$TEMP_DIR/kod/VERSION" ]; then
    cp "$TEMP_DIR/kod/VERSION" "$INSTALL_DIR/VERSION"
    INSTALLED_VERSION=$(cat "$INSTALL_DIR/VERSION" | tr -d '[:space:]')
fi

# Cleanup
rm -rf "$TEMP_DIR"

if [ -n "$INSTALLED_VERSION" ]; then
    print_success "Kod v$INSTALLED_VERSION installed to $BIN_DIR/kod"
else
    print_success "Kod installed to $BIN_DIR/kod"
fi

# Check if bin directory is in PATH
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    echo ""
    print_info "Add $BIN_DIR to your PATH:"
    echo ""
    echo "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc"
    echo "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.zshrc"
    echo ""
    print_info "Then restart your shell or run:"
    echo "  source ~/.bashrc  # or ~/.zshrc"
    echo ""
fi

echo ""
print_success "Installation complete!"
echo ""
print_info "Run 'kod help' to see all available commands."
echo ""
print_info "To upgrade Kod in the future, run:"
echo "  kod upgrade"
echo ""
