import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Database } from '../../src/db/index.js';

describe('Database', () => {
  let db: Database;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'kod-db-test-'));
    db = new Database(tempDir);
  });

  afterEach(async () => {
    await db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Repos', () => {
    test('It should create and get a repo', async () => {
      const repo = {
        name: 'my-app',
        createdAt: Date.now(),
        path: '/repos/my-app.git',
        ownerTokenId: 'test-token-id'
      };

      await db.createRepo(repo);
      const result = await db.getRepo('my-app');

      expect(result?.name).toBe('my-app');
      expect(result?.path).toBe('/repos/my-app.git');
    });

    test('It should return undefined for non-existent repo', async () => {
      const result = await db.getRepo('nonexistent');

      expect(result).toBeUndefined();
    });

    test('It should list all repos', async () => {
      await db.createRepo({
        name: 'app1',
        createdAt: Date.now(),
        path: '/repos/app1.git',
        ownerTokenId: 'test-token-id'
      });
      await db.createRepo({
        name: 'app2',
        createdAt: Date.now(),
        path: '/repos/app2.git',
        ownerTokenId: 'test-token-id'
      });

      const repos = await db.listRepos();

      expect(repos).toHaveLength(2);
      expect(repos.map((r) => r.name)).toContain('app1');
      expect(repos.map((r) => r.name)).toContain('app2');
    });

    test('It should update a repo', async () => {
      await db.createRepo({
        name: 'old-name',
        createdAt: Date.now(),
        path: '/repos/old-name.git',
        ownerTokenId: 'test-token-id'
      });

      await db.updateRepo('old-name', {
        name: 'new-name',
        path: '/repos/new-name.git'
      });

      const oldRepo = await db.getRepo('old-name');
      const newRepo = await db.getRepo('new-name');

      expect(oldRepo).toBeUndefined();
      expect(newRepo?.name).toBe('new-name');
    });

    test('It should delete a repo', async () => {
      await db.createRepo({
        name: 'to-delete',
        createdAt: Date.now(),
        path: '/repos/to-delete.git',
        ownerTokenId: 'test-token-id'
      });

      await db.deleteRepo('to-delete');

      const result = await db.getRepo('to-delete');
      expect(result).toBeUndefined();
    });

    test('It should initialize empty collaborators list on create', async () => {
      await db.createRepo({
        name: 'my-app',
        createdAt: Date.now(),
        path: '/repos/my-app.git',
        ownerTokenId: 'test-token-id'
      });

      const collabs = await db.getRepoCollaborators('my-app');

      expect(collabs?.collaborators).toEqual([]);
    });
  });

  describe('Collaborators', () => {
    test('It should create and get a collaborator', async () => {
      const collab = {
        username: 'alice',
        publicKey: 'ssh-rsa AAA...',
        addedAt: Date.now()
      };

      await db.createCollaborator(collab);
      const result = await db.getCollaborator('alice');

      expect(result?.username).toBe('alice');
      expect(result?.publicKey).toBe('ssh-rsa AAA...');
    });

    test('It should delete a collaborator', async () => {
      await db.createCollaborator({
        username: 'bob',
        publicKey: 'ssh-rsa BBB...',
        addedAt: Date.now()
      });

      await db.deleteCollaborator('bob');

      const result = await db.getCollaborator('bob');
      expect(result).toBeUndefined();
    });
  });

  describe('Repo-Collaborator Relationships', () => {
    beforeEach(async () => {
      await db.createRepo({
        name: 'my-app',
        createdAt: Date.now(),
        path: '/repos/my-app.git',
        ownerTokenId: 'test-token-id'
      });
    });

    test('It should add collaborator to repo', async () => {
      await db.addCollaboratorToRepo('my-app', 'alice');

      const collabs = await db.getRepoCollaborators('my-app');

      expect(collabs?.collaborators).toContain('alice');
    });

    test('It should not add duplicate collaborator', async () => {
      await db.addCollaboratorToRepo('my-app', 'alice');
      await db.addCollaboratorToRepo('my-app', 'alice');

      const collabs = await db.getRepoCollaborators('my-app');

      expect(collabs?.collaborators.filter((c) => c === 'alice')).toHaveLength(
        1
      );
    });

    test('It should remove collaborator from repo', async () => {
      await db.addCollaboratorToRepo('my-app', 'alice');
      await db.addCollaboratorToRepo('my-app', 'bob');

      await db.removeCollaboratorFromRepo('my-app', 'alice');

      const collabs = await db.getRepoCollaborators('my-app');

      expect(collabs?.collaborators).not.toContain('alice');
      expect(collabs?.collaborators).toContain('bob');
    });

    test('It should update collaborators when repo is renamed', async () => {
      await db.addCollaboratorToRepo('my-app', 'alice');

      await db.updateRepo('my-app', {
        name: 'new-app',
        path: '/repos/new-app.git'
      });

      const oldCollabs = await db.getRepoCollaborators('my-app');
      const newCollabs = await db.getRepoCollaborators('new-app');

      expect(oldCollabs).toBeUndefined();
      expect(newCollabs?.collaborators).toContain('alice');
    });
  });

  describe('Workflow Runs', () => {
    test('It should create and get a workflow run', async () => {
      const run = {
        id: 'run123',
        repoName: 'my-app',
        branch: 'main',
        status: 'running' as const,
        startedAt: Date.now()
      };

      await db.createWorkflowRun(run);
      const result = await db.getWorkflowRun('run123');

      expect(result?.id).toBe('run123');
      expect(result?.status).toBe('running');
    });

    test('It should update a workflow run', async () => {
      await db.createWorkflowRun({
        id: 'run456',
        repoName: 'my-app',
        branch: 'main',
        status: 'running'
      });

      await db.updateWorkflowRun('run456', {
        status: 'completed',
        completedAt: Date.now()
      });

      const result = await db.getWorkflowRun('run456');

      expect(result?.status).toBe('completed');
      expect(result?.completedAt).toBeDefined();
    });

    test('It should list workflow runs', async () => {
      await db.createWorkflowRun({
        id: 'run1',
        repoName: 'app1',
        branch: 'main',
        status: 'completed'
      });
      await db.createWorkflowRun({
        id: 'run2',
        repoName: 'app2',
        branch: 'main',
        status: 'running'
      });

      const allRuns = await db.listWorkflowRuns();

      expect(allRuns).toHaveLength(2);
    });

    test('It should filter workflow runs by repo', async () => {
      await db.createWorkflowRun({
        id: 'run1',
        repoName: 'app1',
        branch: 'main',
        status: 'completed'
      });
      await db.createWorkflowRun({
        id: 'run2',
        repoName: 'app2',
        branch: 'main',
        status: 'running'
      });
      await db.createWorkflowRun({
        id: 'run3',
        repoName: 'app1',
        branch: 'dev',
        status: 'completed'
      });

      const app1Runs = await db.listWorkflowRuns('app1');

      expect(app1Runs).toHaveLength(2);
      expect(app1Runs.every((r) => r.repoName === 'app1')).toBe(true);
    });
  });
});
