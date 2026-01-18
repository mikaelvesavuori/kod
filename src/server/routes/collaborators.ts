import type {
  Route,
  HttpRequest,
  HttpResponse,
  AddCollaboratorRequest,
  Collaborator
} from '../../shared/types.js';

import type { Database } from '../../db/index.js';
import type { SshKeyManager } from '../git/SSHKeys.js';
import { hasPermission, getTokenId, FORBIDDEN } from '../auth.js';

export function createCollaboratorRoutes(
  db: Database,
  sshKeyManager: SshKeyManager
): Route[] {
  const input = { db, sshKeyManager };
  return [
    listCollaborators(input),
    addCollaborator(input),
    removeCollaborator(input)
  ];
}

// GET /repos/:name/collaborators - List collaborators
const listCollaborators = (input: any) => {
  const { db } = input;

  return {
    method: 'GET',
    pattern: /^\/repos\/(?<name>[^/]+)\/collaborators\/?$/,
    handler: async (
      req: HttpRequest,
      params: Record<string, string>
    ): Promise<HttpResponse> => {
      // Require collaborator:read permission
      if (!hasPermission(req, 'collaborator:read')) {
        return FORBIDDEN;
      }

      const repo = await db.getRepo(params.name);

      if (!repo) {
        return { status: 404, body: { error: 'Repository not found' } };
      }

      // Only owner or admin can view collaborators
      const isOwner = repo.ownerTokenId === getTokenId(req);
      const isAdmin = hasPermission(req, 'admin');
      if (!isOwner && !isAdmin) {
        return FORBIDDEN;
      }

      const repoCollabs = await db.getRepoCollaborators(params.name);
      const usernames = repoCollabs?.collaborators || [];

      // Get full collaborator details
      const collaborators: Collaborator[] = [];
      for (const username of usernames) {
        const collab = await db.getCollaborator(username);
        if (collab) {
          collaborators.push(collab);
        }
      }

      return { status: 200, body: collaborators };
    }
  };
};

// POST /repos/:name/collaborators - Add collaborator
const addCollaborator = (input: any) => {
  const { db, sshKeyManager } = input;

  return {
    method: 'POST',
    pattern: /^\/repos\/(?<name>[^/]+)\/collaborators\/?$/,
    handler: async (
      req: HttpRequest,
      params: Record<string, string>
    ): Promise<HttpResponse> => {
      // Require collaborator:write permission
      if (!hasPermission(req, 'collaborator:write')) {
        return FORBIDDEN;
      }

      const body = req.body as AddCollaboratorRequest;

      if (!body?.username) {
        return { status: 400, body: { error: 'Username is required' } };
      }

      if (!body?.publicKey) {
        return { status: 400, body: { error: 'Public key is required' } };
      }

      // Validate username
      if (!/^[a-zA-Z0-9_-]+$/.test(body.username)) {
        return {
          status: 400,
          body: {
            error:
              'Username must be alphanumeric with hyphens and underscores only'
          }
        };
      }

      const repo = await db.getRepo(params.name);
      if (!repo) {
        return { status: 404, body: { error: 'Repository not found' } };
      }

      // Only owner or admin can add collaborators
      const isOwner = repo.ownerTokenId === getTokenId(req);
      const isAdmin = hasPermission(req, 'admin');
      if (!isOwner && !isAdmin) {
        return {
          status: 403,
          body: { error: 'Only the repository owner can add collaborators' }
        };
      }

      // Check if collaborator already exists
      const repoCollabs = await db.getRepoCollaborators(params.name);
      if (repoCollabs?.collaborators.includes(body.username)) {
        return {
          status: 409,
          body: { error: 'Collaborator already added to this repository' }
        };
      }

      // Create or update collaborator record
      const collaborator: Collaborator = {
        username: body.username,
        publicKey: body.publicKey,
        addedAt: Date.now()
      };
      await db.createCollaborator(collaborator);

      // Add to repo's collaborators list
      await db.addCollaboratorToRepo(params.name, body.username);

      // Regenerate SSH authorized_keys
      await sshKeyManager.regenerateAuthorizedKeys(db);

      return { status: 201, body: collaborator };
    }
  };
};

// DELETE /repos/:name/collaborators/:username - Remove collaborator
const removeCollaborator = (input: any) => {
  const { db, sshKeyManager } = input;

  return {
    method: 'DELETE',
    pattern: /^\/repos\/(?<name>[^/]+)\/collaborators\/(?<username>[^/]+)\/?$/,
    handler: async (
      req: HttpRequest,
      params: Record<string, string>
    ): Promise<HttpResponse> => {
      // Require collaborator:write permission
      if (!hasPermission(req, 'collaborator:write')) {
        return FORBIDDEN;
      }

      const repo = await db.getRepo(params.name);

      if (!repo) {
        return { status: 404, body: { error: 'Repository not found' } };
      }

      // Only owner or admin can remove collaborators
      const isOwner = repo.ownerTokenId === getTokenId(req);
      const isAdmin = hasPermission(req, 'admin');
      if (!isOwner && !isAdmin) {
        return {
          status: 403,
          body: {
            error: 'Only the repository owner can remove collaborators'
          }
        };
      }

      const repoCollabs = await db.getRepoCollaborators(params.name);
      if (!repoCollabs?.collaborators.includes(params.username)) {
        return {
          status: 404,
          body: { error: 'Collaborator not found in this repository' }
        };
      }

      // Remove from repo's collaborators list
      await db.removeCollaboratorFromRepo(params.name, params.username);

      // Regenerate SSH authorized_keys
      await sshKeyManager.regenerateAuthorizedKeys(db);

      return { status: 204 };
    }
  };
};
