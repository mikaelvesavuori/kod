import { writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Generate and install a post-receive hook for a repository.
 * This hook triggers workflow execution when code is pushed.
 * Uses internal hook endpoint that doesn't require auth (localhost only).
 */
export function installPostReceiveHook(
  repoPath: string,
  serverUrl: string
): void {
  const hookPath = join(repoPath, 'hooks', 'post-receive');
  const hookContent = generatePostReceiveHook(serverUrl);

  writeFileSync(hookPath, hookContent, 'utf-8');
  chmodSync(hookPath, 0o755);
}

function generatePostReceiveHook(serverUrl: string): string {
  // Extract repo name from the path (will be set by git)
  // The hook receives stdin with: <old-sha> <new-sha> <ref>
  return `#!/bin/sh
# Kod post-receive hook - triggers workflow on push

# Read all refs being pushed
while read oldrev newrev refname; do
  # Extract branch name from ref (refs/heads/main -> main)
  branch=$(echo "$refname" | sed 's|refs/heads/||')

  # Get repo name from the git directory path
  repo_path=$(pwd)
  repo_name=$(basename "$repo_path" .git)

  # Trigger workflow via internal hook endpoint (no auth required for localhost)
  curl -s -X POST \\
    -H "Content-Type: application/json" \\
    -d "{\\"branch\\": \\"$branch\\", \\"commit\\": \\"$newrev\\"}" \\
    "${serverUrl}/internal/hooks/$repo_name/push" \\
    > /dev/null 2>&1 &

  echo "Kod: Workflow triggered for $repo_name on branch $branch"
done
`;
}

/**
 * Generate a pre-receive hook to validate pushes.
 * Currently just a placeholder - can be used for access control.
 */
export function installPreReceiveHook(repoPath: string): void {
  const hookPath = join(repoPath, 'hooks', 'pre-receive');
  const hookContent = `#!/bin/sh
# Kod pre-receive hook - validates push permissions
# Currently allows all pushes
exit 0
`;

  writeFileSync(hookPath, hookContent, 'utf-8');
  chmodSync(hookPath, 0o755);
}
