/** biome-ignore-all lint/style/noNonNullAssertion: OK */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createSecretRoutes } from '../../src/server/routes/secrets.js';
import { Database } from '../../src/server/db/index.js';
import { setEncryptionKey } from '../../src/shared/crypto.js';
import type { HttpRequest } from '../../src/shared/types.js';

function createRequest(
  method: string,
  url: string,
  body?: unknown,
  permissions: string[] = ['admin']
): HttpRequest {
  const req: any = {
    method,
    url,
    headers: {},
    body
  };
  req.tokenInfo = {
    id: 'token-id',
    tokenHash: 'hash',
    name: 'test-token',
    createdAt: Date.now(),
    permissions
  };
  return req;
}

describe('Secret Routes', () => {
  let db: Database;
  let tempDir: string;
  let routes: ReturnType<typeof createSecretRoutes>;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'kod-secret-routes-test-'));
    db = new Database(tempDir);
    routes = createSecretRoutes(db);
    setEncryptionKey('test-encryption-key');

    // Create a repo for tests
    await db.createRepo({
      name: 'my-app',
      createdAt: Date.now(),
      path: '/repos/my-app.git',
      ownerTokenId: 'token-id'
    });
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

  describe('GET /repos/:name/secrets', () => {
    test('It should list secrets for a repo', async () => {
      await db.setSecret('my-app', 'API_KEY', 'secret-val');
      await db.setSecret('my-app', 'DB_PASS', 'db-secret');

      const route = findRoute('GET', '/repos/my-app/secrets');
      const req = createRequest('GET', '/repos/my-app/secrets');
      const params = extractParams(route, '/repos/my-app/secrets');
      const res = await route.handler(req, params);

      expect(res.status).toBe(200);
      const body = res.body as any[];
      expect(body).toHaveLength(2);
      expect(body.map((s: any) => s.name)).toContain('API_KEY');
      expect(body.map((s: any) => s.name)).toContain('DB_PASS');
    });

    test('It should return 404 for non-existent repo', async () => {
      const route = findRoute('GET', '/repos/nonexistent/secrets');
      const req = createRequest('GET', '/repos/nonexistent/secrets');
      const params = extractParams(route, '/repos/nonexistent/secrets');
      const res = await route.handler(req, params);

      expect(res.status).toBe(404);
    });

    test('It should return 403 without secrets:read permission', async () => {
      const route = findRoute('GET', '/repos/my-app/secrets');
      const req = createRequest('GET', '/repos/my-app/secrets', undefined, [
        'repo:read'
      ]);
      const params = extractParams(route, '/repos/my-app/secrets');
      const res = await route.handler(req, params);

      expect(res.status).toBe(403);
    });
  });

  describe('PUT /repos/:name/secrets/:secretName', () => {
    test('It should create a secret', async () => {
      const route = findRoute('PUT', '/repos/my-app/secrets/API_KEY');
      const req = createRequest('PUT', '/repos/my-app/secrets/API_KEY', {
        value: 'my-secret'
      });
      const params = extractParams(route, '/repos/my-app/secrets/API_KEY');
      const res = await route.handler(req, params);

      expect(res.status).toBe(200);
      const body = res.body as any;
      expect(body.name).toBe('API_KEY');
      expect(body.message).toBe('Secret saved');

      // Verify it was stored
      const value = await db.getSecretValue('my-app', 'API_KEY');
      expect(value).toBe('my-secret');
    });

    test('It should return 400 for missing value', async () => {
      const route = findRoute('PUT', '/repos/my-app/secrets/API_KEY');
      const req = createRequest('PUT', '/repos/my-app/secrets/API_KEY', {});
      const params = extractParams(route, '/repos/my-app/secrets/API_KEY');
      const res = await route.handler(req, params);

      expect(res.status).toBe(400);
      expect((res.body as any).error).toContain('value is required');
    });

    test('It should return 400 for invalid secret name', async () => {
      const route = findRoute('PUT', '/repos/my-app/secrets/invalid-name');
      const req = createRequest('PUT', '/repos/my-app/secrets/invalid-name', {
        value: 'val'
      });
      const params = extractParams(route, '/repos/my-app/secrets/invalid-name');
      const res = await route.handler(req, params);

      expect(res.status).toBe(400);
      expect((res.body as any).error).toContain('valid environment variable name');
    });

    test('It should accept valid env var names', async () => {
      const route = findRoute('PUT', '/repos/my-app/secrets/MY_VAR_123');
      const req = createRequest('PUT', '/repos/my-app/secrets/MY_VAR_123', {
        value: 'val'
      });
      const params = extractParams(route, '/repos/my-app/secrets/MY_VAR_123');
      const res = await route.handler(req, params);

      expect(res.status).toBe(200);
    });

    test('It should return 404 for non-existent repo', async () => {
      const route = findRoute('PUT', '/repos/nonexistent/secrets/KEY');
      const req = createRequest('PUT', '/repos/nonexistent/secrets/KEY', {
        value: 'val'
      });
      const params = extractParams(route, '/repos/nonexistent/secrets/KEY');
      const res = await route.handler(req, params);

      expect(res.status).toBe(404);
    });

    test('It should return 403 without secrets:write permission', async () => {
      const route = findRoute('PUT', '/repos/my-app/secrets/KEY');
      const req = createRequest(
        'PUT',
        '/repos/my-app/secrets/KEY',
        { value: 'val' },
        ['secrets:read']
      );
      const params = extractParams(route, '/repos/my-app/secrets/KEY');
      const res = await route.handler(req, params);

      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /repos/:name/secrets/:secretName', () => {
    test('It should delete a secret', async () => {
      await db.setSecret('my-app', 'TO_DELETE', 'value');

      const route = findRoute('DELETE', '/repos/my-app/secrets/TO_DELETE');
      const req = createRequest('DELETE', '/repos/my-app/secrets/TO_DELETE');
      const params = extractParams(route, '/repos/my-app/secrets/TO_DELETE');
      const res = await route.handler(req, params);

      expect(res.status).toBe(204);

      const value = await db.getSecretValue('my-app', 'TO_DELETE');
      expect(value).toBeUndefined();
    });

    test('It should return 404 for non-existent repo', async () => {
      const route = findRoute('DELETE', '/repos/nonexistent/secrets/KEY');
      const req = createRequest('DELETE', '/repos/nonexistent/secrets/KEY');
      const params = extractParams(route, '/repos/nonexistent/secrets/KEY');
      const res = await route.handler(req, params);

      expect(res.status).toBe(404);
    });

    test('It should return 403 without secrets:write permission', async () => {
      const route = findRoute('DELETE', '/repos/my-app/secrets/KEY');
      const req = createRequest(
        'DELETE',
        '/repos/my-app/secrets/KEY',
        undefined,
        ['secrets:read']
      );
      const params = extractParams(route, '/repos/my-app/secrets/KEY');
      const res = await route.handler(req, params);

      expect(res.status).toBe(403);
    });
  });
});
