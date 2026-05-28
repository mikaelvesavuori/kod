import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo, Server } from 'node:net';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { Database } from '../../src/server/db/index.js';
import { RepoManager } from '../../src/server/git/RepoManager.js';
import { installPreReceiveHook } from '../../src/server/git/hooks.js';
import { startSshServer } from '../../src/server/ssh/server.js';
import { parsePublicKey } from '../../src/server/ssh/keys.js';
import { execFile } from '../../src/shared/exec.js';
import type { ServerConfig } from '../../src/shared/types.js';

describe('Git over SSH', () => {
  let tempDir: string;
  let db: Database;
  let repoManager: RepoManager;
  let sshServer: Server | undefined;
  let port: number;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'kod-git-ssh-test-'));
    const reposDir = join(tempDir, 'repos');
    mkdirSync(reposDir, { recursive: true });
    db = new Database(join(tempDir, 'data'));
    repoManager = new RepoManager(reposDir);

    await db.createCollaborator({ username: 'alice', addedAt: Date.now() });
    const token = await db.createApiToken(
      'alice-token',
      ['repo:read', 'repo:write'],
      undefined,
      'alice'
    );

    const repoPath = await repoManager.create('smoke');
    installPreReceiveHook(repoPath);
    await db.createRepo({
      name: 'smoke',
      createdAt: Date.now(),
      path: repoPath,
      ownerTokenId: token.id,
      protectedBranches: []
    });

    await generateSshKey('alice');
    const publicKey = readFileSync(keyPath('alice.pub'), 'utf-8');
    const parsed = parsePublicKey(publicKey);
    if (!parsed) throw new Error('Failed to parse generated SSH key');
    await db.createSshKey({
      username: 'alice',
      name: 'alice',
      publicKey: parsed.publicKey,
      keyType: parsed.keyType,
      keyData: parsed.keyData,
      fingerprint: parsed.fingerprint
    });

    sshServer = await startSshServer({
      db,
      repoManager,
      config: makeConfig(false)
    });
    port = (sshServer.address() as AddressInfo).port;
  });

  afterEach(async () => {
    if (sshServer?.listening) {
      await new Promise<void>((resolve) => sshServer?.close(() => resolve()));
    }
    await db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('It should clone and push with collaborator public key auth', async () => {
    const cloneDir = join(tempDir, 'clone');
    await git(['clone', sshUrl('kod'), cloneDir], sshEnv('alice'));

    writeFileSync(join(cloneDir, 'README.md'), '# Smoke\n');
    await git(['config', 'user.email', 'alice@example.com'], sshEnv('alice'), cloneDir);
    await git(['config', 'user.name', 'Alice'], sshEnv('alice'), cloneDir);
    await git(['add', 'README.md'], sshEnv('alice'), cloneDir);
    await git(['commit', '-m', 'initial'], sshEnv('alice'), cloneDir);
    await git(['push', 'origin', 'HEAD:main'], sshEnv('alice'), cloneDir);

    const commit = await repoManager.getLatestCommit('smoke', 'main');
    expect(commit).toMatch(/^[a-f0-9]{40}$/);
  });

  test('It should support anonymous read-only SSH discovery and clone', async () => {
    await closeSshServer();
    sshServer = await startSshServer({
      db,
      repoManager,
      config: makeConfig(true)
    });
    port = (sshServer.address() as AddressInfo).port;

    const discovery = await execFile(
      'ssh',
      [
        '-o',
        'StrictHostKeyChecking=no',
        '-o',
        'UserKnownHostsFile=/dev/null',
        '-p',
        String(port),
        'anonymous@127.0.0.1',
        'repos'
      ],
      { timeout: 10_000 }
    );

    expect(discovery.exitCode).toBe(0);
    expect(discovery.stdout).toContain('smoke');

    const cloneDir = join(tempDir, 'anonymous-clone');
    await git(['clone', sshUrl('anonymous'), cloneDir], anonymousSshEnv());
    expect(existsSync(cloneDir)).toBe(true);
  });

  async function generateSshKey(name: string): Promise<void> {
    const result = await execFile('ssh-keygen', [
      '-t',
      'ed25519',
      '-N',
      '',
      '-C',
      name,
      '-f',
      keyPath(name)
    ]);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || 'ssh-keygen failed');
    }
  }

  function keyPath(name: string): string {
    return join(tempDir, name);
  }

  function sshUrl(username: string): string {
    return `ssh://${username}@127.0.0.1:${port}/smoke.git`;
  }

  function sshEnv(keyName: string): Record<string, string> {
    return {
      GIT_SSH_COMMAND: [
        'ssh',
        '-o StrictHostKeyChecking=no',
        '-o UserKnownHostsFile=/dev/null',
        '-o IdentitiesOnly=yes',
        `-i ${keyPath(keyName)}`
      ].join(' ')
    };
  }

  function anonymousSshEnv(): Record<string, string> {
    return {
      GIT_SSH_COMMAND: [
        'ssh',
        '-o StrictHostKeyChecking=no',
        '-o UserKnownHostsFile=/dev/null'
      ].join(' ')
    };
  }

  async function git(
    args: string[],
    env: Record<string, string>,
    cwd?: string
  ): Promise<void> {
    const result = await execFile('git', args, {
      cwd,
      env,
      timeout: 30_000
    });
    expect(result.exitCode, result.stderr).toBe(0);
  }

  async function closeSshServer(): Promise<void> {
    if (sshServer?.listening) {
      await new Promise<void>((resolve) => sshServer?.close(() => resolve()));
    }
  }

  function makeConfig(anonymousRead: boolean): ServerConfig {
    return {
      port: 0,
      dataDir: join(tempDir, 'data'),
      reposDir: join(tempDir, 'repos'),
      apiToken: '',
      adminToken: '',
      encryptionKey: '',
      sshEnabled: true,
      sshHost: '127.0.0.1',
      sshPort: 0,
      sshHostKeyPath: join(tempDir, `host-${anonymousRead}.key`),
      sshAnonymousRead: anonymousRead
    };
  }
});
