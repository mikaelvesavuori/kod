import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { createHttpServer } from '../../src/server/http-server.js';
import { Database } from '../../src/server/db/index.js';
import { RepoManager } from '../../src/server/git/RepoManager.js';
import { createRepoRoutes } from '../../src/server/routes/repos.js';
import { createCollaboratorRoutes } from '../../src/server/routes/collaborators.js';
import { createTokenRoutes } from '../../src/server/routes/tokens.js';
import { createGitRoutes } from '../../src/server/routes/git.js';
import type { Route } from '../../src/shared/types.js';
import { execFile } from '../../src/shared/exec.js';

describe('Git HTTP smoke test', () => {
  let tempDir: string;
  let db: Database;
  let server: ReturnType<typeof createHttpServer>;
  let port: number;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'kod-e2e-git-http-'));
    const dataDir = join(tempDir, 'data');
    const reposDir = join(tempDir, 'repos');
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(reposDir, { recursive: true });

    db = new Database(dataDir);
    await db.createAdminToken('kod_admin');

    const repoManager = new RepoManager(reposDir);
    const routes: Route[] = [
      {
        method: 'POST',
        pattern: /^\/internal\/hooks\/(?<name>[^/]+)\/push\/?$/,
        handler: async () => ({ status: 202, body: { message: 'queued' } })
      },
      ...createRepoRoutes(db, repoManager, 'http://127.0.0.1:1'),
      ...createCollaboratorRoutes(db),
      ...createTokenRoutes(db),
      ...createGitRoutes(db, repoManager)
    ];

    server = createHttpServer(routes, (token) => db.validateToken(token));
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('No listener address');
    }
    port = address.port;
  });

  afterEach(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await db.close();
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('It should clone, push, and enforce protected branches locally', async () => {
    await api('POST', '/repos', { name: 'smoke' });

    const cloneDir = join(tempDir, 'clone');
    const adminUrl = repoUrl('kod_admin');
    await git(['clone', adminUrl, cloneDir]);
    await git(['checkout', '-b', 'main'], { cwd: cloneDir });

    writeFileSync(join(cloneDir, 'README.md'), '# smoke\n');
    await git(['add', 'README.md'], { cwd: cloneDir });
    await git(['commit', '-m', 'initial'], { cwd: cloneDir });
    await git(['push', 'origin', 'main'], { cwd: cloneDir });

    await api('PUT', '/repos/smoke/protections/branches/main');
    await api('POST', '/repos/smoke/collaborators', { username: 'alice' });
    const tokenResponse = await api('POST', '/tokens', {
      name: 'alice-token',
      username: 'alice',
      permissions: ['repo:read', 'repo:write']
    });
    const aliceToken = tokenResponse.token as string;

    await git(['remote', 'set-url', 'origin', repoUrl(aliceToken)], {
      cwd: cloneDir
    });
    writeFileSync(join(cloneDir, 'README.md'), '# smoke\n\nchange\n');
    await git(['add', 'README.md'], { cwd: cloneDir });
    await git(['commit', '-m', 'change'], { cwd: cloneDir });

    await expect(git(['push', 'origin', 'main'], { cwd: cloneDir })).rejects
      .toThrow(/protected/);
  });

  async function api(
    method: string,
    path: string,
    body?: unknown
  ): Promise<Record<string, unknown>> {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        Authorization: 'Bearer kod_admin',
        'Content-Type': 'application/json'
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    const text = await response.text();
    const parsed = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(parsed.error ?? `HTTP ${response.status}`);
    }
    return parsed;
  }

  function repoUrl(token: string): string {
    return `http://git:${token}@127.0.0.1:${port}/repos/smoke.git`;
  }

  async function git(
    args: string[],
    options: { cwd?: string } = {}
  ): Promise<void> {
    const result = await execFile('git', args, {
      cwd: options.cwd,
      timeout: 10000,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Kod Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Kod Test',
        GIT_COMMITTER_EMAIL: 'test@example.com'
      }
    });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout);
    }
  }
});
