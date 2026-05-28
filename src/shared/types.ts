// Core domain types for Kod

export interface Repo {
  name: string;
  createdAt: number;
  path: string;
  ownerTokenId: string; // Token ID that created this repo
  protectedBranches?: string[]; // Branches writable only by owner/admin
}

export interface Collaborator {
  username: string;
  publicKey?: string; // Optional: only needed for SSH access (deprecated)
  addedAt: number;
}

export interface RepoCollaborators {
  repoName: string;
  collaborators: string[]; // usernames
}

// Workflow types

export interface Workflow {
  timeout?: number;
  steps: Step[];
}

export interface Step {
  name: string;
  run: string;
  if?: string;
  working_dir?: string;
  continue_on_error?: boolean;
}

export interface WorkflowContext {
  env: Record<string, string>;
  branch: string;
  repo: string;
  workingDir: string;
  redactedValues?: string[];
}

export interface StepResult {
  name: string;
  success: boolean;
  output: string;
  error?: string;
  duration: number;
  skipped?: boolean;
}

export interface WorkflowResult {
  success: boolean;
  steps: StepResult[];
  duration: number;
}

export interface WorkflowRun {
  id: string;
  repoName: string;
  branch: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  startedAt?: number;
  completedAt?: number;
  result?: WorkflowResult;
}

// Config types

export interface KodConfig {
  serverUrl: string;
  apiToken: string;
}

export interface ServerConfig {
  port: number;
  dataDir: string;
  reposDir: string;
  apiToken: string;
  adminToken: string;
  encryptionKey: string;
  sshEnabled: boolean;
  sshHost: string;
  sshPort: number;
  sshHostKeyPath: string;
  sshAnonymousRead: boolean;
}

// HTTP types

export interface Route {
  method: string;
  pattern: RegExp;
  handler: (
    req: HttpRequest,
    params: Record<string, string>
  ) => Promise<HttpResponse>;
}

export interface HttpRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  rawUrl?: string; // Full URL including query string
}

export interface HttpResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

// API request/response types

export interface CreateRepoRequest {
  name: string;
}

export interface ImportRepoRequest {
  source: string;
  name?: string;
}

export interface UpdateRepoRequest {
  name?: string;
}

export interface AddCollaboratorRequest {
  username: string;
  publicKey?: string; // Optional: only needed for SSH access (deprecated)
}

export interface TriggerWorkflowRequest {
  branch: string;
  files?: string[];
}

// Error types

export interface KodError {
  code: string;
  message: string;
}

// API token types

export interface ApiToken {
  id: string;
  tokenHash: string; // SHA-256 hash of the actual token
  name: string;
  createdAt: number;
  lastUsedAt?: number;
  expiresAt?: number; // Unix timestamp, undefined = never expires
  permissions: TokenPermission[];
  username?: string; // Optional: links token to a collaborator for Git access
}

export type TokenPermission =
  | 'repo:read'
  | 'repo:write'
  | 'repo:delete'
  | 'collaborator:read'
  | 'collaborator:write'
  | 'workflow:read'
  | 'workflow:trigger'
  | 'secrets:read'
  | 'secrets:write'
  | 'webhook:read'
  | 'webhook:write'
  | 'admin';

export interface RepoSecret {
  name: string;
  repoName: string;
  encryptedValue: string;
  createdAt: number;
  updatedAt: number;
}

export type WebhookEvent = 'push' | 'workflow';

export interface RepoWebhook {
  id: string;
  repoName: string;
  url: string;
  events: WebhookEvent[];
  secret?: string;
  createdAt: number;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  repoName: string;
  event: WebhookEvent;
  url: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'success' | 'failed';
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  lastAttemptAt?: number;
  nextAttemptAt?: number;
  responseStatus?: number;
  error?: string;
}

export interface SshPublicKey {
  id: string;
  username: string;
  name: string;
  publicKey: string;
  keyType: string;
  keyData: string;
  fingerprint: string;
  createdAt: number;
  lastUsedAt?: number;
}
