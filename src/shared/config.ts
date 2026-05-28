import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomInt } from 'node:crypto';

import type { KodConfig, ServerConfig } from './types.js';

const CONFIG_DIR = join(homedir(), '.kod');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

const DEFAULT_CLIENT_CONFIG: KodConfig = {
  serverUrl: 'http://localhost:3000',
  apiToken: ''
};

const DEFAULT_SERVER_CONFIG: ServerConfig = {
  port: 3000,
  dataDir: join(CONFIG_DIR, 'data'),
  reposDir: join(CONFIG_DIR, 'repos'),
  apiToken: '',
  adminToken: '',
  encryptionKey: '',
  sshEnabled: true,
  sshHost: '0.0.0.0',
  sshPort: 2222,
  sshHostKeyPath: join(CONFIG_DIR, 'ssh_host_rsa_key'),
  sshAnonymousRead: false
};

export function loadClientConfig(
  overrides: Partial<KodConfig> = {}
): KodConfig {
  // Start with defaults
  let config = { ...DEFAULT_CLIENT_CONFIG };

  // Load from config file if exists
  if (existsSync(CONFIG_FILE)) {
    try {
      const content = readFileSync(CONFIG_FILE, 'utf-8');
      const parsed = JSON.parse(content);
      config = { ...config, ...parsed };
    } catch {
      // Ignore parse errors, use defaults
    }
  }

  // Environment variables override file config
  if (process.env.KOD_SERVER_URL) {
    config.serverUrl = process.env.KOD_SERVER_URL;
  }
  if (process.env.KOD_API_TOKEN) {
    config.apiToken = process.env.KOD_API_TOKEN;
  }

  // CLI overrides take precedence
  config = { ...config, ...overrides };

  return config;
}

export function saveClientConfig(config: Partial<KodConfig>): void {
  const existing = loadClientConfig();
  const merged = { ...existing, ...config };

  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2));
}

export function loadServerConfig(
  overrides: Partial<ServerConfig> = {}
): ServerConfig {
  // Start with defaults
  let config = { ...DEFAULT_SERVER_CONFIG };

  // Load from config file if exists
  const serverConfigFile = join(CONFIG_DIR, 'server.json');
  if (existsSync(serverConfigFile)) {
    try {
      const content = readFileSync(serverConfigFile, 'utf-8');
      const parsed = JSON.parse(content);
      config = { ...config, ...parsed };
    } catch {
      // Ignore parse errors, use defaults
    }
  }

  // Environment variables override file config
  if (process.env.KOD_PORT) {
    config.port = parseInt(process.env.KOD_PORT, 10);
  }
  if (process.env.KOD_DATA_DIR) {
    config.dataDir = process.env.KOD_DATA_DIR;
  }
  if (process.env.KOD_REPOS_DIR) {
    config.reposDir = process.env.KOD_REPOS_DIR;
  }
  if (process.env.KOD_API_TOKEN) {
    config.apiToken = process.env.KOD_API_TOKEN;
  }
  if (process.env.KOD_ADMIN_TOKEN) {
    config.adminToken = process.env.KOD_ADMIN_TOKEN;
  }
  if (process.env.KOD_ENCRYPTION_KEY) {
    config.encryptionKey = process.env.KOD_ENCRYPTION_KEY;
  }
  if (process.env.KOD_SSH_ENABLED) {
    config.sshEnabled = parseBoolean(process.env.KOD_SSH_ENABLED);
  }
  if (process.env.KOD_SSH_HOST) {
    config.sshHost = process.env.KOD_SSH_HOST;
  }
  if (process.env.KOD_SSH_PORT) {
    config.sshPort = parseInt(process.env.KOD_SSH_PORT, 10);
  }
  if (process.env.KOD_SSH_HOST_KEY_PATH) {
    config.sshHostKeyPath = process.env.KOD_SSH_HOST_KEY_PATH;
  }
  if (process.env.KOD_SSH_ANONYMOUS_READ) {
    config.sshAnonymousRead = parseBoolean(process.env.KOD_SSH_ANONYMOUS_READ);
  }

  // CLI overrides take precedence
  config = { ...config, ...overrides };

  // Ensure directories exist
  ensureDir(config.dataDir);
  ensureDir(config.reposDir);

  return config;
}

export function saveServerConfig(config: Partial<ServerConfig>): void {
  const serverConfigFile = join(CONFIG_DIR, 'server.json');

  let existing: Partial<ServerConfig> = {};
  if (existsSync(serverConfigFile)) {
    try {
      existing = JSON.parse(readFileSync(serverConfigFile, 'utf-8'));
    } catch {
      // Ignore
    }
  }

  const merged = { ...existing, ...config };

  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  writeFileSync(serverConfigFile, JSON.stringify(merged, null, 2));
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function parseBoolean(value: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export function generateApiToken(): string {
  const chars =
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let token = 'kod_';
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(randomInt(chars.length));
  }
  return token;
}
