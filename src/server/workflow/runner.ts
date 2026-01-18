import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import type {
  WorkflowContext,
  WorkflowResult,
  StepResult
} from '../../shared/types.js';

import { exec } from '../../shared/exec.js';
import {
  parseTOML,
  processRunLine,
  evaluateCondition
} from '../../shared/toml-parser.js';

export async function runWorkflow(
  workflowContent: string,
  context: WorkflowContext
): Promise<WorkflowResult> {
  const startTime = Date.now();
  const workflow = parseTOML(workflowContent);
  const stepResults: StepResult[] = [];
  let success = true;

  const timeout = (workflow.timeout ?? 300) * 1000;

  for (const step of workflow.steps) {
    const stepStart = Date.now();

    // Check condition
    if (step.if) {
      const shouldRun = evaluateCondition(
        step.if,
        context.env,
        context.branch,
        context.repo
      );
      if (!shouldRun) {
        stepResults.push({
          name: step.name,
          success: true,
          output: '',
          duration: 0,
          skipped: true
        });
        continue;
      }
    }

    // Determine working directory
    const workingDir = step.working_dir
      ? join(context.workingDir, step.working_dir)
      : context.workingDir;

    // Process run commands
    const commands = step.run.split('\n').filter((line) => line.trim());
    let stepOutput = '';
    let stepSuccess = true;
    let stepError: string | undefined;

    for (const line of commands) {
      const command = processRunLine(
        line,
        context.env,
        context.branch,
        context.repo
      );

      // Skip env assignments
      if (command === null) continue;

      const result = await exec(command, {
        cwd: workingDir,
        timeout,
        env: context.env
      });

      stepOutput += result.stdout;
      if (result.stderr) {
        stepOutput += result.stderr;
      }

      if (result.exitCode !== 0) {
        stepSuccess = false;
        stepError = `Exit code: ${result.exitCode}`;
        break;
      }
    }

    const stepDuration = Date.now() - stepStart;

    stepResults.push({
      name: step.name,
      success: stepSuccess,
      output: stepOutput,
      error: stepError,
      duration: stepDuration
    });

    // Handle failure
    if (!stepSuccess) {
      if (step.continue_on_error) {
        // Continue to next step
        continue;
      }
      // Stop workflow
      success = false;
      break;
    }
  }

  return {
    success,
    steps: stepResults,
    duration: Date.now() - startTime
  };
}

export async function runWorkflowFiles(
  files: string[],
  context: WorkflowContext
): Promise<WorkflowResult> {
  const startTime = Date.now();
  const allStepResults: StepResult[] = [];
  let overallSuccess = true;

  for (const file of files) {
    const filePath = file.startsWith('/')
      ? file
      : join(context.workingDir, file);

    if (!existsSync(filePath)) {
      allStepResults.push({
        name: `Load ${file}`,
        success: false,
        output: '',
        error: `Workflow file not found: ${filePath}`,
        duration: 0
      });
      overallSuccess = false;
      break;
    }

    const content = readFileSync(filePath, 'utf-8');
    const result = await runWorkflow(content, context);

    allStepResults.push(...result.steps);

    if (!result.success) {
      overallSuccess = false;
      break;
    }
  }

  return {
    success: overallSuccess,
    steps: allStepResults,
    duration: Date.now() - startTime
  };
}

/**
 * Discover workflow files in a repository.
 * Looks for .kod/workflows/*.toml
 */
export function discoverWorkflows(repoWorkingDir: string): string[] {
  const workflowDir = join(repoWorkingDir, '.kod', 'workflows');

  if (!existsSync(workflowDir)) {
    return [];
  }

  try {
    const { readdirSync } = require('node:fs');
    const files = readdirSync(workflowDir) as string[];
    return files
      .filter((f: string) => f.endsWith('.toml'))
      .map((f: string) => join(workflowDir, f));
  } catch {
    return [];
  }
}
