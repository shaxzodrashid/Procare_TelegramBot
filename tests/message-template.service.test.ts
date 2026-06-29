import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Api } from 'grammy';

import {
  BotDirectMessageService,
  BotNotificationService,
  buildDirectMessageInlineKeyboard,
  isTelegramBlockedError,
  renderDirectMessage,
} from '../src/services/bot-notification.service.js';
import {
  MessageTemplateRenderer,
  type MessageTemplateStore,
} from '../src/services/message-template.service.js';
import type {
  MessageDispatchLogRecord,
  MessageTemplate,
  MessageTemplateInput,
  MessageTemplateType,
  MessageTemplateUpdate,
} from '../src/types/message-template.js';
import type { RegisteredUserMessageTarget } from '../src/types/registered-user.js';
import type { SupportMessageReplyTarget } from '../src/types/support-message.js';

const template = (overrides: Partial<MessageTemplate> = {}): MessageTemplate => ({
  id: '1',
  template_key: 'purchase_default',
  template_type: 'purchase',
  title: 'Purchase',
  content_uz: 'Salom {{ customer_name }}. Kupon: {{ coupon_code }}',
  content_ru: 'Здравствуйте, {{ customer_name }}. Купон: {{ coupon_code }}',
  channel: 'telegram_bot',
  is_active: true,
  created_at: '2026-06-17T10:00:00.000Z',
  updated_at: '2026-06-17T10:00:00.000Z',
  ...overrides,
});

class MemoryTemplateStore implements MessageTemplateStore {
  logs: MessageDispatchLogRecord[] = [];
  blockedUpdates: Array<{ telegramId: string; isBlocked: boolean }> = [];

  constructor(private readonly activeTemplate: MessageTemplate | null) {}

  async listTemplates(): Promise<MessageTemplate[]> {
    return this.activeTemplate ? [this.activeTemplate] : [];
  }

  async findTemplateById(id: string): Promise<MessageTemplate | null> {
    return this.activeTemplate?.id === id ? this.activeTemplate : null;
  }

  async findActiveTemplateByType(type: MessageTemplateType): Promise<MessageTemplate | null> {
    return this.activeTemplate?.template_type === type ? this.activeTemplate : null;
  }

  async createTemplate(input: MessageTemplateInput): Promise<MessageTemplate> {
    void input;
    throw new Error('Not implemented');
  }

  async updateTemplate(id: string, update: MessageTemplateUpdate): Promise<MessageTemplate | null> {
    void id;
    void update;
    throw new Error('Not implemented');
  }

  async deleteTemplate(id: string): Promise<boolean> {
    void id;
    throw new Error('Not implemented');
  }

  async logDispatch(record: MessageDispatchLogRecord): Promise<void> {
    this.logs.push(record);
  }

  async setUserBlocked(telegramId: string, isBlocked: boolean): Promise<void> {
    this.blockedUpdates.push({ telegramId, isBlocked });
  }
}

const createTelegramDouble = (sendMessageError?: unknown | unknown[]) => {
  const calls: Array<{
    method: string;
    chatId?: string | number;
    text?: string;
    options?: unknown;
  }> = [];
  const sendMessageErrors = Array.isArray(sendMessageError)
    ? [...sendMessageError]
    : sendMessageError === undefined
      ? []
      : [sendMessageError];
  const telegram = {
    async sendMessage(chatId: string | number, text: string, options?: unknown) {
      calls.push({ method: 'sendMessage', chatId, text, options });
      const error = sendMessageErrors.shift();
      if (error) throw error;
      return {};
    },
    async sendPhoto(_chatId: string | number, _photo: unknown, options?: unknown) {
      calls.push({ method: 'sendPhoto', options });
      return {};
    },
  } as Pick<Api, 'sendMessage' | 'sendPhoto'>;

  return { telegram, calls };
};

class MemoryRegisteredUserLookup {
  constructor(private readonly user: RegisteredUserMessageTarget | null) {}

  async findByPhoneNumber(phoneNumber: string): Promise<RegisteredUserMessageTarget | null> {
    return this.user?.phone_number === phoneNumber ? this.user : null;
  }
}

class MemorySupportMessageLookup {
  constructor(
    private readonly replyTarget: SupportMessageReplyTarget | null,
    private readonly crmCommentId = '22222222-2222-4222-8222-222222222222',
  ) {}

