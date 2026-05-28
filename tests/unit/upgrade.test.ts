import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  getCurrentVersion,
  getLatestVersion,
  isUpgradeNeeded,
  getInstallDir,
  getBinDir
} from '../../src/cli/commands/upgrade.js';

describe('Upgrade', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `kod-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('getCurrentVersion', () => {
    test('It should return null when VERSION file does not exist', () => {
      const version = getCurrentVersion(testDir);
      expect(version).toBeNull();
    });

    test('It should return version when VERSION file exists', () => {
      writeFileSync(join(testDir, 'VERSION'), '1.2.3\n');
      const version = getCurrentVersion(testDir);
      expect(version).toBe('1.2.3');
    });

    test('It should trim whitespace from version', () => {
      writeFileSync(join(testDir, 'VERSION'), '  2.0.0  \n\n');
      const version = getCurrentVersion(testDir);
      expect(version).toBe('2.0.0');
    });
  });

  describe('isUpgradeNeeded', () => {
    test('It should return true when current version is null', () => {
      expect(isUpgradeNeeded(null, '1.0.0')).toBe(true);
    });

    test('It should return true when latest version is null', () => {
      expect(isUpgradeNeeded('1.0.0', null)).toBe(true);
    });

    test('It should return true when both versions are null', () => {
      expect(isUpgradeNeeded(null, null)).toBe(true);
    });

    test('It should return false when versions are equal', () => {
      expect(isUpgradeNeeded('1.0.0', '1.0.0')).toBe(false);
    });

    test('It should return true when versions differ', () => {
      expect(isUpgradeNeeded('1.0.0', '1.1.0')).toBe(true);
    });

    test('It should return true when upgrading to newer version', () => {
      expect(isUpgradeNeeded('1.0.0', '2.0.0')).toBe(true);
    });

    test('It should return true when downgrading (versions differ)', () => {
      expect(isUpgradeNeeded('2.0.0', '1.0.0')).toBe(true);
    });
  });

  describe('getLatestVersion', () => {
    test('It should read the latest version from a static text file', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () =>
        new Response('1.2.3\n', { status: 200 }) as Response;

      try {
        await expect(getLatestVersion('https://example.com/VERSION')).resolves.toBe(
          '1.2.3'
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test('It should return null when the static version file is unavailable', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () =>
        new Response('', { status: 404 }) as Response;

      try {
        await expect(
          getLatestVersion('https://example.com/VERSION')
        ).resolves.toBeNull();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('getInstallDir', () => {
    test('It should return path under home directory', () => {
      const installDir = getInstallDir();
      expect(installDir).toContain('.kod');
    });
  });

  describe('getBinDir', () => {
    test('It should return path under home directory', () => {
      const binDir = getBinDir();
      expect(binDir).toContain('.local');
      expect(binDir).toContain('bin');
    });
  });
});
