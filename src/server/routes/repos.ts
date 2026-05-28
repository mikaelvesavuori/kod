import type {
  Route,
  HttpRequest,
  HttpResponse,
  CreateRepoRequest,
  ImportRepoRequest,
  UpdateRepoRequest,
  Repo
} from '../../shared/types.js';

import type { Database } from '../db/index.js';
import type { RepoManager } from '../git/RepoManager.js';
import {
  installPostReceiveHook,
  installPreReceiveHook,
  writeProtectedBranches
} from '../git/hooks.js';
import { hasPermission, getTokenId, FORBIDDEN } from '../auth.js';
import { canSeeRepo } from '../access.js';

interface RepoRouteInput {
  db: Database;
  repoManager: RepoManager;
  serverUrl: string;
}

export function createRepoRoutes(
  db: Database,
  repoManager: RepoManager,
  serverUrl: string
): Route[] {
  const input = { db, repoManager, serverUrl };

  return [
    listRepos(input),
    createRepo(input),
    importRepo(input),
    getRepoDetails(input),
    listProtectedBranches(input),
    protectBranch(input),
    unprotectBranch(input),
    updateRepo(input),
    deleteRepo(input)
  ];
}

// GET /repos - List all repos
const listRepos = (input: RepoRouteInput) => {
  const { db } = input;

  return {
    method: 'GET',
    pattern: /^\/repos\/?$/,
    handler: async (req: HttpRequest): Promise<HttpResponse> => {
      // Require repo:read permission
      if (!hasPermission(req, 'repo:read')) {
        return FORBIDDEN;
      }

      const repos = await db.listRepos();
      const visible: Repo[] = [];
      for (const repo of repos) {
        if (await canSeeRepo(req, db, repo)) {
          visible.push(repo);
        }
      }
      return { status: 200, body: visible };
    }
  };
};

// POST /repos - Create repo
const createRepo = (input: RepoRouteInput) => {
  const { db, repoManager, serverUrl } = input;

  return {
    method: 'POST',
    pattern: /^\/repos\/?$/,
    handler: async (req: HttpRequest): Promise<HttpResponse> => {
      // Require repo:write permission
      if (!hasPermission(req, 'repo:write')) {
        return FORBIDDEN;
      }

      const body = req.body as CreateRepoRequest;

      if (!body?.name) {
        return { status: 400, body: { error: 'Name is required' } };
      }

      // Validate name (alphanumeric, hyphens, underscores only)
      if (!isValidRepoName(body.name)) {
        return {
          status: 400,
          body: {
            error: 'Name must be alphanumeric with hyphens and underscores only'
          }
        };
      }

      // Check if repo already exists
      const existing = await db.getRepo(body.name);
      if (existing) {
        return { status: 409, body: { error: 'Repository already exists' } };
      }

      const ownerTokenId = getTokenId(req);
      if (!ownerTokenId) {
        return { status: 401, body: { error: 'Token ID required' } };
      }

      try {
        // Create bare git repo
        const repoPath = await repoManager.create(body.name);

        // Install post-receive hook
        installPostReceiveHook(repoPath, serverUrl);
        installPreReceiveHook(repoPath);
        writeProtectedBranches(repoPath, []);

        // Save to database with owner
        const repo: Repo = {
          name: body.name,
          createdAt: Date.now(),
          path: repoPath,
          ownerTokenId,
          protectedBranches: []
        };
        await db.createRepo(repo);

        return { status: 201, body: repo };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return { status: 500, body: { error: message } };
      }
    }
  };
};

// POST /repos/import - Import a remote or local Git repository
const importRepo = (input: RepoRouteInput) => {
  const { db, repoManager, serverUrl } = input;

  return {
    method: 'POST',
    pattern: /^\/repos\/import\/?$/,
    handler: async (req: HttpRequest): Promise<HttpResponse> => {
      if (!hasPermission(req, 'repo:write')) {
        return FORBIDDEN;
      }

      const body = req.body as ImportRepoRequest;
      if (!body?.source || typeof body.source !== 'string') {
        return { status: 400, body: { error: 'Source is required' } };
      }

      const name = body.name || deriveRepoName(body.source);
      if (!name) {
        return {
          status: 400,
          body: { error: 'Could not derive repository name from source' }
        };
      }

      if (!isValidRepoName(name)) {
        return {
          status: 400,
          body: {
            error: 'Name must be alphanumeric with hyphens and underscores only'
          }
        };
      }

      const existing = await db.getRepo(name);
      if (existing) {
        return { status: 409, body: { error: 'Repository already exists' } };
      }

      const ownerTokenId = getTokenId(req);
      if (!ownerTokenId) {
        return { status: 401, body: { error: 'Token ID required' } };
      }

      try {
        const repoPath = await repoManager.import(body.source, name);
        installPostReceiveHook(repoPath, serverUrl);
        installPreReceiveHook(repoPath);
        writeProtectedBranches(repoPath, []);

        const repo: Repo = {
          name,
          createdAt: Date.now(),
          path: repoPath,
          ownerTokenId,
          protectedBranches: []
        };
        await db.createRepo(repo);

        return { status: 201, body: repo };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return { status: 500, body: { error: message } };
      }
    }
  };
};

