import { execSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export const RELEASE_URL = 'https://gitkod.com/release';
export const VERSION_API_URL = 'https://api.gitkod.com/prod/version/core';

export interface VersionResponse {
  version: string;
}

export function getInstallDir(): string {
  return join(homedir(), '.kod');
}

export function getBinDir(): string {
  return join(homedir(), '.local', 'bin');
}

export function getCurrentVersion(installDir?: string): string | null {
  const dir = installDir || getInstallDir();
  const versionFile = join(dir, 'VERSION');
  if (existsSync(versionFile)) {
    return readFileSync(versionFile, 'utf-8').trim();
  }
  return null;
}

export async function getLatestVersion(
  apiUrl: string = VERSION_API_URL
): Promise<string | null> {
  try {
    const response = await fetch(apiUrl);
    if (!response.ok) return null;
    const data = (await response.json()) as VersionResponse;
    return data.version || null;
  } catch {
    return null;
  }
}

export async function downloadAndExtract(
  tempDir: string,
  releaseUrl: string = RELEASE_URL
): Promise<string> {
  const zipPath = join(tempDir, 'kod.zip');
  const extractDir = join(tempDir, 'kod-extract');

  // Download
  const response = await fetch(`${releaseUrl}/latest.zip`);
  if (!response.ok) {
    throw new Error(
      `Failed to download: ${response.status} ${response.statusText}`
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  writeFileSync(zipPath, Buffer.from(arrayBuffer));

  // Extract using unzip command
  mkdirSync(extractDir, { recursive: true });
  execSync(`unzip -q -o "${zipPath}" -d "${extractDir}"`, { stdio: 'pipe' });

  return extractDir;
}

export function isUpgradeNeeded(
  currentVersion: string | null,
  latestVersion: string | null
): boolean {
  if (!currentVersion || !latestVersion) {
    return true; // Upgrade if we can't determine versions
  }
  return currentVersion !== latestVersion;
}

export function checkSystemdService(): boolean {
  try {
    const result = execSync(
      'systemctl is-active kod.service 2>/dev/null || true',
      {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      }
    ).trim();
    return result === 'active';
  } catch {
    return false;
  }
}

export async function upgradeCommand(): Promise<void> {
  console.log('Kod Upgrade Tool\n');

  // Get current version
  const currentVersion = getCurrentVersion();
  if (currentVersion) {
    console.log(`Current version: v${currentVersion}`);
  } else {
    console.log('Current version: unknown');
  }

  // Check latest version
  console.log('Checking for latest version...');
  const latestVersion = await getLatestVersion();

  if (latestVersion) {
    console.log(`Latest version: v${latestVersion}`);
  } else {
    console.log(
      'Could not determine latest version. Proceeding with upgrade anyway...'
    );
  }

  // Check if upgrade is needed
  if (!isUpgradeNeeded(currentVersion, latestVersion)) {
    console.log('\n✓ Kod is already up to date!');
    return;
  }

  if (latestVersion) {
    console.log(
      `\nUpgrading from v${currentVersion || 'unknown'} to v${latestVersion}...`
    );
  } else {
    console.log('\nUpgrading to latest version...');
  }

  // Create temp directory
  const tempDir = join(tmpdir(), `kod-upgrade-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    // Download and extract
    console.log('Downloading latest release...');
    const extractDir = await downloadAndExtract(tempDir);

    const binDir = getBinDir();
    const installDir = getInstallDir();
    const kodBinary = join(binDir, 'kod');
    const newBinary = join(extractDir, 'kod', 'kod.js');
    const newVersionFile = join(extractDir, 'kod', 'VERSION');

    // Ensure directories exist
    mkdirSync(binDir, { recursive: true });
    mkdirSync(installDir, { recursive: true });

    // Backup old version if exists
    if (existsSync(kodBinary)) {
      const backupPath = `${kodBinary}.backup.${Date.now()}`;
      copyFileSync(kodBinary, backupPath);
      console.log(`Backed up old version to ${backupPath}`);
    }

    // Install new version
    console.log('Installing new version...');
    copyFileSync(newBinary, kodBinary);
    execSync(`chmod +x "${kodBinary}"`, { stdio: 'pipe' });

    // Copy VERSION file
    if (existsSync(newVersionFile)) {
      copyFileSync(newVersionFile, join(installDir, 'VERSION'));
    }

    console.log('\n✓ Kod upgraded successfully!');

    // Show new version
    const newVersion = getCurrentVersion();
    if (newVersion) {
      console.log(`Installed version: v${newVersion}`);
    }

    // Check if running as systemd service (Linux only)
    if (checkSystemdService()) {
      console.log('\nKod is running as a systemd service.');
      console.log('Restart the service to apply the upgrade:');
      console.log('  sudo systemctl restart kod.service');
    }

    console.log('\nRun "kod --version" to verify the installation.');
  } finally {
    // Cleanup temp directory
    try {
      execSync(`rm -rf "${tempDir}"`, { stdio: 'pipe' });
    } catch {
      // Ignore cleanup errors
    }
  }
}
