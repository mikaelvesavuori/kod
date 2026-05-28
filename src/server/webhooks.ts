import { createHmac } from 'node:crypto';

import type {
  RepoWebhook,
  WebhookDelivery,
  WebhookEvent
} from '../shared/types.js';

import type { Database } from './db/index.js';

const MAX_DELIVERY_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [30_000, 5 * 60_000, 30 * 60_000];

export async function deliverWebhooks(
  db: Database,
  repoName: string,
  event: WebhookEvent,
  payload: Record<string, unknown>
): Promise<void> {
  const webhooks = await db.listRepoWebhooks(repoName);
  const deliveries = webhooks
    .filter((webhook) => webhook.events.includes(event))
    .map(async (webhook) => {
      const delivery = await db.createWebhookDelivery({
        webhookId: webhook.id,
        repoName,
        event,
        url: webhook.url,
        payload,
        maxAttempts: MAX_DELIVERY_ATTEMPTS
      });

      await attemptWebhookDelivery(db, delivery, webhook);
    });

  await Promise.allSettled(deliveries);
}

export async function retryWebhookDelivery(
  db: Database,
  deliveryId: string
): Promise<WebhookDelivery | undefined> {
  const delivery = await db.getWebhookDelivery(deliveryId);
  if (!delivery) return undefined;

  const webhook = await db.getRepoWebhook(
    delivery.repoName,
    delivery.webhookId
  );
  if (!webhook) {
    await db.updateWebhookDelivery(delivery.id, {
      status: 'failed',
      error: 'Webhook no longer exists',
      nextAttemptAt: undefined
    });
    return db.getWebhookDelivery(delivery.id);
  }

  await db.updateWebhookDelivery(delivery.id, {
    status: 'pending',
    nextAttemptAt: undefined
  });
  const updated = await db.getWebhookDelivery(delivery.id);
  if (!updated) return undefined;

  await attemptWebhookDelivery(db, updated, webhook);
  return db.getWebhookDelivery(delivery.id);
}

export async function retryDueWebhookDeliveries(
  db: Database,
  now = Date.now()
): Promise<void> {
  const due = await db.listDueWebhookDeliveries(now);
  const attempts = due.map((delivery) => retryWebhookDelivery(db, delivery.id));
  await Promise.allSettled(attempts);
}

export function startWebhookRetryWorker(
  db: Database,
  intervalMs = 30_000
): NodeJS.Timeout {
  return setInterval(() => {
    void retryDueWebhookDeliveries(db).catch(() => {});
  }, intervalMs);
}

async function attemptWebhookDelivery(
  db: Database,
  delivery: WebhookDelivery,
  webhook: RepoWebhook
): Promise<void> {
  const body = JSON.stringify({
    event: delivery.event,
    repo: delivery.repoName,
    ...delivery.payload
  });
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Kod-Webhooks',
    'X-Kod-Event': delivery.event,
    'X-Kod-Delivery': delivery.id
  };

  if (webhook.secret) {
    const signature = createHmac('sha256', webhook.secret)
      .update(body)
      .digest('hex');
    headers['X-Kod-Signature-256'] = `sha256=${signature}`;
  }

  const nextAttempts = delivery.attempts + 1;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(delivery.url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal
    });

    if (response.ok) {
      await db.updateWebhookDelivery(delivery.id, {
        status: 'success',
        attempts: nextAttempts,
        lastAttemptAt: Date.now(),
        nextAttemptAt: undefined,
        responseStatus: response.status,
        error: undefined
      });
      return;
    }

    await recordFailedAttempt(
      db,
      delivery,
      nextAttempts,
      `HTTP ${response.status}`,
      response.status
    );
  } catch (err) {
    await recordFailedAttempt(
      db,
      delivery,
      nextAttempts,
      err instanceof Error ? err.message : 'Delivery failed'
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function recordFailedAttempt(
  db: Database,
  delivery: WebhookDelivery,
  attempts: number,
  error: string,
  responseStatus?: number
): Promise<void> {
  const hasRetries = attempts < delivery.maxAttempts;
  await db.updateWebhookDelivery(delivery.id, {
    status: hasRetries ? 'pending' : 'failed',
    attempts,
    lastAttemptAt: Date.now(),
    nextAttemptAt: hasRetries ? Date.now() + retryDelay(attempts) : undefined,
    responseStatus,
    error
  });
}

function retryDelay(attempts: number): number {
  return RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)];
}
