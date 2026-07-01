/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createBot } from '../src/bot/create-bot.js';
import type { BotDependencies } from '../src/bot/create-bot.js';
import type { RegisteredUserStore } from '../src/services/registered-user.store.js';
import type { MessageTemplateStore } from '../src/services/message-template.service.js';
import type { MessageTemplate } from '../src/types/message-template.js';
import type { UserRegistrationState } from '../src/types/registered-user.js';
import type { Logger } from '../src/utils/logger.js';

const mockLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  extra: () => {},
  table: () => {},
};

const createMockDependencies = (): BotDependencies & {
  clients: UserRegistrationState[];
  templates: MessageTemplate[];
  dispatches: any[];
  blockedUsers: Record<string, boolean>;
} => {
  const clients: UserRegistrationState[] = [
    {
      user: {
        id: '201',
        telegram_id: '900201',
        telegram_username: 'john_doe',
        first_name: 'John',
        last_name: 'Doe',
        phone_number: '+998901234567',
        locale: 'uz',
      },
      client: {
        crm_client_id: 'crm-201',
        customer_code: 'CC-201',
        status: 'Active',
        is_active: true,
      },
    },
  ];

  const templates: MessageTemplate[] = [
    {
      id: '10',
      template_key: 'warranty_uz_ru',
      template_type: 'warranty',
      title: 'Payment Reminder',
      content_uz: 'Hurmatli {{customer_name}}, tolov muddati keldi. Kupon: {{coupon_code}}',
      content_ru: 'Уважаемый {{customer_name}}, пришло время оплаты. Купон: {{coupon_code}}',
      channel: 'telegram_bot',
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  const dispatches: any[] = [];
  const blockedUsers: Record<string, boolean> = {};

  const registeredUserStore = {
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
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        };
      }
      const client = clients.find((c) => c.user.telegram_id === telegramId);
      return client ?? null;
    },
    async findByPhoneNumber(phoneNumber: string) {
      const client = clients.find((c) => c.user.phone_number === phoneNumber);
      if (!client) return null;
      return {
        id: client.user.id || '',
        telegram_id: client.user.telegram_id,
        phone_number: client.user.phone_number,
        is_blocked: Boolean(blockedUsers[client.user.telegram_id]),
      };
    },
    async searchClients(query: string) {
      const q = query.toLowerCase();
      return clients.filter(
        (c) =>
          c.user.first_name.toLowerCase().includes(q) ||
          c.user.phone_number.includes(q) ||
          c.user.telegram_username?.toLowerCase().includes(q),
      );
    },
  } as unknown as RegisteredUserStore;

  const messageTemplateStore = {
    async listTemplates() {
      return templates;
    },
    async findTemplateById(id: string) {
      return templates.find((t) => t.id === id) ?? null;
    },
    async findActiveTemplateByType(type: string) {
      return templates.find((t) => t.template_type === type && t.is_active) ?? null;
    },
    async logDispatch(record: any) {
      dispatches.push(record);
    },
    async setUserBlocked(telegramId: string, isBlocked: boolean) {
      blockedUsers[telegramId] = isBlocked;
    },
  } as unknown as MessageTemplateStore;

  return {
    registrationService: {} as any,
    repairOrderService: {} as any,
    clientRepairOrderService: {} as any,
    unknownClientStore: {} as any,
    supportMessageStore: {} as any,
    registeredUserStore,
    messageTemplateStore,
    logger: mockLogger,
    allowManualPhoneEntry: true,
    richMessagesEnabled: false,
    clients,
    templates,
    dispatches,
    blockedUsers,
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

  bot.api.config.use(async (prev, method, payload: any, signal) => {
    apiCalls.push({ method, payload });
    if (method === 'sendMessage' || method === 'sendPhoto') {
      return {
        ok: true,
        result: {
          message_id: 12345,
          date: Math.floor(Date.now() / 1000),
          chat: { id: Number(payload.chat_id), type: 'private' },
        },
      } as any;
    }
    if (method === 'answerCallbackQuery') {
      return { ok: true, result: true } as any;
    }
    return { ok: true, result: {} } as any;
  });

  return { bot, apiCalls };
};