  async findReplyTargetByCrmCommentId(
    crmCommentId: string,
    telegramId: string,
  ): Promise<SupportMessageReplyTarget | null> {
    if (crmCommentId === this.crmCommentId && this.replyTarget?.telegram_id === telegramId) {
      return this.replyTarget;
    }
    return null;
  }
}

const directMessageUser = (
  overrides: Partial<RegisteredUserMessageTarget> = {},
): RegisteredUserMessageTarget => ({
  id: '7',
  telegram_id: '1001',
  telegram_username: 'ali',
  first_name: 'Ali',
  last_name: 'Valiyev',
  phone_number: '+998901234567',
  locale: 'uz',
  is_blocked: false,
  ...overrides,
});

describe('MessageTemplateRenderer', () => {
  it('renders localized placeholders and wraps coupon codes for Telegram copy', () => {
    const rendered = MessageTemplateRenderer.render(template(), 'uz', {
      customer_name: 'Ali <Admin>',
      coupon_code: 'SAVE<10>',
    });

    assert.equal(rendered, 'Salom Ali &lt;Admin&gt;. Kupon: <code>SAVE&lt;10&gt;</code>');
  });

  it('does not double-wrap coupon codes that are already inside code tags', () => {
    const rendered = MessageTemplateRenderer.render(
      template({ content_uz: 'Kupon: <code>{{ coupon_code }}</code>' }),
      'uz',
      { coupon_code: 'A&B' },
    );

    assert.equal(rendered, 'Kupon: <code>A&amp;B</code>');
  });

  it('detects placeholders with flexible spacing', () => {
    assert.equal(
      MessageTemplateRenderer.hasPlaceholder(
        template({ content_uz: 'Sovrin: {{  prize_name  }}' }),
        'uz',
        'prize_name',
      ),
      true,
    );
  });
});

describe('BotNotificationService', () => {
  it('logs template_not_found when no active template exists', async () => {
    const store = new MemoryTemplateStore(null);
    const { telegram, calls } = createTelegramDouble();
    const service = new BotNotificationService(store, telegram);

    const result = await service.sendTemplateMessage({
      user: { id: '7', telegram_id: '1001', language_code: 'uz' },
      type: 'purchase',
      placeholders: {},
    });

    assert.deepEqual(result, { status: 'template_not_found' });
    assert.equal(calls.length, 0);
    assert.equal(store.logs[0]?.status, 'template_not_found');
    assert.equal(store.logs[0]?.user_id, '7');
  });

  it('splits prize photos from long rendered text instead of using an oversized caption', async () => {
    const store = new MemoryTemplateStore(
      template({
        template_type: 'winner_notification',
        content_uz: `Sovrin: {{ prize_name }}\n${'x'.repeat(1030)}`,
      }),
    );
    const { telegram, calls } = createTelegramDouble();
    const service = new BotNotificationService(store, telegram);

    const result = await service.sendTemplateMessage({
      user: { id: '7', telegram_id: '1001', language_code: 'uz' },
      type: 'winner_notification',
      placeholders: { prize_name: 'Phone' },
      photo: { buffer: Buffer.from('image'), fileName: 'prize.jpg' },
    });

    assert.deepEqual(result, { status: 'sent' });
    assert.deepEqual(
      calls.map((call) => call.method),
      ['sendPhoto', 'sendMessage'],
    );
    assert.equal(store.logs[0]?.status, 'sent');
    assert.deepEqual(store.blockedUpdates, [{ telegramId: '1001', isBlocked: false }]);
  });

  it('marks a user blocked when Telegram rejects delivery with a blocked-bot error', async () => {
    const store = new MemoryTemplateStore(template());
    const { telegram } = createTelegramDouble({
      error_code: 403,
      description: 'Forbidden: bot was blocked by the user',
    });
    const service = new BotNotificationService(store, telegram);

    const result = await service.sendTemplateMessage({
      user: { id: '7', telegram_id: '1001', language_code: 'uz' },
      type: 'purchase',
      placeholders: {},
    });

    assert.deepEqual(result, { status: 'failed' });
    assert.equal(store.logs[0]?.status, 'failed');
    assert.deepEqual(store.blockedUpdates, [{ telegramId: '1001', isBlocked: true }]);
    assert.equal(isTelegramBlockedError(new Error('Forbidden: bot was blocked')), true);
  });
});

