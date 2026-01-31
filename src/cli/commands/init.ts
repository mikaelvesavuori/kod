import { createInterface } from 'node:readline';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { execSync } from 'node:child_process';
import { URL } from 'node:url';

import {
  saveClientConfig,
  loadClientConfig,
  generateApiToken,
  saveServerConfig
} from '../../shared/config.js';

/**
 * Test whether a token authenticates successfully against a running server.
 * Returns true if the server responds with 2xx, false otherwise.
 * Returns undefined if the server is not reachable.
 */
function verifyToken(
  serverUrl: string,
  token: string
): Promise<boolean | undefined> {
  return new Promise((resolve) => {
    const url = new URL('/health', serverUrl);
    const isHttps = url.protocol === 'https:';
    const requestFn = isHttps ? httpsRequest : httpRequest;

    const req = requestFn(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: '/repos',
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        timeout: 3000
      },
      (res) => {
        // Consume the response
        res.resume();
        resolve(res.statusCode !== undefined && res.statusCode < 400);
      }
    );

    req.on('error', () => resolve(undefined));
    req.on('timeout', () => {
      req.destroy();
      resolve(undefined);
    });

    req.end();
  });
}

export async function initCommand(): Promise<void> {
  console.log('Kod initialization\n');

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, (answer) => {
        resolve(answer.trim());
      });
    });
  };

  try {
    const existing = loadClientConfig();

    // Server URL
    const defaultUrl = existing.serverUrl || 'http://localhost:3000';
    const serverUrl = await question(`Server URL [${defaultUrl}]: `);
    const finalUrl = serverUrl || defaultUrl;

    // API Token
    const tokenPrompt = existing.apiToken
      ? `API Token [keep existing]: `
      : `API Token (enter the token used with --admin-token, or leave empty to generate): `;
    const apiToken = await question(tokenPrompt);

    let finalToken = apiToken;
    if (!apiToken && !existing.apiToken) {
      finalToken = generateApiToken();
      console.log(`\nGenerated API token: ${finalToken}`);
      console.log(
        'Save this token — use it with "kod serve --admin-token <token>" to start the server.'
      );
    } else if (!apiToken) {
      finalToken = existing.apiToken;
    }

    // Save config
    saveClientConfig({
      serverUrl: finalUrl,
      apiToken: finalToken
    });

    console.log('\nConfiguration saved to ~/.kod/config.json');
    console.log(`\nServer URL: ${finalUrl}`);
    console.log(
      `API Token: ${finalToken ? `***${finalToken.slice(-4)}` : '(none)'}`
    );

    // Verify token against a running server
    const result = await verifyToken(finalUrl, finalToken);
    if (result === true) {
      console.log('\nToken verified against server — authentication OK.');
    } else if (result === false) {
      console.warn(
        '\nWARNING: Token was rejected by the server (401 Unauthorized).'
      );
      console.warn(
        'Make sure this token matches the --admin-token used when starting the server.'
      );
    }
    // result === undefined means server not reachable, skip silently

    // Ask if they want to configure server too
    const configServer = await question(
      '\nConfigure server settings too? [y/N]: '
    );

    if (configServer.toLowerCase() === 'y') {
      const port = await question('Server port [3000]: ');
      const dataDir = await question('Data directory [~/.kod/data]: ');
      const reposDir = await question('Repos directory [~/.kod/repos]: ');

      saveServerConfig({
        ...(port && { port: parseInt(port, 10) }),
        ...(dataDir && { dataDir }),
        ...(reposDir && { reposDir }),
        apiToken: finalToken
      });

      console.log('\nServer configuration saved to ~/.kod/server.json');
    }

    // Configure git credential helper
    setupGitCredentialHelper(finalUrl);

    console.log('\nDone! You can now use kod commands.');
  } finally {
    rl.close();
  }
}

/**
 * Configure git to use the kod credential helper for the server host.
 * Uses a URL-specific credential config so it only applies to the Kod server.
 */
function setupGitCredentialHelper(serverUrl: string): void {
  try {
    // Check if git-credential-kod is available
    execSync(
      'git-credential-kod --version 2>/dev/null || which git-credential-kod',
      {
        stdio: 'ignore'
      }
    );
  } catch {
    // Credential helper not in PATH — skip silently
    return;
  }

  try {
    const url = new URL(serverUrl);
    const credentialKey = `credential.${url.protocol}//${url.host}.helper`;

    // Check if already configured
    try {
      const current = execSync(`git config --global "${credentialKey}"`, {
        encoding: 'utf-8'
      }).trim();
      if (current === 'kod') return; // Already set
    } catch {
      // Not set yet
    }

    execSync(`git config --global "${credentialKey}" "kod"`);
    console.log(`\nGit credential helper configured for ${url.host}`);
    console.log(
      'Plain git commands (clone, push, pull) will authenticate automatically.'
    );
  } catch {
    // Non-fatal — user can still use kod clone
  }
}
