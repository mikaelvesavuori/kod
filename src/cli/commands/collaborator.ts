import { api } from '../http-client.js';

import type { Collaborator } from '../../shared/types.js';

export async function addCollaborator(
  repoName: string,
  username: string
): Promise<void> {
  if (!repoName || !username) {
    console.error('Error: Repository name and username are required');
    console.error('Usage: kod repo <name> collaborator add <username>');
    process.exit(1);
  }

  const response = await api.post<Collaborator>(
    `/repos/${repoName}/collaborators`,
    { username }
  );

  if (!response.ok) {
    console.error(`Error: ${response.error}`);
    process.exit(1);
  }

  console.log(`Collaborator '${username}' added to '${repoName}'.`);
  console.log(`Create a token for this user: kod token create ${username}-token --username ${username}`);
}

export async function removeCollaborator(
  repoName: string,
  username: string
): Promise<void> {
  if (!repoName || !username) {
    console.error('Error: Repository name and username are required');
    console.error('Usage: kod repo <name> collaborator remove <username>');
    process.exit(1);
  }

  const response = await api.delete(
    `/repos/${repoName}/collaborators/${username}`
  );

  if (!response.ok) {
    console.error(`Error: ${response.error}`);
    process.exit(1);
  }

  console.log(`Collaborator '${username}' removed from '${repoName}'.`);
}

export async function listCollaborators(repoName: string): Promise<void> {
  if (!repoName) {
    console.error('Error: Repository name is required');
    console.error('Usage: kod repo <name> collaborator list');
    process.exit(1);
  }

  const response = await api.get<Collaborator[]>(
    `/repos/${repoName}/collaborators`
  );

  if (!response.ok) {
    console.error(`Error: ${response.error}`);
    process.exit(1);
  }

  const collaborators = response.data || [];

  if (collaborators.length === 0) {
    console.log(`No collaborators for '${repoName}'.`);
    return;
  }

  console.log(`Collaborators for '${repoName}':\n`);
  for (const collab of collaborators) {
    const added = new Date(collab.addedAt).toLocaleDateString();
    console.log(`  ${collab.username}`);
    console.log(`    Added: ${added}`);
    console.log();
  }
}
