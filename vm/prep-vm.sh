#!/bin/bash

# Kod VM Preparation Script
# Run this locally to copy install.sh to your VM and start provisioning

IP_ADDRESS=""

# Check if IP address was provided as argument
if [ -n "$1" ]; then
    IP_ADDRESS="$1"
fi

# Validate required variables
if [ -z "$IP_ADDRESS" ]; then
    echo "ERROR: IP address is required"
    echo ""
    echo "Usage: ./prep-vm.sh <ip-address>"
    echo "Example: ./prep-vm.sh 51.159.139.141"
    exit 1
fi

echo "=== Kod VM Preparation ==="
echo "Target: root@$IP_ADDRESS"
echo ""

# Copy install script to VM
echo "Copying install.sh to VM..."
scp install.sh "root@$IP_ADDRESS:/root/"

echo ""
echo "Files copied successfully."
echo ""
echo "Next steps:"
echo "  1. SSH into the VM: ssh root@$IP_ADDRESS"
echo "  2. Edit install.sh to set your KOD_DOMAIN"
echo "  3. Run the installer: bash /root/install.sh"
