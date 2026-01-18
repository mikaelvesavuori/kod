import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  createHash
} from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;

const kodDir = join(homedir(), '.kod');
const keyFile = join(kodDir, '.key');

/**
 * Get or create the encryption key.
 * The key is derived from a random salt stored in ~/.kod/.key
 */
function getEncryptionKey(): Buffer {
  if (!existsSync(kodDir)) {
    mkdirSync(kodDir, { recursive: true });
  }

  let salt: Buffer;

  if (existsSync(keyFile)) {
    salt = readFileSync(keyFile);
  } else {
    salt = randomBytes(SALT_LENGTH);
    writeFileSync(keyFile, salt, { mode: 0o600 });
  }

  // Derive key from salt using scrypt
  // Using a fixed "password" combined with random salt
  // The security comes from the random salt being secret
  return scryptSync('kod-encryption-key', salt, KEY_LENGTH);
}

/**
 * Encrypt a string value.
 * Returns base64-encoded: iv + authTag + ciphertext
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();

  // Combine: iv (16) + authTag (16) + ciphertext
  const combined = Buffer.concat([iv, authTag, encrypted]);
  return combined.toString('base64');
}

/**
 * Decrypt a base64-encoded encrypted value.
 */
export function decrypt(encryptedBase64: string): string {
  const key = getEncryptionKey();
  const combined = Buffer.from(encryptedBase64, 'base64');

  // Extract parts
  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]);

  return decrypted.toString('utf8');
}

/**
 * Hash a token for secure comparison.
 * Used for storing tokens in a way that can be verified but not reversed.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Check if a value looks like it's encrypted (base64 with correct length prefix).
 */
export function isEncrypted(value: string): boolean {
  if (!value || typeof value !== 'string') return false;

  try {
    const decoded = Buffer.from(value, 'base64');
    // Minimum length: IV (16) + AuthTag (16) + at least 1 byte ciphertext
    return decoded.length >= IV_LENGTH + AUTH_TAG_LENGTH + 1;
  } catch {
    return false;
  }
}
