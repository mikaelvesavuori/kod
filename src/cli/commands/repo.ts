/** biome-ignore-all lint/style/noNonNullAssertion: OK */
import type { Repo } from '../../shared/types.js';

import { api } from '../http-client.js';
import { buildRepoUrl } from './clone.js';

interface RepoInfo extends Repo {
  collaborators: string[];
  branches: string[];
  defaultBranch: string | null;
}

export async function listRepos(): Promise<void> {
  const response = await api.get<Repo[]>('/repos');

  if (!response.ok) {
    console.error(`Error: ${response.error}`);
    process.exit(1);
  }

  const repos = response.data || [];

  if (repos.length === 0) {
    console.log('No repositories found.');
    return;
  }

  console.log('Repositories:\n');
  for (const repo of repos) {
    const created = new Date(repo.createdAt).toLocaleDateString();
    console.log(`  ${repo.name}`);
    console.log(`    Created: ${created}`);
    console.log();
  }
}

export async function createRepo(name: string): Promise<void> {
  if (!name) {
    console.error('Error: Repository name is required');
    console.error('Usage: kod repo create <name>');
    process.exit(1);
  }

  const response = await api.post<Repo>('/repos', { name });

  if (!response.ok) {
    console.error(`Error: ${response.error}`);
    process.exit(1);
  }

  const repo = response.data!;

  console.log(`Repository '${repo.name}' created successfully.`);
  console.log();
  console.log('Clone with:');
  console.log(`  kod clone ${repo.name}`);
  console.log();
  console.log('Or with plain git (use your API token as password):');
  console.log(`  git clone ${buildRepoUrl(repo.name)}`);
  console.log();
  console.log('Add as remote:');
  console.log(`  git remote add origin ${buildRepoUrl(repo.name)}`);
}

export async function getRepoInfo(name: string): Promise<void> {
  if (!name) {
    console.error('Error: Repository name is required');
    console.error('Usage: kod repo <name> info');
    process.exit(1);
  }

  const response = await api.get<RepoInfo>(`/repos/${name}`);

  if (!response.ok) {
    console.error(`Error: ${response.error}`);
    process.exit(1);
  }

  const repo = response.data!;

  console.log(`Repository: ${repo.name}`);
  console.log(`Created: ${new Date(repo.createdAt).toLocaleString()}`);
  console.log(`Default branch: ${repo.defaultBranch || '(none)'}`);
  console.log();
  console.log('Clone URL:');
  console.log(`  ${buildRepoUrl(repo.name)}`);
  console.log();

  if (repo.branches.length > 0) {
    console.log('Branches:');
    for (const branch of repo.branches) {
      const marker = branch === repo.defaultBranch ? ' *' : '';
      console.log(`  ${branch}${marker}`);
    }
    console.log();
  }

  if (repo.collaborators.length > 0) {
    console.log('Collaborators:');
    for (const collab of repo.collaborators) {
      console.log(`  ${collab}`);
    }
  } else {
    console.log('Collaborators: (none)');
  }
}

export async function updateRepo(
  name: string,
  field: string,
  value: string
): Promise<void> {
  if (!name || !field || !value) {
    console.error('Error: Missing arguments');
    console.error('Usage: kod repo update <name> <field> <value>');
    console.error('Example: kod repo update my-app name new-name');
    process.exit(1);
  }

  if (field !== 'name') {
    console.error(`Error: Unknown field '${field}'. Only 'name' is supported.`);
    process.exit(1);
  }

  const response = await api.patch<Repo>(`/repos/${name}`, { [field]: value });

  if (!response.ok) {
    console.error(`Error: ${response.error}`);
    process.exit(1);
  }

  console.log(`Repository renamed from '${name}' to '${value}'.`);
  console.log();
  console.log('Remember to update your remote URL:');
  console.log(`  git remote set-url origin ${buildRepoUrl(value)}`);
}

export async function deleteRepo(name: string): Promise<void> {
  if (!name) {
    console.error('Error: Repository name is required');
    console.error('Usage: kod repo delete <name>');
    process.exit(1);
  }

  const response = await api.delete(`/repos/${name}`);

  if (!response.ok) {
    console.error(`Error: ${response.error}`);
    process.exit(1);
  }

  console.log(`Repository '${name}' deleted.`);
}
