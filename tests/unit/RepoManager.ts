import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { RepoManager } from '../../src/server/git/RepoManager.js';

describe('RepoManager', () => {
  let repoManager: RepoManager;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'kod-repos-test-'));
    repoManager = new RepoManager(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('It should create a bare repository', async () => {
    const repoPath = await repoManager.create('my-app');

    expect(repoPath).toBe(join(tempDir, 'my-app.git'));
    expect(existsSync(repoPath)).toBe(true);
    expect(existsSync(join(repoPath, 'HEAD'))).toBe(true);
  });

  test('It should throw when creating repo that exists', async () => {
    await repoManager.create('my-app');

    await expect(repoManager.create('my-app')).rejects.toThrow(
      'already exists'
    );
  });

  test('It should check if repo exists', async () => {
    await repoManager.create('my-app');

    expect(repoManager.exists('my-app')).toBe(true);
    expect(repoManager.exists('nonexistent')).toBe(false);
  });

  test('It should delete a repository', async () => {
    await repoManager.create('to-delete');

    await repoManager.delete('to-delete');

    expect(repoManager.exists('to-delete')).toBe(false);
  });

  test('It should throw when deleting non-existent repo', async () => {
    await expect(repoManager.delete('nonexistent')).rejects.toThrow(
      'does not exist'
    );
  });

  test('It should rename a repository', async () => {
    await repoManager.create('old-name');

    const newPath = await repoManager.rename('old-name', 'new-name');

    expect(newPath).toBe(join(tempDir, 'new-name.git'));
    expect(repoManager.exists('old-name')).toBe(false);
    expect(repoManager.exists('new-name')).toBe(true);
  });

  test('It should throw when renaming non-existent repo', async () => {
    await expect(repoManager.rename('nonexistent', 'new-name')).rejects.toThrow(
      'does not exist'
    );
  });

  test('It should throw when renaming to existing name', async () => {
    await repoManager.create('repo1');
    await repoManager.create('repo2');

    await expect(repoManager.rename('repo1', 'repo2')).rejects.toThrow(
      'already exists'
    );
  });

  test('It should get repo path', () => {
    const path = repoManager.getRepoPath('my-app');

    expect(path).toBe(join(tempDir, 'my-app.git'));
  });

  test('It should return empty branches for new repo', async () => {
    await repoManager.create('empty-repo');

    const branches = await repoManager.getBranches('empty-repo');

    expect(branches).toEqual([]);
  });

  test('It should return default branch for new repo', async () => {
    await repoManager.create('empty-repo');

    const defaultBranch = await repoManager.getDefaultBranch('empty-repo');

    // Git initializes with a default branch (usually 'main' or 'master')
    expect(defaultBranch).toMatch(/^(main|master)$/);
  });

  test('It should return empty branches for non-existent repo', async () => {
    const branches = await repoManager.getBranches('nonexistent');

    expect(branches).toEqual([]);
  });

  test('It should return symbolic ref for repo without commits', async () => {
    await repoManager.create('empty-repo');

    const commit = await repoManager.getLatestCommit('empty-repo');

    // On a repo with no commits, rev-parse HEAD returns "HEAD" as symbolic ref
    // or null depending on git version
    expect(commit === null || commit === 'HEAD').toBe(true);
  });
});
