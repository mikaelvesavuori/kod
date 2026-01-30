/** biome-ignore-all lint/style/noNonNullAssertion: OK */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createTokenRoutes } from '../../src/server/routes/tokens.js';
import { Database } from '../../src/server/db/index.js';
import type { HttpRequest } from '../../src/shared/types.js';

function createRequest(
  method: string,
  url: string,
  body?: unknown,
  tokenInfo?: {
    id?: string;
    permissions?: string[];
  } | null
): HttpRequest {
  const req: any = {
    method,
    url,
    headers: {},
    body
  };

  if (tokenInfo !== null) {
    req.tokenInfo = {
      id: tokenInfo?.id ?? 'admin-token-id',
      tokenHash: 'hash',
      name: 'admin',
      createdAt: Date.now(),
      permissions: tokenInfo?.permissions ?? ['admin']
    };
  }

  return req;
}

describe('Token Routes', () => {
  let db: Database;
  let tempDir: string;
  let routes: ReturnType<typeof createTokenRoutes>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'kod-token-routes-test-'));
    db = new Database(tempDir);
    routes = createTokenRoutes(db);
  });

  afterEach(async () => {
    await db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  function findRoute(method: string, url: string) {
    return routes.find(
      (r) => r.method === method && r.pattern.test(url)
    )!;
  }

  function extractParams(route: (typeof routes)[0], url: string) {
    const match = url.match(route.pattern);
    const params: Record<string, string> = {};
    if (match?.groups) {
      for (const [key, value] of Object.entries(match.groups)) {
        params[key] = value;
      }
    }
    return params;
  }

  describe('GET /tokens', () => {
    test('It should list tokens for admin', async () => {
      await db.createApiToken('token-1', ['repo:read']);
      await db.createApiToken('token-2', ['repo:write']);

      const route = findRoute('GET', '/tokens');
      const req = createRequest('GET', '/tokens');
      const params = extractParams(route, '/tokens');
      const res = await route.handler(req, params);

      expect(res.status).toBe(200);
      const body = res.body as any[];
      expect(body).toHaveLength(2);
    });

    test('It should return 403 for non-admin', async () => {
      const route = findRoute('GET', '/tokens');
      const req = createRequest('GET', '/tokens', undefined, {
        permissions: ['repo:read']
      });
      const params = extractParams(route, '/tokens');
      const res = await route.handler(req, params);

      expect(res.status).toBe(403);
    });
  });

  describe('POST /tokens', () => {
    test('It should create a token with default permissions', async () => {
      const route = findRoute('POST', '/tokens');
      const req = createRequest('POST', '/tokens', { name: 'new-token' });
      const params = extractParams(route, '/tokens');
      const res = await route.handler(req, params);

      expect(res.status).toBe(201);
      const body = res.body as any;
      expect(body.name).toBe('new-token');
      expect(body.token).toMatch(/^kod_/);
      expect(body.permissions).toEqual(['repo:read', 'repo:write']);
    });

    test('It should create a token with custom permissions', async () => {
      const route = findRoute('POST', '/tokens');
      const req = createRequest('POST', '/tokens', {
        name: 'ci-token',
        permissions: ['repo:read', 'workflow:trigger']
      });
      const params = extractParams(route, '/tokens');
      const res = await route.handler(req, params);

      expect(res.status).toBe(201);
      const body = res.body as any;
      expect(body.permissions).toEqual(['repo:read', 'workflow:trigger']);
    });

    test('It should create a token with expiration', async () => {
      const route = findRoute('POST', '/tokens');
      const req = createRequest('POST', '/tokens', {
        name: 'temp-token',
        expiresInDays: 30
      });
      const params = extractParams(route, '/tokens');
      const res = await route.handler(req, params);

      expect(res.status).toBe(201);
      const body = res.body as any;
      expect(body.expiresAt).toBeDefined();
    });

    test('It should reject invalid expiration', async () => {
      const route = findRoute('POST', '/tokens');
      const req = createRequest('POST', '/tokens', {
        name: 'bad-token',
        expiresInDays: 500
      });
      const params = extractParams(route, '/tokens');
      const res = await route.handler(req, params);

      expect(res.status).toBe(400);
      expect((res.body as any).error).toContain('expiresInDays');
    });

    test('It should reject invalid permissions', async () => {
      const route = findRoute('POST', '/tokens');
      const req = createRequest('POST', '/tokens', {
        name: 'bad-perm',
        permissions: ['invalid:perm']
      });
      const params = extractParams(route, '/tokens');
      const res = await route.handler(req, params);

      expect(res.status).toBe(400);
      expect((res.body as any).error).toContain('Invalid permission');
    });

    test('It should return 400 when name is missing', async () => {
      const route = findRoute('POST', '/tokens');
      const req = createRequest('POST', '/tokens', {});
      const params = extractParams(route, '/tokens');
      const res = await route.handler(req, params);

      expect(res.status).toBe(400);
      expect((res.body as any).error).toContain('name is required');
    });

    test('It should return 403 for non-admin', async () => {
      const route = findRoute('POST', '/tokens');
      const req = createRequest('POST', '/tokens', { name: 'test' }, {
        permissions: ['repo:read']
      });
      const params = extractParams(route, '/tokens');
      const res = await route.handler(req, params);

      expect(res.status).toBe(403);
    });

    test('It should create token with username when collaborator exists', async () => {
      await db.createCollaborator({ username: 'alice', addedAt: Date.now() });

      const route = findRoute('POST', '/tokens');
      const req = createRequest('POST', '/tokens', {
        name: 'alice-token',
        username: 'alice'
      });
      const params = extractParams(route, '/tokens');
      const res = await route.handler(req, params);

      expect(res.status).toBe(201);
      expect((res.body as any).username).toBe('alice');
    });

    test('It should reject username when collaborator does not exist', async () => {
      const route = findRoute('POST', '/tokens');
      const req = createRequest('POST', '/tokens', {
        name: 'ghost-token',
        username: 'nonexistent'
      });
      const params = extractParams(route, '/tokens');
      const res = await route.handler(req, params);

      expect(res.status).toBe(400);
      expect((res.body as any).error).toContain('not found');
    });
  });

  describe('DELETE /tokens/:id', () => {
    test('It should delete a token', async () => {
      const { id } = await db.createApiToken('to-delete', ['repo:read']);

      const route = findRoute('DELETE', `/tokens/${id}`);
      const req = createRequest('DELETE', `/tokens/${id}`);
      const params = extractParams(route, `/tokens/${id}`);
      const res = await route.handler(req, params);

      expect(res.status).toBe(204);
    });

    test('It should prevent deleting own token', async () => {
      const route = findRoute('DELETE', '/tokens/admin-token-id');
      const req = createRequest('DELETE', '/tokens/admin-token-id');
      const params = extractParams(route, '/tokens/admin-token-id');
      const res = await route.handler(req, params);

      expect(res.status).toBe(400);
      expect((res.body as any).error).toContain('Cannot delete your own token');
    });

    test('It should return 403 for non-admin', async () => {
      const route = findRoute('DELETE', '/tokens/some-id');
      const req = createRequest('DELETE', '/tokens/some-id', undefined, {
        permissions: ['repo:read']
      });
      const params = extractParams(route, '/tokens/some-id');
      const res = await route.handler(req, params);

      expect(res.status).toBe(403);
    });
  });
});
