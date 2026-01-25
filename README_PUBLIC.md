# Kod

Minimalist Git repository management with workflow automation. A self-hosted, zero-dependency alternative to hosted Git platforms.

## Features

- **Repository management** - Create, rename, delete Git repos
- **Collaborator management** - Add/remove users with token-based access control
- **Git over HTTP** - Clone and push using API tokens
- **Workflow automation** - Run TOML-defined workflows on push or locally
- **Single binary** - One `kod` command for CLI and server
- **Zero runtime dependencies** - Only requires Node.js 18+

## Installation

```bash
curl -fsSL https://itskod.com/release/latest.zip -o kod.zip && unzip kod.zip && chmod +x kod/kod.js && sudo mv kod/kod.js /usr/local/bin/kod && rm -rf kod kod.zip
```

## Upgrade

To upgrade to the latest version:

```bash
kod upgrade
```

Or using the standalone script (useful if `kod` is broken):

```bash
curl -fsSL https://itskod.com/release/upgrade.sh | bash
```

On a VM with Kod installed via the install script:

```bash
sudo /usr/local/bin/kod-upgrade.sh
```

## Quick Start

### 1. Start the server

Start the server with an admin token for first-time setup:

```bash
KOD_ADMIN_TOKEN=kod_your_secret_token kod serve
```

The server will create an admin token on first start if no tokens exist.

### 2. Initialize configuration

```bash
kod init
# Enter server URL: http://localhost:3000
# Enter token: kod_your_secret_token (the one you set above)
```

### 3. Create a repository

```bash
kod repo create my-app
```

### 4. Clone and push

```bash
git clone http://localhost:3000/repos/my-app.git
# Username: git (or anything)
# Password: your API token

cd my-app
# ... make changes ...
git push origin main
```

## Git Access

Kod provides Git access over HTTP. Authenticate using your API token as the password:

```bash
# Clone a repository
git clone http://localhost:3000/repos/my-app.git

# Git will prompt for credentials:
# Username: git (or anything)
# Password: your_api_token

# Configure git to remember credentials
git config --global credential.helper store
```

### Collaborator Workflow

To give another user access to a repository:

```bash
# 1. Add them as a collaborator
kod repo my-app collaborator add alice

# 2. Create a token for them
kod token create alice-token --username alice --permissions repo:read,repo:write

# 3. Share the token with Alice - she uses it as the git password
```

## CLI Reference

### Global Options

These options can be used with any command:

```bash
kod [global options] <command> [command options]

Global options:
  -t, --token <token>                 # API token for authentication
  -s, --server <url>                  # Server URL (e.g., http://localhost:3000)
  -h, --help                          # Show help
  -v, --version                       # Show version
```

### Setup

```bash
kod init                              # Configure server URL and API token
kod serve [options]                   # Start the Kod server
  --port, -p <port>                   # Port (default: 3000)
  --data-dir <path>                   # Database directory
  --repos-dir <path>                  # Git repositories directory
  --token <token>                     # API token
```

### Clone

```bash
kod clone <repo>                      # Clone a repository
```

The clone command accepts only the repository name (not a full URL). It uses your configured server URL and API token to authenticate automatically.

### Repository Management

```bash
kod repo list                         # List all repositories
kod repo create <name>                # Create a new repository
kod repo <name> info                  # Show repository details
kod repo update <name> name <new>     # Rename a repository
kod repo delete <name>                # Delete a repository
```

### Collaborators

```bash
kod repo <name> collaborator list              # List collaborators
kod repo <name> collaborator add <username>    # Add collaborator
kod repo <name> collaborator remove <username> # Remove collaborator
```

### API Tokens

```bash
kod token list                                           # List all tokens (admin only)
kod token create <name>                                  # Create token with defaults
kod token create <name> --permissions repo:read,workflow:trigger
kod token create <name> --username alice                 # Link to collaborator
kod token create <name> --expires 30                     # Expires in 30 days
kod token delete <id>                                    # Delete a token (admin only)
```

### Workflows

```bash
kod workflow <file.toml> [more...]    # Run workflow(s) locally
kod workflow build.toml,deploy.toml   # Comma-separated files
kod workflow                          # Auto-discover from .kod/workflows/
kod workflow status [repo]            # Check workflow run status (requires server)

# Override branch for local testing
BRANCH=main kod workflow deploy.toml
```

## Workflow Syntax

Workflows are defined in TOML files. Place them in `.kod/workflows/` in your repository for automatic execution on push, or run them locally with `kod workflow`.

### Basic Example

```toml
timeout: 120  # Global timeout in seconds (default: 300)

[step:test]
run: npm test
continue_on_error: true  # Continue even if this step fails

[step:build]
run: npm run build

[step:deploy]
if: "branch == 'main'"
run: ./deploy.sh
```

### Multiline Commands

```toml
[step:deploy]
run:
  echo "Starting deployment"
  npm run build
  ./deploy.sh production
  echo "Done!"
```

### Environment Variables

```toml
[step:deploy]
run:
  env.TARGET = "production"
  env.VERSION = "1.0.0"
  echo "Deploying {env.TARGET} v{env.VERSION}"
  ./deploy.sh {env.TARGET}
```

### Conditionals

Supported conditions:

- `branch == 'value'` - Run if branch matches
- `branch != 'value'` - Run if branch doesn't match
- `env.VAR == 'value'` - Run if environment variable matches

```toml
[step:deploy staging]
if: "branch == 'develop'"
run: ./deploy.sh staging

[step:deploy production]
if: "branch == 'main'"
run: ./deploy.sh production

[step:notify]
if: "env.NOTIFY == 'true'"
run: ./send-notification.sh
```

