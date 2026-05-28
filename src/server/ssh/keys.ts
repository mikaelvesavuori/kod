import { createHash } from 'node:crypto';

import ssh2 from 'ssh2';
import type { ParsedKey } from 'ssh2';

const { utils } = ssh2;

export interface ParsedPublicKey {
  publicKey: string;
  keyType: string;
  keyData: string;
  fingerprint: string;
  comment?: string;
  parsedKey: ParsedKey;
}

export function parsePublicKey(input: string): ParsedPublicKey | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;

  const parsed = utils.parseKey(trimmed);
  if (parsed instanceof Error || Array.isArray(parsed)) {
    return undefined;
  }

  const parts = trimmed.split(/\s+/);
  const comment = parts.length > 2 ? parts.slice(2).join(' ') : undefined;
  const keyData = parsed.getPublicSSH();

  return {
    publicKey: trimmed,
    keyType: parsed.type,
    keyData: keyData.toString('base64'),
    fingerprint: fingerprintKeyData(keyData),
    comment,
    parsedKey: parsed
  };
}

export function fingerprintKeyData(keyData: Buffer): string {
  return `SHA256:${createHash('sha256')
    .update(keyData)
    .digest('base64')
    .replace(/=+$/u, '')}`;
}
