import { createInterface } from 'node:readline';

import {
  saveClientConfig,
  loadClientConfig,
  generateApiToken,
  saveServerConfig
} from '../../shared/config.js';

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
      : `API Token (leave empty to generate): `;
    const apiToken = await question(tokenPrompt);

    let finalToken = apiToken;
    if (!apiToken && !existing.apiToken) {
      finalToken = generateApiToken();
      console.log(`\nGenerated API token: ${finalToken}`);
      console.log('Save this token - you will need it for the server.');
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

    console.log('\nDone! You can now use kod commands.');
  } finally {
    rl.close();
  }
}
