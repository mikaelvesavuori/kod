import type { Route, ServerConfig } from '../shared/types.js';

import { createHttpServer } from './http-server.js';
import { Database } from './db/index.js';
import { RepoManager } from './git/RepoManager.js';
import { WorkflowQueue } from './workflow/WorkflowQueue.js';
import { setEncryptionKey, hasEncryptionKey } from '../shared/crypto.js';

import { createRepoRoutes } from './routes/repos.js';
import { createCollaboratorRoutes } from './routes/collaborators.js';
import { createWorkflowRoutes } from './routes/workflows.js';
import { createTokenRoutes } from './routes/tokens.js';
import { createSecretRoutes } from './routes/secrets.js';
import { createGitRoutes } from './routes/git.js';

export async function startServer(config: ServerConfig): Promise<void> {
  console.log('Starting Kod server...');

  // Initialize encryption key if provided
  if (config.encryptionKey) {
    setEncryptionKey(config.encryptionKey);
  }

  // Initialize database
  const db = new Database(config.dataDir);

  // Check if secrets exist but no encryption key is configured
  const secretsExist = await db.hasSecrets();
  if (secretsExist && !hasEncryptionKey()) {
    console.error(
      'Error: Secrets exist in the database but no encryption key is configured.'
    );
    console.error(
      'Set KOD_ENCRYPTION_KEY env var or use --encryption-key to provide the key.'
    );
    process.exit(1);
  }

  // Initialize repo manager
  const repoManager = new RepoManager(config.reposDir);

  // Initialize workflow queue
  const queue = new WorkflowQueue(db, config.reposDir);

  // Build server URL for hooks
  const serverUrl = `http://localhost:${config.port}`;

  // Collect all routes
  const routes: Route[] = [
    // Health check
    {
      method: 'GET',
      pattern: /^\/health\/?$/,
      handler: async () => ({ status: 200, body: { status: 'ok' } })
    },
    // Internal hook endpoint (no auth, called by git post-receive hook)
    {
      method: 'POST',
      pattern: /^\/internal\/hooks\/(?<name>[^/]+)\/push\/?$/,
      handler: async (req, params) => {
        const body = req.body as { branch?: string; commit?: string };
        if (!body?.branch) {
          return { status: 400, body: { error: 'Branch is required' } };
        }
        const repo = await db.getRepo(params.name);
        if (!repo) {
          return { status: 404, body: { error: 'Repository not found' } };
        }
        await queue.enqueue(params.name, body.branch, '');
        return { status: 202, body: { message: 'Workflow queued' } };
      }
    },
    ...createRepoRoutes(db, repoManager, serverUrl),
    ...createCollaboratorRoutes(db),
    ...createWorkflowRoutes(db, queue),
    ...createTokenRoutes(db),
    ...createSecretRoutes(db),
    ...createGitRoutes(db, repoManager)
  ];

  // Token validator using database
  const validateToken = (token: string) => db.validateToken(token);

  // Create and start HTTP server
  const server = createHttpServer(routes, validateToken);

  // Handle graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down...');
    server.close();
    await db.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Bootstrap: create admin token if none exist and admin token is configured
  const tokens = await db.listApiTokens();
  if (tokens.length === 0) {
    if (config.adminToken) {
      await db.createAdminToken(config.adminToken);
      console.log('Created admin token from configuration');
    }
  }

  // Start listening
  server.listen(config.port, async () => {
    console.log(`Kod server running on http://localhost:${config.port}`);
    console.log(`  Data dir: ${config.dataDir}`);
    console.log(`  Repos dir: ${config.reposDir}`);

    // Check if any tokens exist
    const currentTokens = await db.listApiTokens();
    if (currentTokens.length === 0) {
      console.error('');
      console.error(
        '  WARNING: No API tokens configured. The server has no authentication.'
      );
      console.error(
        '  To create an admin token, set one of the following and restart:'
      );
      console.error('');
      console.error('    KOD_ADMIN_TOKEN=<your-token> kod serve');
      console.error('    kod serve --admin-token <your-token>');
      console.error('');
    } else {
      console.log(`  Auth: ${currentTokens.length} API token(s) configured`);
    }
  });
}
