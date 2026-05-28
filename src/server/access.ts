import type { HttpRequest, Repo, TokenPermission } from '../shared/types.js';

import { hasPermission, getTokenId } from './auth.js';
import type { Database } from './db/index.js';
import type { HttpRequestWithAuth } from './http-server.js';

export interface RepoAccessOptions {
  permission?: TokenPermission;
  allowCollaborator?: boolean;
  allowSystemToken?: boolean;
}

export async function hasRepoAccess(
  req: HttpRequest,
  db: Database,
  repo: Repo,
  options: RepoAccessOptions = {}
): Promise<boolean> {
  const {
    permission,
    allowCollaborator = false,
    allowSystemToken = true
  } = options;

  if (permission && !hasPermission(req, permission)) {
    return false;
  }

  if (hasPermission(req, 'admin')) {
    return true;
  }

  const authReq = req as HttpRequestWithAuth;
  const tokenInfo = authReq.tokenInfo;
  if (!tokenInfo) return false;

  if (repo.ownerTokenId === getTokenId(req)) {
    return true;
  }

  if (allowCollaborator && tokenInfo.username) {
    const repoCollabs = await db.getRepoCollaborators(repo.name);
    if (repoCollabs?.collaborators.includes(tokenInfo.username)) {
      return true;
    }
  }

  // Unlinked tokens are treated as system tokens. They are useful for
  // automation and retain global access when they hold the needed permission.
  return allowSystemToken && !tokenInfo.username;
}

export async function canSeeRepo(
  req: HttpRequest,
  db: Database,
  repo: Repo
): Promise<boolean> {
  return hasRepoAccess(req, db, repo, {
    permission: 'repo:read',
    allowCollaborator: true
  });
}
