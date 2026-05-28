import type {
  HttpRequest,
  HttpResponse,
  Route,
  SshPublicKey
} from '../../shared/types.js';

import { FORBIDDEN, hasPermission } from '../auth.js';
import type { Database } from '../db/index.js';
import type { HttpRequestWithAuth } from '../http-server.js';
import { parsePublicKey } from '../ssh/keys.js';

export function createKeyRoutes(db: Database): Route[] {
  return [listKeys(db), addKey(db), removeKey(db)];
}

const listKeys = (db: Database): Route => ({
  method: 'GET',
  pattern: /^\/keys\/?$/,
  handler: async (req: HttpRequest): Promise<HttpResponse> => {
    const username = getRequestedUsername(req);
    if (!username.allowed) return username.response;

    const keys = await db.listSshKeys(username.value);
    return {
      status: 200,
      body: keys.map(withoutKeyData)
    };
  }
});

const addKey = (db: Database): Route => ({
  method: 'POST',
  pattern: /^\/keys\/?$/,
  handler: async (req: HttpRequest): Promise<HttpResponse> => {
    const body = req.body as {
      username?: string;
      name?: string;
      publicKey?: string;
    };

    const username = getRequestedUsername(req, body?.username);
    if (!username.allowed) return username.response;

    if (!body?.publicKey || typeof body.publicKey !== 'string') {
      return { status: 400, body: { error: 'publicKey is required' } };
    }

    const collaborator = await db.getCollaborator(username.value);
    if (!collaborator) {
      return {
        status: 400,
        body: { error: `Collaborator '${username.value}' not found` }
      };
    }

    const parsed = parsePublicKey(body.publicKey);
    if (!parsed) {
      return { status: 400, body: { error: 'Invalid SSH public key' } };
    }

    const existing = await db.findSshKeyByData(parsed.keyType, parsed.keyData);
    if (existing) {
      return {
        status: 409,
        body: { error: 'SSH key already exists', id: existing.id }
      };
    }

    const key = await db.createSshKey({
      username: username.value,
      name: body.name || parsed.comment || parsed.fingerprint,
      publicKey: parsed.publicKey,
      keyType: parsed.keyType,
      keyData: parsed.keyData,
      fingerprint: parsed.fingerprint
    });

    return { status: 201, body: withoutKeyData(key) };
  }
});

const removeKey = (db: Database): Route => ({
  method: 'DELETE',
  pattern: /^\/keys\/(?<id>[^/]+)\/?$/,
  handler: async (
    req: HttpRequest,
    params: Record<string, string>
  ): Promise<HttpResponse> => {
    const key = await db.getSshKey(params.id);
    if (!key) {
      return { status: 404, body: { error: 'SSH key not found' } };
    }

    const username = getRequestedUsername(req, key.username);
    if (!username.allowed) return username.response;

    await db.deleteSshKey(params.id);
    return { status: 204 };
  }
});

type UsernameResult =
  | { allowed: true; value: string }
  | { allowed: false; response: HttpResponse };

function getRequestedUsername(
  req: HttpRequest,
  bodyUsername?: string
): UsernameResult {
  const authReq = req as HttpRequestWithAuth;
  const tokenUsername = authReq.tokenInfo?.username;
  const queryUsername = getQueryParam(req, 'username');
  const username = bodyUsername || queryUsername || tokenUsername;

  if (!username) {
    return {
      allowed: false,
      response: {
        status: 400,
        body: {
          error:
            'Username is required. Use a username-linked token or pass --username as an admin.'
        }
      }
    };
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return {
      allowed: false,
      response: { status: 400, body: { error: 'Invalid username' } }
    };
  }

  if (username !== tokenUsername && !hasPermission(req, 'admin')) {
    return { allowed: false, response: FORBIDDEN };
  }

  return { allowed: true, value: username };
}

function getQueryParam(req: HttpRequest, name: string): string | undefined {
  const rawUrl = req.rawUrl ?? req.url;
  const url = new URL(rawUrl, 'http://localhost');
  return url.searchParams.get(name) ?? undefined;
}

function withoutKeyData(key: SshPublicKey): Omit<SshPublicKey, 'keyData'> {
  const { keyData: _keyData, ...rest } = key;
  return rest;
}
