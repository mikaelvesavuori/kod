import { describe, test, expect, afterEach } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createBackup,
  restoreBackup
} from '../../src/cli/commands/backup.js';
import type { ServerConfig } from '../../src/shared/types.js';

describe('Backup commands', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('It should create and restore a backup archive', async () => {
    const sourceRoot = makeTempDir('kod-backup-source-');
    const targetRoot = makeTempDir('kod-backup-target-');
    const archiveRoot = makeTempDir('kod-backup-archive-');

    const sourceConfig = makeConfig(sourceRoot);
    const targetConfig = makeConfig(targetRoot);

    writeFileSync(join(sourceConfig.dataDir, 'db.bin'), 'database');
    mkdirSync(join(sourceConfig.reposDir, 'app.git'), { recursive: true });
    writeFileSync(join(sourceConfig.reposDir, 'app.git', 'HEAD'), 'ref: main');

    const archive = await createBackup(
      sourceConfig,
      join(archiveRoot, 'backup.tar.gz')
    );

    expect(existsSync(archive)).toBe(true);

    await restoreBackup(targetConfig, archive, false);

    expect(readFileSync(join(targetConfig.dataDir, 'db.bin'), 'utf-8')).toBe(
      'database'
    );
    expect(
      readFileSync(join(targetConfig.reposDir, 'app.git', 'HEAD'), 'utf-8')
    ).toBe('ref: main');
  });

  test('It should refuse to restore over non-empty directories without force', async () => {
    const sourceRoot = makeTempDir('kod-backup-source-');
    const targetRoot = makeTempDir('kod-backup-target-');
    const archiveRoot = makeTempDir('kod-backup-archive-');

    const sourceConfig = makeConfig(sourceRoot);
    const targetConfig = makeConfig(targetRoot);

    writeFileSync(join(sourceConfig.dataDir, 'db.bin'), 'database');
    writeFileSync(join(targetConfig.dataDir, 'existing.bin'), 'existing');

    const archive = await createBackup(
      sourceConfig,
      join(archiveRoot, 'backup.tar.gz')
    );

    await expect(restoreBackup(targetConfig, archive, false)).rejects.toThrow(
      'not empty'
    );

    await restoreBackup(targetConfig, archive, true);
    expect(existsSync(join(targetConfig.dataDir, 'existing.bin'))).toBe(false);
  });

  function makeTempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    dirs.push(dir);
    return dir;
  }

  function makeConfig(root: string): ServerConfig {
    const dataDir = join(root, 'data');
    const reposDir = join(root, 'repos');
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(reposDir, { recursive: true });

    return {
      port: 3000,
      dataDir,
      reposDir,
      apiToken: '',
      adminToken: '',
      encryptionKey: '',
      sshEnabled: false,
      sshHost: '127.0.0.1',
      sshPort: 0,
      sshHostKeyPath: join(root, 'ssh_host_rsa_key'),
      sshAnonymousRead: false
    };
  }
});
