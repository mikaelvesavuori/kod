import { hashToken } from '../../shared/crypto.js';
import type {
  Repo,
  Collaborator,
  RepoCollaborators,
  WorkflowRun,
  ApiToken
} from '../../shared/types.js';

import { Store } from './Store.js';

const REPOS_TABLE = 'repos';
const COLLABORATORS_TABLE = 'collaborators';
const REPO_COLLABORATORS_TABLE = 'repo_collaborators';
const WORKFLOW_RUNS_TABLE = 'workflow_runs';
const API_TOKENS_TABLE = 'api_tokens';

export class Database {
  private store: Store;

  constructor(dataDir: string) {
    this.store = new Store(dataDir);
  }

  // Repo operations

  async createRepo(repo: Repo): Promise<void> {
    await this.store.write(REPOS_TABLE, repo.name, repo);
    // Initialize empty collaborators list
    await this.store.write(REPO_COLLABORATORS_TABLE, repo.name, {
      repoName: repo.name,
      collaborators: []
    });
  }

  async getRepo(name: string): Promise<Repo | undefined> {
    return this.store.get<Repo>(REPOS_TABLE, name) as Promise<Repo | undefined>;
  }

  async listRepos(): Promise<Repo[]> {
    const repos = await this.store.get<Repo>(REPOS_TABLE);
    return (repos as Repo[]) || [];
  }

  async updateRepo(name: string, updates: Partial<Repo>): Promise<void> {
    const existing = await this.getRepo(name);
    if (!existing) return;

    const updated = { ...existing, ...updates };

    // If name changed, we need to move the record
    if (updates.name && updates.name !== name) {
      await this.store.delete(REPOS_TABLE, name);
      await this.store.write(REPOS_TABLE, updates.name, updated);

      // Also update repo_collaborators
      const collabs = await this.getRepoCollaborators(name);
      if (collabs) {
        await this.store.delete(REPO_COLLABORATORS_TABLE, name);
        await this.store.write(REPO_COLLABORATORS_TABLE, updates.name, {
          ...collabs,
          repoName: updates.name
        });
      }
    } else {
      await this.store.write(REPOS_TABLE, name, updated);
    }
  }

  async deleteRepo(name: string): Promise<void> {
    await this.store.delete(REPOS_TABLE, name);
    await this.store.delete(REPO_COLLABORATORS_TABLE, name);
  }

  // Collaborator operations

  async createCollaborator(collaborator: Collaborator): Promise<void> {
    await this.store.write(
      COLLABORATORS_TABLE,
      collaborator.username,
      collaborator
    );
  }

  async getCollaborator(username: string): Promise<Collaborator | undefined> {
    return this.store.get<Collaborator>(
      COLLABORATORS_TABLE,
      username
    ) as Promise<Collaborator | undefined>;
  }

  async listCollaborators(): Promise<Collaborator[]> {
    const collaborators =
      await this.store.get<Collaborator>(COLLABORATORS_TABLE);
    return (collaborators as Collaborator[]) || [];
  }

  async deleteCollaborator(username: string): Promise<void> {
    await this.store.delete(COLLABORATORS_TABLE, username);
  }

  // Repo-Collaborator relationships

  async getRepoCollaborators(
    repoName: string
  ): Promise<RepoCollaborators | undefined> {
    return this.store.get<RepoCollaborators>(
      REPO_COLLABORATORS_TABLE,
      repoName
    ) as Promise<RepoCollaborators | undefined>;
  }

  async addCollaboratorToRepo(
    repoName: string,
    username: string
  ): Promise<void> {
    const existing = await this.getRepoCollaborators(repoName);
    if (!existing) return;

    if (!existing.collaborators.includes(username)) {
      existing.collaborators.push(username);
      await this.store.write(REPO_COLLABORATORS_TABLE, repoName, existing);
    }
  }

  async removeCollaboratorFromRepo(
    repoName: string,
    username: string
  ): Promise<void> {
    const existing = await this.getRepoCollaborators(repoName);
    if (!existing) return;

    existing.collaborators = existing.collaborators.filter(
      (c: any) => c !== username
    );
    await this.store.write(REPO_COLLABORATORS_TABLE, repoName, existing);
  }

  // Workflow run operations

