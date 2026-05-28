import { exec as nodeExec, spawn } from 'node:child_process';

export interface ExecOptions {
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function exec(
  command: string,
  options: ExecOptions = {}
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const env = options.env ? { ...process.env, ...options.env } : process.env;

    nodeExec(
      command,
      {
        cwd: options.cwd,
        timeout: options.timeout,
        env,
        maxBuffer: 10 * 1024 * 1024 // 10MB
      },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          exitCode: error?.code ?? 0
        });
      }
    );
  });
}

export function execFile(
  command: string,
  args: string[] = [],
  options: ExecOptions = {}
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const env = options.env ? { ...process.env, ...options.env } : process.env;
    const proc = spawn(command, args, {
      cwd: options.cwd,
      env,
      shell: false
    });

    let stdout = '';
    let stderr = '';
    let killed = false;
    let timeout: NodeJS.Timeout | undefined;

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    if (options.timeout) {
      timeout = setTimeout(() => {
        killed = true;
        proc.kill('SIGKILL');
      }, options.timeout);
    }

    proc.on('close', (code) => {
      if (timeout) clearTimeout(timeout);
      resolve({
        stdout,
        stderr,
        exitCode: killed ? 124 : (code ?? 0)
      });
    });

    proc.on('error', (err) => {
      if (timeout) clearTimeout(timeout);
      resolve({
        stdout,
        stderr: stderr + err.message,
        exitCode: 1
      });
    });
  });
}