describe('Employee Client Search and Messaging Flow', () => {
  it('allows employee to search clients, view profile card, send custom, and template messages', async () => {
    const deps = createMockDependencies();
    const { bot, apiCalls } = createTestBot(deps);

    // Helper mock callback message
    const mockCallbackMessage = {
      message_id: 999,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 800100, type: 'private' as const, first_name: 'Admin' },
      from: { id: 99999, is_bot: true, first_name: 'TestBot' },
      text: 'mock_source_message',
    };

    // 1. Employee /start command
    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 101,
        date: Date.now() / 1000,
        chat: { id: 800100, type: 'private', first_name: 'Admin' },
        from: { id: 800100, is_bot: false, first_name: 'Admin' },
        text: '/start',
        entities: [{ offset: 0, length: 6, type: 'bot_command' }],
      },
    } as any);

    const startCall = apiCalls.find((c) => c.method === 'sendMessage');
    assert.ok(startCall);
    assert.ok(startCall.payload.text.includes('PROCARE WORKPLACE'));

    apiCalls.length = 0;

    // 2. Click "🔍 Mijozlar qidiruvi" (simulated via hears text)
    await bot.handleUpdate({
      update_id: 2,
      message: {
        message_id: 102,
        date: Date.now() / 1000,
        chat: { id: 800100, type: 'private', first_name: 'Admin' },
        from: { id: 800100, is_bot: false, first_name: 'Admin' },
        text: '🔍 Mijozlar qidiruvi',
      },
    } as any);

    const searchPromptCall = apiCalls.find((c) => c.method === 'sendMessage');
    assert.ok(searchPromptCall);
    assert.ok(searchPromptCall.payload.text.includes('Mijozning ismi'));

    apiCalls.length = 0;

    // 3. Send search query "John"
    await bot.handleUpdate({
      update_id: 3,
      message: {
        message_id: 103,
        date: Date.now() / 1000,
        chat: { id: 800100, type: 'private', first_name: 'Admin' },
        from: { id: 800100, is_bot: false, first_name: 'Admin' },
        text: 'John',
      },
    } as any);

    const searchResultsCall = apiCalls.find((c) => c.method === 'sendMessage');
    assert.ok(searchResultsCall);
    assert.ok(searchResultsCall.payload.text.includes('Topilgan mijozlar'));
    assert.ok(
      searchResultsCall.payload.reply_markup?.inline_keyboard[0][0].text.includes('John Doe'),
    );

    apiCalls.length = 0;

    // 4. Click callback to view client card "ac:v:900201"
    await bot.handleUpdate({
      update_id: 4,
      callback_query: {
        id: 'q4',
        from: { id: 800100, is_bot: false, first_name: 'Admin' },
        chat_instance: 'instance_1',
        data: 'ac:v:900201',
        message: mockCallbackMessage,
      },
    } as any);

    const cardCall = apiCalls.find((c) => c.method === 'sendMessage');
    assert.ok(cardCall);
    assert.ok(cardCall.payload.text.includes('John Doe'));
    assert.ok(cardCall.payload.text.includes('crm-201'));

    apiCalls.length = 0;

    // 5. Click callback to send custom message "ac:msg:900201"
    await bot.handleUpdate({
      update_id: 5,
      callback_query: {
        id: 'q5',
        from: { id: 800100, is_bot: false, first_name: 'Admin' },
        chat_instance: 'instance_1',
        data: 'ac:msg:900201',
        message: mockCallbackMessage,
      },
    } as any);

    const customPromptCall = apiCalls.find((c) => c.method === 'sendMessage');
    assert.ok(customPromptCall);
    assert.ok(customPromptCall.payload.text.includes('shaxsiy xabar matnini'));

    apiCalls.length = 0;

    // 6. Enter custom message text
    await bot.handleUpdate({
      update_id: 6,
      message: {
        message_id: 104,
        date: Date.now() / 1000,
        chat: { id: 800100, type: 'private', first_name: 'Admin' },
        from: { id: 800100, is_bot: false, first_name: 'Admin' },
        text: 'Your device is ready for pickup!',
      },
    } as any);

    const customPreviewCall = apiCalls.find((c) => c.method === 'sendMessage');
    assert.ok(customPreviewCall);
    assert.ok(customPreviewCall.payload.text.includes('Your device is ready for pickup!'));

    apiCalls.length = 0;

    // 7. Click confirm custom send callback "ac:custom_send:900201"
    await bot.handleUpdate({
      update_id: 7,
      callback_query: {
        id: 'q7',
        from: { id: 800100, is_bot: false, first_name: 'Admin' },
        chat_instance: 'instance_1',
        data: 'ac:custom_send:900201',
        message: mockCallbackMessage,
      },
    } as any);

    // Verify client received the message
    const clientMessageCall = apiCalls.find(
      (c) => c.method === 'sendMessage' && String(c.payload.chat_id) === '900201',
    );
    assert.ok(clientMessageCall);
    assert.equal(clientMessageCall.payload.text, 'Your device is ready for pickup!');

    // Verify success confirmation sent to admin
    const successCall = apiCalls.find(
      (c) =>
        c.method === 'sendMessage' &&
        String(c.payload.chat_id) === '800100' &&
        c.payload.text.includes('muvaffaqiyatli yuborildi'),
    );
    assert.ok(successCall);

    // Verify dispatch log
    assert.equal(deps.dispatches.length, 1);
    assert.equal(deps.dispatches[0].dispatch_type, 'admin_custom_message');
    assert.equal(deps.dispatches[0].status, 'sent');
    assert.equal(deps.dispatches[0].user_id, '201');

    apiCalls.length = 0;

    // 8. Click template message button "ac:tmpl:900201"
    await bot.handleUpdate({
      update_id: 8,
      callback_query: {
        id: 'q8',
        from: { id: 800100, is_bot: false, first_name: 'Admin' },
        chat_instance: 'instance_1',
        data: 'ac:tmpl:900201',
        message: mockCallbackMessage,
      },
    } as any);

    const templateSelectCall = apiCalls.find((c) => c.method === 'sendMessage');
    assert.ok(templateSelectCall);
    assert.ok(templateSelectCall.payload.text.includes('shabloningizni tanlang'));

    apiCalls.length = 0;

    // 9. Select template "ac:tmpl_sel:900201:10"
    await bot.handleUpdate({
      update_id: 9,
      callback_query: {
        id: 'q9',
        from: { id: 800100, is_bot: false, first_name: 'Admin' },
        chat_instance: 'instance_1',
        data: 'ac:tmpl_sel:900201:10',
        message: mockCallbackMessage,
      },
    } as any);

    // Should prompt for the custom placeholder "coupon_code"
    const placeholderPromptCall = apiCalls.find((c) => c.method === 'sendMessage');
    assert.ok(placeholderPromptCall);
    assert.ok(placeholderPromptCall.payload.text.includes('coupon_code'));

    apiCalls.length = 0;

    // 10. Enter placeholder value
    await bot.handleUpdate({
      update_id: 10,
      message: {
        message_id: 105,
        date: Date.now() / 1000,
        chat: { id: 800100, type: 'private', first_name: 'Admin' },
        from: { id: 800100, is_bot: false, first_name: 'Admin' },
        text: 'PRO50',
      },
    } as any);

    // Should show template preview with prefilled customer_name (John Doe) and discount code (PRO50)
    const templatePreviewCall = apiCalls.find((c) => c.method === 'sendMessage');
    assert.ok(templatePreviewCall);
    assert.ok(templatePreviewCall.payload.text.includes('John Doe'));
    assert.ok(templatePreviewCall.payload.text.includes('PRO50'));

    apiCalls.length = 0;

    // 11. Confirm send template callback "ac:tmpl_send:900201:10"
    await bot.handleUpdate({
      update_id: 11,
      callback_query: {
        id: 'q11',
        from: { id: 800100, is_bot: false, first_name: 'Admin' },
        chat_instance: 'instance_1',
        data: 'ac:tmpl_send:900201:10',
        message: mockCallbackMessage,
      },
    } as any);

    // Verify client received the template message
    const clientTmplMessageCall = apiCalls.find(
      (c) => c.method === 'sendMessage' && String(c.payload.chat_id) === '900201',
    );
    assert.ok(clientTmplMessageCall);
    assert.ok(clientTmplMessageCall.payload.text.includes('John Doe'));
    assert.ok(clientTmplMessageCall.payload.text.includes('PRO50'));

    // Verify success confirmation sent to admin
    const tmplSuccessCall = apiCalls.find(
      (c) =>
        c.method === 'sendMessage' &&
        String(c.payload.chat_id) === '800100' &&
        c.payload.text.includes('muvaffaqiyatli yuborildi'),
    );
    assert.ok(tmplSuccessCall);

    // Verify dispatch log
    const tmplDispatch = deps.dispatches.find(
      (d) => d.dispatch_type === 'admin_client_send_template',
    );
    assert.ok(tmplDispatch);
    assert.equal(tmplDispatch.status, 'sent');
    assert.equal(tmplDispatch.template_id, '10');
    assert.equal(tmplDispatch.user_id, '201');
  });

  it('auto-populates employee_name and problem_label instead of client_id and customer_code', async () => {
    const deps = createMockDependencies();
    deps.templates.push({
      id: '11',
      template_key: 'problem_start_uz_ru',
      template_type: 'problem_start',
      title: 'Problem Start',
      content_uz: 'Xodim: {{employee_name}}, Muammo: {{problem_label}}, Mijoz: {{customer_name}}',
      content_ru:
        'Сотрудник: {{employee_name}}, Проблема: {{problem_label}}, Клиент: {{customer_name}}',
      channel: 'telegram_bot',
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const { bot, apiCalls } = createTestBot(deps);

    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 101,
        date: Date.now() / 1000,
        chat: { id: 800100, type: 'private', first_name: 'Admin' },
        from: { id: 800100, is_bot: false, first_name: 'Admin' },
        text: '/start',
        entities: [{ offset: 0, length: 6, type: 'bot_command' }],
      },
    } as any);

    apiCalls.length = 0;

    const mockCallbackMessage = {
      message_id: 999,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 800100, type: 'private' },
      from: { id: 99999, is_bot: true, first_name: 'TestBot' },
      text: 'mock_source_message',
    };

    await bot.handleUpdate({
      update_id: 4,
      callback_query: {
        id: 'q4',
        from: { id: 800100, is_bot: false, first_name: 'Admin' },
        chat_instance: 'instance_1',
        data: 'ac:v:900201',
        message: mockCallbackMessage,
      },
    } as any);

    apiCalls.length = 0;

    await bot.handleUpdate({
      update_id: 9,
      callback_query: {
        id: 'q9',
        from: { id: 800100, is_bot: false, first_name: 'Admin' },
        chat_instance: 'instance_1',
        data: 'ac:tmpl_sel:900201:11',
        message: mockCallbackMessage,
      },
    } as any);

    const previewCall = apiCalls.find(
      (c) =>
        c.method === 'sendMessage' &&
        typeof c.payload.text === 'string' &&
        c.payload.text.includes('Shablon xabar oldindan ko‘rinishi'),
    );
    assert.ok(previewCall, 'Should show the preview screen directly');
    assert.ok(
      previewCall.payload.text.includes('Xodim: Admin User'),
      'employee_name should be replaced with Admin User',
    );
    assert.ok(
      previewCall.payload.text.includes('Muammo: ,'),
      'problem_label should be replaced with empty string',
    );
    assert.ok(
      previewCall.payload.text.includes('Mijoz: John Doe'),
      'customer_name should be replaced with John Doe',
    );
  });
});
