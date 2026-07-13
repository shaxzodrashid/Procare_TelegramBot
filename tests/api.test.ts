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
  bot: { enabled: false, richMessagesEnabled: false, developerTelegramIds: [] },
  api: { enabled: true, host: '127.0.0.1', port: 3000, messageSendToken: 'message-token' },
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

const authHeaders = { authorization: 'Bearer message-token' };

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

  it('returns service unavailable when a health reporter marks the process unhealthy', async () => {
    const app = createApiServer(config, logger, {
      healthReporter: {
        async snapshot() {
          return {
            status: 'unhealthy',
            service: 'procare-telegram-bot',
            timestamp: '2026-06-30T00:00:00.000Z',
            uptimeSeconds: 1,
            checks: {
              process: { status: 'ok' },
              configuration: { status: 'ok' },
              database: { status: 'unhealthy', message: 'PostgreSQL health query timed out' },
              migrations: { status: 'ok' },
              api: { status: 'ok' },
              telegram: { status: 'disabled' },
            },
          };
        },
      },
    });

    const response = await app.inject({ method: 'GET', url: '/health' });
    await app.close();

    assert.equal(response.statusCode, 503);
    assert.equal(response.json<{ status: string }>().status, 'unhealthy');
    assert.equal(
      response.json<{ checks: { database: { message: string } } }>().checks.database.message,
      'PostgreSQL health query timed out',
    );
  });
});

