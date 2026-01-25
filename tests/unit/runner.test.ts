import { describe, test, expect } from 'vitest';

import { runWorkflow } from '../../src/server/workflow/runner.js';
import type { WorkflowContext } from '../../src/shared/types.js';

const createContext = (): WorkflowContext => ({
  env: {},
  branch: 'main',
  repo: 'test-repo',
  workingDir: '/tmp'
});

describe('Workflow Runner', () => {
  test('It should run a successful workflow', async () => {
    const workflow = `
[step:hello]
run: echo "Hello World"
`;
    const result = await runWorkflow(workflow, createContext());

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].success).toBe(true);
    expect(result.steps[0].output.trim()).toBe('Hello World');
  });

  test('It should mark step as failed when exit code is non-zero', async () => {
    const workflow = `
[step:failing]
run: exit 1
`;
    const result = await runWorkflow(workflow, createContext());

    expect(result.success).toBe(false);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].success).toBe(false);
    expect(result.steps[0].error).toBe('Exit code: 1');
  });

  test('It should mark workflow as failed when a step fails', async () => {
    const workflow = `
[step:first]
run: echo "First"

[step:failing]
run: exit 1

[step:third]
run: echo "Third"
`;
    const result = await runWorkflow(workflow, createContext());

    expect(result.success).toBe(false);
    expect(result.steps).toHaveLength(2); // Third step should not run
    expect(result.steps[0].success).toBe(true);
    expect(result.steps[0].name).toBe('first');
    expect(result.steps[1].success).toBe(false);
    expect(result.steps[1].name).toBe('failing');
  });

  test('It should capture exit code from command with output', async () => {
    const workflow = `
[step:echo-and-fail]
run: echo "Some output" && exit 42
`;
    const result = await runWorkflow(workflow, createContext());

    expect(result.success).toBe(false);
    expect(result.steps[0].success).toBe(false);
    expect(result.steps[0].error).toBe('Exit code: 42');
    expect(result.steps[0].output).toContain('Some output');
  });

  test('It should continue when continue_on_error is set', async () => {
    const workflow = `
[step:failing]
run: exit 1
continue_on_error: true

[step:after]
run: echo "After failure"
`;
    const result = await runWorkflow(workflow, createContext());

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].success).toBe(false);
    expect(result.steps[1].success).toBe(true);
    expect(result.steps[1].output.trim()).toBe('After failure');
  });

  test('It should run multiple commands in a step and fail on first failure', async () => {
    const workflow = `
[step:multi]
run:
  echo "line1"
  exit 1
  echo "line3"
`;
    const result = await runWorkflow(workflow, createContext());

    expect(result.success).toBe(false);
    expect(result.steps[0].success).toBe(false);
    expect(result.steps[0].output).toContain('line1');
    expect(result.steps[0].output).not.toContain('line3');
  });
});
