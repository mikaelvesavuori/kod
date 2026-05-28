import { loadServerConfig } from '../shared/config.js';
import type { KodConfig } from '../shared/types.js';

import { startServer } from '../server/index.js';

import { initCommand } from './commands/init.js';
import {
  listRepos,
  createRepo,
  importRepo,
  getRepoInfo,
  updateRepo,
  deleteRepo,
  listProtectedBranches,
  protectBranch,
  unprotectBranch,
  listWebhooks,
  addWebhook,
  removeWebhook,
  listWebhookDeliveries,
  retryWebhookDelivery
} from './commands/repo.js';
import {
  addCollaborator,
  removeCollaborator,
  listCollaborators
} from './commands/collaborator.js';
import {
  runWorkflowCommand,
  workflowStatus,
  workflowShow,
  workflowTrigger
} from './commands/workflow.js';
import {
  listTokens,
  createToken,
  deleteToken,
  parsePermissions,
  parseExpiration,
  parseUsername
} from './commands/token.js';
import { upgradeCommand } from './commands/upgrade.js';
import { uninstallCommand } from './commands/uninstall.js';
import { backupCommand, restoreCommand } from './commands/backup.js';
import { cloneRepo, parseCloneArgs } from './commands/clone.js';
import { setConfigOverrides } from './http-client.js';
import { addKey, listKeys, removeKey } from './commands/keys.js';
import { doctorCommand } from './commands/doctor.js';

declare const __PKG_VERSION__: string;
const VERSION = __PKG_VERSION__;

interface ParsedArgs {
  globalOverrides: Partial<KodConfig>;
  command: string | undefined;
  commandArgs: string[];
}

function parseGlobalArgs(args: string[]): ParsedArgs {
  const globalOverrides: Partial<KodConfig> = {};
  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    if (arg === '--token' || arg === '-t') {
      globalOverrides.apiToken = args[++i];
    } else if (arg === '--server' || arg === '-s') {
      globalOverrides.serverUrl = args[++i];
    } else {
      break;
    }
    i++;
  }

  const remainingArgs = args.slice(i);

  return {
    globalOverrides,
    command: remainingArgs[0],
    commandArgs: remainingArgs.slice(1)
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '-h' || args[0] === '--help') {
    showHelp();
    return;
  }

  if (args[0] === '-v' || args[0] === '--version') {
    console.log(`kod ${VERSION}`);
    return;
  }

  const { globalOverrides, command, commandArgs } = parseGlobalArgs(args);

  // Apply global overrides for API requests
  if (Object.keys(globalOverrides).length > 0) {
    setConfigOverrides(globalOverrides);
  }

  if (!command) {
    showHelp();
    return;
  }

  try {
    switch (command) {
      case 'init':
        await initCommand();
        break;

      case 'serve':
        await serveCommand(commandArgs);
        break;

      case 'repo':
        await repoCommand(commandArgs);
        break;

      case 'keys':
        await keysCommand(commandArgs);
        break;

      case 'doctor':
        await doctorCommand();
        break;

      case 'workflow':
        await workflowCommand(commandArgs);
        break;

      case 'token':
        await tokenCommand(commandArgs);
        break;

      case 'upgrade':
        await upgradeCommand();
        break;

      case 'uninstall':
        await uninstallCommand();
        break;

      case 'backup':
        await backupCommand(commandArgs);
        break;

      case 'restore':
        await restoreCommand(commandArgs);
        break;

      case 'clone': {
        const { repoUrl, options } = parseCloneArgs(commandArgs);
        await cloneRepo(repoUrl, options);
        break;
      }

      case 'help':
        showHelp();
        break;

      default:
        console.error(`Unknown command: ${command}`);
        console.error('Run "kod help" for usage.');
        process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

async function serveCommand(args: string[]): Promise<void> {
  const overrides: Record<string, unknown> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--port' || arg === '-p') {
      overrides.port = parseInt(args[++i], 10);
    } else if (arg === '--data-dir') {
      overrides.dataDir = args[++i];
    } else if (arg === '--repos-dir') {
      overrides.reposDir = args[++i];
    } else if (arg === '--token') {
      overrides.apiToken = args[++i];
    } else if (arg === '--admin-token') {
      overrides.adminToken = args[++i];
    } else if (arg === '--encryption-key') {
      overrides.encryptionKey = args[++i];
    } else if (arg === '--ssh') {
      overrides.sshEnabled = true;
    } else if (arg === '--no-ssh') {
      overrides.sshEnabled = false;
    } else if (arg === '--ssh-host') {
      overrides.sshHost = args[++i];
    } else if (arg === '--ssh-port') {
      overrides.sshPort = parseInt(args[++i], 10);
    } else if (arg === '--ssh-host-key') {
      overrides.sshHostKeyPath = args[++i];
    } else if (arg === '--ssh-anonymous-read') {
      overrides.sshAnonymousRead = true;
    } else if (arg === '-h' || arg === '--help') {
      console.log(`Usage: kod serve [options]

Options:
  --port, -p <port>          Port to listen on (default: 3000)
  --data-dir <path>          Data directory for database
  --repos-dir <path>         Directory for Git repositories
  --token <token>            Legacy bootstrap token alias
  --admin-token <token>      Admin token for first-time setup
  --encryption-key <key>     Encryption key for secrets
  --ssh / --no-ssh           Enable or disable SSH Git access
  --ssh-host <host>          SSH listen host (default: 0.0.0.0)
  --ssh-port <port>          SSH listen port (default: 2222)
  --ssh-host-key <path>      SSH host private key path
  --ssh-anonymous-read       Allow unauthenticated SSH clone/fetch/list

Environment variables:
  KOD_PORT                   Port to listen on
  KOD_DATA_DIR               Data directory
  KOD_REPOS_DIR              Repos directory
  KOD_API_TOKEN              Legacy bootstrap token alias
  KOD_ADMIN_TOKEN            Admin token for first-time setup
  KOD_ENCRYPTION_KEY         Encryption key for secrets
  KOD_SSH_ENABLED            Enable SSH server (true/false)
  KOD_SSH_HOST               SSH listen host
  KOD_SSH_PORT               SSH listen port
  KOD_SSH_HOST_KEY_PATH      SSH host private key path
  KOD_SSH_ANONYMOUS_READ     Allow anonymous SSH read access`);
      return;
    }
  }

  const config = loadServerConfig(overrides);
  await startServer(config);
}

