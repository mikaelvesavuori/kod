/** biome-ignore-all lint/suspicious/noExplicitAny: Test request helpers */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createKeyRoutes } from '../../src/server/routes/keys.js';
import { Database } from '../../src/server/db/index.js';
import type { HttpRequest } from '../../src/shared/types.js';

const PUBLIC_KEY =
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICmMr9L+hVR1q3kzYb6py2UUW+O2Jp8T6M4Q8ZLQF6nL alice@example';

function createRequest(
  method: string,
  url: string,
  body?: unknown,
  username = 'alice',
  permissions: string[] = ['repo:read']
): HttpRequest {
  const req: any = {
    method,
    url,
    rawUrl: url,
    headers: {},
    body
  };
  req.tokenInfo = {
    id: 'token-id',
    tokenHash: 'hash',
    name: 'test-token',
    username,
    createdAt: Date.now(),
    permissions
  };
  return req;
}

describe('Key Routes', () => {
  let db: Database;
  let tempDir: string;
  let routes: ReturnType<typeof createKeyRoutes>;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'kod-key-routes-test-'));
    db = new Database(tempDir);
    routes = createKeyRoutes(db);
    await db.createCollaborator({ username: 'alice', addedAt: Date.now() });
    await db.createCollaborator({ username: 'bob', addedAt: Date.now() });
  });

  afterEach(async () => {
    await db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('It should add and list SSH keys for the authenticated user', async () => {
    const addRoute = findRoute('POST', '/keys');
    const addRes = await addRoute.handler(
      createRequest('POST', '/keys', {
        publicKey: PUBLIC_KEY,
        name: 'laptop'
      }),
      {}
    );

    expect(addRes.status).toBe(201);
    expect(addRes.body).not.toHaveProperty('keyData');
    expect((addRes.body as any).fingerprint).toMatch(/^SHA256:/);

    const listRoute = findRoute('GET', '/keys');
    const listRes = await listRoute.handler(createRequest('GET', '/keys'), {});

    expect(listRes.status).toBe(200);
    expect(listRes.body as any[]).toHaveLength(1);
    expect((listRes.body as any[])[0].name).toBe('laptop');
  });

  test('It should prevent non-admin tokens from managing another user key', async () => {
    const addRoute = findRoute('POST', '/keys');
    const addRes = await addRoute.handler(
      createRequest('POST', '/keys', {
        username: 'bob',
        publicKey: PUBLIC_KEY
      }),
      {}
    );

    expect(addRes.status).toBe(403);
  });

  test('It should let admins add a key for another collaborator', async () => {
    const addRoute = findRoute('POST', '/keys');
    const addRes = await addRoute.handler(
      createRequest(
        'POST',
        '/keys',
        {
          username: 'bob',
          publicKey: PUBLIC_KEY
        },
        undefined,
        ['admin']
      ),
      {}
    );

    expect(addRes.status).toBe(201);
    expect((addRes.body as any).username).toBe('bob');
  });

  function findRoute(method: string, url: string) {
    return routes.find((route) => route.method === method && route.pattern.test(url))!;
  }
});
