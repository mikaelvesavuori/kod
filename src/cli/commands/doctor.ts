import { constants, accessSync, existsSync } from 'node:fs';

import { loadClientConfig, loadServerConfig } from '../../shared/config.js';
import { execFile } from '../../shared/exec.js';

import { api } from '../http-client.js';

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export async function doctorCommand(): Promise<void> {
  const checks: Check[] = [];
  const clientConfig = loadClientConfig();
  const serverConfig = loadServerConfig();

  checks.push(await checkGit());
  checks.push(checkClientConfig(clientConfig.serverUrl, clientConfig.apiToken));
  checks.push(checkDirectory('Data directory', serverConfig.dataDir));
  checks.push(checkDirectory('Repos directory', serverConfig.reposDir));
  checks.push(checkSshConfig(serverConfig.sshEnabled, serverConfig.sshPort));
  checks.push(await checkServer());
  checks.push(await checkAuth(clientConfig.apiToken));

  console.log('Kod doctor\n');
  for (const check of checks) {
    console.log(`${check.ok ? 'OK' : 'FAIL'} ${check.name}: ${check.detail}`);
  }

  if (checks.some((check) => !check.ok)) {
    process.exitCode = 1;
  }
}

async function checkGit(): Promise<Check> {
  const result = await execFile('git', ['--version']);
  return {
    name: 'Git',
    ok: result.exitCode === 0,
    detail:
      result.exitCode === 0
        ? result.stdout.trim()
        : result.stderr.trim() || 'git not found'
  };
}

function checkClientConfig(serverUrl: string, apiToken: string): Check {
  return {
    name: 'Client config',
    ok: Boolean(serverUrl),
    detail: apiToken
      ? `${serverUrl} with API token configured`
      : `${serverUrl || '(missing server URL)'} without API token`
  };
}

function checkDirectory(name: string, path: string): Check {
  try {
    accessSync(path, constants.R_OK | constants.W_OK);
    return { name, ok: true, detail: path };
  } catch {
    return {
      name,
      ok: false,
      detail: existsSync(path) ? `${path} is not writable` : `${path} missing`
    };
  }
}

function checkSshConfig(enabled: boolean, port: number): Check {
  return {
    name: 'SSH config',
    ok: !enabled || port > 0,
    detail: enabled ? `enabled on port ${port}` : 'disabled'
  };
}

async function checkServer(): Promise<Check> {
  const response = await api.get<{ status: string }>('/health');
  return {
    name: 'HTTP server',
    ok: response.ok,
    detail: response.ok ? 'healthy' : response.error || 'unreachable'
  };
}

async function checkAuth(apiToken: string): Promise<Check> {
  if (!apiToken) {
    return {
      name: 'API auth',
      ok: false,
      detail: 'no API token configured'
    };
  }

  const response = await api.get('/repos');
  return {
    name: 'API auth',
    ok: response.ok,
    detail: response.ok ? 'token accepted' : response.error || 'token rejected'
  };
}
