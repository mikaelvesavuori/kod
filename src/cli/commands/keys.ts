import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

import type { SshPublicKey } from '../../shared/types.js';

import { api } from '../http-client.js';

type KeyInfo = Omit<SshPublicKey, 'keyData'>;

export async function listKeys(args: string[]): Promise<void> {
  const username = parseOption(args, '--username');
  const path = username
    ? `/keys?username=${encodeURIComponent(username)}`
    : '/keys';
  const response = await api.get<KeyInfo[]>(path);

  if (!response.ok) {
    console.error(`Error: ${response.error}`);
    process.exit(1);
  }

  const keys = response.data ?? [];
  if (keys.length === 0) {
    console.log('No SSH keys found.');
    return;
  }

  console.log('SSH keys:\n');
  for (const key of keys) {
    console.log(`  ${key.id}`);
    console.log(`    Name: ${key.name}`);
    console.log(`    User: ${key.username}`);
    console.log(`    Type: ${key.keyType}`);
    console.log(`    Fingerprint: ${key.fingerprint}`);
    console.log(`    Created: ${new Date(key.createdAt).toLocaleString()}`);
    if (key.lastUsedAt) {
      console.log(
        `    Last used: ${new Date(key.lastUsedAt).toLocaleString()}`
      );
    }
    console.log();
  }
}

export async function addKey(args: string[]): Promise<void> {
  const input = positionalArgs(args)[0];
  if (!input) {
    console.error(
      'Usage: kod keys add <public-key-or-path> [--name <name>] [--username <user>]'
    );
    process.exit(1);
  }

  const publicKey = readPublicKeyInput(input);
  const response = await api.post<KeyInfo>('/keys', {
    publicKey,
    name: parseOption(args, '--name'),
    username: parseOption(args, '--username')
  });

  if (!response.ok) {
    console.error(`Error: ${response.error}`);
    process.exit(1);
  }

  console.log(`SSH key ${response.data?.id} added.`);
  console.log(`Fingerprint: ${response.data?.fingerprint}`);
}

export async function removeKey(args: string[]): Promise<void> {
  const id = positionalArgs(args)[0];
  if (!id) {
    console.error('Usage: kod keys remove <id>');
    process.exit(1);
  }

  const response = await api.delete(`/keys/${id}`);
  if (!response.ok) {
    console.error(`Error: ${response.error}`);
    process.exit(1);
  }

  console.log(`SSH key ${id} removed.`);
}

function parseOption(args: string[], option: string): string | undefined {
  const index = args.indexOf(option);
  if (index === -1) return undefined;
  return args[index + 1];
}

function positionalArgs(args: string[]): string[] {
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--name' || arg === '--username') {
      i++;
      continue;
    }
    if (!arg.startsWith('--')) {
      positionals.push(arg);
    }
  }
  return positionals;
}

function readPublicKeyInput(input: string): string {
  const path = input.startsWith('~')
    ? resolve(homedir(), input.slice(2))
    : resolve(input);

  if (existsSync(path)) {
    return readFileSync(path, 'utf-8').trim();
  }

  return input.trim();
}
