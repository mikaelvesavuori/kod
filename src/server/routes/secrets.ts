import type { Route, HttpRequest, HttpResponse } from '../../shared/types.js';

import type { Database } from '../db/index.js';
import { hasPermission, FORBIDDEN } from '../auth.js';
import { hasRepoAccess } from '../access.js';
import { hasEncryptionKey } from '../../shared/crypto.js';

export function createSecretRoutes(db: Database): Route[] {
  return [listSecrets(db), setSecret(db), deleteSecret(db)];
}

// GET /repos/:name/secrets - List secret names (no values)
const listSecrets = (db: Database): Route => ({
  method: 'GET',
  pattern: /^\/repos\/(?<name>[^/]+)\/secrets\/?$/,
  handler: async (req: HttpRequest, params): Promise<HttpResponse> => {
    if (!hasPermission(req, 'secrets:read')) {
      return FORBIDDEN;
    }

    const repo = await db.getRepo(params.name);
    if (!repo) {
      return { status: 404, body: { error: 'Repository not found' } };
    }

    if (
      !(await hasRepoAccess(req, db, repo, {
        permission: 'secrets:read',
        allowCollaborator: true
      }))
    ) {
      return FORBIDDEN;
    }

    const secrets = await db.getRepoSecrets(params.name);
    return { status: 200, body: secrets };
  }
});

// PUT /repos/:name/secrets/:secretName - Create or update a secret
const setSecret = (db: Database): Route => ({
  method: 'PUT',
  pattern: /^\/repos\/(?<name>[^/]+)\/secrets\/(?<secretName>[^/]+)\/?$/,
  handler: async (req: HttpRequest, params): Promise<HttpResponse> => {
    if (!hasPermission(req, 'secrets:write')) {
      return FORBIDDEN;
    }

    if (!hasEncryptionKey()) {
      return {
        status: 500,
        body: {
          error:
            'No encryption key configured. Set KOD_ENCRYPTION_KEY or use --encryption-key.'
        }
      };
    }

    const repo = await db.getRepo(params.name);
    if (!repo) {
      return { status: 404, body: { error: 'Repository not found' } };
    }

    if (
      !(await hasRepoAccess(req, db, repo, {
        permission: 'secrets:write',
        allowCollaborator: true
      }))
    ) {
      return FORBIDDEN;
    }

    const body = req.body as { value?: string };
    if (!body?.value || typeof body.value !== 'string') {
      return { status: 400, body: { error: 'Secret value is required' } };
    }

    const secretName = params.secretName;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(secretName)) {
      return {
        status: 400,
        body: {
          error:
            'Secret name must be a valid environment variable name (letters, digits, underscores)'
        }
      };
    }

    await db.setSecret(params.name, secretName, body.value);

    return {
      status: 200,
      body: { name: secretName, repoName: params.name, message: 'Secret saved' }
    };
  }
});

// DELETE /repos/:name/secrets/:secretName - Delete a secret
const deleteSecret = (db: Database): Route => ({
  method: 'DELETE',
  pattern: /^\/repos\/(?<name>[^/]+)\/secrets\/(?<secretName>[^/]+)\/?$/,
  handler: async (req: HttpRequest, params): Promise<HttpResponse> => {
    if (!hasPermission(req, 'secrets:write')) {
      return FORBIDDEN;
    }

    const repo = await db.getRepo(params.name);
    if (!repo) {
      return { status: 404, body: { error: 'Repository not found' } };
    }

    if (
      !(await hasRepoAccess(req, db, repo, {
        permission: 'secrets:write',
        allowCollaborator: true
      }))
    ) {
      return FORBIDDEN;
    }

    await db.deleteSecret(params.name, params.secretName);
    return { status: 204 };
  }
});
