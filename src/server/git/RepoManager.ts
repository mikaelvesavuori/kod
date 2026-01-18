import { existsSync, rmSync, renameSync } from 'node:fs';
import { join } from 'node:path';

import { exec } from '../../shared/exec.js';

export class RepoManager {
  private reposDir: string;

  constructor(reposDir: string) {
    this.reposDir = reposDir;
  }

  getRepoPath(name: string): string {
    return join(this.reposDir, `${name}.git`);
  }

  async create(name: string): Promise<string> {
    const repoPath = this.getRepoPath(name);

    if (existsSync(repoPath)) {
      throw new Error(`Repository '${name}' already exists`);
    }

    // Create bare repository
    const result = await exec(`git init --bare "${repoPath}"`);

    if (result.exitCode !== 0) {
      throw new Error(`Failed to create repository: ${result.stderr}`);
    }

    return repoPath;
  }

  async rename(oldName: string, newName: string): Promise<string> {
    const oldPath = this.getRepoPath(oldName);
    const newPath = this.getRepoPath(newName);

    if (!existsSync(oldPath)) {
      throw new Error(`Repository '${oldName}' does not exist`);
    }

    if (existsSync(newPath)) {
      throw new Error(`Repository '${newName}' already exists`);
    }

    renameSync(oldPath, newPath);

    return newPath;
  }

  async delete(name: string): Promise<void> {
    const repoPath = this.getRepoPath(name);

    if (!existsSync(repoPath)) {
      throw new Error(`Repository '${name}' does not exist`);
    }

    rmSync(repoPath, { recursive: true, force: true });
  }

  exists(name: string): boolean {
    return existsSync(this.getRepoPath(name));
  }

  async getBranches(name: string): Promise<string[]> {
    const repoPath = this.getRepoPath(name);

    if (!existsSync(repoPath)) {
      return [];
    }

    const result = await exec(`git --git-dir="${repoPath}" branch`, {
      cwd: repoPath
    });

    if (result.exitCode !== 0) {
      return [];
    }

    return result.stdout
      .split('\n')
      .map((line) => line.trim().replace(/^\* /, ''))
      .filter((line) => line.length > 0);
  }

  async getDefaultBranch(name: string): Promise<string | null> {
    const repoPath = this.getRepoPath(name);

    if (!existsSync(repoPath)) {
      return null;
    }

    const result = await exec(
      `git --git-dir="${repoPath}" symbolic-ref --short HEAD`,
      { cwd: repoPath }
    );

    if (result.exitCode !== 0) {
      return null;
    }

    return result.stdout.trim() || null;
  }

  async getLatestCommit(name: string, branch?: string): Promise<string | null> {
    const repoPath = this.getRepoPath(name);

    if (!existsSync(repoPath)) {
      return null;
    }

    const ref = branch || 'HEAD';
    const result = await exec(`git --git-dir="${repoPath}" rev-parse ${ref}`, {
      cwd: repoPath
    });

    if (result.exitCode !== 0) {
      return null;
    }

    return result.stdout.trim() || null;
  }
}
