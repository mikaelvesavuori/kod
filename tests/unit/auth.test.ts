import { describe, test, expect } from 'vitest';

import {
  hasPermission,
  hasAnyPermission,
  getTokenId,
  getTokenName,
  FORBIDDEN
} from '../../src/server/auth.js';

import type { HttpRequest } from '../../src/shared/types.js';

function createRequest(
  tokenInfo?: {
    id?: string;
    name?: string;
    permissions?: string[];
  } | null
): HttpRequest {
  const req: any = {
    method: 'GET',
    url: '/test',
    headers: {},
    body: undefined
  };

  if (tokenInfo !== null && tokenInfo !== undefined) {
    req.tokenInfo = {
      id: tokenInfo.id ?? 'token-id',
      tokenHash: 'hash',
      name: tokenInfo.name ?? 'test-token',
      createdAt: Date.now(),
      permissions: tokenInfo.permissions ?? []
    };
  }

  return req;
}

describe('Auth', () => {
  describe('hasPermission', () => {
    test('It should return false when no tokenInfo is present', () => {
      const req = createRequest(null);
      expect(hasPermission(req, 'repo:read')).toBe(false);
    });

    test('It should return false when token lacks the permission', () => {
      const req = createRequest({ permissions: ['repo:read'] });
      expect(hasPermission(req, 'repo:write')).toBe(false);
    });

    test('It should return true when token has the permission', () => {
      const req = createRequest({ permissions: ['repo:read', 'repo:write'] });
      expect(hasPermission(req, 'repo:write')).toBe(true);
    });

    test('It should return true for any permission when token is admin', () => {
      const req = createRequest({ permissions: ['admin'] });

      expect(hasPermission(req, 'repo:read')).toBe(true);
      expect(hasPermission(req, 'repo:write')).toBe(true);
      expect(hasPermission(req, 'secrets:write')).toBe(true);
      expect(hasPermission(req, 'workflow:trigger')).toBe(true);
    });
  });

  describe('hasAnyPermission', () => {
    test('It should return false when token has none of the permissions', () => {
      const req = createRequest({ permissions: ['collaborator:read'] });
      expect(hasAnyPermission(req, ['repo:read', 'repo:write'])).toBe(false);
    });

    test('It should return true when token has at least one permission', () => {
      const req = createRequest({ permissions: ['repo:read'] });
      expect(hasAnyPermission(req, ['repo:read', 'repo:write'])).toBe(true);
    });

    test('It should return true for admin token', () => {
      const req = createRequest({ permissions: ['admin'] });
      expect(hasAnyPermission(req, ['repo:read', 'secrets:write'])).toBe(true);
    });
  });

  describe('getTokenId', () => {
    test('It should return the token ID', () => {
      const req = createRequest({ id: 'my-token-id' });
      expect(getTokenId(req)).toBe('my-token-id');
    });

    test('It should return undefined when no tokenInfo', () => {
      const req = createRequest(null);
      expect(getTokenId(req)).toBeUndefined();
    });
  });

  describe('getTokenName', () => {
    test('It should return the token name', () => {
      const req = createRequest({ name: 'deploy-key' });
      expect(getTokenName(req)).toBe('deploy-key');
    });

    test('It should return undefined when no tokenInfo', () => {
      const req = createRequest(null);
      expect(getTokenName(req)).toBeUndefined();
    });
  });

  describe('FORBIDDEN', () => {
    test('It should have status 403 and error message', () => {
      expect(FORBIDDEN.status).toBe(403);
      expect(FORBIDDEN.body.error).toBe('Permission denied');
    });
  });
});
