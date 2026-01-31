import { execSync } from 'node:child_process';
import { existsSync, rmSync, unlinkSync } from 'node:fs';
import { createInterface } from 'node:readline';

import { getInstallDir, getBinDir, checkSystemdService } from './upgrade.js';

function confirm(message: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

export async function uninstallCommand(): Promise<void> {
  console.log('Kod Uninstall\n');

  const installDir = getInstallDir();
  const binDir = getBinDir();
  const kodBinary = `${binDir}/kod`;

  const hasInstallDir = existsSync(installDir);
  const hasBinary = existsSync(kodBinary);

  if (!hasInstallDir && !hasBinary) {
    console.log('Kod does not appear to be installed.');
    return;
  }

  console.log('This will remove:');
  if (hasBinary) console.log(`  - Binary: ${kodBinary}`);
  if (hasInstallDir) console.log(`  - Data directory: ${installDir}`);

  // Check for systemd service
  if (checkSystemdService()) {
    console.log(
      '\nWarning: Kod is running as a systemd service. Stop it first:'
    );
    console.log('  sudo systemctl stop kod.service');
    console.log('  sudo systemctl disable kod.service');
  }

  const confirmed = await confirm('\nProceed with uninstall?');
  if (!confirmed) {
    console.log('Uninstall cancelled.');
    return;
  }

  // Remove binary
  if (hasBinary) {
    try {
      unlinkSync(kodBinary);
      console.log('Removed binary.');
    } catch (err) {
      console.error(
        `Failed to remove binary: ${err instanceof Error ? err.message : err}`
      );
    }
  }

  // Remove install directory (~/.kod)
  if (hasInstallDir) {
    try {
      rmSync(installDir, { recursive: true, force: true });
      console.log('Removed data directory.');
    } catch (err) {
      console.error(
        `Failed to remove data directory: ${err instanceof Error ? err.message : err}`
      );
    }
  }

  // Clean up backup files
  try {
    execSync(`rm -f "${kodBinary}".backup.*`, { stdio: 'pipe' });
  } catch {
    // Ignore cleanup errors
  }

  console.log('\nKod has been uninstalled.');
}