### Working Directory

```toml
[step:build frontend]
working_dir: ./frontend
run: npm run build
```

### Variable Interpolation

Available variables:

- `{branch}` - Current Git branch
- `{repo}` - Repository name
- `{env.VAR}` - Environment variable

## Security

### API Tokens & Permissions

Kod uses a permission-based access control system. Each API token has specific permissions:

- `repo:read` - List and view repositories, clone/fetch
- `repo:write` - Create and update repositories, push
- `repo:delete` - Delete repositories
- `collaborator:read` - List collaborators
- `collaborator:write` - Add/remove collaborators
- `workflow:read` - View workflow runs
- `workflow:trigger` - Trigger workflows
- `admin` - Full access to all operations

Default permissions for new tokens: `repo:read`, `repo:write`, `workflow:read`

### Repository Ownership

- Each repository is owned by the token that created it
- Only the owner (or admin) can delete, rename, or add collaborators
- Non-owners with `repo:read` can view repos but not modify them

### Collaborator Access Control

Tokens can be linked to collaborators using the `--username` flag:

```bash
kod token create alice-token --username alice --permissions repo:read,repo:write
```

When a token is linked to a collaborator:

- Git operations (clone/push) check if the collaborator has access to the repository
- Admin tokens bypass collaborator checks

### HTTP Authentication

Git operations use HTTP Basic Auth:

- Username can be anything (e.g., "git")
- Password is the API token

The server also accepts Bearer token authentication for API requests.

### Internal Endpoints

Internal endpoints (`/internal/*`) used by git hooks are restricted to localhost only.

## HTTP API

The server exposes a REST API for programmatic access.

### Authentication

Include the API token in requests:

```bash
curl -H "Authorization: Bearer <token>" http://localhost:3000/repos
```

### Endpoints

| Method | Path                               | Description                     |
|--------|------------------------------------|---------------------------------|
| GET    | `/health`                          | Health check (no auth required) |
| GET    | `/repos`                           | List repositories               |
| POST   | `/repos`                           | Create repository               |
| GET    | `/repos/:name`                     | Get repository details          |
| PATCH  | `/repos/:name`                     | Update repository               |
| DELETE | `/repos/:name`                     | Delete repository               |
| GET    | `/repos/:name/collaborators`       | List collaborators              |
| POST   | `/repos/:name/collaborators`       | Add collaborator                |
| DELETE | `/repos/:name/collaborators/:user` | Remove collaborator             |
| POST   | `/repos/:name/workflows`           | Trigger workflow                |
| GET    | `/repos/:name/workflows`           | List workflow runs              |
| GET    | `/repos/:name/workflows/:id`       | Get workflow run details        |
| GET    | `/workflows/status`                | Global workflow status          |
| GET    | `/tokens`                          | List API tokens (admin only)    |
| POST   | `/tokens`                          | Create API token (admin only)   |
| DELETE | `/tokens/:id`                      | Delete API token (admin only)   |

### Git HTTP Endpoints

| Method | Path                                    | Description          |
|--------|-----------------------------------------|----------------------|
| GET    | `/repos/:name.git/info/refs`            | Git refs discovery   |
| POST   | `/repos/:name.git/git-upload-pack`      | Git clone/fetch      |
| POST   | `/repos/:name.git/git-receive-pack`     | Git push             |

### Example: Create Repository

```bash
curl -X POST http://localhost:3000/repos \
  -H "Authorization: Bearer kod_xxx" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-app"}'
```

## Configuration

### Client Config (`~/.kod/config.json`)

```json
{
  "serverUrl": "http://localhost:3000",
  "apiToken": "kod_xxxxx"
}
```

### Server Config (`~/.kod/server.json`)

```json
{
  "port": 3000,
  "dataDir": "~/.kod/data",
  "reposDir": "~/.kod/repos"
}
```

### Server Bootstrap

On first start, if no API tokens exist and `KOD_ADMIN_TOKEN` is set, the server will automatically create an admin token with that value. This solves the chicken-and-egg problem of needing a token to create tokens.

### Environment Variables

| Variable          | Description                                        |
|-------------------|----------------------------------------------------|
| `KOD_ADMIN_TOKEN` | Bootstrap admin token (created on first start)     |
| `KOD_PORT`        | Server port                                        |
| `KOD_DATA_DIR`    | Database directory                                 |
| `KOD_REPOS_DIR`   | Git repositories directory                         |
| `KOD_API_TOKEN`   | API authentication token (server & CLI)            |
| `KOD_SERVER_URL`  | Server URL for CLI commands                        |

#### Configuration Priority

Configuration is loaded in this order (later sources override earlier):

1. **Default values** - Built-in defaults
2. **Config file** - `~/.kod/config.json` (client) or `~/.kod/server.json` (server)
3. **Environment variables** - `KOD_API_TOKEN`, `KOD_SERVER_URL`, etc.
4. **CLI flags** - `--token`, `--server`, etc.

#### Examples

```bash
# Using environment variables
export KOD_API_TOKEN=kod_abc123
export KOD_SERVER_URL=http://myserver:3000
kod repo list

# Using CLI flags
kod --token kod_abc123 --server http://myserver:3000 repo list

# Short form
kod -t kod_abc123 -s http://myserver:3000 repo list

# Mix: env var for token, flag for server
KOD_API_TOKEN=kod_abc123 kod -s http://myserver:3000 repo list
```

## License

MIT
