import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

import type { Database } from '../db/index.js';

/**
 * Manages SSH authorized_keys for Git access.
 *
 * Each collaborator's key is added with a forced command that:
 * 1. Sets the username in an environment variable
 * 2. Calls the kod-shell script which validates access
 *
 * The authorized_keys line format is:
 * command="KOD_USER=<username> /path/to/kod-shell",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty <key>
 */
export class SshKeyManager {
  private authorizedKeysPath: string;
  private shellPath: string;
  private reposDir: string;

  constructor(dataDir: string, reposDir: string) {
    // Default to ~/.ssh/authorized_keys but allow override
    const sshDir = process.env.KOD_SSH_DIR || join(homedir(), '.ssh');
    this.authorizedKeysPath =
      process.env.KOD_AUTHORIZED_KEYS || join(sshDir, 'authorized_keys');
    this.shellPath = process.env.KOD_SHELL || join(dataDir, 'kod-shell');
    this.reposDir = reposDir;
  }

  /**
   * Regenerate the authorized_keys file from the database.
   * This is the safest approach - always rebuild from source of truth.
   */
  async regenerateAuthorizedKeys(db: Database): Promise<void> {
    const allCollaborators = await db.listCollaborators();
    const lines: string[] = [];

    // Header comment
    lines.push('# Kod managed keys - DO NOT EDIT MANUALLY');
    lines.push('# Regenerated automatically when collaborators change');
    lines.push('');

    for (const collab of allCollaborators) {
      // Get all repos this user has access to
      const repos = await this.getCollaboratorRepos(db, collab.username);

      if (repos.length === 0) {
        // User has no repos - don't add their key
        continue;
      }

      // Validate the public key format
      if (!this.isValidPublicKey(collab.publicKey)) {
        console.warn(
          `Skipping invalid public key for user: ${collab.username}`
        );
        continue;
      }

      // Create the authorized_keys line
      const repoList = repos.join(',');
      const command = `KOD_USER=${collab.username} KOD_REPOS=${repoList} KOD_REPOS_DIR=${this.reposDir} ${this.shellPath}`;
      const options =
        'no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty';

      lines.push(`command="${command}",${options} ${collab.publicKey}`);
    }

    // Ensure the .ssh directory exists
    const sshDir = dirname(this.authorizedKeysPath);
    if (!existsSync(sshDir)) {
      mkdirSync(sshDir, { recursive: true, mode: 0o700 });
    }

    // Read existing file to preserve non-Kod keys
    let existingContent = '';
    if (existsSync(this.authorizedKeysPath)) {
      existingContent = readFileSync(this.authorizedKeysPath, 'utf-8');
    }

    // Extract non-Kod keys (lines before our header or after our section)
    const preservedLines = this.extractNonKodKeys(existingContent);

    // Combine preserved keys with Kod-managed keys
    const finalContent = `${[...preservedLines, '', ...lines].join('\n')}\n`;

    // Write with restrictive permissions
    writeFileSync(this.authorizedKeysPath, finalContent, { mode: 0o600 });
  }

  /**
   * Install the kod-shell script that handles Git commands.
   */
  installShell(): void {
    const shellContent = `#!/bin/sh
# Kod Git shell - validates repository access
# Environment variables set by authorized_keys:
#   KOD_USER - the username
#   KOD_REPOS - comma-separated list of allowed repos
#   KOD_REPOS_DIR - path to repos directory

# Only allow git commands
case "$SSH_ORIGINAL_COMMAND" in
  git-upload-pack*|git-receive-pack*)
    # Extract repo name from command
    # Format: git-upload-pack '/path/to/repo.git' or git-receive-pack 'repo.git'
    repo_path=$(echo "$SSH_ORIGINAL_COMMAND" | sed "s/.*'\\(.*\\)'/\\1/")
    repo_name=$(basename "$repo_path" .git)

    # Check if repo is in allowed list
    if echo ",$KOD_REPOS," | grep -q ",$repo_name,"; then
      # Allowed - execute the git command
      exec git-shell -c "$SSH_ORIGINAL_COMMAND"
    else
      echo "Error: Access denied to repository '$repo_name'" >&2
      exit 1
    fi
    ;;
  *)
    echo "Error: Only git commands are allowed" >&2
    exit 1
    ;;
esac
`;

    const shellDir = dirname(this.shellPath);
    if (!existsSync(shellDir)) {
      mkdirSync(shellDir, { recursive: true });
    }

    writeFileSync(this.shellPath, shellContent, { mode: 0o755 });
  }

  /**
   * Get list of repos a collaborator has access to.
   */
  private async getCollaboratorRepos(
    db: Database,
    username: string
  ): Promise<string[]> {
    const repos: string[] = [];
    const allRepos = await db.listRepos();

    for (const repo of allRepos) {
      const repoCollabs = await db.getRepoCollaborators(repo.name);
      if (repoCollabs?.collaborators.includes(username)) {
        repos.push(repo.name);
      }
    }

    return repos;
  }

  /**
   * Basic validation of SSH public key format.
   */
  private isValidPublicKey(key: string): boolean {
    // Must start with a known key type
    const validPrefixes = [
      'ssh-rsa',
      'ssh-ed25519',
      'ssh-dss',
      'ecdsa-sha2-nistp256',
      'ecdsa-sha2-nistp384',
      'ecdsa-sha2-nistp521',
      'sk-ssh-ed25519@openssh.com',
      'sk-ecdsa-sha2-nistp256@openssh.com'
    ];

    const trimmedKey = key.trim();
    return validPrefixes.some((prefix) => trimmedKey.startsWith(prefix));
  }

  /**
   * Extract lines that weren't added by Kod.
   */
  private extractNonKodKeys(content: string): string[] {
    const lines = content.split('\n');
    const preserved: string[] = [];
    let inKodSection = false;

    for (const line of lines) {
      if (line.includes('Kod managed keys')) {
        inKodSection = true;
        continue;
      }

      if (inKodSection) {
        // Skip Kod-managed lines (contain KOD_USER)
        if (line.includes('KOD_USER=') || line.trim() === '') {
          continue;
        }
        // Non-empty line that's not Kod - end of our section
        inKodSection = false;
      }

      if (!inKodSection && line.trim()) {
        preserved.push(line);
      }
    }

    return preserved;
  }
}
