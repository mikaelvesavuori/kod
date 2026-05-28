/** biome-ignore-all lint/style/noNonNullAssertion: OK */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createRepoRoutes } from '../../src/server/routes/repos.js';
import { Database } from '../../src/server/db/index.js';
import { RepoManager } from '../../src/server/git/RepoManager.js';
import type { HttpRequest } from '../../src/shared/types.js';
import { execFile } from '../../src/shared/exec.js';

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

describe('Repo Routes', () => {
  let db: Database;
  let tempDir: string;
  let reposDir: string;
  let routes: ReturnType<typeof createRepoRoutes>;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'kod-repo-routes-test-'));
    reposDir = join(tempDir, 'repos');
    mkdirSync(reposDir, { recursive: true });
    db = new Database(join(tempDir, 'data'));
    const repoManager = new RepoManager(reposDir);
    routes = createRepoRoutes(db, repoManager, 'http://localhost:3000');

    const repoPath = await repoManager.create('my-app');
    await db.createRepo({
      name: 'my-app',
      createdAt: Date.now(),
      path: repoPath,
      ownerTokenId: 'owner-token',
      protectedBranches: []
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

  test('It should protect and unprotect branches', async () => {
    const protectUrl = '/repos/my-app/protections/branches/main';
    const protectRoute = findRoute('PUT', protectUrl);
    const protectReq = createRequest('PUT', protectUrl);
    const protectRes = await protectRoute.handler(
      protectReq,
      extractParams(protectRoute, protectUrl)
    );

    expect(protectRes.status).toBe(200);
    expect((protectRes.body as any).branches).toEqual(['main']);

    const protectedFile = join(reposDir, 'my-app.git', 'kod-protected-branches');
    expect(existsSync(protectedFile)).toBe(true);
    expect(readFileSync(protectedFile, 'utf-8')).toContain('main');

    const unprotectRoute = findRoute('DELETE', protectUrl);
    const unprotectReq = createRequest('DELETE', protectUrl);
    const unprotectRes = await unprotectRoute.handler(
      unprotectReq,
      extractParams(unprotectRoute, protectUrl)
    );

    expect(unprotectRes.status).toBe(200);
    expect((unprotectRes.body as any).branches).toEqual([]);
  });

  test('It should prevent non-owners from changing branch protection', async () => {
    const url = '/repos/my-app/protections/branches/main';
    const route = findRoute('PUT', url);
    const req = createRequest('PUT', url, undefined, ['repo:write'], 'other');
    const res = await route.handler(req, extractParams(route, url));

    expect(res.status).toBe(403);
  });

  test('It should import a local repository', async () => {
    const source = join(tempDir, 'source-repo');
    mkdirSync(source, { recursive: true });
    await execFile('git', ['init'], { cwd: source });
    await execFile('git', ['config', 'user.email', 'test@example.com'], {
      cwd: source
    });
    await execFile('git', ['config', 'user.name', 'Test User'], {
      cwd: source
    });
    writeFileSync(join(source, 'README.md'), '# Imported\n');
    await execFile('git', ['add', 'README.md'], { cwd: source });
    await execFile('git', ['commit', '-m', 'initial'], { cwd: source });

    const url = '/repos/import';
    const route = findRoute('POST', url);
    const req = createRequest('POST', url, {
      source,
      name: 'imported'
    });
    const res = await route.handler(req, {});

    expect(res.status).toBe(201);
    expect(await db.getRepo('imported')).toBeDefined();
    expect(existsSync(join(reposDir, 'imported.git'))).toBe(true);
  });
});
