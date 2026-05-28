/** biome-ignore-all lint/style/noNonNullAssertion: OK */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from '../../src/server/db/index.js';
import { createWorkflowRoutes } from '../../src/server/routes/workflows.js';
import type { HttpRequest } from '../../src/shared/types.js';
import type { WorkflowQueue } from '../../src/server/workflow/WorkflowQueue.js';

function createRequest(
  method: string,
  url: string,
  body?: unknown,
  options: {
    id?: string;
    username?: string;
    permissions?: string[];
  } = {}
): HttpRequest {
  const req: any = {
    method,
    url,
    headers: {},
    body
  };
  req.tokenInfo = {
    id: options.id ?? 'owner-token',
    tokenHash: 'hash',
    name: 'test-token',
    createdAt: Date.now(),
    permissions: options.permissions ?? ['admin'],
    username: options.username
  };
  return req;
}

describe('Workflow Routes', () => {
  let db: Database;
  let tempDir: string;
  let routes: ReturnType<typeof createWorkflowRoutes>;
  let enqueued:
    | { repoName: string; branch: string; commit: string; files?: string[] }
    | undefined;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'kod-workflow-routes-test-'));
    db = new Database(tempDir);
    enqueued = undefined;

    const queue = {
      enqueue: async (
        repoName: string,
        branch: string,
        commit: string,
        files?: string[]
      ) => {
        enqueued = { repoName, branch, commit, files };
        return 'run-123';
      },
      getStatus: () => ({ running: null, queued: 0 })
    } as unknown as WorkflowQueue;

    routes = createWorkflowRoutes(db, queue);

    await db.createRepo({
      name: 'my-app',
      createdAt: Date.now(),
      path: '/repos/my-app.git',
      ownerTokenId: 'owner-token'
    });
    await db.createRepo({
      name: 'other-app',
      createdAt: Date.now(),
      path: '/repos/other-app.git',
      ownerTokenId: 'other-owner'
    });
    await db.createCollaborator({ username: 'alice', addedAt: Date.now() });
    await db.addCollaboratorToRepo('my-app', 'alice');
  });

  afterEach(async () => {
    await db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  function findRoute(method: string, url: string) {
    return routes.find(
      (route) => route.method === method && route.pattern.test(url)
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

  test('It should let collaborators trigger workflows for accessible repos', async () => {
    const url = '/repos/my-app/workflows';
    const route = findRoute('POST', url);
    const req = createRequest(
      'POST',
      url,
      {
        branch: 'main',
        commit: 'abcdef1',
        files: ['.kod/workflows/build.toml']
      },
      {
        id: 'alice-token',
        username: 'alice',
        permissions: ['workflow:trigger']
      }
    );

    const res = await route.handler(req, extractParams(route, url));

    expect(res.status).toBe(202);
    expect(enqueued).toEqual({
      repoName: 'my-app',
      branch: 'main',
      commit: 'abcdef1',
      files: ['.kod/workflows/build.toml']
    });
  });

  test('It should reject invalid workflow trigger input', async () => {
    const url = '/repos/my-app/workflows';
    const route = findRoute('POST', url);
    const req = createRequest(
      'POST',
      url,
      { branch: 'bad branch' },
      {
        permissions: ['workflow:trigger']
      }
    );

    const res = await route.handler(req, extractParams(route, url));

    expect(res.status).toBe(400);
    expect((res.body as any).error).toContain('Invalid branch');
  });

  test('It should filter global status to repos the token can access', async () => {
    await db.createWorkflowRun({
      id: 'run-visible',
      repoName: 'my-app',
      branch: 'main',
      status: 'completed',
      startedAt: 2
    });
    await db.createWorkflowRun({
      id: 'run-hidden',
      repoName: 'other-app',
      branch: 'main',
      status: 'failed',
      startedAt: 1
    });

    const url = '/workflows/status';
    const route = findRoute('GET', url);
    const req = createRequest('GET', url, undefined, {
      id: 'alice-token',
      username: 'alice',
      permissions: ['workflow:read']
    });

    const res = await route.handler(req, extractParams(route, url));

    expect(res.status).toBe(200);
    expect((res.body as any).summary.completed).toBe(1);
    expect((res.body as any).summary.failed).toBe(0);
    expect((res.body as any).recent.map((run: any) => run.id)).toEqual([
      'run-visible'
    ]);
  });
});
