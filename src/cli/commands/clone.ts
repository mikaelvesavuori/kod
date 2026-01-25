import { spawn } from 'node:child_process';
import { loadClientConfig } from '../../shared/config.js';

interface CloneOptions {
  credentials?: string;
}

/**
 * Build the clone URL for a repository (without credentials).
 */
export function buildRepoUrl(repoName: string): string {
  const config = loadClientConfig();
  return `${config.serverUrl}/repos/${repoName}.git`;
}

export async function cloneRepo(
  repoUrl: string,
  options: CloneOptions = {}
): Promise<void> {
  if (!repoUrl) {
    console.error('Error: Repository URL or name is required');
    console.error('Usage: kod clone <url|name> [--credentials <token>]');
    process.exit(1);
  }

  const config = loadClientConfig();
  const token = options.credentials || config.apiToken;

  if (!token) {
    console.error('Error: No credentials available');
    console.error(
      'Either configure a token with "kod init" or use --credentials <token>'
    );
    process.exit(1);
  }

  // Build the clone URL with credentials
  let cloneUrl: string;

  if (repoUrl.startsWith('http://') || repoUrl.startsWith('https://')) {
    // Full URL provided - inject credentials
    const url = new URL(repoUrl);
    url.username = 'git';
    url.password = token;
    cloneUrl = url.toString();
  } else {
    // Just a repo name - build full URL from config
    const serverUrl = new URL(config.serverUrl);
    serverUrl.username = 'git';
    serverUrl.password = token;
    serverUrl.pathname = `/repos/${repoUrl}.git`;
    cloneUrl = serverUrl.toString();
  }

  // Run git clone
  const gitArgs = ['clone', cloneUrl];

  const proc = spawn('git', gitArgs, {
    stdio: 'inherit'
  });

  proc.on('close', (code) => {
    process.exit(code || 0);
  });

  proc.on('error', (err) => {
    console.error(`Error: Failed to run git clone: ${err.message}`);
    process.exit(1);
  });
}

export function parseCloneArgs(args: string[]): {
  repoUrl: string;
  options: CloneOptions;
} {
  const options: CloneOptions = {};
  let repoUrl = '';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--credentials' || arg === '-c') {
      options.credentials = args[++i];
    } else if (!arg.startsWith('-')) {
      repoUrl = arg;
    }
  }

  return { repoUrl, options };
}
