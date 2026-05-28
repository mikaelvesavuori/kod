import type {
  HttpRequest,
  HttpResponse,
  RepoWebhook,
  Route,
  WebhookEvent
} from '../../shared/types.js';

import { FORBIDDEN, hasPermission, getTokenId } from '../auth.js';
import type { Database } from '../db/index.js';
import { retryWebhookDelivery } from '../webhooks.js';

export function createWebhookRoutes(db: Database): Route[] {
  return [
    listWebhooks(db),
    createWebhook(db),
    listWebhookDeliveries(db),
    retryWebhookDeliveryRoute(db),
    deleteWebhook(db)
  ];
}

const listWebhooks = (db: Database): Route => ({
  method: 'GET',
  pattern: /^\/repos\/(?<name>[^/]+)\/webhooks\/?$/,
  handler: async (
    req: HttpRequest,
    params: Record<string, string>
  ): Promise<HttpResponse> => {
    if (!hasPermission(req, 'webhook:read')) {
      return FORBIDDEN;
    }

    const repo = await db.getRepo(params.name);
    if (!repo) {
      return { status: 404, body: { error: 'Repository not found' } };
    }

    if (!canManageWebhooks(req, repo.ownerTokenId)) {
      return FORBIDDEN;
    }

    const webhooks = await db.listRepoWebhooks(params.name);
    return {
      status: 200,
      body: webhooks.map(withoutSecret)
    };
  }
});

const createWebhook = (db: Database): Route => ({
  method: 'POST',
  pattern: /^\/repos\/(?<name>[^/]+)\/webhooks\/?$/,
  handler: async (
    req: HttpRequest,
    params: Record<string, string>
  ): Promise<HttpResponse> => {
    if (!hasPermission(req, 'webhook:write')) {
      return FORBIDDEN;
    }

    const repo = await db.getRepo(params.name);
    if (!repo) {
      return { status: 404, body: { error: 'Repository not found' } };
    }

    if (!canManageWebhooks(req, repo.ownerTokenId)) {
      return FORBIDDEN;
    }

    const body = req.body as {
      url?: string;
      events?: WebhookEvent[];
      secret?: string;
    };

    if (!body?.url || typeof body.url !== 'string') {
      return { status: 400, body: { error: 'Webhook URL is required' } };
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(body.url);
    } catch {
      return { status: 400, body: { error: 'Webhook URL is invalid' } };
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return {
        status: 400,
        body: { error: 'Webhook URL must use http or https' }
      };
    }

    const events = body.events ?? ['push'];
    if (
      !Array.isArray(events) ||
      events.length === 0 ||
      events.some((event) => !isWebhookEvent(event))
    ) {
      return { status: 400, body: { error: 'Invalid webhook events' } };
    }

    const webhook = await db.createRepoWebhook(
      params.name,
      parsedUrl.toString(),
      events,
      body.secret
    );

    return { status: 201, body: withoutSecret(webhook) };
  }
});

const deleteWebhook = (db: Database): Route => ({
  method: 'DELETE',
  pattern: /^\/repos\/(?<name>[^/]+)\/webhooks\/(?<id>[^/]+)\/?$/,
  handler: async (
    req: HttpRequest,
    params: Record<string, string>
  ): Promise<HttpResponse> => {
    if (!hasPermission(req, 'webhook:write')) {
      return FORBIDDEN;
    }

    const repo = await db.getRepo(params.name);
    if (!repo) {
      return { status: 404, body: { error: 'Repository not found' } };
    }

    if (!canManageWebhooks(req, repo.ownerTokenId)) {
      return FORBIDDEN;
    }

    await db.deleteRepoWebhook(params.name, params.id);
    return { status: 204 };
  }
});

const listWebhookDeliveries = (db: Database): Route => ({
  method: 'GET',
  pattern: /^\/repos\/(?<name>[^/]+)\/webhooks\/(?<id>[^/]+)\/deliveries\/?$/,
  handler: async (
    req: HttpRequest,
    params: Record<string, string>
  ): Promise<HttpResponse> => {
    if (!hasPermission(req, 'webhook:read')) {
      return FORBIDDEN;
    }

    const repo = await db.getRepo(params.name);
    if (!repo) {
      return { status: 404, body: { error: 'Repository not found' } };
    }

    if (!canManageWebhooks(req, repo.ownerTokenId)) {
      return FORBIDDEN;
    }

    const webhook = await db.getRepoWebhook(params.name, params.id);
    if (!webhook) {
      return { status: 404, body: { error: 'Webhook not found' } };
    }

    const deliveries = await db.listWebhookDeliveries(params.name, params.id);
    return { status: 200, body: deliveries };
  }
});

const retryWebhookDeliveryRoute = (db: Database): Route => ({
  method: 'POST',
  pattern:
    /^\/repos\/(?<name>[^/]+)\/webhooks\/(?<id>[^/]+)\/deliveries\/(?<deliveryId>[^/]+)\/retry\/?$/,
  handler: async (
    req: HttpRequest,
    params: Record<string, string>
  ): Promise<HttpResponse> => {
    if (!hasPermission(req, 'webhook:write')) {
      return FORBIDDEN;
    }

    const repo = await db.getRepo(params.name);
    if (!repo) {
      return { status: 404, body: { error: 'Repository not found' } };
    }

    if (!canManageWebhooks(req, repo.ownerTokenId)) {
      return FORBIDDEN;
    }

    const delivery = await db.getWebhookDelivery(params.deliveryId);
    if (
      !delivery ||
      delivery.repoName !== params.name ||
      delivery.webhookId !== params.id
    ) {
      return { status: 404, body: { error: 'Webhook delivery not found' } };
    }

    const updated = await retryWebhookDelivery(db, params.deliveryId);
    return { status: 202, body: updated };
  }
});

function canManageWebhooks(req: HttpRequest, ownerTokenId: string): boolean {
  return hasPermission(req, 'admin') || getTokenId(req) === ownerTokenId;
}

function withoutSecret(webhook: RepoWebhook): Omit<RepoWebhook, 'secret'> {
  const { secret: _secret, ...rest } = webhook;
  return rest;
}

function isWebhookEvent(event: string): event is WebhookEvent {
  return event === 'push' || event === 'workflow';
}
