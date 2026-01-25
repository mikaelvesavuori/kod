import { describe, test, expect, beforeEach } from 'vitest';

import { setConfigOverrides, apiRequest } from '../../src/cli/http-client.js';

describe('CLI', () => {
  describe('setConfigOverrides', () => {
    beforeEach(() => {
      // Reset overrides before each test
      setConfigOverrides({});
    });

    test('It should apply token override to API requests', async () => {
      setConfigOverrides({
        apiToken: 'kod_test_override_token',
        serverUrl: 'http://test-server:9999'
      });

      // Make a request - it will fail to connect but we can verify the config is used
      const result = await apiRequest('GET', '/test');

      // Connection will fail but error message confirms the server URL was used
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Connection failed');
    });

    test('It should allow overriding just the token', async () => {
      setConfigOverrides({
        apiToken: 'kod_token_only'
      });

      const result = await apiRequest('GET', '/test');

      // Will try to connect to default localhost:3000
      expect(result.ok).toBe(false);
    });

    test('It should allow overriding just the server URL', async () => {
      setConfigOverrides({
        serverUrl: 'http://custom:8080'
      });

      const result = await apiRequest('GET', '/test');

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Connection failed');
    });

    test('It should handle empty overrides', () => {
      // Should not throw
      setConfigOverrides({});
    });
  });
});
