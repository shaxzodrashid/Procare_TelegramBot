/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createBot } from '../src/bot/create-bot.js';
import { parseAdminExportPeriod } from '../src/bot/handlers/admin-export.js';
import type { BotDependencies } from '../src/bot/create-bot.js';
import type { Logger } from '../src/utils/logger.js';

const logger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  extra: () => undefined,
  table: () => undefined,
};

const createDependencies = (): BotDependencies & { exportedPeriods: any[] } => {
  const exportedPeriods: any[] = [];

  return {
    registrationService: {} as any,
    repairOrderService: {} as any,
    clientRepairOrderService: {} as any,
    unknownClientStore: {} as any,
    registeredUserStore: {
      async findByTelegramId(telegramId: string) {
        if (telegramId === '800100') {
          return {
            user: {
              id: '100',
              telegram_id: '800100',
              telegram_username: 'admin_user',
              first_name: 'Admin',
              last_name: 'User',
              phone_number: '+998907654321',
              locale: 'uz' as const,
            },
            employee: {
              crm_admin_id: 'crm-admin-100',
              status: 'Open',
              is_active: true,
              created_at: '2026-06-17T10:00:00.000Z',
              updated_at: '2026-06-17T10:00:00.000Z',
            },
          };
        }
        return null;
      },
    } as any,
    messageTemplateStore: {
      async setUserBlocked() {
        return undefined;
      },
    } as any,
    supportMessageStore: {} as any,
    actionExportService: {
      async exportActions(period) {
        exportedPeriods.push(period);
        return {
          fileName: 'procare-actions_2026-06-01_to_2026-06-25.xlsx',
          buffer: Buffer.from('fake-xlsx'),
          rowCounts: { Users: 1 },
        };
      },
    },
    logger,
    allowManualPhoneEntry: true,
    richMessagesEnabled: false,
    exportedPeriods,
  };
};

const createTestBot = (deps: BotDependencies) => {
  const bot = createBot('fake-token', deps);
  const apiCalls: Array<{ method: string; payload: any }> = [];

  bot.botInfo = {
    id: 99999,
    is_bot: true,
    first_name: 'TestBot',
    username: 'test_bot',
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: true,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
    can_manage_bots: false,
    supports_join_request_queries: false,
  } as any;

  bot.api.config.use(async (_prev, method, payload: any) => {
    apiCalls.push({ method, payload });
    if (method === 'sendMessage') {
      return {
        ok: true,
        result: {
          message_id: 12345,
          date: Math.floor(Date.now() / 1000),
          chat: { id: Number(payload.chat_id), type: 'private' },
        },
      } as any;
    }
    if (method === 'sendDocument') {
      return {
        ok: true,
        result: {
          message_id: 12346,
          date: Math.floor(Date.now() / 1000),
          chat: { id: Number(payload.chat_id), type: 'private' },
          document: { file_id: 'file-1', file_unique_id: 'unique-1' },
        },
      } as any;
    }
    return { ok: true, result: {} } as any;
  });

  return { bot, apiCalls };
};

describe('admin export period parsing', () => {
  it('parses inclusive Tashkent date periods', () => {
    const result = parseAdminExportPeriod('2026-06-01 2026-06-25');

    assert.equal(result.status, 'ok');
    if (result.status !== 'ok') return;
    assert.equal(result.period.from.toISOString(), '2026-05-31T19:00:00.000Z');
    assert.equal(result.period.toExclusive.toISOString(), '2026-06-25T19:00:00.000Z');
    assert.equal(result.period.fromLabel, '2026-06-01');
    assert.equal(result.period.toLabel, '2026-06-25');
  });

  it('rejects invalid and reversed periods', () => {
    assert.deepEqual(parseAdminExportPeriod('2026-02-31 2026-03-01'), { status: 'invalid' });
    assert.deepEqual(parseAdminExportPeriod('2026-06-25 2026-06-01'), {
      status: 'start_after_end',
    });
  });
});

describe('admin export flow', () => {
  it('asks an employee for a period and sends an Excel document', async () => {
    const deps = createDependencies();
    const { bot, apiCalls } = createTestBot(deps);

    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 101,
        date: Date.now() / 1000,
        chat: { id: 800100, type: 'private', first_name: 'Admin' },
        from: { id: 800100, is_bot: false, first_name: 'Admin' },
        text: '/export',
        entities: [{ offset: 0, length: 7, type: 'bot_command' }],
      },
    } as any);

    assert.ok(
      apiCalls.some(
        (call) => call.method === 'sendMessage' && call.payload.text.includes('Excel eksport'),
      ),
    );
    apiCalls.length = 0;

    await bot.handleUpdate({
      update_id: 2,
      message: {
        message_id: 102,
        date: Date.now() / 1000,
        chat: { id: 800100, type: 'private', first_name: 'Admin' },
        from: { id: 800100, is_bot: false, first_name: 'Admin' },
        text: '2026-06-01 2026-06-25',
      },
    } as any);

    assert.equal(deps.exportedPeriods.length, 1);
    assert.ok(
      apiCalls.some(
        (call) => call.method === 'sendMessage' && call.payload.text.includes('tayyorlanmoqda'),
      ),
    );
    const documentCall = apiCalls.find((call) => call.method === 'sendDocument');
    assert.ok(documentCall);
    assert.equal(documentCall.payload.caption, '✅ Excel eksport tayyor: 2026-06-01 - 2026-06-25.');
  });
});
