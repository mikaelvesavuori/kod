/** biome-ignore-all lint/style/noNonNullAssertion: OK */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createWebhookRoutes } from '../../src/server/routes/webhooks.js';
import { Database } from '../../src/server/db/index.js';
import type { HttpRequest } from '../../src/shared/types.js';

function createRequest(
  method: string,
  url: string,
  body?: unknown,
  permissions: string[] = ['admin'],
  id = 'owner-token'
): HttpRequest {
  const req: any = {
    method,
    url,
    headers: {},
    body
  };
  req.tokenInfo = {
    id,
    tokenHash: 'hash',
    name: 'test-token',
    createdAt: Date.now(),
    permissions
  };
  return req;
}

describe('Webhook Routes', () => {
  let db: Database;
  let tempDir: string;
  let routes: ReturnType<typeof createWebhookRoutes>;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'kod-webhook-routes-test-'));
    db = new Database(tempDir);
    routes = createWebhookRoutes(db);

    await db.createRepo({
      name: 'my-app',
      createdAt: Date.now(),
      path: '/repos/my-app.git',
      ownerTokenId: 'owner-token'
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

  test('It should create and list a webhook without returning the secret', async () => {
    const createRoute = findRoute('POST', '/repos/my-app/webhooks');
    const createReq = createRequest('POST', '/repos/my-app/webhooks', {
      url: 'https://example.com/hook',
      events: ['push', 'workflow'],
      secret: 'top-secret'
    });
    const createRes = await createRoute.handler(
      createReq,
      extractParams(createRoute, '/repos/my-app/webhooks')
    );

    expect(createRes.status).toBe(201);
    expect(createRes.body).not.toHaveProperty('secret');

    const listRoute = findRoute('GET', '/repos/my-app/webhooks');
    const listReq = createRequest('GET', '/repos/my-app/webhooks');
    const listRes = await listRoute.handler(
      listReq,
      extractParams(listRoute, '/repos/my-app/webhooks')
    );

    expect(listRes.status).toBe(200);
    expect(listRes.body as any[]).toHaveLength(1);
    expect((listRes.body as any[])[0].events).toEqual(['push', 'workflow']);
  });

  test('It should reject invalid webhook URLs', async () => {
    const route = findRoute('POST', '/repos/my-app/webhooks');
    const req = createRequest('POST', '/repos/my-app/webhooks', {
      url: 'ftp://example.com/hook'
    });
    const res = await route.handler(
      req,
      extractParams(route, '/repos/my-app/webhooks')
    );

    expect(res.status).toBe(400);
  });

  test('It should require owner or admin access', async () => {
    const route = findRoute('GET', '/repos/my-app/webhooks');
    const req = createRequest(
      'GET',
      '/repos/my-app/webhooks',
      undefined,
      ['webhook:read'],
      'other-token'
    );
    const res = await route.handler(
      req,
      extractParams(route, '/repos/my-app/webhooks')
    );

    expect(res.status).toBe(403);
  });

  test('It should list webhook deliveries', async () => {
    const webhook = await db.createRepoWebhook('my-app', 'https://example.com', [
      'push'
    ]);
    await db.createWebhookDelivery({
      webhookId: webhook.id,
      repoName: 'my-app',
      event: 'push',
      url: webhook.url,
      payload: { branch: 'main' },
      maxAttempts: 4
    });

    const url = `/repos/my-app/webhooks/${webhook.id}/deliveries`;
    const route = findRoute('GET', url);
    const res = await route.handler(
      createRequest('GET', url),
      extractParams(route, url)
    );

    expect(res.status).toBe(200);
    expect(res.body as any[]).toHaveLength(1);
  });
});
