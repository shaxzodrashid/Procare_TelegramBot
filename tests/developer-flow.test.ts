/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createBot, type BotDependencies } from '../src/bot/create-bot.js';
import {
  API_ENDPOINTS,
  type ApiErrorLocalizationStore,
} from '../src/services/api-error-localization.service.js';
import type {
  ApiErrorLocalization,
  ApiErrorLocalizationInput,
} from '../src/types/api-error-localization.js';
import type { Logger } from '../src/utils/logger.js';

const mockLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  extra: () => {},
  table: () => {},
};

const createApiLocalizationStore = (): ApiErrorLocalizationStore & {
  savedInputs: ApiErrorLocalizationInput[];
  rows: ApiErrorLocalization[];
} => {
  const rows: ApiErrorLocalization[] = [];
  const savedInputs: ApiErrorLocalizationInput[] = [];
  return {
    savedInputs,
    rows,
    listEndpoints: () => API_ENDPOINTS,
    getEndpoint: (endpointKey: string) =>
      API_ENDPOINTS.find((endpoint) => endpoint.key === endpointKey) ?? null,
    async listLocalizations(endpointKey: string) {
      return rows.filter((row) => row.endpoint_key === endpointKey);
    },
    async findLocalization(endpointKey: string, location: string) {
      return (
        rows.find((row) => row.endpoint_key === endpointKey && row.location === location) ?? null
      );
    },
    async upsertLocalization(input: ApiErrorLocalizationInput) {
      savedInputs.push(input);
      const row: ApiErrorLocalization = {
        id: '1',
        endpoint_key: input.endpoint_key,
        location: input.location,
        message_uz: input.message_uz,
        message_ru: input.message_ru,
        created_at: '2026-06-30T00:00:00.000Z',
        updated_at: '2026-06-30T00:00:00.000Z',
      };
      rows[0] = row;
      return row;
    },
    async resolveEnvelope() {
      return null;
    },
  };
};

const createDependencies = (): BotDependencies & {
  apiErrorLocalizationStore: ReturnType<typeof createApiLocalizationStore>;
} => {
  const apiErrorLocalizationStore = createApiLocalizationStore();
  return {
    registrationService: {} as any,
    repairOrderService: {} as any,
    clientRepairOrderService: {} as any,
    unknownClientStore: {
      async deleteByTelegramId() {},
    } as any,
    supportMessageStore: {} as any,
    registeredUserStore: {
      async findByTelegramId() {
        return null;
      },
    } as any,
    messageTemplateStore: {
      async setUserBlocked() {},
    } as any,
    apiErrorLocalizationStore,
    logger: mockLogger,
    allowManualPhoneEntry: true,
    richMessagesEnabled: false,
    developerTelegramIds: new Set(['900100']),
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
  } as any;

  bot.api.config.use(async (_prev, method, payload: any) => {
    apiCalls.push({ method, payload });
    if (method === 'answerCallbackQuery') return { ok: true, result: true } as any;
    return {
      ok: true,
      result: {
        message_id: 12345,
        date: Math.floor(Date.now() / 1000),
        chat: { id: Number(payload.chat_id), type: 'private' },
      },
    } as any;
  });

  return { bot, apiCalls };
};

const developerMessage = (updateId: number, text: string) =>
  ({
    update_id: updateId,
    message: {
      message_id: updateId,
      date: Date.now() / 1000,
      chat: { id: 900100, type: 'private', first_name: 'Developer' },
      from: { id: 900100, is_bot: false, first_name: 'Developer' },
      text,
    },
  }) as any;

const developerCallback = (updateId: number, data: string) =>
  ({
    update_id: updateId,
    callback_query: {
      id: `q${updateId}`,
      from: { id: 900100, is_bot: false, first_name: 'Developer' },
      chat_instance: 'instance_1',
      data,
      message: {
        message_id: updateId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 900100, type: 'private', first_name: 'Developer' },
        from: { id: 99999, is_bot: true, first_name: 'TestBot' },
        text: 'source',
      },
    },
  }) as any;

describe('Developer endpoint localization flow', () => {
  it('lets a developer-only user continue registration after logout language selection', async () => {
    const deps = createDependencies();
    const { bot, apiCalls } = createTestBot(deps);

    await bot.handleUpdate(developerMessage(1, '/logout'));
    apiCalls.length = 0;

    await bot.handleUpdate(developerMessage(2, '🇺🇿 O‘zbekcha'));

    const reply = apiCalls.find((call) => call.method === 'sendMessage');
    assert.ok(reply);
    assert.ok(String(reply.payload.text).includes('telefon raqamini ulashing'));
    assert.equal(reply.payload.reply_markup.keyboard[0][0].request_contact, true);
    assert.doesNotMatch(String(reply.payload.text), /PROCARE DEVELOPER CORE/);
  });

  it('lets a configured developer create an endpoint location localization', async () => {
    const deps = createDependencies();
    const { bot, apiCalls } = createTestBot(deps);

    await bot.handleUpdate(developerMessage(1, '/start'));
    assert.ok(apiCalls.some((call) => String(call.payload.text).includes('PROCARE DEVELOPER CORE')));

    apiCalls.length = 0;
    await bot.handleUpdate(developerMessage(2, '⚙️ API endpointlar'));
    const listCall = apiCalls.find((call) => call.method === 'sendMessage');
    assert.ok(listCall);
    assert.ok(String(listCall.payload.text).includes('API endpointlar'));
    assert.equal(listCall.payload.reply_markup.inline_keyboard[0][0].callback_data, 'dev:e:0');

    apiCalls.length = 0;
    await bot.handleUpdate(developerCallback(3, 'dev:e:0'));
    assert.ok(
      apiCalls.some((call) => String(call.payload.text).includes('/api/v1/users/register-client')),
    );

    apiCalls.length = 0;
    await bot.handleUpdate(developerCallback(4, 'dev:a:0'));
    assert.ok(apiCalls.some((call) => String(call.payload.text).includes('location')));

    await bot.handleUpdate(developerMessage(5, 'phone_number'));
    await bot.handleUpdate(developerMessage(6, 'Telefon raqamini tekshiring.'));
    await bot.handleUpdate(developerMessage(7, 'Проверьте номер телефона.'));

    assert.deepEqual(deps.apiErrorLocalizationStore.savedInputs, [
      {
        endpoint_key: 'client_registration',
        location: 'phone_number',
        message_uz: 'Telefon raqamini tekshiring.',
        message_ru: 'Проверьте номер телефона.',
      },
    ]);
    assert.ok(apiCalls.some((call) => String(call.payload.text).includes('saqlandi')));
  });
});
