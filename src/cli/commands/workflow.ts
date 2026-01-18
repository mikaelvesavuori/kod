/** biome-ignore-all lint/style/noNonNullAssertion: OK */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import type { WorkflowContext, WorkflowRun } from '../../shared/types.js';

import { api } from '../http-client.js';

import {
  runWorkflowFiles,
  discoverWorkflows
} from '../../server/workflow/runner.js';

interface WorkflowListResponse {
  runs: WorkflowRun[];
  queue: { running: string | null; queued: number };
}

interface WorkflowStatusResponse {
  summary: {
    queued: number;
    running: number;
    completed: number;
    failed: number;
  };
  recent: WorkflowRun[];
}

export async function runWorkflowCommand(files: string[]): Promise<void> {
  // Handle comma-separated files
  const expandedFiles = files.flatMap((f) => f.split(','));

  if (expandedFiles.length === 0) {
    // Try to discover workflows
    const discovered = discoverWorkflows(process.cwd());
    if (discovered.length === 0) {
      console.error(
        'Error: No workflow files specified and none found in .kod/workflows/'
      );
      console.error('Usage: kod workflow <file.toml> [file2.toml...]');
      process.exit(1);
    }
    expandedFiles.push(...discovered);
    console.log(`Discovered ${discovered.length} workflow(s)`);
  }

  // Resolve file paths
  const resolvedFiles = expandedFiles.map((f) => resolve(f));

  // Verify all files exist
  for (const file of resolvedFiles) {
    if (!existsSync(file)) {
      console.error(`Error: Workflow file not found: ${file}`);
      process.exit(1);
    }
  }

  // Get branch from git or environment
  const branch = process.env.BRANCH || (await getGitBranch()) || 'main';

  // Create context
  const context: WorkflowContext = {
    env: { ...process.env } as Record<string, string>,
    branch,
    repo: getRepoName(),
    workingDir: process.cwd()
  };

  console.log(
    `Running ${resolvedFiles.length} workflow(s) on branch '${branch}'...\n`
  );

  const result = await runWorkflowFiles(resolvedFiles, context);

  // Print results
  for (const step of result.steps) {
    const icon = step.skipped ? '⊘' : step.success ? '✓' : '✗';
    const status = step.skipped
      ? 'skipped'
      : step.success
        ? 'passed'
        : 'failed';
    console.log(`${icon} ${step.name} (${status}, ${step.duration}ms)`);

    if (step.output && !step.skipped) {
      // Indent and truncate output
      const lines = step.output.trim().split('\n').slice(0, 10);
      for (const line of lines) {
        console.log(`    ${line}`);
      }
      if (step.output.trim().split('\n').length > 10) {
        console.log('    ...(truncated)');
      }
    }

    if (step.error) {
      console.log(`    Error: ${step.error}`);
    }
    console.log();
  }

  // Summary
  const passed = result.steps.filter((s) => s.success && !s.skipped).length;
  const failed = result.steps.filter((s) => !s.success && !s.skipped).length;
  const skipped = result.steps.filter((s) => s.skipped).length;

  console.log(
    `\nWorkflow ${result.success ? 'completed' : 'failed'} in ${result.duration}ms`
  );
  console.log(`  ${passed} passed, ${failed} failed, ${skipped} skipped`);

  if (!result.success) {
    process.exit(1);
  }
}

export async function workflowStatus(repoName?: string): Promise<void> {
  if (repoName) {
    // Get status for specific repo
    const response = await api.get<WorkflowListResponse>(
      `/repos/${repoName}/workflows`
    );

    if (!response.ok) {
      console.error(`Error: ${response.error}`);
      process.exit(1);
    }

    const { runs, queue } = response.data!;

    console.log(`Workflow status for '${repoName}':\n`);

    if (queue.running) {
      console.log(`  Running: ${queue.running}`);
    }
    if (queue.queued > 0) {
      console.log(`  Queued: ${queue.queued}`);
    }

    if (runs.length === 0) {
      console.log('  No workflow runs yet.');
      return;
    }

    console.log('\nRecent runs:\n');
    for (const run of runs.slice(0, 10)) {
      const icon =
        run.status === 'completed'
          ? '✓'
          : run.status === 'failed'
            ? '✗'
            : run.status === 'running'
              ? '⟳'
              : '○';
      const time = run.startedAt
        ? new Date(run.startedAt).toLocaleString()
        : 'queued';
      console.log(
        `  ${icon} ${run.id} - ${run.branch} - ${run.status} (${time})`
      );
    }
  } else {
    // Get overall status
    const response = await api.get<WorkflowStatusResponse>('/workflows/status');

    if (!response.ok) {
      console.error(`Error: ${response.error}`);
      process.exit(1);
    }

    const { summary, recent } = response.data!;

    console.log('Workflow status (all repos):\n');
    console.log(`  Running: ${summary.running}`);
    console.log(`  Queued: ${summary.queued}`);
    console.log(`  Completed: ${summary.completed}`);
    console.log(`  Failed: ${summary.failed}`);

    if (recent.length > 0) {
      console.log('\nRecent runs:\n');
      for (const run of recent) {
        const icon =
          run.status === 'completed'
            ? '✓'
            : run.status === 'failed'
              ? '✗'
              : run.status === 'running'
                ? '⟳'
                : '○';
        const time = run.startedAt
          ? new Date(run.startedAt).toLocaleString()
          : 'queued';
        console.log(
          `  ${icon} ${run.repoName}/${run.id} - ${run.branch} - ${run.status} (${time})`
        );
      }
    }
  }
}

async function getGitBranch(): Promise<string | null> {
  try {
    const { exec } = await import('../../shared/exec.js');
    const result = await exec('git rev-parse --abbrev-ref HEAD');
    if (result.exitCode === 0) {
      return result.stdout.trim();
    }
  } catch {
    // Not in a git repo
  }
  return null;
}

function getRepoName(): string {
  // Try to get repo name from git remote
  try {
    const { execSync } = require('node:child_process');
    const remote = execSync('git remote get-url origin 2>/dev/null', {
      encoding: 'utf-8'
    });
    const match = remote.match(/[:/]([^/]+?)(?:\.git)?$/);
    if (match) {
      return match[1];
    }
  } catch {
    // Ignore
  }

  // Fall back to directory name
  return process.cwd().split('/').pop() || 'unknown';
}
