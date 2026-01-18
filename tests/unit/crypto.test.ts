import { describe, test, expect } from 'vitest';

import {
  encrypt,
  decrypt,
  hashToken,
  isEncrypted
} from '../../src/shared/crypto.js';

describe('Crypto utilities', () => {
  describe('encrypt/decrypt', () => {
    test('It should encrypt and decrypt a string', () => {
      const original = 'my secret token';
      const encrypted = encrypt(original);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(original);
      expect(encrypted).not.toBe(original);
    });

    test('It should produce different ciphertext each time (random IV)', () => {
      const original = 'same value';
      const encrypted1 = encrypt(original);
      const encrypted2 = encrypt(original);

      expect(encrypted1).not.toBe(encrypted2);
      expect(decrypt(encrypted1)).toBe(original);
      expect(decrypt(encrypted2)).toBe(original);
    });

    test('It should handle empty strings', () => {
      const encrypted = encrypt('');
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe('');
    });

    test('It should handle unicode characters', () => {
      const original = 'Hello 世界 🚀';
      const encrypted = encrypt(original);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(original);
    });
  });

  describe('hashToken', () => {
    test('It should produce a consistent hash for the same input', () => {
      const token = 'kod_abc123xyz';
      const hash1 = hashToken(token);
      const hash2 = hashToken(token);

      expect(hash1).toBe(hash2);
    });

    test('It should produce different hashes for different inputs', () => {
      const hash1 = hashToken('token1');
      const hash2 = hashToken('token2');

      expect(hash1).not.toBe(hash2);
    });

    test('It should produce a 64-character hex string (SHA-256)', () => {
      const hash = hashToken('any token');

      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('isEncrypted', () => {
    test('It should return true for encrypted values', () => {
      const encrypted = encrypt('test');

      expect(isEncrypted(encrypted)).toBe(true);
    });

    test('It should return false for plain strings', () => {
      expect(isEncrypted('not encrypted')).toBe(false);
      expect(isEncrypted('kod_abc123')).toBe(false);
    });

    test('It should return false for empty/null/undefined', () => {
      expect(isEncrypted('')).toBe(false);
      expect(isEncrypted(null as any)).toBe(false);
      expect(isEncrypted(undefined as any)).toBe(false);
    });

    test('It should return false for short base64 strings', () => {
      // Base64 that's too short to contain IV + authTag + ciphertext
      expect(isEncrypted('YWJj')).toBe(false);
    });
  });
});
