import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Api } from 'grammy';

import {
  BotDirectMessageService,
  BotNotificationService,
  isTelegramBlockedError,
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

const createTelegramDouble = (sendMessageError?: unknown) => {
  const calls: Array<{
    method: string;
    chatId?: string | number;
    text?: string;
    options?: unknown;
  }> = [];
  const telegram = {
    async sendMessage(chatId: string | number, text: string, options?: unknown) {
      calls.push({ method: 'sendMessage', chatId, text, options });
      if (sendMessageError) throw sendMessageError;
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
    const users = new MemoryRegisteredUserLookup({
      id: '7',
      telegram_id: '1001',
      phone_number: '+998901234567',
      is_blocked: false,
    });
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

  it('does not send to users already marked as blocked', async () => {
    const store = new MemoryTemplateStore(null);
    const users = new MemoryRegisteredUserLookup({
      id: '7',
      telegram_id: '1001',
      phone_number: '+998901234567',
      is_blocked: true,
    });
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
    const users = new MemoryRegisteredUserLookup({
      id: '7',
      telegram_id: '1001',
      phone_number: '+998901234567',
      is_blocked: false,
    });
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
