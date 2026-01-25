import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { WorkflowQueue } from '../../src/server/workflow/WorkflowQueue.js';
import { Database } from '../../src/server/db/index.js';

describe('WorkflowQueue', () => {
  let db: Database;
  let queue: WorkflowQueue;
  let testDir: string;
  let dataDir: string;
  let reposDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `kod-test-${Date.now()}`);
    dataDir = join(testDir, 'data');
    reposDir = join(testDir, 'repos');
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(reposDir, { recursive: true });

    db = new Database(dataDir);
    queue = new WorkflowQueue(db, reposDir);
  });

  afterEach(async () => {
    // Wait for any in-flight operations to complete
    await new Promise((r) => setTimeout(r, 200));
    await db.close();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('It should queue a workflow run', async () => {
    const id = await queue.enqueue('test-repo', 'main', 'abc123');

    expect(id).toBeDefined();
    expect(typeof id).toBe('string');

    const run = await db.getWorkflowRun(id);
    expect(run).toBeDefined();
    expect(run?.status).toBe('queued');
    expect(run?.repoName).toBe('test-repo');
    expect(run?.branch).toBe('main');
  });

  test('It should set status to failed when workflow fails', async () => {
    // Create a bare git repo with a failing workflow
    const bareRepoPath = join(reposDir, 'failing-repo.git');
    mkdirSync(bareRepoPath, { recursive: true });

    // Initialize bare repo
    const { execSync } = await import('node:child_process');
    execSync('git init --bare', { cwd: bareRepoPath });

    // Create a temp clone to add files
    const tempClone = join(testDir, 'temp-clone');
    execSync(`git clone "${bareRepoPath}" "${tempClone}"`);
    execSync('git checkout -b main', { cwd: tempClone });

    // Add a failing workflow
    const workflowDir = join(tempClone, '.kod', 'workflows');
    mkdirSync(workflowDir, { recursive: true });
    writeFileSync(
      join(workflowDir, 'test.toml'),
      `
[step:fail]
run: exit 1
`
    );

    // Commit and push
    execSync('git add -A && git commit -m "Add failing workflow"', {
      cwd: tempClone,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@test.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@test.com'
      }
    });
    execSync('git push origin main', { cwd: tempClone });

    // Enqueue and wait for execution
    const id = await queue.enqueue('failing-repo', 'main', '');

    // Wait for workflow to complete (max 5 seconds)
    let run = await db.getWorkflowRun(id);
    const maxAttempts = 50;
    let attempts = 0;
    while (
      run?.status !== 'completed' &&
      run?.status !== 'failed' &&
      attempts < maxAttempts
    ) {
      await new Promise((r) => setTimeout(r, 100));
      run = await db.getWorkflowRun(id);
      attempts++;
    }

    // Verify the workflow failed
    expect(run?.status).toBe('failed');
    expect(run?.result?.success).toBe(false);
    expect(run?.result?.steps[0]?.success).toBe(false);
    expect(run?.result?.steps[0]?.error).toBe('Exit code: 1');
  });

  test('It should set status to completed when workflow succeeds', async () => {
    // Create a bare git repo with a passing workflow
    const bareRepoPath = join(reposDir, 'passing-repo.git');
    mkdirSync(bareRepoPath, { recursive: true });

    const { execSync } = await import('node:child_process');
    execSync('git init --bare', { cwd: bareRepoPath });

    const tempClone = join(testDir, 'temp-clone-pass');
    execSync(`git clone "${bareRepoPath}" "${tempClone}"`);
    execSync('git checkout -b main', { cwd: tempClone });

    const workflowDir = join(tempClone, '.kod', 'workflows');
    mkdirSync(workflowDir, { recursive: true });
    writeFileSync(
      join(workflowDir, 'test.toml'),
      `
[step:pass]
run: echo "Success"
`
    );

    execSync('git add -A && git commit -m "Add passing workflow"', {
      cwd: tempClone,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@test.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@test.com'
      }
    });
    execSync('git push origin main', { cwd: tempClone });

    const id = await queue.enqueue('passing-repo', 'main', '');

    // Wait for workflow to complete
    let run = await db.getWorkflowRun(id);
    const maxAttempts = 50;
    let attempts = 0;
    while (
      run?.status !== 'completed' &&
      run?.status !== 'failed' &&
      attempts < maxAttempts
    ) {
      await new Promise((r) => setTimeout(r, 100));
      run = await db.getWorkflowRun(id);
      attempts++;
    }

    // Verify the workflow succeeded
    expect(run?.status).toBe('completed');
    expect(run?.result?.success).toBe(true);
  });
});
