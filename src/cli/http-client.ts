/** biome-ignore-all lint/style/noNonNullAssertion: OK */
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';

import { loadClientConfig } from '../shared/config.js';
import type { KodConfig } from '../shared/types.js';

export interface ApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

// Global config overrides set by CLI
let globalConfigOverrides: Partial<KodConfig> = {};

export function setConfigOverrides(overrides: Partial<KodConfig>): void {
  globalConfigOverrides = overrides;
}

export async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<ApiResponse<T>> {
  const config = loadClientConfig(globalConfigOverrides);

  if (!config.serverUrl) {
    return {
      ok: false,
      status: 0,
      error: 'Server URL not configured. Run "kod init" first.'
    };
  }

  const url = new URL(path, config.serverUrl);
  const isHttps = url.protocol === 'https:';
  const requestFn = isHttps ? httpsRequest : httpRequest;

  return new Promise((resolve) => {
    const req = requestFn(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiToken && { Authorization: `Bearer ${config.apiToken}` })
        }
      },
      (res) => {
        const chunks: Buffer[] = [];

        res.on('data', (chunk) => chunks.push(chunk));

        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          let data: T | undefined;

          try {
            data = raw ? JSON.parse(raw) : undefined;
          } catch {
            // Not JSON
          }

          const ok = res.statusCode! >= 200 && res.statusCode! < 300;

          if (ok) {
            resolve({ ok: true, status: res.statusCode!, data });
          } else {
            const errorData = data as { error?: string } | undefined;
            resolve({
              ok: false,
              status: res.statusCode!,
              error: errorData?.error || `HTTP ${res.statusCode}`
            });
          }
        });
      }
    );

    req.on('error', (err) => {
      resolve({
        ok: false,
        status: 0,
        error: `Connection failed: ${err.message}`
      });
    });

    if (body !== undefined) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

// Convenience methods
export const api = {
  get: <T>(path: string) => apiRequest<T>('GET', path),
  post: <T>(path: string, body?: unknown) => apiRequest<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) =>
    apiRequest<T>('PATCH', path, body),
  delete: <T>(path: string) => apiRequest<T>('DELETE', path)
};
