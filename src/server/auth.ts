import type { HttpRequest, TokenPermission } from '../shared/types.js';

import type { HttpRequestWithAuth } from './http-server.js';

/**
 * Check if the request has the required permission.
 * Returns true if authorized, false otherwise.
 */
export function hasPermission(
  req: HttpRequest,
  permission: TokenPermission
): boolean {
  const authReq = req as HttpRequestWithAuth;
  const tokenInfo = authReq.tokenInfo;

  if (!tokenInfo) return false;

  // Admin has all permissions
  if (tokenInfo.permissions.includes('admin')) return true;

  return tokenInfo.permissions.includes(permission);
}

/**
 * Check if the request has any of the required permissions.
 */
export function hasAnyPermission(
  req: HttpRequest,
  permissions: TokenPermission[]
): boolean {
  return permissions.some((p) => hasPermission(req, p));
}

/**
 * Get the token ID from the request (for ownership checks).
 */
export function getTokenId(req: HttpRequest): string | undefined {
  const authReq = req as HttpRequestWithAuth;
  return authReq.tokenInfo?.id;
}

/**
 * Get the token name from the request.
 */
export function getTokenName(req: HttpRequest): string | undefined {
  const authReq = req as HttpRequestWithAuth;
  return authReq.tokenInfo?.name;
}

/**
 * Permission denied response.
 */
export const FORBIDDEN = {
  status: 403,
  body: { error: 'Permission denied' }
} as const;
