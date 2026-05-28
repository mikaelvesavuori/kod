import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';

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
    const workingDirResult = resolveInsideBase(
      context.workingDir,
      step.working_dir ?? '.'
    );
    if (!workingDirResult.ok) {
      stepResults.push({
        name: step.name,
        success: false,
        output: '',
        error: workingDirResult.error,
        duration: Date.now() - stepStart
      });
      success = false;
      break;
    }
    const workingDir = workingDirResult.path;

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

      stepOutput += redact(result.stdout, context.redactedValues);
      if (result.stderr) {
        stepOutput += redact(result.stderr, context.redactedValues);
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

    const safePath = resolveInsideBase(context.workingDir, filePath);
    if (!safePath.ok) {
      allStepResults.push({
        name: `Load ${file}`,
        success: false,
        output: '',
        error: safePath.error,
        duration: 0
      });
      overallSuccess = false;
      break;
    }

    if (!existsSync(safePath.path)) {
      allStepResults.push({
        name: `Load ${file}`,
        success: false,
        output: '',
        error: `Workflow file not found: ${safePath.path}`,
        duration: 0
      });
      overallSuccess = false;
      break;
    }

    const content = readFileSync(safePath.path, 'utf-8');
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
    const files = readdirSync(workflowDir);
    return files
      .filter((f) => f.endsWith('.toml'))
      .map((f) => join(workflowDir, f));
  } catch {
    return [];
  }
}

function resolveInsideBase(
  baseDir: string,
  path: string
): { ok: true; path: string } | { ok: false; error: string } {
  const base = resolve(baseDir);
  const target = resolve(base, path);
  const rel = relative(base, target);

  if (
    rel === '..' ||
    rel.startsWith(`..${sep}`) ||
    resolve(target) !== target
  ) {
    return {
      ok: false,
      error: `Path must stay inside the repository: ${path}`
    };
  }

  return { ok: true, path: target };
}

function redact(output: string, values: string[] | undefined): string {
  if (!values || values.length === 0 || output.length === 0) return output;

  let redacted = output;
  for (const value of values) {
    if (!value) continue;
    redacted = redacted.split(value).join('[secret]');
  }
  return redacted;
}