// GET /repos/:name - Get repo details
const getRepoDetails = (input: RepoRouteInput) => {
  const { db, repoManager } = input;

  return {
    method: 'GET',
    pattern: /^\/repos\/(?<name>[^/]+)\/?$/,
    handler: async (
      req: HttpRequest,
      params: Record<string, string>
    ): Promise<HttpResponse> => {
      // Require repo:read permission
      if (!hasPermission(req, 'repo:read')) {
        return FORBIDDEN;
      }

      const repo = await db.getRepo(params.name);

      if (!repo) {
        return { status: 404, body: { error: 'Repository not found' } };
      }

      if (!(await canSeeRepo(req, db, repo))) {
        return FORBIDDEN;
      }

      // Get additional info
      const collaborators = await db.getRepoCollaborators(params.name);
      const branches = await repoManager.getBranches(params.name);
      const defaultBranch = await repoManager.getDefaultBranch(params.name);

      return {
        status: 200,
        body: {
          ...repo,
          collaborators: collaborators?.collaborators || [],
          branches,
          defaultBranch,
          protectedBranches: repo.protectedBranches ?? []
        }
      };
    }
  };
};

// GET /repos/:name/protections/branches - List protected branches
const listProtectedBranches = (input: RepoRouteInput) => {
  const { db } = input;

  return {
    method: 'GET',
    pattern: /^\/repos\/(?<name>[^/]+)\/protections\/branches\/?$/,
    handler: async (
      req: HttpRequest,
      params: Record<string, string>
    ): Promise<HttpResponse> => {
      if (!hasPermission(req, 'repo:read')) {
        return FORBIDDEN;
      }

      const repo = await db.getRepo(params.name);
      if (!repo) {
        return { status: 404, body: { error: 'Repository not found' } };
      }

      if (!(await canSeeRepo(req, db, repo))) {
        return FORBIDDEN;
      }

      return {
        status: 200,
        body: { branches: repo.protectedBranches ?? [] }
      };
    }
  };
};

// PUT /repos/:name/protections/branches/:branch - Protect a branch
const protectBranch = (input: RepoRouteInput) => {
  const { db, repoManager } = input;

  return {
    method: 'PUT',
    pattern: /^\/repos\/(?<name>[^/]+)\/protections\/branches\/(?<branch>.+)$/,
    handler: async (
      req: HttpRequest,
      params: Record<string, string>
    ): Promise<HttpResponse> => {
      if (!hasPermission(req, 'repo:write')) {
        return FORBIDDEN;
      }

      const repo = await db.getRepo(params.name);
      if (!repo) {
        return { status: 404, body: { error: 'Repository not found' } };
      }

      const tokenId = getTokenId(req);
      const isOwner = repo.ownerTokenId === tokenId;
      const isAdmin = hasPermission(req, 'admin');
      if (!isOwner && !isAdmin) {
        return {
          status: 403,
          body: { error: 'Only the repository owner can protect branches' }
        };
      }

      const branch = decodeURIComponent(params.branch);
      if (!isValidBranchPattern(branch)) {
        return { status: 400, body: { error: 'Invalid branch name' } };
      }

      const branches = new Set<string>(
        (repo.protectedBranches ?? []) as string[]
      );
      branches.add(branch);
      const protectedBranches = [...branches].sort();
      await db.updateRepo(params.name, { protectedBranches });
      installPreReceiveHook(repoManager.getRepoPath(params.name));
      writeProtectedBranches(
        repoManager.getRepoPath(params.name),
        protectedBranches
      );

      return { status: 200, body: { branches: protectedBranches } };
    }
  };
};

// DELETE /repos/:name/protections/branches/:branch - Unprotect a branch
const unprotectBranch = (input: RepoRouteInput) => {
  const { db, repoManager } = input;

  return {
    method: 'DELETE',
    pattern: /^\/repos\/(?<name>[^/]+)\/protections\/branches\/(?<branch>.+)$/,
    handler: async (
      req: HttpRequest,
      params: Record<string, string>
    ): Promise<HttpResponse> => {
      if (!hasPermission(req, 'repo:write')) {
        return FORBIDDEN;
      }

      const repo = await db.getRepo(params.name);
      if (!repo) {
        return { status: 404, body: { error: 'Repository not found' } };
      }

      const tokenId = getTokenId(req);
      const isOwner = repo.ownerTokenId === tokenId;
      const isAdmin = hasPermission(req, 'admin');
      if (!isOwner && !isAdmin) {
        return {
          status: 403,
          body: { error: 'Only the repository owner can unprotect branches' }
        };
      }

      const branch = decodeURIComponent(params.branch);
      const protectedBranches = (
        (repo.protectedBranches ?? []) as string[]
      ).filter((b: string) => b !== branch);
      await db.updateRepo(params.name, { protectedBranches });
      installPreReceiveHook(repoManager.getRepoPath(params.name));
      writeProtectedBranches(
        repoManager.getRepoPath(params.name),
        protectedBranches
      );

      return { status: 200, body: { branches: protectedBranches } };
    }
  };
};

