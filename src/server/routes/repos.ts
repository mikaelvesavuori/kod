import type {
  Route,
  HttpRequest,
  HttpResponse,
  CreateRepoRequest,
  UpdateRepoRequest,
  Repo
} from '../../shared/types.js';

import type { Database } from '../../db/index.js';
import type { RepoManager } from '../git/RepoManager.js';
import { installPostReceiveHook } from '../git/hooks.js';
import { hasPermission, getTokenId, FORBIDDEN } from '../auth.js';

export function createRepoRoutes(
  db: Database,
  repoManager: RepoManager,
  serverUrl: string
): Route[] {
  const input = { db, repoManager, serverUrl };

  return [
    listRepos(input),
    createRepo(input),
    getRepoDetails(input),
    updateRepo(input),
    deleteRepo(input)
  ];
}

// GET /repos - List all repos
const listRepos = (input: any) => {
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
      return { status: 200, body: repos };
    }
  };
};

// POST /repos - Create repo
const createRepo = (input: any) => {
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
      if (!/^[a-zA-Z0-9_-]+$/.test(body.name)) {
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

        // Save to database with owner
        const repo: Repo = {
          name: body.name,
          createdAt: Date.now(),
          path: repoPath,
          ownerTokenId
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
const getRepoDetails = (input: any) => {
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
          defaultBranch
        }
      };
    }
  };
};

// PATCH /repos/:name - Update repo (rename)
const updateRepo = (input: any) => {
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
        if (!/^[a-zA-Z0-9_-]+$/.test(body.name)) {
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
const deleteRepo = (input: any) => {
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
