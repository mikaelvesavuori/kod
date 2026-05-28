import { relative, resolve, sep } from 'node:path';

import { execFile } from '../../shared/exec.js';

export async function isValidBranchName(branch: string): Promise<boolean> {
  if (
    !branch ||
    branch.length > 255 ||
    branch.startsWith('-') ||
    hasControlCharacter(branch)
  ) {
    return false;
  }

  const result = await execFile('git', [
    'check-ref-format',
    '--branch',
    branch
  ]);
  return result.exitCode === 0;
}

function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 32 || code === 127) {
      return true;
    }
  }
  return false;
}

export function isValidCommit(commit: string): boolean {
  return commit === '' || /^[0-9a-fA-F]{7,64}$/.test(commit);
}

export function resolveWorkflowFile(
  workingDir: string,
  file: string
): { ok: true; path: string } | { ok: false; error: string } {
  if (!file || file.includes('\0')) {
    return { ok: false, error: 'Workflow file path is invalid' };
  }

  const base = resolve(workingDir);
  const target = resolve(base, file);
  const rel = relative(base, target);

  if (rel === '..' || rel.startsWith(`..${sep}`)) {
    return {
      ok: false,
      error: `Workflow file must stay inside the repository: ${file}`
    };
  }

  if (
    !rel.startsWith(`.kod${sep}workflows${sep}`) &&
    rel !== `.kod${sep}workflows`
  ) {
    return {
      ok: false,
      error: `Workflow file must be in .kod/workflows: ${file}`
    };
  }

  return { ok: true, path: target };
}
