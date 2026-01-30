import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll
} from 'vitest';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
  mkdtempSync,
  rmSync
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  generateApiToken,
  loadClientConfig,
  loadServerConfig
} from '../../src/shared/config.js';

const CONFIG_DIR = join(homedir(), '.kod');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const SERVER_CONFIG_FILE = join(CONFIG_DIR, 'server.json');

describe('Config', () => {
  // Backup and restore config file to avoid test pollution from user's real config
  let configBackup: string | null = null;
  let serverConfigBackup: string | null = null;

  beforeAll(() => {
    if (existsSync(CONFIG_FILE)) {
      configBackup = readFileSync(CONFIG_FILE, 'utf-8');
      unlinkSync(CONFIG_FILE);
    }
    if (existsSync(SERVER_CONFIG_FILE)) {
      serverConfigBackup = readFileSync(SERVER_CONFIG_FILE, 'utf-8');
      unlinkSync(SERVER_CONFIG_FILE);
    }
  });

  afterAll(() => {
    // Restore the original config files if they existed
    if (configBackup !== null) {
      if (!existsSync(CONFIG_DIR)) {
        mkdirSync(CONFIG_DIR, { recursive: true });
      }
      writeFileSync(CONFIG_FILE, configBackup);
    }
    if (serverConfigBackup !== null) {
      if (!existsSync(CONFIG_DIR)) {
        mkdirSync(CONFIG_DIR, { recursive: true });
      }
      writeFileSync(SERVER_CONFIG_FILE, serverConfigBackup);
    }
  });
  describe('generateApiToken', () => {
    test('It should generate a token starting with kod_', () => {
      const token = generateApiToken();

      expect(token.startsWith('kod_')).toBe(true);
    });

    test('It should generate a token of correct length', () => {
      const token = generateApiToken();

      // "kod_" (4 chars) + 32 random chars = 36
      expect(token.length).toBe(36);
    });

    test('It should generate unique tokens', () => {
      const token1 = generateApiToken();
      const token2 = generateApiToken();

      expect(token1).not.toBe(token2);
    });

    test('It should only contain alphanumeric characters after prefix', () => {
      const token = generateApiToken();
      const suffix = token.slice(4);

      expect(/^[a-zA-Z0-9]+$/.test(suffix)).toBe(true);
    });
  });

  describe('loadClientConfig', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      // Clear relevant env vars before each test
      delete process.env.KOD_API_TOKEN;
      delete process.env.KOD_SERVER_URL;
    });

    afterEach(() => {
      // Restore original env
      process.env = { ...originalEnv };
    });

    test('It should return default config when no config file or env vars exist', () => {
      const config = loadClientConfig();

      expect(config.serverUrl).toBe('http://localhost:3000');
      expect(config.apiToken).toBe('');
    });

    test('It should use KOD_API_TOKEN environment variable', () => {
      process.env.KOD_API_TOKEN = 'kod_env_token_123';

      const config = loadClientConfig();

      expect(config.apiToken).toBe('kod_env_token_123');
    });

    test('It should use KOD_SERVER_URL environment variable', () => {
      process.env.KOD_SERVER_URL = 'http://custom-server:8080';

      const config = loadClientConfig();

      expect(config.serverUrl).toBe('http://custom-server:8080');
    });

    test('It should use both environment variables together', () => {
      process.env.KOD_API_TOKEN = 'kod_env_token_456';
      process.env.KOD_SERVER_URL = 'https://prod-server:443';

      const config = loadClientConfig();

      expect(config.apiToken).toBe('kod_env_token_456');
      expect(config.serverUrl).toBe('https://prod-server:443');
    });

    test('It should allow CLI overrides to take precedence over env vars', () => {
      process.env.KOD_API_TOKEN = 'kod_env_token';
      process.env.KOD_SERVER_URL = 'http://env-server:3000';

      const config = loadClientConfig({
        apiToken: 'kod_cli_token',
        serverUrl: 'http://cli-server:4000'
      });

      expect(config.apiToken).toBe('kod_cli_token');
      expect(config.serverUrl).toBe('http://cli-server:4000');
    });

    test('It should allow partial CLI overrides', () => {
      process.env.KOD_API_TOKEN = 'kod_env_token';
      process.env.KOD_SERVER_URL = 'http://env-server:3000';

      // Only override token, keep server URL from env
      const config = loadClientConfig({
        apiToken: 'kod_cli_token'
      });

      expect(config.apiToken).toBe('kod_cli_token');
      expect(config.serverUrl).toBe('http://env-server:3000');
    });

    test('It should handle empty overrides object', () => {
      process.env.KOD_API_TOKEN = 'kod_env_token';

      const config = loadClientConfig({});

      expect(config.apiToken).toBe('kod_env_token');
    });
  });

  describe('loadServerConfig', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      delete process.env.KOD_PORT;
      delete process.env.KOD_DATA_DIR;
      delete process.env.KOD_REPOS_DIR;
      delete process.env.KOD_API_TOKEN;
      delete process.env.KOD_ADMIN_TOKEN;
      delete process.env.KOD_ENCRYPTION_KEY;
    });

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    test('It should return default server config', () => {
      const config = loadServerConfig();

      expect(config.port).toBe(3000);
      expect(config.apiToken).toBe('');
      expect(config.adminToken).toBe('');
      expect(config.encryptionKey).toBe('');
    });

    test('It should use KOD_PORT environment variable', () => {
      process.env.KOD_PORT = '8080';

      const config = loadServerConfig();

      expect(config.port).toBe(8080);
    });

    test('It should use KOD_ENCRYPTION_KEY environment variable', () => {
      process.env.KOD_ENCRYPTION_KEY = 'my-secret-key';

      const config = loadServerConfig();

      expect(config.encryptionKey).toBe('my-secret-key');
    });

    test('It should use KOD_ADMIN_TOKEN environment variable', () => {
      process.env.KOD_ADMIN_TOKEN = 'kod_admin_123';

      const config = loadServerConfig();

      expect(config.adminToken).toBe('kod_admin_123');
    });

    test('It should allow CLI overrides to take precedence', () => {
      process.env.KOD_PORT = '8080';

      const config = loadServerConfig({ port: 9090 });

      expect(config.port).toBe(9090);
    });

    test('It should use KOD_DATA_DIR and KOD_REPOS_DIR env vars', () => {
      const dataDir = mkdtempSync(join(tmpdir(), 'kod-cfg-data-'));
      const reposDir = mkdtempSync(join(tmpdir(), 'kod-cfg-repos-'));

      process.env.KOD_DATA_DIR = dataDir;
      process.env.KOD_REPOS_DIR = reposDir;

      const config = loadServerConfig();

      expect(config.dataDir).toBe(dataDir);
      expect(config.reposDir).toBe(reposDir);

      rmSync(dataDir, { recursive: true, force: true });
      rmSync(reposDir, { recursive: true, force: true });
    });
  });
});
