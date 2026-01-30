/** biome-ignore-all lint/style/noNonNullAssertion: OK */
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type {
  WorkflowRun,
  WorkflowContext,
  WorkflowResult
} from '../../shared/types.js';

import { exec } from '../../shared/exec.js';
import { runWorkflowFiles, discoverWorkflows } from './runner.js';
import type { Database } from '../db/index.js';

interface QueuedWorkflow {
  id: string;
  repoName: string;
  branch: string;
  commit: string;
  files?: string[];
}

export class WorkflowQueue {
  private queues: Map<string, QueuedWorkflow[]> = new Map();
  private running: Map<string, string> = new Map(); // repoName -> runId
  private db: Database;
  private reposDir: string;

  constructor(db: Database, reposDir: string) {
    this.db = db;
    this.reposDir = reposDir;
  }

  async enqueue(
    repoName: string,
    branch: string,
    commit: string,
    files?: string[]
  ): Promise<string> {
    const id = generateId();

    const run: WorkflowRun = {
      id,
      repoName,
      branch,
      status: 'queued'
    };
    await this.db.createWorkflowRun(run);

    const queued: QueuedWorkflow = { id, repoName, branch, commit, files };

    // Add to queue
    if (!this.queues.has(repoName)) {
      this.queues.set(repoName, []);
    }
    this.queues.get(repoName)?.push(queued);

    // Try to process queue
    this.processQueue(repoName);

    return id;
  }

  private async processQueue(repoName: string): Promise<void> {
    // Check if already running for this repo
    if (this.running.has(repoName)) {
      return;
    }

    const queue = this.queues.get(repoName);
    if (!queue || queue.length === 0) {
      return;
    }

    // Get next item
    const item = queue.shift()!;
    this.running.set(repoName, item.id);

    // Execute workflow in background
    this.executeWorkflow(item).finally(() => {
      this.running.delete(repoName);
      // Process next in queue
      this.processQueue(repoName);
    });
  }

  private async executeWorkflow(item: QueuedWorkflow): Promise<void> {
    const { id, repoName, branch, commit, files } = item;

    // Update status to running
    await this.db.updateWorkflowRun(id, {
      status: 'running',
      startedAt: Date.now()
    });

    let result: WorkflowResult;
    let workDir: string | null = null;

    try {
      // Clone repo to temp directory
      workDir = mkdtempSync(join(tmpdir(), `kod-${repoName}-`));
      const repoPath = join(this.reposDir, `${repoName}.git`);

      const cloneResult = await exec(
        `git clone --branch ${branch} "${repoPath}" "${workDir}"`,
        { timeout: 60000 }
      );

      if (cloneResult.exitCode !== 0) {
        throw new Error(`Failed to clone: ${cloneResult.stderr}`);
      }

      // Checkout specific commit if provided
      if (commit) {
        await exec(`git checkout ${commit}`, { cwd: workDir });
      }

      // Determine workflow files
      const workflowFiles = files ?? discoverWorkflows(workDir);

      if (workflowFiles.length === 0) {
        // No workflows to run
        result = {
          success: true,
          steps: [],
          duration: 0
        };
      } else {
        // Fetch and inject decrypted secrets into env
        const secrets = await this.db.getDecryptedSecrets(repoName);
        const env = { ...process.env, ...secrets } as Record<string, string>;

        // Create context
        const context: WorkflowContext = {
          env,
          branch,
          repo: repoName,
          workingDir: workDir
        };

        // Run workflows
        result = await runWorkflowFiles(workflowFiles, context);
      }

      // Update run with result
      await this.db.updateWorkflowRun(id, {
        status: result.success ? 'completed' : 'failed',
        completedAt: Date.now(),
        result
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';

      result = {
        success: false,
        steps: [
          {
            name: 'Setup',
            success: false,
            output: '',
            error: message,
            duration: 0
          }
        ],
        duration: 0
      };

      await this.db.updateWorkflowRun(id, {
        status: 'failed',
        completedAt: Date.now(),
        result
      });
    } finally {
      // Cleanup temp directory
      if (workDir && existsSync(workDir)) {
        try {
          rmSync(workDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }

  getStatus(repoName: string): { running: string | null; queued: number } {
    return {
      running: this.running.get(repoName) ?? null,
      queued: this.queues.get(repoName)?.length ?? 0
    };
  }

  isRunning(repoName: string): boolean {
    return this.running.has(repoName);
  }
}

function generateId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 12; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}
