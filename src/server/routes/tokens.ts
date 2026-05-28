import type {
  Route,
  HttpRequest,
  HttpResponse,
  TokenPermission
} from '../../shared/types.js';

import type { Database } from '../db/index.js';
import type { HttpRequestWithAuth } from '../http-server.js';

export function createTokenRoutes(db: Database): Route[] {
  return [listTokens(db), createToken(db), deleteToken(db)];
}

// GET /tokens - List all tokens (admin only)
const listTokens = (db: Database): Route => ({
  method: 'GET',
  pattern: /^\/tokens\/?$/,
  handler: async (req: HttpRequest): Promise<HttpResponse> => {
    const authReq = req as HttpRequestWithAuth;

    // Require admin permission
    if (!authReq.tokenInfo?.permissions.includes('admin')) {
      return { status: 403, body: { error: 'Admin permission required' } };
    }

    const tokens = await db.listApiTokens();
    return { status: 200, body: tokens };
  }
});

// POST /tokens - Create a new token (admin only)
const createToken = (db: Database): Route => ({
  method: 'POST',
  pattern: /^\/tokens\/?$/,
  handler: async (req: HttpRequest): Promise<HttpResponse> => {
    const authReq = req as HttpRequestWithAuth;

    // Require admin permission
    if (!authReq.tokenInfo?.permissions.includes('admin')) {
      return { status: 403, body: { error: 'Admin permission required' } };
    }

    const body = req.body as {
      name?: string;
      permissions?: TokenPermission[];
      expiresInDays?: number;
      username?: string;
    };

    if (!body?.name) {
      return { status: 400, body: { error: 'Token name is required' } };
    }

    const permissions = body.permissions || ['repo:read', 'repo:write'];

    // Validate permissions
    const validPermissions: TokenPermission[] = [
      'repo:read',
      'repo:write',
      'repo:delete',
      'collaborator:read',
      'collaborator:write',
      'workflow:read',
      'workflow:trigger',
      'secrets:read',
      'secrets:write',
      'webhook:read',
      'webhook:write',
      'admin'
    ];

    for (const perm of permissions) {
      if (!validPermissions.includes(perm)) {
        return { status: 400, body: { error: `Invalid permission: ${perm}` } };
      }
    }

    // Validate expiration
    if (body.expiresInDays !== undefined) {
      if (body.expiresInDays < 1 || body.expiresInDays > 365) {
        return {
          status: 400,
          body: { error: 'expiresInDays must be between 1 and 365' }
        };
      }
    }

    // If username provided, verify the collaborator exists
    if (body.username) {
      const collaborator = await db.getCollaborator(body.username);
      if (!collaborator) {
        return {
          status: 400,
          body: { error: `Collaborator '${body.username}' not found` }
        };
      }
    }

    const { token, id, expiresAt } = await db.createApiToken(
      body.name,
      permissions,
      body.expiresInDays,
      body.username
    );

    return {
      status: 201,
      body: {
        id,
        name: body.name,
        token, // Only shown once!
        permissions,
        expiresAt,
        username: body.username,
        message: 'Save this token - it will not be shown again'
      }
    };
  }
});

// DELETE /tokens/:id - Delete a token (admin only)
const deleteToken = (db: Database): Route => ({
  method: 'DELETE',
  pattern: /^\/tokens\/(?<id>[^/]+)\/?$/,
  handler: async (
    req: HttpRequest,
    params: Record<string, string>
  ): Promise<HttpResponse> => {
    const authReq = req as HttpRequestWithAuth;

    // Require admin permission
    if (!authReq.tokenInfo?.permissions.includes('admin')) {
      return { status: 403, body: { error: 'Admin permission required' } };
    }

    // Prevent deleting your own token
    if (authReq.tokenInfo?.id === params.id) {
      return { status: 400, body: { error: 'Cannot delete your own token' } };
    }

    await db.deleteApiToken(params.id);
    return { status: 204 };
  }
});