// PATCH /repos/:name - Update repo (rename)
const updateRepo = (input: RepoRouteInput) => {
  const { db, repoManager } = input;

  return {
    method: 'PATCH',
    pattern: /^\/repos\/(?<name>[^/]+)\/?$/,
    handler: async (
      req: HttpRequest,
      params: Record<string, string>
    ): Promise<HttpResponse> => {
      // Require repo:write permission
      if (!hasPermission(req, 'repo:write')) {
        return FORBIDDEN;
      }

      const body = req.body as UpdateRepoRequest;

      const repo = await db.getRepo(params.name);
      if (!repo) {
        return { status: 404, body: { error: 'Repository not found' } };
      }

      // Check ownership - only owner or admin can update
      const tokenId = getTokenId(req);
      const isOwner = repo.ownerTokenId === tokenId;
      const isAdmin = hasPermission(req, 'admin');

      if (!isOwner && !isAdmin) {
        return {
          status: 403,
          body: { error: 'Only the repository owner can update it' }
        };
      }

      if (body.name) {
        // Validate new name
        if (!isValidRepoName(body.name)) {
          return {
            status: 400,
            body: {
              error:
                'Name must be alphanumeric with hyphens and underscores only'
            }
          };
        }

        // Check if new name is taken
        const existing = await db.getRepo(body.name);
        if (existing) {
          return {
            status: 409,
            body: { error: 'A repository with that name already exists' }
          };
        }

        try {
          // Rename git repo
          const newPath = await repoManager.rename(params.name, body.name);

          // Update database
          await db.updateRepo(params.name, {
            name: body.name,
            path: newPath
          });

          const updated = await db.getRepo(body.name);
          return { status: 200, body: updated };
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          return { status: 500, body: { error: message } };
        }
      }

      return { status: 200, body: repo };
    }
  };
};

// DELETE /repos/:name - Delete repo
const deleteRepo = (input: RepoRouteInput) => {
  const { db, repoManager } = input;

  return {
    method: 'DELETE',
    pattern: /^\/repos\/(?<name>[^/]+)\/?$/,
    handler: async (
      req: HttpRequest,
      params: Record<string, string>
    ): Promise<HttpResponse> => {
      // Require repo:delete permission
      if (!hasPermission(req, 'repo:delete')) {
        return FORBIDDEN;
      }

      const repo = await db.getRepo(params.name);

      if (!repo) {
        return { status: 404, body: { error: 'Repository not found' } };
      }

      // Check ownership - only owner or admin can delete
      const tokenId = getTokenId(req);
      const isOwner = repo.ownerTokenId === tokenId;
      const isAdmin = hasPermission(req, 'admin');

      if (!isOwner && !isAdmin) {
        return {
          status: 403,
          body: { error: 'Only the repository owner can delete it' }
        };
      }

      try {
        // Delete git repo
        await repoManager.delete(params.name);

        // Delete from database
        await db.deleteRepo(params.name);

        return { status: 204 };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return { status: 500, body: { error: message } };
      }
    }
  };
};

function isValidBranchPattern(branch: string): boolean {
  return (
    branch.length > 0 &&
    branch.length <= 255 &&
    !branch.startsWith('-') &&
    !branch.includes('..') &&
    !hasUnsafeBranchChars(branch) &&
    !branch.endsWith('/') &&
    !branch.endsWith('.lock')
  );
}

function hasUnsafeBranchChars(branch: string): boolean {
  for (const char of branch) {
    const code = char.charCodeAt(0);
    if (
      code < 32 ||
      code === 127 ||
      /\s/.test(char) ||
      ['~', '^', ':', '?', '*', '[', ']', '\\'].includes(char)
    ) {
      return true;
    }
  }
  return false;
}

function isValidRepoName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

function deriveRepoName(source: string): string | undefined {
  let raw = source.trim();
  if (!raw) return undefined;

  try {
    const url = new URL(raw);
    raw = url.pathname;
  } catch {
    const scpLike = raw.match(/^[^@]+@[^:]+:(?<path>.+)$/);
    if (scpLike?.groups?.path) {
      raw = scpLike.groups.path;
    }
  }

  const last = raw.replace(/\/+$/u, '').split('/').pop();
  if (!last) return undefined;

  return last.replace(/\.git$/u, '');
}
