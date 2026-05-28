import { spawn } from 'node:child_process';
import type { Route, HttpRequest, HttpResponse } from '../../shared/types.js';
import type { Database } from '../db/index.js';
import type { RepoManager } from '../git/RepoManager.js';
import type { HttpRequestWithAuth } from '../http-server.js';

/**
 * Creates routes for Git HTTP Smart Protocol.
 * Allows git clone/fetch/push over HTTP with token-based auth.
 *
 * Git clients authenticate via HTTP Basic Auth:
 * - Username: can be anything (often 'git' or the actual username)
 * - Password: the API token
 *
 * Access control:
 * - Token must have repo:read for clone/fetch
 * - Token must have repo:write for push
 * - If token has a username, user must be a collaborator on the repo
 */
export function createGitRoutes(
  db: Database,
  repoManager: RepoManager
): Route[] {
  return [
    gitInfoRefs(db, repoManager),
    gitUploadPack(db, repoManager),
    gitReceivePack(db, repoManager)
  ];
}

/**
 * Check if the authenticated user has access to a repo.
 * - Admin tokens have access to all repos
 * - Tokens with username must have that user as a collaborator
 * - Tokens without username (system tokens) have access based on permissions only
 */
async function checkRepoAccess(
  req: HttpRequest,
  db: Database,
  repoName: string,
  requireWrite: boolean
): Promise<{ allowed: boolean; error?: string }> {
  const authReq = req as HttpRequestWithAuth;
  const tokenInfo = authReq.tokenInfo;

  if (!tokenInfo) {
    return { allowed: false, error: 'Authentication required' };
  }

  // Admin tokens have full access
  if (tokenInfo.permissions.includes('admin')) {
    return { allowed: true };
  }

  // Check basic permissions
  if (requireWrite && !tokenInfo.permissions.includes('repo:write')) {
    return { allowed: false, error: 'repo:write permission required' };
  }
  if (!requireWrite && !tokenInfo.permissions.includes('repo:read')) {
    return { allowed: false, error: 'repo:read permission required' };
  }

  // Check repo exists
  const repo = await db.getRepo(repoName);
  if (!repo) {
    return { allowed: false, error: 'Repository not found' };
  }

  // If token is linked to a username, check collaborator access
  if (tokenInfo.username) {
    const repoCollabs = await db.getRepoCollaborators(repoName);
    const isCollaborator = repoCollabs?.collaborators.includes(
      tokenInfo.username
    );
    const isOwner = repo.ownerTokenId === tokenInfo.id;

    if (!isCollaborator && !isOwner) {
      return { allowed: false, error: 'Not a collaborator on this repository' };
    }
  }

  return { allowed: true };
}

// GET /repos/:name.git/info/refs?service=git-upload-pack|git-receive-pack
const gitInfoRefs = (db: Database, repoManager: RepoManager): Route => ({
  method: 'GET',
  pattern: /^\/repos\/(?<name>[^/]+)\.git\/info\/refs$/,
  handler: async (
    req: HttpRequest,
    params: Record<string, string>
  ): Promise<HttpResponse> => {
    const url = new URL(req.rawUrl || req.url, 'http://localhost');
    const service = url.searchParams.get('service');

    if (
      !service ||
      !['git-upload-pack', 'git-receive-pack'].includes(service)
    ) {
      return { status: 400, body: { error: 'Invalid service' } };
    }

    const requireWrite = service === 'git-receive-pack';
    const access = await checkRepoAccess(req, db, params.name, requireWrite);
    if (!access.allowed) {
      return { status: 403, body: { error: access.error } };
    }

    const repoPath = repoManager.getRepoPath(params.name);

    return new Promise((resolve) => {
      const proc = spawn(service, [
        '--stateless-rpc',
        '--advertise-refs',
        repoPath
      ]);

      const chunks: Buffer[] = [];
      proc.stdout.on('data', (data) => chunks.push(data));

      proc.on('close', (code) => {
        if (code !== 0) {
          resolve({ status: 500, body: { error: 'Git command failed' } });
          return;
        }

        const output = Buffer.concat(chunks);
        // Git smart protocol header
        const header = `# service=${service}\n`;
        const headerPkt = `${(header.length + 4).toString(16).padStart(4, '0')}${header}`;
        const body = Buffer.concat([Buffer.from(`${headerPkt}0000`), output]);

        resolve({
          status: 200,
          body,
          headers: {
            'Content-Type': `application/x-${service}-advertisement`,
            'Cache-Control': 'no-cache'
          }
        });
      });

      proc.on('error', () => {
        resolve({
          status: 500,
          body: { error: 'Failed to spawn git process' }
        });
      });
    });
  }
});

// POST /repos/:name.git/git-upload-pack
const gitUploadPack = (db: Database, repoManager: RepoManager): Route => ({
  method: 'POST',
  pattern: /^\/repos\/(?<name>[^/]+)\.git\/git-upload-pack$/,
  handler: async (
    req: HttpRequest,
    params: Record<string, string>
  ): Promise<HttpResponse> => {
    const access = await checkRepoAccess(req, db, params.name, false);
    if (!access.allowed) {
      return { status: 403, body: { error: access.error } };
    }

    const repoPath = repoManager.getRepoPath(params.name);
    return runGitCommand('git-upload-pack', repoPath, req.body as Buffer);
  }
});

// POST /repos/:name.git/git-receive-pack
const gitReceivePack = (db: Database, repoManager: RepoManager): Route => ({
  method: 'POST',
  pattern: /^\/repos\/(?<name>[^/]+)\.git\/git-receive-pack$/,
  handler: async (
    req: HttpRequest,
    params: Record<string, string>
  ): Promise<HttpResponse> => {
    const access = await checkRepoAccess(req, db, params.name, true);
    if (!access.allowed) {
      return { status: 403, body: { error: access.error } };
    }

    const repoPath = repoManager.getRepoPath(params.name);
    const authReq = req as HttpRequestWithAuth;
    const tokenInfo = authReq.tokenInfo;
    const repo = await db.getRepo(params.name);

    return runGitCommand('git-receive-pack', repoPath, req.body as Buffer, {
      KOD_IS_ADMIN: tokenInfo?.permissions.includes('admin') ? 'true' : 'false',
      KOD_IS_OWNER: repo?.ownerTokenId === tokenInfo?.id ? 'true' : 'false',
      KOD_TOKEN_ID: tokenInfo?.id ?? '',
      KOD_USERNAME: tokenInfo?.username ?? ''
    });
  }
});

function runGitCommand(
  command: string,
  repoPath: string,
  input: Buffer,
  env: Record<string, string> = {}
): Promise<HttpResponse> {
  return new Promise((resolve) => {
    const proc = spawn(command, ['--stateless-rpc', repoPath], {
      env: { ...process.env, ...env }
    });

    const chunks: Buffer[] = [];
    proc.stdout.on('data', (data) => chunks.push(data));

    proc.on('close', (code) => {
      if (code !== 0) {
        resolve({ status: 500, body: { error: 'Git command failed' } });
        return;
      }

      resolve({
        status: 200,
        body: Buffer.concat(chunks),
        headers: {
          'Content-Type': `application/x-${command}-result`,
          'Cache-Control': 'no-cache'
        }
      });
    });

    proc.on('error', () => {
      resolve({ status: 500, body: { error: 'Failed to spawn git process' } });
    });

    // Send the input to git
    if (input && input.length > 0) {
      proc.stdin.write(input);
    }
    proc.stdin.end();
  });
}
