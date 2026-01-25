import { loadServerConfig } from '../shared/config.js';
import type { KodConfig } from '../shared/types.js';

import { startServer } from '../server/index.js';

import { initCommand } from './commands/init.js';
import {
  listRepos,
  createRepo,
  getRepoInfo,
  updateRepo,
  deleteRepo
} from './commands/repo.js';
import {
  addCollaborator,
  removeCollaborator,
  listCollaborators
} from './commands/collaborator.js';
import { runWorkflowCommand, workflowStatus } from './commands/workflow.js';
import {
  listTokens,
  createToken,
  deleteToken,
  parsePermissions,
  parseExpiration,
  parseUsername
} from './commands/token.js';
import { upgradeCommand } from './commands/upgrade.js';
import { setConfigOverrides } from './http-client.js';

const VERSION = '0.0.1';

interface ParsedArgs {
  globalOverrides: Partial<KodConfig>;
  command: string | undefined;
  commandArgs: string[];
}

function parseGlobalArgs(args: string[]): ParsedArgs {
  const globalOverrides: Partial<KodConfig> = {};
  const remainingArgs: string[] = [];
  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    if (arg === '--token' || arg === '-t') {
      globalOverrides.apiToken = args[++i];
    } else if (arg === '--server' || arg === '-s') {
      globalOverrides.serverUrl = args[++i];
    } else {
      remainingArgs.push(arg);
    }
    i++;
  }

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

      case 'workflow':
        await workflowCommand(commandArgs);
        break;

      case 'token':
        await tokenCommand(commandArgs);
        break;

      case 'upgrade':
        await upgradeCommand();
        break;

      default:
        console.error(`Unknown command: ${command}`);
        console.error('Run "kod --help" for usage.');
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
    } else if (arg === '-h' || arg === '--help') {
      console.log(`Usage: kod serve [options]

Options:
  --port, -p <port>     Port to listen on (default: 3000)
  --data-dir <path>     Data directory for database
  --repos-dir <path>    Directory for Git repositories
  --token <token>       API token for authentication

Environment variables:
  KOD_PORT              Port to listen on
  KOD_DATA_DIR          Data directory
  KOD_REPOS_DIR         Repos directory
  KOD_API_TOKEN         API token`);
      return;
    }
  }

  const config = loadServerConfig(overrides);
  await startServer(config);
}

async function repoCommand(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error('Usage: kod repo <command> [options]');
    console.error('Commands: list, create, info, update, delete');
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
      } else {
        console.error(`Unknown repo action: ${action}`);
        console.error('Actions: info, collaborator');
        process.exit(1);
      }
    }
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
  kod workflow <file.toml> [file2.toml...]   Run workflow(s) locally
  kod workflow status [repo]                 Check workflow status

Examples:
  kod workflow build.toml
  kod workflow build.toml deploy.toml
  kod workflow build.toml,deploy.toml
  BRANCH=main kod workflow build.toml
  kod workflow status
  kod workflow status my-repo`);
    return;
  }

  const subcommand = args[0];

  if (subcommand === 'status') {
    await workflowStatus(args[1]);
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
  upgrade                        Upgrade Kod to the latest version

  repo list                      List all repositories
  repo create <name>             Create a new repository
  repo <name> info               Show repository details
  repo update <name> name <new>  Rename a repository
  repo delete <name>             Delete a repository

  repo <name> collaborator list                List collaborators
  repo <name> collaborator add <user>          Add collaborator
  repo <name> collaborator remove <user>       Remove collaborator

  token list                     List all API tokens (requires admin)
  token create <name> [options]  Create a new API token (requires admin)
  token delete <id>              Delete an API token (requires admin)

  workflow <file.toml> [...]     Run workflow(s) locally
  workflow status [repo]         Check workflow run status

Global Options:
  -t, --token <token>            API token for authentication
  -s, --server <url>             Server URL (e.g., http://localhost:3000)
  -h, --help                     Show this help
  -v, --version                  Show version

Token Options:
  --permissions <perms>          Comma-separated permissions
  --expires <days>               Token expiration in days (1-365)
  --username <user>              Link token to collaborator (for Git access)

Permissions: repo:read, repo:write, repo:delete, collaborator:read,
             collaborator:write, workflow:read, workflow:trigger, admin

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
  kod repo my-app collaborator add alice
  kod token create ci-deploy --permissions repo:read,workflow:trigger
  kod token create alice-token --username alice --permissions repo:read,repo:write
  kod token create temp-token --expires 30
  kod workflow build.toml`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
