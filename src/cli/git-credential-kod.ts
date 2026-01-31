#!/usr/bin/env node
/**
 * Git credential helper for Kod.
 *
 * Git calls this as: git-credential-kod <action>
 * where action is "get", "store", or "erase".
 *
 * For "get", reads protocol/host from stdin and returns
 * credentials from ~/.kod/config.json if the host matches.
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const CONFIG_FILE = join(homedir(), '.kod', 'config.json');

function loadConfig(): { serverUrl?: string; apiToken?: string } {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function parseInput(lines: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of lines) {
    const eq = line.indexOf('=');
    if (eq > -1) {
      result[line.slice(0, eq)] = line.slice(eq + 1);
    }
  }
  return result;
}

async function main(): Promise<void> {
  const action = process.argv[2];

  // Only respond to "get" requests
  if (action !== 'get') return;

  const config = loadConfig();
  if (!config.serverUrl || !config.apiToken) return;

  let serverUrl: URL;
  try {
    serverUrl = new URL(config.serverUrl);
  } catch {
    return;
  }

  // Read input from git (protocol, host, path, etc.)
  const lines: string[] = [];
  const rl = createInterface({ input: process.stdin });

  for await (const line of rl) {
    if (line === '') break;
    lines.push(line);
  }

  const input = parseInput(lines);

  // Only provide credentials if the host matches the configured server
  const requestHost = input.host || '';
  const serverHost = serverUrl.port
    ? `${serverUrl.hostname}:${serverUrl.port}`
    : serverUrl.hostname;

  if (requestHost !== serverHost) return;

  // Only match the protocol if provided
  if (input.protocol && input.protocol !== serverUrl.protocol.replace(':', ''))
    return;

  // Output credentials
  process.stdout.write(`protocol=${serverUrl.protocol.replace(':', '')}\n`);
  process.stdout.write(`host=${serverHost}\n`);
  process.stdout.write(`username=git\n`);
  process.stdout.write(`password=${config.apiToken}\n`);
}

main().catch(() => process.exit(1));
