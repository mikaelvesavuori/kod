import {
  createServer,
  type IncomingMessage,
  type ServerResponse
} from 'node:http';

import type { Route, HttpRequest, ApiToken } from '../shared/types.js';

export type TokenValidator = (
  token: string
) => Promise<ApiToken | undefined> | ApiToken | undefined;

/**
 * Check if the remote address is localhost (127.0.0.1, ::1, or ::ffff:127.0.0.1).
 */
function isLocalhost(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false;
  return (
    remoteAddress === '127.0.0.1' ||
    remoteAddress === '::1' ||
    remoteAddress === '::ffff:127.0.0.1'
  );
}

export function createHttpServer(
  routes: Route[],
  validateToken: TokenValidator
) {
  const server = createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, PATCH, DELETE, OPTIONS'
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization'
    );

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Parse request
    const httpReq = await parseRequest(req);

    // Internal endpoints are only accessible from localhost
    const isInternalEndpoint = httpReq.url.startsWith('/internal/');
    if (isInternalEndpoint) {
      const remoteAddr = req.socket.remoteAddress;
      if (!isLocalhost(remoteAddr)) {
        sendResponse(res, 403, { error: 'Internal endpoints are localhost-only' });
        return;
      }
    }

    // Check auth (except for health check and internal endpoints)
    const skipAuth = httpReq.url === '/health' || isInternalEndpoint;

    if (!skipAuth) {
      const authResult = await validateAuth(httpReq, validateToken);
      if (!authResult.valid) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Kod"');
        sendResponse(res, 401, { error: 'Unauthorized' });
        return;
      }
      // Attach token info to request for permission checking
      (httpReq as HttpRequestWithAuth).tokenInfo = authResult.tokenInfo;
    }

    // Find matching route
    for (const route of routes) {
      if (route.method !== httpReq.method) continue;

      const match = httpReq.url.match(route.pattern);
      if (!match) continue;

      // Extract named params from regex groups
      const params: Record<string, string> = {};
      const groups = match.groups;
      if (groups) {
        for (const [key, value] of Object.entries(groups)) {
          params[key] = value;
        }
      }

      try {
        const response = await route.handler(httpReq, params);
        sendResponse(res, response.status, response.body, response.headers);
      } catch (err) {
        console.error('Route error:', err);
        sendResponse(res, 500, { error: 'Internal server error' });
      }
      return;
    }

    // No route matched
    sendResponse(res, 404, { error: 'Not found' });
  });

  return server;
}

async function parseRequest(req: IncomingMessage): Promise<HttpRequest> {
  const body = await parseBody(req);
  const rawUrl = req.url || '/';
  const url = new URL(rawUrl, `http://${req.headers.host || 'localhost'}`);

  return {
    method: req.method || 'GET',
    url: url.pathname,
    headers: req.headers as Record<string, string | string[] | undefined>,
    body,
    // Store raw URL for routes that need query params (e.g., git info/refs)
    rawUrl
  };
}

async function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];

    req.on('data', (chunk) => {
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(undefined);
        return;
      }

      const buffer = Buffer.concat(chunks);
      const contentType = req.headers['content-type'] || '';

      // Keep as Buffer for git protocol requests
      if (
        contentType.includes('application/x-git') ||
        contentType.includes('git-upload-pack') ||
        contentType.includes('git-receive-pack')
      ) {
        resolve(buffer);
        return;
      }

      const raw = buffer.toString('utf-8');

      // Try to parse as JSON
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(raw);
      }
    });

    req.on('error', () => {
      resolve(undefined);
    });
  });
}

export interface HttpRequestWithAuth extends HttpRequest {
  tokenInfo?: ApiToken;
}

interface AuthResult {
  valid: boolean;
  tokenInfo?: ApiToken;
}

async function validateAuth(
  req: HttpRequest,
  validateToken: TokenValidator
): Promise<AuthResult> {
  const auth = req.headers.authorization;
  if (!auth || typeof auth !== 'string') return { valid: false };

  // Bearer token auth
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice(7);
    const tokenInfo = await validateToken(token);

    if (tokenInfo) {
      return { valid: true, tokenInfo };
    }
  }

  // HTTP Basic Auth (for git clients)
  // Format: Basic base64(username:password)
  // The password is the API token
  if (auth.startsWith('Basic ')) {
    try {
      const base64 = auth.slice(6);
      const decoded = Buffer.from(base64, 'base64').toString('utf-8');
      const colonIndex = decoded.indexOf(':');

      if (colonIndex > -1) {
        // Password is the token
        const token = decoded.slice(colonIndex + 1);
        const tokenInfo = await validateToken(token);

        if (tokenInfo) {
          return { valid: true, tokenInfo };
        }
      }
    } catch {
      // Invalid base64
    }
  }

  return { valid: false };
}

function sendResponse(
  res: ServerResponse,
  status: number,
  body?: unknown,
  headers?: Record<string, string>
): void {
  // Set custom headers first (may override Content-Type)
  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      res.setHeader(key, value);
    }
  }

  // If no Content-Type set, default to JSON
  if (!res.hasHeader('Content-Type')) {
    res.setHeader('Content-Type', 'application/json');
  }

  res.writeHead(status);

  if (body === undefined) {
    res.end();
  } else if (Buffer.isBuffer(body)) {
    // Binary response (for git protocol)
    res.end(body);
  } else {
    // JSON response
    res.end(JSON.stringify(body));
  }
}
