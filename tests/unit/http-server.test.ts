import { describe, test, expect, afterEach } from 'vitest';

import { createHttpServer } from '../../src/server/http-server.js';
import type { Route, ApiToken } from '../../src/shared/types.js';

function makeToken(overrides: Partial<ApiToken> = {}): ApiToken {
  return {
    id: 'token-id',
    tokenHash: 'hash',
    name: 'test-token',
    createdAt: Date.now(),
    permissions: ['admin'],
    ...overrides
  };
}

async function request(
  server: ReturnType<typeof createHttpServer>,
  method: string,
  path: string,
  options: {
    body?: unknown;
    headers?: Record<string, string>;
  } = {}
): Promise<{ status: number; body: any; headers: Record<string, string> }> {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No address');

  const url = `http://127.0.0.1:${address.port}${path}`;
  const fetchOptions: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  };

  if (options.body) {
    fetchOptions.body = JSON.stringify(options.body);
  }

  const res = await fetch(url, fetchOptions);
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  const resHeaders: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    resHeaders[key] = value;
  });

  return { status: res.status, body, headers: resHeaders };
}

describe('HTTP Server', () => {
  let server: ReturnType<typeof createHttpServer>;

  afterEach(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  function createTestServer(
    routes: Route[] = [],
    validator: (token: string) => ApiToken | undefined = () => makeToken()
  ) {
    server = createHttpServer(routes, validator);
    return new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
  }

  describe('Health check', () => {
    test('It should respond to /health without auth', async () => {
      await createTestServer();

      const res = await request(server, 'GET', '/health');

      // Health endpoint has no route defined, so it returns 404
      // but the important thing is it doesn't return 401
      expect(res.status).not.toBe(401);
    });
  });

  describe('Authentication', () => {
    test('It should return 401 for requests without auth', async () => {
      const routes: Route[] = [
        {
          method: 'GET',
          pattern: /^\/test\/?$/,
          handler: async () => ({ status: 200, body: { ok: true } })
        }
      ];

      await createTestServer(routes);

      const res = await request(server, 'GET', '/test');

      expect(res.status).toBe(401);
    });

    test('It should accept Bearer token auth', async () => {
      const routes: Route[] = [
        {
          method: 'GET',
          pattern: /^\/test\/?$/,
          handler: async () => ({ status: 200, body: { ok: true } })
        }
      ];

      await createTestServer(routes, (token) =>
        token === 'valid-token' ? makeToken() : undefined
      );

      const res = await request(server, 'GET', '/test', {
        headers: { Authorization: 'Bearer valid-token' }
      });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    test('It should reject invalid Bearer token', async () => {
      const routes: Route[] = [
        {
          method: 'GET',
          pattern: /^\/test\/?$/,
          handler: async () => ({ status: 200, body: { ok: true } })
        }
      ];

      await createTestServer(routes, () => undefined);

      const res = await request(server, 'GET', '/test', {
        headers: { Authorization: 'Bearer invalid-token' }
      });

      expect(res.status).toBe(401);
    });

    test('It should accept Basic auth (git client style)', async () => {
      const routes: Route[] = [
        {
          method: 'GET',
          pattern: /^\/test\/?$/,
          handler: async () => ({ status: 200, body: { ok: true } })
        }
      ];

      const basicAuth = Buffer.from('user:valid-token').toString('base64');

      await createTestServer(routes, (token) =>
        token === 'valid-token' ? makeToken() : undefined
      );

      const res = await request(server, 'GET', '/test', {
        headers: { Authorization: `Basic ${basicAuth}` }
      });

      expect(res.status).toBe(200);
    });
  });

  describe('Routing', () => {
    test('It should return 404 for unmatched routes', async () => {
      await createTestServer([], () => makeToken());

      const res = await request(server, 'GET', '/nonexistent', {
        headers: { Authorization: 'Bearer token' }
      });

      expect(res.status).toBe(404);
    });

    test('It should match routes and extract named params', async () => {
      const routes: Route[] = [
        {
          method: 'GET',
          pattern: /^\/repos\/(?<name>[^/]+)\/?$/,
          handler: async (_req, params) => ({
            status: 200,
            body: { repoName: params.name }
          })
        }
      ];

      await createTestServer(routes);

      const res = await request(server, 'GET', '/repos/my-app', {
        headers: { Authorization: 'Bearer token' }
      });

      expect(res.status).toBe(200);
      expect(res.body.repoName).toBe('my-app');
    });

    test('It should handle OPTIONS preflight requests', async () => {
      await createTestServer();

      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No address');
      const url = `http://127.0.0.1:${(address as any).port}/test`;

      const res = await fetch(url, { method: 'OPTIONS' });

      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(res.headers.get('access-control-allow-methods')).toContain('GET');
    });

    test('It should return 500 when route handler throws', async () => {
      const routes: Route[] = [
        {
          method: 'GET',
          pattern: /^\/error\/?$/,
          handler: async () => {
            throw new Error('Unexpected error');
          }
        }
      ];

      await createTestServer(routes);

      const res = await request(server, 'GET', '/error', {
        headers: { Authorization: 'Bearer token' }
      });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal server error');
    });
  });

  describe('Response handling', () => {
    test('It should set Content-Type to JSON by default', async () => {
      const routes: Route[] = [
        {
          method: 'GET',
          pattern: /^\/json\/?$/,
          handler: async () => ({ status: 200, body: { data: 'test' } })
        }
      ];

      await createTestServer(routes);

      const res = await request(server, 'GET', '/json', {
        headers: { Authorization: 'Bearer token' }
      });

      expect(res.headers['content-type']).toContain('application/json');
    });

    test('It should support custom response headers', async () => {
      const routes: Route[] = [
        {
          method: 'GET',
          pattern: /^\/custom\/?$/,
          handler: async () => ({
            status: 200,
            body: 'plain text',
            headers: { 'Content-Type': 'text/plain' }
          })
        }
      ];

      await createTestServer(routes);

      const res = await request(server, 'GET', '/custom', {
        headers: { Authorization: 'Bearer token' }
      });

      expect(res.headers['content-type']).toContain('text/plain');
    });

    test('It should handle empty body (204 responses)', async () => {
      const routes: Route[] = [
        {
          method: 'DELETE',
          pattern: /^\/resource\/?$/,
          handler: async () => ({ status: 204 })
        }
      ];

      await createTestServer(routes);

      const res = await request(server, 'DELETE', '/resource', {
        headers: { Authorization: 'Bearer token' }
      });

      expect(res.status).toBe(204);
    });
  });
});
