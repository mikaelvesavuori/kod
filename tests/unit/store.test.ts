import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Store } from '../../src/db/Store.js';

describe('Store', () => {
  let store: Store;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'kod-test-'));
    store = new Store(tempDir);
  });

  afterEach(async () => {
    await store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('It should write and read a value', async () => {
    await store.write('users', 'alice', { name: 'Alice', age: 30 });

    const result = await store.get<{ name: string; age: number }>(
      'users',
      'alice'
    );

    expect(result).toEqual({ name: 'Alice', age: 30 });
  });

  test('It should return undefined for non-existent key', async () => {
    const result = await store.get('users', 'nonexistent');

    expect(result).toBeUndefined();
  });

  test('It should return all values when no key provided', async () => {
    await store.write('users', 'alice', { name: 'Alice' });
    await store.write('users', 'bob', { name: 'Bob' });

    const result = await store.get<{ name: string }>('users');

    expect(result).toHaveLength(2);
    expect(result).toContainEqual({ name: 'Alice' });
    expect(result).toContainEqual({ name: 'Bob' });
  });

  test('It should delete a value', async () => {
    await store.write('users', 'alice', { name: 'Alice' });
    await store.delete('users', 'alice');

    const result = await store.get('users', 'alice');

    expect(result).toBeUndefined();
  });

  test('It should check if key exists', async () => {
    await store.write('users', 'alice', { name: 'Alice' });

    expect(await store.has('users', 'alice')).toBe(true);
    expect(await store.has('users', 'bob')).toBe(false);
  });

  test('It should return all keys for a table', async () => {
    await store.write('users', 'alice', { name: 'Alice' });
    await store.write('users', 'bob', { name: 'Bob' });

    const keys = await store.keys('users');

    expect(keys).toContain('alice');
    expect(keys).toContain('bob');
    expect(keys).toHaveLength(2);
  });

  test('It should overwrite existing value', async () => {
    await store.write('users', 'alice', { name: 'Alice', age: 30 });
    await store.write('users', 'alice', { name: 'Alice', age: 31 });

    const result = await store.get<{ name: string; age: number }>(
      'users',
      'alice'
    );

    expect(result?.age).toBe(31);
  });

  test('It should handle multiple tables', async () => {
    await store.write('users', 'alice', { name: 'Alice' });
    await store.write('repos', 'my-app', { name: 'my-app' });

    const user = await store.get<{ name: string }>('users', 'alice');
    const repo = await store.get<{ name: string }>('repos', 'my-app');

    expect(user?.name).toBe('Alice');
    expect(repo?.name).toBe('my-app');
  });

  test('It should persist data after close and reopen', async () => {
    await store.write('users', 'alice', { name: 'Alice' });
    await store.close();

    const newStore = new Store(tempDir);
    const result = await newStore.get<{ name: string }>('users', 'alice');

    expect(result?.name).toBe('Alice');

    await newStore.close();
  });

  test('It should return empty array for empty table', async () => {
    const result = await store.get('empty-table');

    expect(result).toEqual([]);
  });

  test('It should return empty keys for empty table', async () => {
    const keys = await store.keys('empty-table');

    expect(keys).toEqual([]);
  });
});
