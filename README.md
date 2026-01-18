# Kod

Minimalist Git repository management with workflow automation. A self-hosted, zero-dependency alternative to hosted Git platforms.

## Installation

```bash
curl -fsSL https://itskod.com/release/latest.zip -o kod.zip && unzip kod.zip && chmod +x kod/kod.js && sudo mv kod/kod.js /usr/local/bin/kod && rm -rf kod kod.zip
```

## VM Setup

To set up Kod on a fresh VM (e.g., Scaleway, DigitalOcean):

```bash
# 1. Copy install script to VM
./prep-vm.sh <ip-address>

# 2. SSH into VM
ssh root@<ip-address>

# 3. Edit install.sh and set KOD_DOMAIN
nano /root/install.sh

# 4. Run installer
bash /root/install.sh
```

The installer provisions:

- Node.js 24
- Caddy reverse proxy (automatic HTTPS)
- UFW firewall
- Systemd service (daemon with auto-restart)
- Log rotation (7 days)
- Daily backups at 2am
- Health checks every 5 minutes
- Disk space monitoring

After installation:

- **Upgrade**: `sudo /usr/local/bin/kod-upgrade.sh`
- **Logs**: `/var/log/kod/server.log`
- **Backups**: `/home/kod/backups/`

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev -- --help

# Type checking
npm run typecheck

# Run tests
npm test

# Lint
npm run lint

# Build
npm run build

# Start server (after build)
npm run serve
```

## Architecture

```text
kod (single binary)
├── CLI mode (default)
│   ├── kod repo create/list/delete
│   ├── kod workflow run
│   └── kod init
└── Server mode (kod serve)
    ├── HTTP API
    ├── Git repository management
    ├── Workflow queue & runner
    └── Key-value database
```

## License

MIT
