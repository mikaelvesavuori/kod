/** biome-ignore-all lint/style/noNonNullAssertion: OK */
import { api } from '../http-client.js';

import type { TokenPermission } from '../../shared/types.js';

export async function listTokens(): Promise<void> {
  const res =
    await api.get<
      Array<{
        id: string;
        name: string;
        createdAt: number;
        lastUsedAt?: number;
        expiresAt?: number;
        permissions: TokenPermission[];
      }>
    >('/tokens');

  if (!res.ok) {
    console.error(`Error: ${res.error}`);
    process.exit(1);
  }

  const tokens = res.data || [];

  if (tokens.length === 0) {
    console.log('No API tokens configured.');
    return;
  }

  console.log('API Tokens:\n');
  for (const token of tokens) {
    const created = new Date(token.createdAt).toISOString().split('T')[0];
    const lastUsed = token.lastUsedAt
      ? new Date(token.lastUsedAt).toISOString().split('T')[0]
      : 'never';
    const expires = token.expiresAt
      ? new Date(token.expiresAt).toISOString().split('T')[0]
      : 'never';

    console.log(`  ${token.name} (${token.id})`);
    console.log(`    Created: ${created}`);
    console.log(`    Last used: ${lastUsed}`);
    console.log(`    Expires: ${expires}`);
    console.log(`    Permissions: ${token.permissions.join(', ')}`);
    console.log();
  }
}

export async function createToken(
  name: string,
  permissions: TokenPermission[],
  expiresInDays?: number
): Promise<void> {
  const res = await api.post<{
    id: string;
    name: string;
    token: string;
    permissions: TokenPermission[];
    expiresAt?: number;
    message: string;
  }>('/tokens', { name, permissions, expiresInDays });

  if (!res.ok) {
    console.error(`Error: ${res.error}`);
    process.exit(1);
  }

  const data = res.data!;

  console.log('\nToken created successfully!\n');
  console.log(`  Name: ${data.name}`);
  console.log(`  ID: ${data.id}`);
  console.log(`  Permissions: ${data.permissions.join(', ')}`);
  if (data.expiresAt) {
    console.log(`  Expires: ${new Date(data.expiresAt).toISOString()}`);
  } else {
    console.log(`  Expires: never`);
  }
  console.log(`\n  Token: ${data.token}`);
  console.log('\n  Save this token now - it will not be shown again!\n');
}

export async function deleteToken(id: string): Promise<void> {
  const res = await api.delete(`/tokens/${id}`);

  if (!res.ok) {
    console.error(`Error: ${res.error}`);
    process.exit(1);
  }

  console.log(`Token ${id} deleted.`);
}

export function parsePermissions(args: string[]): TokenPermission[] {
  const validPermissions: TokenPermission[] = [
    'repo:read',
    'repo:write',
    'repo:delete',
    'collaborator:read',
    'collaborator:write',
    'workflow:read',
    'workflow:trigger',
    'admin'
  ];

  // Find --permissions flag
  const permIndex = args.indexOf('--permissions');
  if (permIndex === -1 || permIndex === args.length - 1) {
    // Default permissions
    return ['repo:read', 'repo:write', 'workflow:read'];
  }

  const permString = args[permIndex + 1];
  const perms = permString.split(',').map((p) => p.trim()) as TokenPermission[];

  for (const perm of perms) {
    if (!validPermissions.includes(perm)) {
      console.error(`Invalid permission: ${perm}`);
      console.error(`Valid permissions: ${validPermissions.join(', ')}`);
      process.exit(1);
    }
  }

  return perms;
}

export function parseExpiration(args: string[]): number | undefined {
  const expIndex = args.indexOf('--expires');
  if (expIndex === -1 || expIndex === args.length - 1) {
    return undefined; // No expiration
  }

  const days = parseInt(args[expIndex + 1], 10);
  if (Number.isNaN(days) || days < 1 || days > 365) {
    console.error('--expires must be a number between 1 and 365 (days)');
    process.exit(1);
  }

  return days;
}