async function repoCommand(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error('Usage: kod repo <command> [options]');
    console.error('Commands: list, create, import, info, update, delete');
    process.exit(1);
  }

  const subcommand = args[0];

  switch (subcommand) {
    case 'list':
      await listRepos();
      break;

    case 'create':
      await createRepo(args[1]);
      break;

    case 'import':
      await importRepo(args[1], args[2]);
      break;

    case 'delete':
      await deleteRepo(args[1]);
      break;

    case 'update':
      // kod repo update <name> <field> <value>
      await updateRepo(args[1], args[2], args[3]);
      break;

    default: {
      // Could be: kod repo <name> <action>
      // e.g., kod repo my-app info
      // e.g., kod repo my-app collaborator add user
      const repoName = subcommand;
      const action = args[1];

      if (!action) {
        // Show repo info by default
        await getRepoInfo(repoName);
        break;
      }

      if (action === 'info') {
        await getRepoInfo(repoName);
      } else if (action === 'collaborator') {
        await collaboratorSubcommand(repoName, args.slice(2));
      } else if (action === 'protected') {
        await listProtectedBranches(repoName);
      } else if (action === 'protect') {
        await protectBranch(repoName, args[2]);
      } else if (action === 'unprotect') {
        await unprotectBranch(repoName, args[2]);
      } else if (action === 'webhook') {
        await webhookSubcommand(repoName, args.slice(2));
      } else {
        console.error(`Unknown repo action: ${action}`);
        console.error(
          'Actions: info, collaborator, protected, protect, unprotect, webhook'
        );
        process.exit(1);
      }
    }
  }
}

async function webhookSubcommand(
  repoName: string,
  args: string[]
): Promise<void> {
  const action = args[0] || 'list';

  switch (action) {
    case 'list':
      await listWebhooks(repoName);
      break;

    case 'add': {
      const url = args[1];
      const eventsIndex = args.indexOf('--events');
      const secretIndex = args.indexOf('--secret');
      const events =
        eventsIndex !== -1 && args[eventsIndex + 1]
          ? args[eventsIndex + 1].split(',').map((event) => event.trim())
          : [];
      const secret =
        secretIndex !== -1 && args[secretIndex + 1]
          ? args[secretIndex + 1]
          : undefined;
      await addWebhook(repoName, url, events, secret);
      break;
    }

    case 'remove':
      await removeWebhook(repoName, args[1]);
      break;

    case 'deliveries':
      await listWebhookDeliveries(repoName, args[1]);
      break;

    case 'retry':
      await retryWebhookDelivery(repoName, args[1], args[2]);
      break;

    default:
      console.error(`Unknown webhook action: ${action}`);
      console.error('Actions: list, add, remove, deliveries, retry');
      process.exit(1);
  }
}

