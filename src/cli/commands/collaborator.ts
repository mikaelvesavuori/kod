import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { api } from '../http-client.js';

import type { Collaborator } from '../../shared/types.js';

export async function addCollaborator(
  repoName: string,
  username: string,
  publicKeyPath?: string
): Promise<void> {
  if (!repoName || !username) {
    console.error('Error: Repository name and username are required');
    console.error(
      'Usage: kod repo <name> collaborator add <username> [key-path]'
    );
    process.exit(1);
  }

  // Try to find public key
  let publicKey = '';

  if (publicKeyPath) {
    // Explicit path provided
    if (!existsSync(publicKeyPath)) {
      console.error(`Error: Public key file not found: ${publicKeyPath}`);
      process.exit(1);
    }
    publicKey = readFileSync(publicKeyPath, 'utf-8').trim();
  } else {
    // Try default locations
    const defaultPaths = [
      join(homedir(), '.ssh', 'id_ed25519.pub'),
      join(homedir(), '.ssh', 'id_rsa.pub')
    ];

    for (const path of defaultPaths) {
      if (existsSync(path)) {
        publicKey = readFileSync(path, 'utf-8').trim();
        break;
      }
    }

    if (!publicKey) {
      console.error('Error: No SSH public key found.');
      console.error(
        'Provide a key path: kod repo <name> collaborator add <username> <key-path>'
      );
      console.error('Or create an SSH key: ssh-keygen -t ed25519');
      process.exit(1);
    }
  }

  const response = await api.post<Collaborator>(
    `/repos/${repoName}/collaborators`,
    {
      username,
      publicKey
    }
  );

  if (!response.ok) {
    console.error(`Error: ${response.error}`);
    process.exit(1);
  }

  console.log(`Collaborator '${username}' added to '${repoName}'.`);
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
    console.log(`    Key: ${collab.publicKey.slice(0, 30)}...`);
    console.log();
  }
}
