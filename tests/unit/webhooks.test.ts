import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { Database } from '../../src/server/db/index.js';
import {
  deliverWebhooks,
  retryDueWebhookDeliveries
} from '../../src/server/webhooks.js';

describe('Webhook delivery', () => {
  const tempDirs: string[] = [];
  const servers: ReturnType<typeof createServer>[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      if (server.listening) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('It should deliver matching webhooks with an HMAC signature', async () => {
    const { received, deliveries } = await withReceiver(
      async (url, getRequest) => {
        const db = await makeDatabase();
        await db.createRepoWebhook('my-app', url, ['push'], 'signing-secret');

        await deliverWebhooks(db, 'my-app', 'push', {
          branch: 'main',
          commit: 'abcdef1'
        });

        const request = await getRequest();
        const deliveryRecords = await db.listWebhookDeliveries('my-app');
        await db.close();
        return { received: request, deliveries: deliveryRecords };
      }
    );

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe('success');
    expect(deliveries[0].attempts).toBe(1);

    expect(received.headers['x-kod-event']).toBe('push');
    expect(received.headers['x-kod-delivery']).toBe(deliveries[0].id);
    expect(received.body).toContain('"repo":"my-app"');
    expect(received.body).toContain('"branch":"main"');

    const expected = createHmac('sha256', 'signing-secret')
      .update(received.body)
      .digest('hex');
    expect(received.headers['x-kod-signature-256']).toBe(
      `sha256=${expected}`
    );
  });

  test('It should record failed deliveries and retry due pending deliveries', async () => {
    let attempts = 0;

    const server = createServer((_req, res) => {
      attempts++;
      res.writeHead(attempts === 1 ? 500 : 204);
      res.end();
    });
    servers.push(server);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('No listener address');
    }

    const db = await makeDatabase();
    await db.createRepoWebhook(
      'my-app',
      `http://127.0.0.1:${address.port}/hook`,
      ['push']
    );

    await deliverWebhooks(db, 'my-app', 'push', { branch: 'main' });
    let deliveries = await db.listWebhookDeliveries('my-app');
    expect(deliveries[0].status).toBe('pending');
    expect(deliveries[0].attempts).toBe(1);

    await db.updateWebhookDelivery(deliveries[0].id, {
      nextAttemptAt: Date.now() - 1
    });
    await retryDueWebhookDeliveries(db);

    deliveries = await db.listWebhookDeliveries('my-app');
    expect(deliveries[0].status).toBe('success');
    expect(deliveries[0].attempts).toBe(2);
    await db.close();
  });

  test('It should skip webhooks that do not subscribe to the event', async () => {
    let delivered = false;

    const server = createServer((_req, res) => {
      delivered = true;
      res.writeHead(204);
      res.end();
    });
    servers.push(server);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('No listener address');
    }

    const db = await makeDatabase();
    await db.createRepoWebhook(
      'my-app',
      `http://127.0.0.1:${address.port}/hook`,
      ['workflow']
    );

    await deliverWebhooks(db, 'my-app', 'push', { branch: 'main' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    await db.close();

    expect(delivered).toBe(false);
  });

  async function makeDatabase(): Promise<Database> {
    const tempDir = mkdtempSync(join(tmpdir(), 'kod-webhook-test-'));
    tempDirs.push(tempDir);
    return new Database(tempDir);
  }

  async function withReceiver<T>(
    callback: (
      url: string,
      getRequest: () => Promise<{
        body: string;
        headers: IncomingMessage['headers'];
      }>
    ) => Promise<T>
  ): Promise<T> {
    let resolveRequest:
      | ((request: { body: string; headers: IncomingMessage['headers'] }) => void)
      | undefined;
    const requestPromise = new Promise<{
      body: string;
      headers: IncomingMessage['headers'];
    }>((resolve) => {
      resolveRequest = resolve;
    });

    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        resolveRequest?.({
          body: Buffer.concat(chunks).toString('utf-8'),
          headers: req.headers
        });
        res.writeHead(204);
        res.end();
      });
    });
    servers.push(server);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('No listener address');
    }

    return callback(`http://127.0.0.1:${address.port}/hook`, () =>
      withTimeout(requestPromise)
    );
  }

  function withTimeout<T>(promise: Promise<T>): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        setTimeout(() => reject(new Error('Timed out waiting for webhook')), 500);
      })
    ]);
  }
});