async function keysCommand(args: string[]): Promise<void> {
  const subcommand = args[0] || 'list';

  switch (subcommand) {
    case 'list':
      await listKeys(args.slice(1));
      break;

    case 'add':
      await addKey(args.slice(1));
      break;

    case 'remove':
    case 'delete':
      await removeKey(args.slice(1));
      break;

    default:
      console.error(`Unknown keys command: ${subcommand}`);
      console.error('Commands: list, add, remove');
      process.exit(1);
  }
}

async function collaboratorSubcommand(
  repoName: string,
  args: string[]
): Promise<void> {
  if (args.length === 0) {
    // List collaborators by default
    await listCollaborators(repoName);
    return;
  }

  const action = args[0];

  switch (action) {
    case 'list':
      await listCollaborators(repoName);
      break;

    case 'add':
      await addCollaborator(repoName, args[1]);
      break;

    case 'remove':
      await removeCollaborator(repoName, args[1]);
      break;

    default:
      console.error(`Unknown collaborator action: ${action}`);
      console.error('Actions: list, add, remove');
      process.exit(1);
  }
}

async function tokenCommand(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === '-h' || args[0] === '--help') {
    console.log(`Usage: kod token <command> [options]

Commands:
  list                           List all API tokens
  create <name> [options]        Create a new token
  delete <id>                    Delete a token

Options for create:
  --permissions <perms>  Comma-separated permissions (default: repo:read,repo:write,workflow:read)
  --expires <days>       Token expiration in days (1-365, default: never)
  --username <user>      Link token to a collaborator (for Git access)

Valid permissions:
  repo:read, repo:write, repo:delete
  collaborator:read, collaborator:write
  workflow:read, workflow:trigger
  secrets:read, secrets:write
  webhook:read, webhook:write
  admin

Examples:
  kod token list
  kod token create my-ci-token
  kod token create admin-token --permissions admin
  kod token create deploy-token --permissions repo:read,workflow:trigger
  kod token create temp-token --expires 30
  kod token create alice-token --username alice --permissions repo:read,repo:write
  kod token delete abc123`);
    return;
  }

  const subcommand = args[0];

  switch (subcommand) {
    case 'list':
      await listTokens();
      break;

    case 'create': {
      const name = args[1];
      if (!name) {
        console.error('Token name is required');
        process.exit(1);
      }
      const permissions = parsePermissions(args);
      const expiresInDays = parseExpiration(args);
      const username = parseUsername(args);
      await createToken(name, permissions, expiresInDays, username);
      break;
    }

    case 'delete': {
      const id = args[1];
      if (!id) {
        console.error('Token ID is required');
        process.exit(1);
      }
      await deleteToken(id);
      break;
    }

    default:
      console.error(`Unknown token command: ${subcommand}`);
      console.error('Commands: list, create, delete');
      process.exit(1);
  }
}

async function workflowCommand(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === '-h' || args[0] === '--help') {
    console.log(`Usage: kod workflow <command> [options]

Commands:
  kod workflow <file.toml> [file2.toml...]           Run workflow(s) locally
  kod workflow status [repo]                         Check workflow status
  kod workflow show <repo> <id>                      Show details of a specific run
  kod workflow trigger <repo> [--branch <branch>]    Trigger a remote workflow

Examples:
  kod workflow build.toml
  kod workflow build.toml deploy.toml
  kod workflow build.toml,deploy.toml
  BRANCH=main kod workflow build.toml
  kod workflow status
  kod workflow status my-repo
  kod workflow show my-repo abc123
  kod workflow trigger my-repo
  kod workflow trigger my-repo --branch feature/login`);
    return;
  }

  const subcommand = args[0];

  if (subcommand === 'status') {
    await workflowStatus(args[1]);
  } else if (subcommand === 'show') {
    if (args.length < 3) {
      console.error('Usage: kod workflow show <repo> <id>');
      process.exit(1);
    }
    await workflowShow(args[1], args[2]);
  } else if (subcommand === 'trigger') {
    if (args.length < 2) {
      console.error('Usage: kod workflow trigger <repo> [--branch <branch>]');
      process.exit(1);
    }
    const repoName = args[1];
    let branch = 'main';
    const branchIdx = args.indexOf('--branch');
    if (branchIdx !== -1 && args[branchIdx + 1]) {
      branch = args[branchIdx + 1];
    }
    await workflowTrigger(repoName, branch);
  } else {
    // Treat as workflow files
    await runWorkflowCommand(args);
  }
}