  async createWorkflowRun(run: WorkflowRun): Promise<void> {
    await this.store.write(WORKFLOW_RUNS_TABLE, run.id, run);
  }

  async getWorkflowRun(id: string): Promise<WorkflowRun | undefined> {
    return this.store.get<WorkflowRun>(WORKFLOW_RUNS_TABLE, id) as Promise<
      WorkflowRun | undefined
    >;
  }

  async updateWorkflowRun(
    id: string,
    updates: Partial<WorkflowRun>
  ): Promise<void> {
    const existing = await this.getWorkflowRun(id);
    if (!existing) return;

    await this.store.write(WORKFLOW_RUNS_TABLE, id, {
      ...existing,
      ...updates
    });
  }

  async listWorkflowRuns(repoName?: string): Promise<WorkflowRun[]> {
    const runs = (await this.store.get<WorkflowRun>(
      WORKFLOW_RUNS_TABLE
    )) as WorkflowRun[];
    if (!runs) return [];

    if (repoName) {
      return runs.filter((r) => r.repoName === repoName);
    }
    return runs;
  }

  async close(): Promise<void> {
    await this.store.close();
  }

  // API Token operations

  /**
   * Create a new API token. Returns the plain token (only shown once).
   * The token is hashed before storage.
   * @param expiresInDays - Optional expiration in days (undefined = never expires)
   * @param username - Optional collaborator username to link this token for Git access
   */
  async createApiToken(
    name: string,
    permissions: ApiToken['permissions'],
    expiresInDays?: number,
    username?: string
  ): Promise<{ token: string; id: string; expiresAt?: number }> {
    const id = this.generateId();
    const token = this.generateToken();
    const tokenHashed = hashToken(token);

    const expiresAt = expiresInDays
      ? Date.now() + expiresInDays * 24 * 60 * 60 * 1000
      : undefined;

    const apiToken: ApiToken = {
      id,
      tokenHash: tokenHashed,
      name,
      createdAt: Date.now(),
      expiresAt,
      permissions,
      username
    };

    // Use PikoDB's built-in expiration if token expires
    await this.store.write(API_TOKENS_TABLE, id, apiToken, expiresAt);

    return { token, id, expiresAt };
  }

  /**
   * Create an admin token with a known token value (for bootstrapping).
   * Used when KOD_ADMIN_TOKEN env var is set on first server start.
   */
  async createAdminToken(token: string): Promise<void> {
    const id = this.generateId();
    const tokenHashed = hashToken(token);

    const apiToken: ApiToken = {
      id,
      tokenHash: tokenHashed,
      name: 'admin',
      createdAt: Date.now(),
      permissions: ['admin']
    };

    await this.store.write(API_TOKENS_TABLE, id, apiToken);
  }

  /**
   * Validate a token and return its metadata if valid.
   * Returns undefined if token is invalid or expired.
   */
  async validateToken(token: string): Promise<ApiToken | undefined> {
    const tokenHashed = hashToken(token);
    const tokens = await this.store.get<ApiToken>(API_TOKENS_TABLE);

    if (!tokens) return undefined;

    const found = tokens.find((t) => t.tokenHash === tokenHashed);

    if (!found) return undefined;

    // Check expiration (double-check even though PikoDB should auto-expire)
    if (found.expiresAt && found.expiresAt < Date.now()) {
      // Token expired, delete it
      await this.store.delete(API_TOKENS_TABLE, found.id);
      return undefined;
    }

    // Update last used timestamp
    await this.store.write(
      API_TOKENS_TABLE,
      found.id,
      { ...found, lastUsedAt: Date.now() },
      found.expiresAt
    );

    return found;
  }

  /**
   * List all tokens (without the actual token values).
   */
  async listApiTokens(): Promise<Omit<ApiToken, 'tokenHash'>[]> {
    const tokens = await this.store.get<ApiToken>(API_TOKENS_TABLE);
    if (!tokens) return [];

    return tokens.map(({ tokenHash: _, ...rest }) => rest);
  }

  /**
   * Delete an API token by ID.
   */
  async deleteApiToken(id: string): Promise<void> {
    await this.store.delete(API_TOKENS_TABLE, id);
  }

  private generateId(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 12; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
  }

  private generateToken(): string {
    const chars =
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let token = 'kod_';
    for (let i = 0; i < 32; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
  }
}
