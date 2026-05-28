/** biome-ignore-all lint/style/noNonNullAssertion: OK */
import type { Repo } from '../../shared/types.js';

import { api } from '../http-client.js';
import { buildRepoUrl } from './clone.js';

interface RepoInfo extends Repo {
  collaborators: string[];
  branches: string[];
  defaultBranch: string | null;
}

interface BranchProtectionResponse {
  branches: string[];
}

interface WebhookInfo {
  id: string;
  repoName: string;
  url: string;
  events: string[];
  createdAt: number;
}

interface WebhookDeliveryInfo {
  id: string;
  webhookId: string;
  repoName: string;
  event: string;
  url: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  lastAttemptAt?: number;
  nextAttemptAt?: number;
  responseStatus?: number;
  error?: string;
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

export async function importRepo(source: string, name?: string): Promise<void> {
  if (!source) {
    console.error('Error: Repository source is required');
    console.error('Usage: kod repo import <source> [name]');
    process.exit(1);
  }

  const response = await api.post<Repo>('/repos/import', { source, name });

  if (!response.ok) {
    console.error(`Error: ${response.error}`);
    process.exit(1);
  }

  const repo = response.data!;
  console.log(`Repository '${repo.name}' imported successfully.`);
  console.log();
  console.log('Clone with:');
  console.log(`  kod clone ${repo.name}`);
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

  if ((repo.protectedBranches ?? []).length > 0) {
    console.log();
    console.log('Protected branches:');
    for (const branch of repo.protectedBranches ?? []) {
      console.log(`  ${branch}`);
    }
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

export async function listProtectedBranches(name: string): Promise<void> {
  const response = await api.get<BranchProtectionResponse>(
    `/repos/${name}/protections/branches`
  );

  if (!response.ok) {
    console.error(`Error: ${response.error}`);
    process.exit(1);
  }

  const branches = response.data?.branches ?? [];
  if (branches.length === 0) {
    console.log('No protected branches.');
    return;
  }

  console.log('Protected branches:\n');
  for (const branch of branches) {
    console.log(`  ${branch}`);
  }
}

export async function protectBranch(
  name: string,
  branch: string
): Promise<void> {
  if (!branch) {
    console.error('Usage: kod repo <name> protect <branch>');
    process.exit(1);
  }

  const response = await api.put<BranchProtectionResponse>(
    `/repos/${name}/protections/branches/${encodeURIComponent(branch)}`
  );

  if (!response.ok) {
    console.error(`Error: ${response.error}`);
    process.exit(1);
  }

  console.log(`Branch '${branch}' protected.`);
}

export async function unprotectBranch(
  name: string,
  branch: string
): Promise<void> {
  if (!branch) {
    console.error('Usage: kod repo <name> unprotect <branch>');
    process.exit(1);
  }

  const response = await api.delete<BranchProtectionResponse>(
    `/repos/${name}/protections/branches/${encodeURIComponent(branch)}`
  );

  if (!response.ok) {
    console.error(`Error: ${response.error}`);
    process.exit(1);
  }

  console.log(`Branch '${branch}' unprotected.`);
}

export async function listWebhooks(name: string): Promise<void> {
  const response = await api.get<WebhookInfo[]>(`/repos/${name}/webhooks`);

  if (!response.ok) {
    console.error(`Error: ${response.error}`);
    process.exit(1);
  }

  const webhooks = response.data ?? [];
  if (webhooks.length === 0) {
    console.log('No webhooks configured.');
    return;
  }

  console.log('Webhooks:\n');
  for (const webhook of webhooks) {
    console.log(`  ${webhook.id}`);
    console.log(`    URL: ${webhook.url}`);
    console.log(`    Events: ${webhook.events.join(', ')}`);
    console.log(`    Created: ${new Date(webhook.createdAt).toLocaleString()}`);
    console.log();
  }
}

export async function addWebhook(
  name: string,
  url: string,
  events: string[],
  secret?: string
): Promise<void> {
  if (!url) {
    console.error(
      'Usage: kod repo <name> webhook add <url> [--events push,workflow] [--secret <secret>]'
    );
    process.exit(1);
  }

  const response = await api.post<WebhookInfo>(`/repos/${name}/webhooks`, {
    url,
    events: events.length > 0 ? events : undefined,
    secret
  });

  if (!response.ok) {
    console.error(`Error: ${response.error}`);
    process.exit(1);
  }

  console.log(`Webhook ${response.data?.id} added.`);
}

export async function removeWebhook(name: string, id: string): Promise<void> {
  if (!id) {
    console.error('Usage: kod repo <name> webhook remove <id>');
    process.exit(1);
  }

  const response = await api.delete(`/repos/${name}/webhooks/${id}`);

  if (!response.ok) {
    console.error(`Error: ${response.error}`);
    process.exit(1);
  }

  console.log(`Webhook ${id} removed.`);
}

export async function listWebhookDeliveries(
  name: string,
  id: string
): Promise<void> {
  if (!id) {
    console.error('Usage: kod repo <name> webhook deliveries <id>');
    process.exit(1);
  }

  const response = await api.get<WebhookDeliveryInfo[]>(
    `/repos/${name}/webhooks/${id}/deliveries`
  );

  if (!response.ok) {
    console.error(`Error: ${response.error}`);
    process.exit(1);
  }

  const deliveries = response.data ?? [];
  if (deliveries.length === 0) {
    console.log('No webhook deliveries found.');
    return;
  }

  console.log('Webhook deliveries:\n');
  for (const delivery of deliveries) {
    console.log(`  ${delivery.id}`);
    console.log(`    Event: ${delivery.event}`);
    console.log(`    Status: ${delivery.status}`);
    console.log(`    Attempts: ${delivery.attempts}/${delivery.maxAttempts}`);
    if (delivery.responseStatus) {
      console.log(`    Response: HTTP ${delivery.responseStatus}`);
    }
    if (delivery.error) {
      console.log(`    Error: ${delivery.error}`);
    }
    if (delivery.nextAttemptAt) {
      console.log(
        `    Next retry: ${new Date(delivery.nextAttemptAt).toLocaleString()}`
      );
    }
    console.log(
      `    Created: ${new Date(delivery.createdAt).toLocaleString()}`
    );
    console.log();
  }
}

export async function retryWebhookDelivery(
  name: string,
  id: string,
  deliveryId: string
): Promise<void> {
  if (!id || !deliveryId) {
    console.error('Usage: kod repo <name> webhook retry <id> <delivery-id>');
    process.exit(1);
  }

  const response = await api.post<WebhookDeliveryInfo>(
    `/repos/${name}/webhooks/${id}/deliveries/${deliveryId}/retry`
  );

  if (!response.ok) {
    console.error(`Error: ${response.error}`);
    process.exit(1);
  }

  console.log(`Webhook delivery ${deliveryId} retried.`);
  console.log(`Status: ${response.data?.status}`);
}
