import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createApiServer } from '../src/api/server.js';
import type { AppConfig } from '../src/config/index.js';
import type { DirectMessageDeliveryResult } from '../src/services/bot-notification.service.js';
import type { Logger } from '../src/utils/logger.js';

const logger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  extra: () => undefined,
  table: () => undefined,
};

const config: AppConfig = {
  nodeEnv: 'test',
  logLevel: 'info',
  bot: { enabled: false, richMessagesEnabled: false },
  api: { enabled: true, host: '127.0.0.1', port: 3000 },
  crm: {
    baseUrl: 'http://crm.test',
    username: 'bot',
    password: 'secret',
    requestTimeoutMs: 1_000,
    maxRetries: 0,
  },
  database: {
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'postgres',
    name: 'probox_bot_db',
    ssl: false,
    poolMin: 0,
    poolMax: 10,
    acquireTimeoutMs: 10_000,
  },
};

describe('health API', () => {
  it('reports service status without opening a network port', async () => {
    const app = createApiServer(config, logger);

    const response = await app.inject({ method: 'GET', url: '/health' });
    await app.close();

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      status: 'ok',
      service: 'procare-telegram-bot',
      timestamp: response.json<{ timestamp: string }>().timestamp,
      botEnabled: false,
    });
  });
});

describe('direct message API', () => {
  it('normalizes the phone number and sends the trimmed message', async () => {
    const calls: Array<{ phoneNumber: string; message: string }> = [];
    const app = createApiServer(config, logger, {
      directMessageSender: {
        async sendDirectMessage(params) {
          calls.push(params);
          return { status: 'sent' };
        },
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/messages/send',
      payload: { phone_number: '90 123 45 67', message: '  Salom  ' },
    });
    await app.close();

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: 'sent' });
    assert.deepEqual(calls, [{ phoneNumber: '+998901234567', message: 'Salom' }]);
  });

  it('rejects invalid request payloads before sending', async () => {
    const app = createApiServer(config, logger, {
      directMessageSender: {
        async sendDirectMessage(): Promise<DirectMessageDeliveryResult> {
          throw new Error('should not send');
        },
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/messages/send',
      payload: { phone_number: '123', message: '' },
    });
    await app.close();

    assert.equal(response.statusCode, 400);
    assert.equal(response.json<{ error: string }>().error, 'BadRequest');
  });

  it('returns not found when no registered user matches the phone number', async () => {
    const app = createApiServer(config, logger, {
      directMessageSender: {
        async sendDirectMessage() {
          return { status: 'not_found' };
        },
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/messages/send',
      payload: { phone_number: '+998901234567', message: 'Salom' },
    });
    await app.close();

    assert.equal(response.statusCode, 404);
    assert.equal(response.json<{ error: string }>().error, 'NotFound');
  });

  it('returns unavailable when Telegram delivery is not configured', async () => {
    const app = createApiServer(config, logger);

    const response = await app.inject({
      method: 'POST',
      url: '/messages/send',
      payload: { phone_number: '+998901234567', message: 'Salom' },
    });
    await app.close();

    assert.equal(response.statusCode, 503);
    assert.equal(response.json<{ error: string }>().error, 'ServiceUnavailable');
  });
});
