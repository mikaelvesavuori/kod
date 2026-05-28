import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import type { ServerConfig } from '../../shared/types.js';
import { execFile } from '../../shared/exec.js';
import { loadServerConfig } from '../../shared/config.js';

interface BackupManifest {
  version: 1;
  createdAt: string;
  dataDirName: string;
  reposDirName: string;
}

export async function backupCommand(args: string[]): Promise<void> {
  const output = parseOutput(args);
  const config = loadServerConfig();
  const backupPath = await createBackup(config, output);
  console.log(`Backup created: ${backupPath}`);
}

export async function restoreCommand(args: string[]): Promise<void> {
  const archive = args.find((arg) => !arg.startsWith('--'));
  const force = args.includes('--force');

  if (!archive) {
    console.error('Usage: kod restore <backup.tar.gz> [--force]');
    process.exit(1);
  }

  const config = loadServerConfig();
  await restoreBackup(config, archive, force);
  console.log('Backup restored.');
}

export async function createBackup(
  config: ServerConfig,
  output?: string
): Promise<string> {
  const backupPath = resolve(output ?? defaultBackupPath());
  mkdirSync(dirname(backupPath), { recursive: true });

  const stagingDir = mkBackupTempDir();
  try {
    const manifest: BackupManifest = {
      version: 1,
      createdAt: new Date().toISOString(),
      dataDirName: 'data',
      reposDirName: 'repos'
    };
    writeFileSync(
      join(stagingDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    );

    copyDirectory(config.dataDir, join(stagingDir, 'data'));
    copyDirectory(config.reposDir, join(stagingDir, 'repos'));

    const result = await execFile('tar', [
      '-czf',
      backupPath,
      '-C',
      stagingDir,
      '.'
    ]);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to create archive: ${result.stderr}`);
    }

    return backupPath;
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}

export async function restoreBackup(
  config: ServerConfig,
  archive: string,
  force = false
): Promise<void> {
  const archivePath = resolve(archive);
  if (!existsSync(archivePath)) {
    throw new Error(`Backup not found: ${archivePath}`);
  }

  if (
    !force &&
    (isNonEmptyDir(config.dataDir) || isNonEmptyDir(config.reposDir))
  ) {
    throw new Error(
      'Data or repos directory is not empty. Re-run with --force to overwrite.'
    );
  }

  const stagingDir = mkBackupTempDir();
  try {
    const result = await execFile('tar', [
      '-xzf',
      archivePath,
      '-C',
      stagingDir
    ]);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to extract archive: ${result.stderr}`);
    }

    const manifestPath = join(stagingDir, 'manifest.json');
    if (!existsSync(manifestPath)) {
      throw new Error('Backup manifest is missing');
    }

    const manifest = JSON.parse(
      readFileSync(manifestPath, 'utf-8')
    ) as BackupManifest;
    if (manifest.version !== 1) {
      throw new Error(`Unsupported backup version: ${manifest.version}`);
    }

    const dataSource = join(stagingDir, manifest.dataDirName);
    const reposSource = join(stagingDir, manifest.reposDirName);
    if (!existsSync(dataSource) || !existsSync(reposSource)) {
      throw new Error('Backup archive is incomplete');
    }

    rmSync(config.dataDir, { recursive: true, force: true });
    rmSync(config.reposDir, { recursive: true, force: true });
    copyDirectory(dataSource, config.dataDir);
    copyDirectory(reposSource, config.reposDir);
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}

function parseOutput(args: string[]): string | undefined {
  const outputIndex = args.indexOf('--output');
  if (outputIndex !== -1 && args[outputIndex + 1]) {
    return args[outputIndex + 1];
  }

  const shortIndex = args.indexOf('-o');
  if (shortIndex !== -1 && args[shortIndex + 1]) {
    return args[shortIndex + 1];
  }

  return undefined;
}

function defaultBackupPath(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  return join(homedir(), '.kod', 'backups', `kod_backup_${stamp}.tar.gz`);
}

function mkBackupTempDir(): string {
  const dir = join(tmpdir(), `kod-backup-${Date.now()}-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function copyDirectory(source: string, target: string): void {
  mkdirSync(dirname(target), { recursive: true });
  if (existsSync(source)) {
    cpSync(source, target, { recursive: true });
  } else {
    mkdirSync(target, { recursive: true });
  }
}

function isNonEmptyDir(path: string): boolean {
  return existsSync(path) && readdirSync(path).length > 0;
}
