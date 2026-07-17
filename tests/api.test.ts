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
  it('accepts the details, approval, and rating action keyboard contracts', async () => {
    const keyboards: unknown[] = [];
    const app = createApiServer(config, logger, {
      directMessageSender: {
        async sendDirectMessage(params) {
          keyboards.push(params.inlineKeyboard);
          return { status: 'sent' };
        },
      },
    });
    const repairOrderUuid = '11111111-1111-4111-8111-111111111111';

    for (const inlineKeyboard of [
      {
        type: 'details',
        repair_order_uuid: repairOrderUuid,
        localized_text: { uz: 'Batafsil', ru: 'Подробнее' },
        style: 'primary',
      },
      { type: 'approval', repair_order_uuid: repairOrderUuid },
      { type: 'rating', repair_order_uuid: repairOrderUuid },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/messages/send',
        headers: authHeaders,
        payload: {
          phone_number: '+998901234567',
          message: 'CRM action',
          inline_keyboard: inlineKeyboard,
        },
      });
      assert.equal(response.statusCode, 200);
    }
    await app.close();

    assert.deepEqual(keyboards, [
      {
        type: 'details',
        repairOrderUuid,
        localizedText: { uz: 'Batafsil', ru: 'Подробнее', en: null },
        style: 'primary',
      },
      { type: 'approval', repairOrderUuid },
      { type: 'rating', repairOrderUuid },
    ]);
  });

  it('accepts CRM-controlled layouts with purpose-specific button subtypes', async () => {
    const keyboards: unknown[] = [];
    const app = createApiServer(config, logger, {
      directMessageSender: {
        async sendDirectMessage(params) {
          keyboards.push(params.inlineKeyboard);
          return { status: 'sent' };
        },
      },
    });
    const repairOrderUuid = '11111111-1111-4111-8111-111111111111';
    const ratingButtons = Array.from({ length: 10 }, (_, index) => ({
      type: `rating_${index + 1}`,
      text: String(index + 1),
    }));
    const actionKeyboards = [
      {
        type: 'details',
        repair_order_uuid: repairOrderUuid,
        layout: [[{ type: 'details', text: 'Open details' }]],
      },
      {
        type: 'approval',
        repair_order_uuid: repairOrderUuid,
        layout: [[{ type: 'approve', text: 'Approve' }], [{ type: 'reject', text: 'Reject' }]],
      },
      {
        type: 'rating',
        repair_order_uuid: repairOrderUuid,
        layout: [ratingButtons.slice(0, 5), ratingButtons.slice(5)],
      },
    ];

    for (const inlineKeyboard of actionKeyboards) {
      const response = await app.inject({
        method: 'POST',
        url: '/messages/send',
        headers: authHeaders,
        payload: {
          phone_number: '+998901234567',
          message: 'CRM action',
          inline_keyboard: inlineKeyboard,
        },
      });
      assert.equal(response.statusCode, 200);
    }
    await app.close();

    assert.deepEqual(
      keyboards,
      actionKeyboards.map(({ repair_order_uuid, ...keyboard }) => ({
        ...keyboard,
        repairOrderUuid: repair_order_uuid,
      })),
    );
  });

  it('accepts localized and styled buttons in generated action layouts', async () => {
    let keyboard: unknown;
    const app = createApiServer(config, logger, {
      directMessageSender: {
        async sendDirectMessage(params) {
          keyboard = params.inlineKeyboard;
          return { status: 'sent' };
        },
      },
    });
    const repairOrderUuid = '11111111-1111-4111-8111-111111111111';

    const response = await app.inject({
      method: 'POST',
      url: '/messages/send',
      headers: authHeaders,
      payload: {
        phone_number: '+998901234567',
        message: 'Approval',
        inline_keyboard: {
          type: 'approval',
          repair_order_uuid: repairOrderUuid,
          layout: [
            [
              {
                type: 'reject',
                localized_text: { uz: 'Rad etish', ru: 'Отклонить' },
                style: 'danger',
              },
              {
                type: 'approve',
                localized_text: { uz: 'Tasdiqlash', ru: 'Одобрить' },
                style: 'success',
              },
            ],
          ],
        },
      },
    });
    await app.close();

    assert.equal(response.statusCode, 200);
    assert.deepEqual(keyboard, {
      type: 'approval',
      repairOrderUuid,
      layout: [
        [
          {
            type: 'reject',
            localizedText: { uz: 'Rad etish', ru: 'Отклонить', en: null },
            style: 'danger',
          },
          {
            type: 'approve',
            localizedText: { uz: 'Tasdiqlash', ru: 'Одобрить', en: null },
            style: 'success',
          },
        ],
      ],
    });
  });

  it('rejects layouts whose button inventory does not match the keyboard purpose', async () => {
    const app = createApiServer(config, logger, {
      directMessageSender: {
        async sendDirectMessage(): Promise<DirectMessageDeliveryResult> {
          return { status: 'sent' };
        },
      },
    });
    const repairOrderUuid = '11111111-1111-4111-8111-111111111111';
    const invalidLayouts = [
      {
        keyboard: {
          type: 'details',
          repair_order_uuid: repairOrderUuid,
          layout: [
            [
              { type: 'details', text: 'One' },
              { type: 'details', text: 'Two' },
            ],
          ],
        },
        message: 'details layout must contain exactly one button',
      },
      {
        keyboard: {
          type: 'approval',
          repair_order_uuid: repairOrderUuid,
          layout: [
            [
              { type: 'approve', text: 'Approve' },
              { type: 'approve', text: 'Approve' },
            ],
          ],
        },
        message: 'approval layout requires one reject button and one approve button',
      },
      {
        keyboard: {
          type: 'rating',
          repair_order_uuid: repairOrderUuid,
          layout: [
            [1, 2, 3, 4, 5].map((grade) => ({ type: `rating_${grade}`, text: String(grade) })),
            [6, 7, 8, 9].map((grade) => ({ type: `rating_${grade}`, text: String(grade) })),
          ],
        },
        message: 'rating layout must contain exactly ten buttons in two rows of five',
      },
    ];

    for (const invalid of invalidLayouts) {
      const response = await app.inject({
        method: 'POST',
        url: '/messages/send',
        headers: authHeaders,
        payload: {
          phone_number: '+998901234567',
          message: 'CRM action',
          inline_keyboard: invalid.keyboard,
        },
      });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json<{ message: string }>().message, invalid.message);
    }
    await app.close();
  });

  it('accepts the localized multi-action keyboard emitted by CRM templates', async () => {
    let captured: unknown;
    const app = createApiServer(config, logger, {
      directMessageSender: {
        async sendDirectMessage(params) {
          captured = params.inlineKeyboard;
          return { status: 'sent', message: 'Доставлено' };
        },
      },
    });
    const repairOrderUuid = '11111111-1111-4111-8111-111111111111';
    const response = await app.inject({
      method: 'POST',
      url: '/messages/send',
      headers: authHeaders,
      payload: {
        phone_number: '+998901234567',
        message: 'Template notification',
        inline_keyboard: {
          rows: [
            [
              {
                type: 'details',
                repair_order_uuid: repairOrderUuid,
                localized_text: { uz: 'Ko‘rish', ru: 'Открыть', en: 'Open' },
              },
            ],
            [
              {
                type: 'approval',
                repair_order_uuid: repairOrderUuid,
                localized_text: { uz: 'Tasdiqlash', ru: 'Подтвердить' },
              },
            ],
            [
              {
                type: 'rating',
                repair_order_uuid: repairOrderUuid,
                localized_text: { uz: 'Baholash', ru: 'Оценить' },
              },
            ],
          ],
        },
      },
    });
    await app.close();

    assert.equal(response.statusCode, 200);
    assert.equal(response.json<{ message: string }>().message, 'Доставлено');
    assert.deepEqual(captured, {
      rows: [
        [
          {
            type: 'details',
            repairOrderUuid,
            localizedText: { uz: 'Ko‘rish', ru: 'Открыть', en: 'Open' },
          },
        ],
        [
          {
            type: 'approval',
            repairOrderUuid,
            localizedText: { uz: 'Tasdiqlash', ru: 'Подтвердить', en: null },
          },
        ],
        [
          {
            type: 'rating',
            repairOrderUuid,
            localizedText: { uz: 'Baholash', ru: 'Оценить', en: null },
          },
        ],
      ],
    });
  });

  it('accepts localized and styled URL buttons plus a styled details row', async () => {
    let captured: unknown;
    const app = createApiServer(config, logger, {
      directMessageSender: {
        async sendDirectMessage(params) {
          captured = params.inlineKeyboard;
          return { status: 'sent' };
        },
      },
    });
    const repairOrderUuid = '11111111-1111-4111-8111-111111111111';

    const response = await app.inject({
      method: 'POST',
      url: '/messages/send',
      headers: authHeaders,
      payload: {
        phone_number: '+998901234567',
        message: 'Documents',
        inline_keyboard: {
          rows: [
            [
              {
                type: 'url',
                localized_text: { uz: 'Shartnoma', ru: 'Договор' },
                style: 'primary',
                url: 'https://files.procare.uz/contract.pdf',
              },
              {
                type: 'url',
                localized_text: { uz: 'Hisob', ru: 'Счёт' },
                url: 'https://files.procare.uz/invoice.pdf',
              },
            ],
            [
              {
                type: 'details',
                localized_text: { uz: 'Batafsil', ru: 'Подробнее' },
                style: 'success',
                repair_order_uuid: repairOrderUuid,
              },
            ],
          ],
        },
      },
    });
    await app.close();

    assert.equal(response.statusCode, 200);
    assert.deepEqual(captured, {
      rows: [
        [
          {
            type: 'url',
            localizedText: { uz: 'Shartnoma', ru: 'Договор', en: null },
            style: 'primary',
            url: 'https://files.procare.uz/contract.pdf',
          },
          {
            type: 'url',
            localizedText: { uz: 'Hisob', ru: 'Счёт', en: null },
            url: 'https://files.procare.uz/invoice.pdf',
          },
        ],
        [
          {
            type: 'details',
            localizedText: { uz: 'Batafsil', ru: 'Подробнее', en: null },
            style: 'success',
            repairOrderUuid,
          },
        ],
      ],
    });
  });

  it('accepts trusted photo and document attachments and returns the exact sent text', async () => {
    let capturedAttachments: unknown;
    const app = createApiServer(config, logger, {
      directMessageSender: {
        async sendDirectMessage(params) {
          capturedAttachments = params.attachments;
          return { status: 'sent', message: 'Exact rendered message' };
        },
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/messages/send',
      headers: authHeaders,
      payload: {
        phone_number: '+998901234567',
        message: 'Original message',
        attachments: [
          {
            type: 'photo',
            url: 'https://files.procare.uz/comment/photo.jpg',
            file_name: 'diagnosis.jpg',
          },
          {
            type: 'document',
            url: 'https://files.procare.uz/warranty.pdf',
            file_name: 'warranty.pdf',
          },
        ],
      },
    });
    await app.close();

    assert.equal(response.statusCode, 200);
    assert.equal(response.json<{ message: string }>().message, 'Exact rendered message');
    assert.deepEqual(capturedAttachments, [
      {
        type: 'photo',
        url: 'https://files.procare.uz/comment/photo.jpg',
        fileName: 'diagnosis.jpg',
      },
      {
        type: 'document',
        url: 'https://files.procare.uz/warranty.pdf',
        fileName: 'warranty.pdf',
      },
    ]);
  });

  it('rejects unsupported attachment types and more than five files', async () => {
    const app = createApiServer(config, logger, {
      directMessageSender: {
        async sendDirectMessage(): Promise<DirectMessageDeliveryResult> {
          return { status: 'sent' };
        },
      },
    });

    for (const invalid of [
      {
        attachments: [{ type: 'pdf', url: 'https://files.procare.uz/file.pdf' }],
        message: 'attachments[0] must have type photo or document',
      },
      {
        attachments: Array.from({ length: 6 }, (_, index) => ({
          type: 'document',
          url: `https://files.procare.uz/file-${index + 1}.pdf`,
        })),
        message: 'attachments may contain at most 5 files',
      },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/messages/send',
        headers: authHeaders,
        payload: {
          phone_number: '+998901234567',
          message: 'Files',
          attachments: invalid.attachments,
        },
      });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json<{ message: string }>().message, invalid.message);
    }
    await app.close();
  });

  it('rejects unsupported fields on generated action keyboards', async () => {
    const app = createApiServer(config, logger, {
      directMessageSender: {
        async sendDirectMessage(): Promise<DirectMessageDeliveryResult> {
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
        message: 'Rate us',
        inline_keyboard: {
          type: 'rating',
          repair_order_uuid: '11111111-1111-4111-8111-111111111111',
          text: 'Custom',
        },
      },
    });
    await app.close();

    assert.equal(response.statusCode, 400);
    assert.equal(
      response.json<{ message: string }>().message,
      'rating keyboards accept button presentation only through layout',
    );
  });

  it('rejects unsupported inline button styles before sending', async () => {
    const app = createApiServer(config, logger, {
      directMessageSender: {
        async sendDirectMessage(): Promise<DirectMessageDeliveryResult> {
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
        message: 'Styled',
        inline_keyboard: {
          rows: [
            [
              {
                type: 'url',
                text: 'Open',
                style: 'green',
                url: 'https://procare.uz',
              },
            ],
          ],
        },
      },
    });
    await app.close();

    assert.equal(response.statusCode, 400);
    assert.equal(
      response.json<{ message: string }>().message,
      'inline keyboard button style must be danger, success, or primary',
    );
  });

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
        localizedVariables: {},
        parseMode: 'HTML',
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

  it('accepts standalone localized messages and returns the locale-selected rendered message', async () => {
    const app = createApiServer(config, logger, {
      directMessageSender: {
        async sendDirectMessage(params) {
          assert.equal(params.message, undefined);
          assert.deepEqual(params.localizedMessages, {
            uz: 'Salom {{ first_name }}',
            ru: 'Здравствуйте, {{ first_name }}',
            en: null,
          });
          return { status: 'sent', message: 'Здравствуйте, Ali' };
        },
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/messages/send',
      headers: authHeaders,
      payload: {
        phone_number: '+998901234567',
        localized_messages: {
          uz: 'Salom {{ first_name }}',
          ru: 'Здравствуйте, {{ first_name }}',
        },
      },
    });
    await app.close();

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      status: 'sent',
      message: 'Здравствуйте, Ali',
    });
  });

  it('accepts MarkdownV2 with locale-specific variables and passes the complete rendering contract', async () => {
    const app = createApiServer(config, logger, {
      directMessageSender: {
        async sendDirectMessage(params) {
          assert.equal(params.parseMode, 'MarkdownV2');
          assert.deepEqual(params.localizedVariables, {
            phone_category: {
              uz: 'iPhone 15 Pro',
              ru: 'iPhone 15 Pro Max',
            },
          });
          return { status: 'sent', message: '*Ali* — iPhone 15 Pro Max' };
        },
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/messages/send',
      headers: authHeaders,
      payload: {
        phone_number: '+998901234567',
        message: '*{{first_name}}* — {{phone_category}}',
        parse_mode: 'MarkdownV2',
        localized_variables: {
          phone_category: {
            uz: 'iPhone 15 Pro',
            ru: 'iPhone 15 Pro Max',
          },
        },
      },
    });
    await app.close();

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      status: 'sent',
      message: '*Ali* — iPhone 15 Pro Max',
    });
  });

  it('rejects legacy or unsupported parse modes before sending', async () => {
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
        message: '*Salom*',
        parse_mode: 'Markdown',
      },
    });
    await app.close();

    assert.equal(response.statusCode, 400);
    assert.equal(
      response.json<{ message: string }>().message,
      'parse_mode must be HTML or MarkdownV2',
    );
  });

  it('validates locale-specific variable shape before sending', async () => {
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
        message: '{{phone_category}}',
        localized_variables: { phone_category: { uz: 'iPhone' } },
      },
    });
    await app.close();

    assert.equal(response.statusCode, 400);
    assert.equal(
      response.json<{ message: string }>().message,
      'localized_variables.phone_category must define uz and ru values',
    );
  });

  it('accepts the variable-count boundary and rejects oversized variable maps', async () => {
    let sendCount = 0;
    const app = createApiServer(config, logger, {
      directMessageSender: {
        async sendDirectMessage() {
          sendCount += 1;
          return { status: 'sent' as const };
        },
      },
    });
    const variables = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [`value_${index}`, index]),
    );

    const boundaryResponse = await app.inject({
      method: 'POST',
      url: '/messages/send',
      headers: authHeaders,
      payload: {
        phone_number: '+998901234567',
        message: 'Bounded message',
        variables,
      },
    });
    const oversizedResponse = await app.inject({
      method: 'POST',
      url: '/messages/send',
      headers: authHeaders,
      payload: {
        phone_number: '+998901234567',
        message: 'Oversized map',
        variables: { ...variables, value_100: 100 },
      },
    });
    await app.close();

    assert.equal(boundaryResponse.statusCode, 200);
    assert.equal(oversizedResponse.statusCode, 400);
    assert.equal(
      oversizedResponse.json<{ message: string }>().message,
      'variables may contain at most 100 entries',
    );
    assert.equal(sendCount, 1);
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
          type: 'details',
          repairOrderUuid: '11111111-1111-4111-8111-111111111111',
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

  it('requires a fallback message or both localized variants', async () => {
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
      payload: { phone_number: '+998901234567' },
    });
    await app.close();

    assert.equal(response.statusCode, 400);
    assert.equal(
      response.json<{ message: string }>().message,
      'message, localized_messages, or attachments must be provided',
    );
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
