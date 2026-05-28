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
# Kod pre-receive hook - validates protected branch pushes

protected_file="$(pwd)/kod-protected-branches"

if [ ! -f "$protected_file" ]; then
  exit 0
fi

while read oldrev newrev refname; do
  case "$refname" in
    refs/heads/*)
      branch=$(echo "$refname" | sed 's|refs/heads/||')
      ;;
    *)
      continue
      ;;
  esac

  while IFS= read -r protected_branch; do
    [ -z "$protected_branch" ] && continue
    [ "$branch" != "$protected_branch" ] && continue

    if [ "$KOD_IS_ADMIN" = "true" ] || [ "$KOD_IS_OWNER" = "true" ]; then
      continue
    fi

    echo "Kod: branch '$branch' is protected; only the repository owner or an admin can push to it" >&2
    exit 1
  done < "$protected_file"
done

exit 0
`;

  writeFileSync(hookPath, hookContent, 'utf-8');
  chmodSync(hookPath, 0o755);
}

export function writeProtectedBranches(
  repoPath: string,
  branches: string[]
): void {
  const filePath = join(repoPath, 'kod-protected-branches');
  const content = branches.length > 0 ? `${branches.join('\n')}\n` : '';
  writeFileSync(filePath, content, 'utf-8');
}
