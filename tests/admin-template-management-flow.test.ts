/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createBot, type BotDependencies } from '../src/bot/create-bot.js';
import type { MessageTemplate, MessageTemplateInput } from '../src/types/message-template.js';
import type { Logger } from '../src/utils/logger.js';

const mockLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  extra: () => {},
  table: () => {},
};

const createTemplate = (overrides: Partial<MessageTemplate> = {}): MessageTemplate => ({
  id: '1',
  template_key: 'warranty_v1',
  template_type: 'warranty',
  title: 'Warranty',
  content_uz: 'Assalomu alaykum, {{customer_name}}',
  content_ru: 'Здравствуйте, {{customer_name}}',
  channel: 'telegram_bot',
  is_active: true,
  created_at: '2026-06-29T00:00:00.000Z',
  updated_at: '2026-06-29T00:00:00.000Z',
  ...overrides,
});

const createMockDependencies = (): BotDependencies & {
  templates: MessageTemplate[];
  createdInputs: MessageTemplateInput[];
} => {
  const templates: MessageTemplate[] = [];
  const createdInputs: MessageTemplateInput[] = [];

  return {
    registrationService: {} as any,
    repairOrderService: {} as any,
    clientRepairOrderService: {} as any,
    unknownClientStore: {} as any,
    supportMessageStore: {} as any,
    registeredUserStore: {
      async findByTelegramId(telegramId: string) {
        if (telegramId !== '800100') return null;
        return {
          user: {
            id: '100',
            telegram_id: '800100',
            telegram_username: 'admin_user',
            first_name: 'Admin',
            last_name: 'User',
            phone_number: '+998907654321',
            locale: 'uz',
          },
          employee: {
            crm_admin_id: 'crm-admin-100',
            status: 'Open',
            is_active: true,
            created_at: '2026-06-29T00:00:00.000Z',
            updated_at: '2026-06-29T00:00:00.000Z',
          },
        };
      },
    } as any,
    messageTemplateStore: {
      async listTemplates() {
        return templates;
      },
      async findTemplateById(id: string) {
        return templates.find((template) => template.id === id) ?? null;
      },
      async findActiveTemplateByType() {
        return null;
      },
      async createTemplate(input: MessageTemplateInput) {
        createdInputs.push(input);
        const template = createTemplate({
          id: String(templates.length + 1),
          ...input,
          channel: input.channel ?? 'telegram_bot',
          is_active: input.is_active ?? true,
        });
        templates.push(template);
        return template;
      },
      async updateTemplate(id: string, update: Partial<MessageTemplate>) {
        const index = templates.findIndex((template) => template.id === id);
        if (index === -1) return null;
        const existing = templates[index];
        assert.ok(existing);
        const updated = { ...existing, ...update, updated_at: '2026-06-29T01:00:00.000Z' };
        templates[index] = updated;
        return updated;
      },
      async deleteTemplate(id: string) {
        const index = templates.findIndex((template) => template.id === id);
        if (index === -1) return false;
        templates.splice(index, 1);
        return true;
      },
      async logDispatch() {},
      async setUserBlocked() {},
    },
    logger: mockLogger,
    allowManualPhoneEntry: true,
    richMessagesEnabled: false,
    templates,
    createdInputs,
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

const adminMessage = (updateId: number, text: string) =>
  ({
    update_id: updateId,
    message: {
      message_id: updateId,
      date: Date.now() / 1000,
      chat: { id: 800100, type: 'private', first_name: 'Admin' },
      from: { id: 800100, is_bot: false, first_name: 'Admin' },
      text,
    },
  }) as any;

const adminCallback = (updateId: number, data: string) =>
  ({
    update_id: updateId,
    callback_query: {
      id: `q${updateId}`,
      from: { id: 800100, is_bot: false, first_name: 'Admin' },
      chat_instance: 'instance_1',
      data,
      message: {
        message_id: updateId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 800100, type: 'private', first_name: 'Admin' },
        from: { id: 99999, is_bot: true, first_name: 'TestBot' },
        text: 'source',
      },
    },
  }) as any;

describe('Admin Template Management Flow', () => {
  it('creates a template using guidance, title-first input, and inline type selection', async () => {
    const deps = createMockDependencies();
    const { bot, apiCalls } = createTestBot(deps);

    await bot.handleUpdate(adminMessage(1, '/start'));
    apiCalls.length = 0;

    await bot.handleUpdate(adminMessage(2, '🧩 Xabar shablonlari'));
    const listCall = apiCalls.find((call) => call.method === 'sendMessage');
    assert.ok(listCall);
    assert.ok(listCall.payload.text.includes('Hozircha shablonlar yo‘q'));
    assert.equal(
      listCall.payload.reply_markup.inline_keyboard.at(-2)?.[0]?.callback_data,
      'admin_template_create',
    );

    apiCalls.length = 0;

    await bot.handleUpdate(adminCallback(3, 'admin_template_create'));
    const guidanceCall = apiCalls.find((call) =>
      String(call.payload.text).includes('Yangi xabar shabloni yaratish'),
    );
    assert.ok(guidanceCall);
    assert.equal(guidanceCall.payload.parse_mode, 'HTML');
    assert.ok(apiCalls.some((call) => String(call.payload.text).includes('sarlavhasini kiriting')));

    apiCalls.length = 0;

    await bot.handleUpdate(adminMessage(4, 'Warranty Document'));
    assert.ok(apiCalls.some((call) => String(call.payload.text).includes('kalitini kiriting')));

    apiCalls.length = 0;

    await bot.handleUpdate(adminMessage(5, 'warranty_v1'));
    const typePromptCall = apiCalls.find((call) =>
      String(call.payload.text).includes('turini tanlang'),
    );
    assert.ok(typePromptCall);
    assert.equal(
      typePromptCall.payload.reply_markup.inline_keyboard[0][0].callback_data,
      'atts:warranty',
    );

    apiCalls.length = 0;

    await bot.handleUpdate(adminCallback(6, 'atts:warranty'));
    assert.ok(apiCalls.some((call) => String(call.payload.text).includes('O‘zbekcha matn')));

    apiCalls.length = 0;

    await bot.handleUpdate(adminMessage(7, 'Assalomu alaykum, {{customer_name}}'));
    assert.ok(apiCalls.some((call) => String(call.payload.text).includes('Ruscha matn')));

    apiCalls.length = 0;

    await bot.handleUpdate(adminMessage(8, 'Здравствуйте, {{customer_name}}'));

    assert.deepEqual(deps.createdInputs, [
      {
        title: 'Warranty Document',
        template_key: 'warranty_v1',
        template_type: 'warranty',
        content_uz: 'Assalomu alaykum, {{customer_name}}',
        content_ru: 'Здравствуйте, {{customer_name}}',
      },
    ]);
    assert.ok(apiCalls.some((call) => String(call.payload.text).includes('Shablon yaratildi')));
    assert.ok(apiCalls.some((call) => String(call.payload.text).includes('Warranty Document')));
  });

  it('edits the template list message when opening details and returning to the list', async () => {
    const deps = createMockDependencies();
    deps.templates.push(createTemplate({ id: '10', title: 'Payment Reminder' }));
    const { bot, apiCalls } = createTestBot(deps);

    await bot.handleUpdate(adminMessage(1, '/start'));
    await bot.handleUpdate(adminMessage(2, '🧩 Xabar shablonlari'));
    apiCalls.length = 0;

    await bot.handleUpdate(adminCallback(3, 'atpd:10'));

    const detailEditCall = apiCalls.find((call) => call.method === 'editMessageText');
    assert.ok(detailEditCall);
    assert.ok(String(detailEditCall.payload.text).includes('Payment Reminder'));
    assert.equal(
      detailEditCall.payload.reply_markup.inline_keyboard.at(-1)?.[0]?.callback_data,
      'admin_templates_back',
    );
    assert.equal(
      apiCalls.some(
        (call) =>
          call.method === 'sendMessage' && String(call.payload.text).includes('Payment Reminder'),
      ),
      false,
    );

    apiCalls.length = 0;

    await bot.handleUpdate(adminCallback(4, 'admin_templates_back'));

    const listEditCall = apiCalls.find((call) => call.method === 'editMessageText');
    assert.ok(listEditCall);
    assert.ok(String(listEditCall.payload.text).includes('🧩 Xabar shablonlari'));
    assert.equal(listEditCall.payload.reply_markup.inline_keyboard[0][0].callback_data, 'atpd:10');
  });

  it('renders the employee menu with HTML when returning from template management', async () => {
    const deps = createMockDependencies();
    const { bot, apiCalls } = createTestBot(deps);

    await bot.handleUpdate(adminMessage(1, '/start'));
    await bot.handleUpdate(adminMessage(2, '🧩 Xabar shablonlari'));
    apiCalls.length = 0;

    await bot.handleUpdate(adminCallback(3, 'admin:menu'));

    const menuCall = apiCalls.find(
      (call) => call.method === 'sendMessage' && String(call.payload.text).includes('WORKPLACE'),
    );
    assert.ok(menuCall);
    assert.equal(menuCall.payload.parse_mode, 'HTML');
  });
});