describe('direct message API', () => {
  it('normalizes the phone number and sends the trimmed message', async () => {
    const calls: Array<{
      phoneNumber: string;
      message: string;
      variables: unknown;
      inlineKeyboard?: unknown;
      supportReply?: unknown;
    }> = [];
    const app = createApiServer(config, logger, {
      directMessageSender: {
        async sendDirectMessage(params) {
          const cleaned = Object.fromEntries(
            Object.entries(params).filter(([, value]) => value !== undefined),
          );
          calls.push(cleaned as (typeof calls)[number]);
          return { status: 'sent' };
        },
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/messages/send',
      headers: authHeaders,
      payload: {
        phone_number: '90 123 45 67',
        message: '  Salom {{ first_name }}  ',
        variables: { phone_category: 'iPhone 15' },
        inline_keyboard: {
          rows: [
            [
              {
                type: 'url',
                text: 'CRM',
                url: 'https://crm.procare.uz/orders/1',
              },
            ],
            [
              {
                type: 'repair_order',
                text: 'Buyurtmani ko‘rish',
                repair_order_uuid: '11111111-1111-4111-8111-111111111111',
              },
            ],
          ],
        },
        support_reply: {
          target_crm_comment_id: '22222222-2222-4222-8222-222222222222',
        },
      },
    });
    await app.close();

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: 'sent' });
    assert.deepEqual(calls, [
      {
        phoneNumber: '+998901234567',
        message: 'Salom {{ first_name }}',
        variables: { phone_category: 'iPhone 15' },
        inlineKeyboard: {
          rows: [
            [{ type: 'url', text: 'CRM', url: 'https://crm.procare.uz/orders/1' }],
            [
              {
                type: 'repair_order',
                text: 'Buyurtmani ko‘rish',
                repairOrderUuid: '11111111-1111-4111-8111-111111111111',
              },
            ],
          ],
        },
        supportReply: {
          targetCrmCommentId: '22222222-2222-4222-8222-222222222222',
        },
      },
    ]);
  });

  it('accepts repair-order keyboard shorthand', async () => {
    const calls: Array<{ inlineKeyboard: unknown }> = [];
    const app = createApiServer(config, logger, {
      directMessageSender: {
        async sendDirectMessage(params) {
          calls.push({ inlineKeyboard: params.inlineKeyboard });
          return { status: 'sent' };
        },
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/messages/send',
      headers: authHeaders,
      payload: {
        phone_number: '+998901234567',
        message: 'Salom',
        inline_keyboard: {
          type: 'repair_order',
          repair_order_uuid: '11111111-1111-4111-8111-111111111111',
        },
      },
    });
    await app.close();

    assert.equal(response.statusCode, 200);
    assert.deepEqual(calls, [
      {
        inlineKeyboard: {
          rows: [
            [
              {
                type: 'repair_order',
                text: undefined,
                repairOrderUuid: '11111111-1111-4111-8111-111111111111',
              },
            ],
          ],
        },
      },
    ]);
  });

  it('requires a valid bearer token for message delivery', async () => {
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
      payload: { phone_number: '+998901234567', message: 'Salom' },
    });
    await app.close();

    assert.equal(response.statusCode, 401);
    assert.equal(response.json<{ error: string }>().error, 'Unauthorized');
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
      headers: authHeaders,
      payload: { phone_number: '123', message: '' },
    });
    await app.close();

    assert.equal(response.statusCode, 400);
    assert.equal(response.json<{ error: string }>().error, 'BadRequest');
  });

  it('rejects invalid variable payloads before sending', async () => {
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
      headers: authHeaders,
      payload: {
        phone_number: '+998901234567',
        message: 'Salom {{ phone_category }}',
        variables: { phone_category: { name: 'iPhone' } },
      },
    });
    await app.close();

    assert.equal(response.statusCode, 400);
    assert.equal(
      response.json<{ message: string }>().message,
      'variable values must be strings, numbers, booleans, or null',
    );
  });

  it('rejects invalid inline keyboard payloads before sending', async () => {
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
      headers: authHeaders,
      payload: {
        phone_number: '+998901234567',
        message: 'Salom',
        inline_keyboard: {
          rows: [[{ type: 'repair_order', repair_order_uuid: 'not-a-uuid' }]],
        },
      },
    });
    await app.close();

    assert.equal(response.statusCode, 400);
    assert.equal(
      response.json<{ message: string }>().message,
      'repair_order buttons require a valid repair_order_uuid',
    );
  });

  it('rejects invalid support reply payloads before sending', async () => {
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
      headers: authHeaders,
      payload: {
        phone_number: '+998901234567',
        message: 'Salom',
        support_reply: { target_crm_comment_id: 'not-a-uuid' },
      },
    });
    await app.close();

    assert.equal(response.statusCode, 400);
    assert.equal(
      response.json<{ message: string }>().message,
      'support_reply.target_crm_comment_id must be a valid CRM comment UUID',
    );
  });

  it('maps rendered message validation failures to bad request', async () => {
    const app = createApiServer(config, logger, {
      directMessageSender: {
        async sendDirectMessage() {
          return {
            status: 'invalid_message',
            message: 'Missing message variables: phone_category',
          };
        },
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/messages/send',
      headers: authHeaders,
      payload: { phone_number: '+998901234567', message: 'Salom {{ phone_category }}' },
    });
    await app.close();

    assert.equal(response.statusCode, 400);
    assert.equal(
      response.json<{ message: string }>().message,
      'Missing message variables: phone_category',
    );
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
      headers: authHeaders,
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
      headers: authHeaders,
      payload: { phone_number: '+998901234567', message: 'Salom' },
    });
    await app.close();

    assert.equal(response.statusCode, 503);
    assert.equal(response.json<{ error: string }>().error, 'ServiceUnavailable');
  });

  it('propagates the optional type parameter when valid', async () => {
    const calls: Array<{ type?: string }> = [];
    const app = createApiServer(config, logger, {
      directMessageSender: {
        async sendDirectMessage(params) {
          calls.push({ type: params.type });
          return { status: 'sent' };
        },
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/messages/send',
      headers: authHeaders,
      payload: {
        phone_number: '+998901234567',
        message: 'Salom',
        type: 'warranty',
      },
    });
    await app.close();

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: 'sent' });
    assert.deepEqual(calls, [{ type: 'warranty' }]);
  });

  it('rejects invalid type parameter types or invalid values', async () => {
    const app = createApiServer(config, logger, {
      directMessageSender: {
        async sendDirectMessage() {
          return { status: 'sent' };
        },
      },
    });

    // 1. type not a string
    const res1 = await app.inject({
      method: 'POST',
      url: '/messages/send',
      headers: authHeaders,
      payload: {
        phone_number: '+998901234567',
        message: 'Salom',
        type: 123,
      },
    });
    assert.equal(res1.statusCode, 400);
    assert.ok(res1.json<{ message: string }>().message.includes('type must be a string'));

    // 2. type is empty
    const res2 = await app.inject({
      method: 'POST',
      url: '/messages/send',
      headers: authHeaders,
      payload: {
        phone_number: '+998901234567',
        message: 'Salom',
        type: '   ',
      },
    });
    assert.equal(res2.statusCode, 400);
    assert.ok(res2.json<{ message: string }>().message.includes('type must not be empty'));

    // 3. type is invalid template type
    const res3 = await app.inject({
      method: 'POST',
      url: '/messages/send',
      headers: authHeaders,
      payload: {
        phone_number: '+998901234567',
        message: 'Salom',
        type: 'not_a_valid_type',
      },
    });
    assert.equal(res3.statusCode, 400);
    assert.ok(
      res3
        .json<{ message: string }>()
        .message.includes('type must be a valid message template type'),
    );

    await app.close();
  });

  describe('send file API', () => {
    it('normalizes the phone number and sends the file payload', async () => {
      const calls: Array<{
        phoneNumber: string;
        fileType: string;
        fileUrl: string;
        fileName?: string;
        variables?: unknown;
        caption?: string;
      }> = [];
      const app = createApiServer(config, logger, {
        directFileSender: {
          async sendDirectFile(params) {
            calls.push(params);
            return { status: 'sent' };
          },
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/messages/send-file',
        headers: authHeaders,
        payload: {
          phone_number: '90 123 45 67',
          file_type: 'warranty',
          file_url: 'https://minio.test/warranty.pdf',
          file_name: 'test_warranty.pdf',
          variables: { order_id: '123' },
          caption: 'My caption',
        },
      });
      await app.close();

      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), { status: 'sent' });
      assert.deepEqual(calls, [
        {
          phoneNumber: '+998901234567',
          fileType: 'warranty',
          fileUrl: 'https://minio.test/warranty.pdf',
          fileName: 'test_warranty.pdf',
          variables: { order_id: '123' },
          caption: 'My caption',
        },
      ]);
    });

    it('rejects requests with missing or invalid fields', async () => {
      const app = createApiServer(config, logger, {
        directFileSender: {
          async sendDirectFile() {
            return { status: 'sent' };
          },
        },
      });

      // Missing phone_number
      let response = await app.inject({
        method: 'POST',
        url: '/messages/send-file',
        headers: authHeaders,
        payload: { file_type: 'warranty', file_url: 'https://minio.test/a.pdf' },
      });
      assert.equal(response.statusCode, 400);

      // Invalid file_type
      response = await app.inject({
        method: 'POST',
        url: '/messages/send-file',
        headers: authHeaders,
        payload: {
          phone_number: '+998901234567',
          file_type: 'invalid',
          file_url: 'https://minio.test/a.pdf',
        },
      });
      assert.equal(response.statusCode, 400);

      // Invalid file_url
      response = await app.inject({
        method: 'POST',
        url: '/messages/send-file',
        headers: authHeaders,
        payload: { phone_number: '+998901234567', file_type: 'warranty', file_url: 'not-a-url' },
      });
      assert.equal(response.statusCode, 400);

      // Invalid file_name extension
      response = await app.inject({
        method: 'POST',
        url: '/messages/send-file',
        headers: authHeaders,
        payload: {
          phone_number: '+998901234567',
          file_type: 'warranty',
          file_url: 'https://minio.test/a.pdf',
          file_name: 'test.docx',
        },
      });
      assert.equal(response.statusCode, 400);

      await app.close();
    });

    it('requires a valid bearer token for file delivery', async () => {
      const app = createApiServer(config, logger, {
        directFileSender: {
          async sendDirectFile() {
            return { status: 'sent' };
          },
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/messages/send-file',
        payload: {
          phone_number: '+998901234567',
          file_type: 'warranty',
          file_url: 'https://minio.test/a.pdf',
        },
      });
      await app.close();

      assert.equal(response.statusCode, 401);
    });

    it('returns 404 when user is not found', async () => {
      const app = createApiServer(config, logger, {
        directFileSender: {
          async sendDirectFile() {
            return { status: 'not_found' };
          },
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/messages/send-file',
        headers: authHeaders,
        payload: {
          phone_number: '+998901234567',
          file_type: 'warranty',
          file_url: 'https://minio.test/a.pdf',
        },
      });
      await app.close();

      assert.equal(response.statusCode, 404);
    });

    it('returns 409 when user is blocked', async () => {
      const app = createApiServer(config, logger, {
        directFileSender: {
          async sendDirectFile() {
            return { status: 'blocked' };
          },
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/messages/send-file',
        headers: authHeaders,
        payload: {
          phone_number: '+998901234567',
          file_type: 'warranty',
          file_url: 'https://minio.test/a.pdf',
        },
      });
      await app.close();

      assert.equal(response.statusCode, 409);
    });

    it('returns 502 when file delivery fails', async () => {
      const app = createApiServer(config, logger, {
        directFileSender: {
          async sendDirectFile() {
            return { status: 'failed' };
          },
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/messages/send-file',
        headers: authHeaders,
        payload: {
          phone_number: '+998901234567',
          file_type: 'warranty',
          file_url: 'https://minio.test/a.pdf',
        },
      });
      await app.close();

      assert.equal(response.statusCode, 502);
    });
  });
});