describe('BotDirectMessageService', () => {
  it('sends plain Telegram messages to the user found by phone number', async () => {
    const store = new MemoryTemplateStore(null);
    const users = new MemoryRegisteredUserLookup(directMessageUser());
    const { telegram, calls } = createTelegramDouble();
    const service = new BotDirectMessageService(users, store, telegram);

    const result = await service.sendDirectMessage({
      phoneNumber: '+998901234567',
      message: 'Salom',
    });

    assert.deepEqual(result, { status: 'sent' });
    assert.deepEqual(calls, [
      { method: 'sendMessage', chatId: '1001', text: 'Salom', options: undefined },
    ]);
    assert.deepEqual(store.blockedUpdates, [{ telegramId: '1001', isBlocked: false }]);
    assert.equal(store.logs[0]?.dispatch_type, 'api_direct_message');
    assert.equal(store.logs[0]?.status, 'sent');
  });

  it('renders registered-user and request variables before delivery', async () => {
    const store = new MemoryTemplateStore(null);
    const users = new MemoryRegisteredUserLookup(directMessageUser());
    const { telegram, calls } = createTelegramDouble();
    const service = new BotDirectMessageService(users, store, telegram);

    const result = await service.sendDirectMessage({
      phoneNumber: '+998901234567',
      message: 'Salom {{ first_name }}. Qurilma: {{ phone_category }}',
      variables: { phone_category: 'iPhone 15 Pro' },
    });

    assert.deepEqual(result, { status: 'sent' });
    assert.equal(calls[0]?.text, 'Salom Ali. Qurilma: iPhone 15 Pro');
  });

  it('sends inline keyboards with URL and repair-order buttons', async () => {
    const store = new MemoryTemplateStore(null);
    const users = new MemoryRegisteredUserLookup(directMessageUser());
    const { telegram, calls } = createTelegramDouble();
    const service = new BotDirectMessageService(users, store, telegram);

    const result = await service.sendDirectMessage({
      phoneNumber: '+998901234567',
      message: 'Salom',
      inlineKeyboard: {
        rows: [
          [{ type: 'url', text: 'CRM', url: 'https://crm.procare.uz/orders/1' }],
          [
            {
              type: 'repair_order',
              repairOrderUuid: '11111111-1111-4111-8111-111111111111',
            },
          ],
        ],
      },
    });

    assert.deepEqual(result, { status: 'sent' });
    assert.deepEqual(calls[0]?.options, {
      reply_markup: buildDirectMessageInlineKeyboard(
        {
          rows: [
            [{ type: 'url', text: 'CRM', url: 'https://crm.procare.uz/orders/1' }],
            [
              {
                type: 'repair_order',
                repairOrderUuid: '11111111-1111-4111-8111-111111111111',
              },
            ],
          ],
        },
        'uz',
      ),
    });
  });

  it('sends support replies against the stored Telegram message target', async () => {
    const store = new MemoryTemplateStore(null);
    const users = new MemoryRegisteredUserLookup(directMessageUser());
    const supportMessages = new MemorySupportMessageLookup({
      id: '42',
      telegram_id: '1001',
      telegram_chat_id: '1001',
      telegram_message_id: 321,
    });
    const { telegram, calls } = createTelegramDouble();
    const service = new BotDirectMessageService(users, store, telegram, supportMessages);

    const result = await service.sendDirectMessage({
      phoneNumber: '+998901234567',
      message: 'Javob',
      supportReply: {
        targetCrmCommentId: '22222222-2222-4222-8222-222222222222',
      },
    });

    assert.deepEqual(result, { status: 'sent' });
    assert.deepEqual(calls, [
      {
        method: 'sendMessage',
        chatId: '1001',
        text: 'Javob',
        options: {
          reply_parameters: {
            message_id: 321,
            allow_sending_without_reply: true,
          },
        },
      },
    ]);
  });

  it('falls back to a simple support reply message when no stored target exists', async () => {
    const store = new MemoryTemplateStore(null);
    const users = new MemoryRegisteredUserLookup(directMessageUser());
    const supportMessages = new MemorySupportMessageLookup(null);
    const { telegram, calls } = createTelegramDouble();
    const service = new BotDirectMessageService(users, store, telegram, supportMessages);

    const result = await service.sendDirectMessage({
      phoneNumber: '+998901234567',
      message: 'Javob',
      supportReply: {
        targetCrmCommentId: '22222222-2222-4222-8222-222222222222',
      },
    });

    assert.deepEqual(result, { status: 'sent' });
    assert.deepEqual(calls, [
      { method: 'sendMessage', chatId: '1001', text: 'Javob', options: undefined },
    ]);
  });

  it('falls back to a simple message when Telegram rejects the reply target', async () => {
    const store = new MemoryTemplateStore(null);
    const users = new MemoryRegisteredUserLookup(directMessageUser());
    const supportMessages = new MemorySupportMessageLookup({
      id: '42',
      telegram_id: '1001',
      telegram_chat_id: '1001',
      telegram_message_id: 321,
    });
    const { telegram, calls } = createTelegramDouble([
      {
        error_code: 400,
        description: 'Bad Request: message to be replied not found',
      },
    ]);
    const service = new BotDirectMessageService(users, store, telegram, supportMessages);

    const result = await service.sendDirectMessage({
      phoneNumber: '+998901234567',
      message: 'Javob',
      supportReply: {
        targetCrmCommentId: '22222222-2222-4222-8222-222222222222',
      },
    });

    assert.deepEqual(result, { status: 'sent' });
    assert.deepEqual(calls, [
      {
        method: 'sendMessage',
        chatId: '1001',
        text: 'Javob',
        options: {
          reply_parameters: {
            message_id: 321,
            allow_sending_without_reply: true,
          },
        },
      },
      { method: 'sendMessage', chatId: '1001', text: 'Javob', options: undefined },
    ]);
    assert.equal(store.logs[0]?.status, 'sent');
  });

  it('rejects direct messages with unresolved variables before sending', async () => {
    const store = new MemoryTemplateStore(null);
    const users = new MemoryRegisteredUserLookup(directMessageUser());
    const { telegram, calls } = createTelegramDouble();
    const service = new BotDirectMessageService(users, store, telegram);

    const result = await service.sendDirectMessage({
      phoneNumber: '+998901234567',
      message: 'Qurilma: {{ phone_category }}',
    });

    assert.deepEqual(result, {
      status: 'invalid_message',
      message: 'Missing message variables: phone_category',
    });
    assert.equal(calls.length, 0);
    assert.equal(store.logs.length, 0);
  });

  it('does not send to users already marked as blocked', async () => {
    const store = new MemoryTemplateStore(null);
    const users = new MemoryRegisteredUserLookup(directMessageUser({ is_blocked: true }));
    const { telegram, calls } = createTelegramDouble();
    const service = new BotDirectMessageService(users, store, telegram);

    const result = await service.sendDirectMessage({
      phoneNumber: '+998901234567',
      message: 'Salom',
    });

    assert.deepEqual(result, { status: 'blocked' });
    assert.equal(calls.length, 0);
    assert.equal(store.logs[0]?.status, 'failed');
  });

  it('marks a user blocked when direct Telegram delivery is forbidden', async () => {
    const store = new MemoryTemplateStore(null);
    const users = new MemoryRegisteredUserLookup(directMessageUser());
    const { telegram } = createTelegramDouble({
      error_code: 403,
      description: 'Forbidden: bot was blocked by the user',
    });
    const service = new BotDirectMessageService(users, store, telegram);

    const result = await service.sendDirectMessage({
      phoneNumber: '+998901234567',
      message: 'Salom',
    });

    assert.deepEqual(result, { status: 'failed' });
    assert.deepEqual(store.blockedUpdates, [{ telegramId: '1001', isBlocked: true }]);
    assert.equal(store.logs[0]?.status, 'failed');
  });
});

describe('renderDirectMessage', () => {
  it('replaces repeated variables and allows explicit empty values', () => {
    assert.deepEqual(
      renderDirectMessage('Salom {{ first_name }} {{ first_name }} {{ last_name }}', {
        first_name: 'Ali',
        last_name: null,
      }),
      { ok: true, message: 'Salom Ali Ali ' },
    );
  });

  it('reports all missing variables in deterministic order', () => {
    assert.deepEqual(renderDirectMessage('{{ z_value }} {{ a_value }}', {}), {
      ok: false,
      message: 'Missing message variables: a_value, z_value',
    });
  });
});
