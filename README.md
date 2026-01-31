# Kod

Minimalist Git repository management with workflow automation. A self-hosted, minimal-dependency alternative to hosted Git platforms.

## Installation

```bash
curl -sSL https://releases.itskod.com/install.sh | bash
```

## Quick Start

```bash
# 1. Start the server with an admin token
KOD_ADMIN_TOKEN=kod_your_secret_token kod serve

# 2. Configure the CLI
kod init
# Enter server URL: http://localhost:3000
# Enter token: kod_your_secret_token

# 3. Create a repository
kod repo create my-project

# 4. Clone it
git clone http://localhost:3000/repos/my-project.git
# Username: anything
# Password: your API token
```

## Git Access

Kod provides Git access over HTTP. Authenticate using your API token as the password:

```bash
# Clone a repository
git clone http://localhost:3000/repos/my-project.git

# Git will prompt for credentials:
# Username: git (or anything)
# Password: your_api_token

# Or configure git to remember credentials
git config --global credential.helper store
```

## Collaborators

Add collaborators to control who can access repositories:

```bash
# Add a collaborator to a repo
kod repo my-project collaborator add alice

# Create a token for that collaborator
kod token create alice-token --username alice --permissions repo:read,repo:write

# Alice can now clone/push using her token
git clone http://localhost:3000/repos/my-project.git
# Password: alice's token
```

## CLI Reference

### Clone

```bash
kod clone <repo>                       # Clone a repository
```

The clone command accepts only the repository name (not a full URL). It uses your configured server URL and API token to authenticate automatically.

### Repository Commands

```bash
kod repo list                          # List all repositories
kod repo create <name>                 # Create a new repository
kod repo <name> info                   # Show repository details
kod repo update <name> name <new>      # Rename a repository
kod repo delete <name>                 # Delete a repository
```

### Collaborator Commands

```bash
kod repo <name> collaborator list              # List collaborators
kod repo <name> collaborator add <username>    # Add collaborator
kod repo <name> collaborator remove <username> # Remove collaborator
```

### Token Commands

```bash
kod token list                         # List all API tokens
kod token create <name> [options]      # Create a new token
kod token delete <id>                  # Delete a token

# Options:
#   --permissions <perms>   Comma-separated permissions
#   --expires <days>        Token expiration (1-365 days)
#   --username <user>       Link token to a collaborator
```

### Permissions

- `repo:read` - Clone and fetch repositories
- `repo:write` - Push to repositories
- `repo:delete` - Delete repositories
- `collaborator:read` - List collaborators
- `collaborator:write` - Add/remove collaborators
- `workflow:read` - View workflow status
- `workflow:trigger` - Trigger workflows
- `admin` - Full access to all operations

### Workflow Commands

```bash
kod workflow <file.toml>               # Run workflow locally
kod workflow status [repo]             # Check workflow status
```

### Maintenance

```bash
kod upgrade                            # Upgrade to latest version
kod uninstall                          # Remove Kod binary and data
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
    ├── Git HTTP protocol (clone/push)
    ├── Workflow queue & runner
    └── Key-value database
```

## License

MIT