function showHelp(): void {
  console.log(`kod - Minimalist Git repository management

Usage: kod [global options] <command> [options]

Commands:
  init                           Configure Kod (server URL, API token)
  serve                          Start the Kod server
  clone <url|name> [options]     Clone a repository (uses configured token)
  doctor                         Check local config, Git, server, and auth
  keys list                      List SSH public keys
  keys add <key|path>            Add an SSH public key
  keys remove <id>               Remove an SSH public key
  backup [--output path]         Create a backup of data and repositories
  restore <file> [--force]       Restore data and repositories from backup
  upgrade                        Upgrade Kod to the latest version
  uninstall                      Remove Kod binary and data

  repo list                      List all repositories
  repo create <name>             Create a new repository
  repo import <source> [name]     Import a local or remote Git repository
  repo <name> info               Show repository details
  repo update <name> name <new>  Rename a repository
  repo delete <name>             Delete a repository

  repo <name> collaborator list                List collaborators
  repo <name> collaborator add <user>          Add collaborator
  repo <name> collaborator remove <user>       Remove collaborator
  repo <name> protected                       List protected branches
  repo <name> protect <branch>                Protect branch from collaborator pushes
  repo <name> unprotect <branch>              Remove branch protection
  repo <name> webhook list                    List webhooks
  repo <name> webhook add <url>               Add webhook
  repo <name> webhook remove <id>             Remove webhook
  repo <name> webhook deliveries <id>         List webhook deliveries
  repo <name> webhook retry <id> <delivery>   Retry a webhook delivery

  token list                     List all API tokens (requires admin)
  token create <name> [options]  Create a new API token (requires admin)
  token delete <id>              Delete an API token (requires admin)

  workflow <file.toml> [...]     Run workflow(s) locally
  workflow status [repo]         Check workflow run status
  workflow show <repo> <id>      Show details of a specific run
  workflow trigger <repo>        Trigger a remote workflow

Global Options:
  -t, --token <token>            API token for authentication
  -s, --server <url>             Server URL (e.g., http://localhost:3000)
  -h, --help                     Show this help
  -v, --version                  Show version

Token Options:
  --permissions <perms>          Comma-separated permissions
  --expires <days>               Token expiration in days (1-365)
  --username <user>              Link token to collaborator (for Git access)

Clone Options:
  -c, --credentials <token>      Override token for git authentication

Permissions: repo:read, repo:write, repo:delete, collaborator:read,
             collaborator:write, workflow:read, workflow:trigger,
             secrets:read, secrets:write, webhook:read, webhook:write, admin

Environment Variables:
  KOD_API_TOKEN                  API token for authentication
  KOD_SERVER_URL                 Server URL for client commands

Examples:
  kod init
  kod serve --port 3000
  kod repo list
  kod --token kod_abc123 repo list
  kod -t kod_abc123 -s http://myserver:3000 repo list
  KOD_API_TOKEN=kod_abc123 kod repo list
  kod repo create my-app
  kod repo import https://github.com/me/app.git
  kod repo my-app collaborator add alice
  kod keys add ~/.ssh/id_ed25519.pub
  kod clone my-app
  kod clone http://localhost:3000/repos/my-app.git
  kod clone my-app --credentials kod_abc123
  kod backup --output kod-backup.tar.gz
  kod repo my-app protect main
  kod repo my-app webhook add https://example.com/hook --events push,workflow
  kod token create ci-deploy --permissions repo:read,workflow:trigger
  kod token create alice-token --username alice --permissions repo:read,repo:write
  kod token create temp-token --expires 30
  kod workflow build.toml`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
