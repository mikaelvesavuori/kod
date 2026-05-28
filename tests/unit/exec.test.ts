import { describe, test, expect } from 'vitest';

import { exec, execFile } from '../../src/shared/exec.js';

describe('Exec', () => {
  test('It should execute a simple command', async () => {
    const result = await exec('echo "hello"');

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello');
  });

  test('It should capture stderr', async () => {
    const result = await exec('echo "error" >&2');

    expect(result.stderr.trim()).toBe('error');
  });

  test('It should return non-zero exit code on failure', async () => {
    const result = await exec('exit 1');

    expect(result.exitCode).toBe(1);
  });

  test('It should respect cwd option', async () => {
    const result = await exec('pwd', { cwd: '/tmp' });

    // On macOS, /tmp is a symlink to /private/tmp
    expect(result.stdout.trim()).toMatch(/^(\/tmp|\/private\/tmp)$/);
  });

  test('It should pass environment variables', async () => {
    const result = await exec('echo $MY_VAR', {
      env: { MY_VAR: 'test-value' }
    });

    expect(result.stdout.trim()).toBe('test-value');
  });

  test('It should handle command with arguments', async () => {
    const result = await exec('echo one two three');

    expect(result.stdout.trim()).toBe('one two three');
  });

  test('It should handle command that outputs nothing', async () => {
    const result = await exec('true');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
  });

  test('It should handle piped commands', async () => {
    const result = await exec('echo "hello world" | tr "h" "H"');

    expect(result.stdout.trim()).toBe('Hello world');
  });

  test('It should handle multi-line output', async () => {
    const result = await exec('echo -e "line1\\nline2\\nline3"');

    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(3);
  });

  test('It should handle command not found', async () => {
    const result = await exec('nonexistent-command-12345');

    expect(result.exitCode).not.toBe(0);
  });

  test('It should execute a file with arguments without a shell', async () => {
    const result = await execFile('node', [
      '-e',
      'console.log(process.argv[1])',
      'hello; echo injected'
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello; echo injected');
  });
});
