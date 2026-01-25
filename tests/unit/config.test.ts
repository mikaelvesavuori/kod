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
  mkdirSync
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { generateApiToken, loadClientConfig } from '../../src/shared/config.js';

const CONFIG_DIR = join(homedir(), '.kod');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const _BACKUP_FILE = join(CONFIG_DIR, 'config.json.test-backup');

describe('Config', () => {
  // Backup and restore config file to avoid test pollution from user's real config
  let configBackup: string | null = null;

  beforeAll(() => {
    if (existsSync(CONFIG_FILE)) {
      configBackup = readFileSync(CONFIG_FILE, 'utf-8');
      unlinkSync(CONFIG_FILE);
    }
  });

  afterAll(() => {
    // Restore the original config file if it existed
    if (configBackup !== null) {
      if (!existsSync(CONFIG_DIR)) {
        mkdirSync(CONFIG_DIR, { recursive: true });
      }
      writeFileSync(CONFIG_FILE, configBackup);
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
});
