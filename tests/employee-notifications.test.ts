import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Api } from 'grammy';
import type { Update } from 'grammy/types';
import type { Knex } from 'knex';

import { createApiServer } from '../src/api/server.js';
import { createBot, type BotDependencies } from '../src/bot/create-bot.js';
import { t } from '../src/bot/messages.js';
import { parseNotificationContent } from '../src/api/employee-notifications.js';
import { loadConfig } from '../src/config/index.js';
import { BotDirectMessageService } from '../src/services/bot-notification.service.js';
import {
  EmployeeNotificationService,
  PostgresEmployeeNotificationStore,
  type EmployeeNotificationStore,
} from '../src/services/employee-notification.service.js';
import type {
  EmployeeNotificationType,
  EmployeeNotificationPreference,
} from '../src/types/employee-notification.js';
import type { MessageDispatchLogRecord } from '../src/types/message-template.js';
import type {
  RegisteredEmployeeMessageTarget,
  UserRegistrationState,
} from '../src/types/registered-user.js';
import type { Logger } from '../src/utils/logger.js';

const logger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  extra: () => {},
  table: () => {},
};
const config = loadConfig({
  NODE_ENV: 'test',
  BOT_ENABLED: 'false',
  API_MESSAGE_SEND_TOKEN: 'test-token',
  CRM_BASE_URL: 'https://crm.test',
  TELEGRAM_BOT_BASIC_AUTH_USER: 'bot',
  TELEGRAM_BOT_BASIC_AUTH_PASSWORD: 'synthetic',
  DB_PASS: 'synthetic',
});
const headers = { authorization: 'Bearer test-token' };

const notificationType = (
  overrides: Partial<EmployeeNotificationType> = {},
): EmployeeNotificationType => ({
  key: 'order_assigned',
  name_uz: 'Yangi buyurtma',
  name_ru: 'Новый заказ',
  is_active: true,
  default_enabled: true,
  message_template: {
    parseMode: 'MarkdownV2',
    localizedMessages: {
      uz: '*{{first_name}}* {{number}}',
      ru: '*{{first_name}}* Заказ {{number}}',
    },
  },
  ...overrides,
});

class MemoryStore implements EmployeeNotificationStore {
  types = new Map<string, EmployeeNotificationType>();
  overrides = new Map<string, boolean>();
  writes: unknown[] = [];
  constructor(type = notificationType()) {
    this.types.set(type.key, type);
  }
  async listTypes(): Promise<EmployeeNotificationType[]> {
    return [...this.types.values()];
  }
  async findType(key: string): Promise<EmployeeNotificationType | null> {
    return this.types.get(key) ?? null;
  }
  async saveType(type: EmployeeNotificationType): Promise<EmployeeNotificationType> {
    this.types.set(type.key, type);
    return type;
  }
  async listPreferences(id: string): Promise<EmployeeNotificationPreference[]> {
    return [...this.types.values()].map((type) => ({
      type,
      enabled: this.overrides.get(`${id}:${type.key}`) ?? type.default_enabled,
    }));
  }
  async setPreference(id: string, key: string, enabled: boolean): Promise<void> {
    this.writes.push({ id, key, enabled });
    this.overrides.set(`${id}:${key}`, enabled);
  }
}

const target = (id = '7001', account = 'admin-1'): RegisteredEmployeeMessageTarget => ({
  id,
  telegram_id: id,
  crm_admin_id: account,
  locale: 'ru',
  is_blocked: false,
});
const registration = (id: string, account = 'admin-1'): UserRegistrationState => ({
  user: {
    id,
    telegram_id: id,
    first_name: 'Ali_Bek',
    last_name: null,
    telegram_username: null,
    phone_number: '+998901234567',
    locale: 'ru',
    should_restart: false,
  },
  employee: {
    crm_admin_id: account,
    is_active: true,
    status: 'Active',
    created_at: '2026-10-12',
    updated_at: '2026-10-12',
  },
});

describe('employee notification delivery', () => {
  it('uses employee identity, locale, rich attachments and keyboard, and logs the type', async () => {
    const store = new MemoryStore();
    const logs: MessageDispatchLogRecord[] = [];
    const calls: Array<{ method: string; chat: string; options: unknown }> = [];
    const telegram = {
      async sendDocument(chat: string, _file: unknown, options: unknown) {
        calls.push({ method: 'sendDocument', chat, options });
        return {};
      },
    } as unknown as Api;
    const delivery = new BotDirectMessageService(
      {
        async findByPhoneNumber() {
          throw new Error('Phone lookup must not be used');
        },
        async findClientByCrmClientId() {
          throw new Error('Client lookup must not be used');
        },
      },
      {
        async logDispatch(log) {
          logs.push(log);
        },
        async setUserBlocked() {},
        async findActiveTemplateByType() {
          return null;
        },
      },
      telegram,
      undefined,
      {
        fetchImpl: async () =>
          new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'application/pdf' } }),
      },
    );
    const service = new EmployeeNotificationService(
      store,
      {
        async findActiveEmployeesByCrmAdminIds() {
          return [target()];
        },
        async findByTelegramId(id) {
          return registration(id);
        },
      },
      delivery,
      logger,
    );
    const result = await service.send({
      typeKey: 'order_assigned',
      crmAdminIds: ['admin-1', 'admin-1'],
      content: {
        variables: { number: 'DP-12' },
        attachments: [
          { type: 'document', url: 'https://files.test/order.pdf', fileName: 'order.pdf' },
        ],
        inlineKeyboard: {
          rows: [
            [
              {
                type: 'url',
                url: 'https://crm.test/order',
                localizedText: { uz: 'Ochish', ru: 'Открыть' },
              },
            ],
          ],
        },
      },
    });
    assert.deepEqual(result.results, [
      { crm_admin_id: 'admin-1', telegram_id: '7001', status: 'sent' },
    ]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.chat, '7001');
    const options = calls[0]?.options as {
      caption: string;
      parse_mode: string;
      reply_markup: { inline_keyboard: unknown };
    };
    assert.equal(options.caption, '*Ali\\_Bek* Заказ DP\\-12');
    assert.equal(options.parse_mode, 'MarkdownV2');
    assert.deepEqual(options.reply_markup.inline_keyboard, [
      [{ text: 'Открыть', url: 'https://crm.test/order' }],
    ]);
    assert.equal(logs[0]?.dispatch_type, 'employee:order_assigned');
    assert.equal(logs[0]?.status, 'sent');
  });

  for (const scenario of [
    'disabled',
    'default_off',
    'type_inactive',
    'missing',
    'deactivated',
    'wrong_account',
  ] as const) {
    it(`does not deliver for ${scenario}`, async () => {
      const store = new MemoryStore(
        notificationType({
          default_enabled: scenario !== 'default_off',
          is_active: scenario !== 'type_inactive',
        }),
      );
      if (scenario === 'disabled') await store.setPreference('admin-1', 'order_assigned', false);
      let calls = 0;
      const service = new EmployeeNotificationService(
        store,
        {
          async findActiveEmployeesByCrmAdminIds() {
            return scenario === 'missing' ? [] : [target()];
          },
          async findByTelegramId(id) {
            const state = registration(id, scenario === 'wrong_account' ? 'other' : 'admin-1');
            if (scenario === 'deactivated') state.employee!.is_active = false;
            return state;
          },
        },
        {
          async sendToRecipient() {
            calls++;
            return { status: 'sent' };
          },
        },
        logger,
      );
      const result = await service.send({ typeKey: 'order_assigned', crmAdminIds: ['admin-1'] });
      assert.equal(calls, 0);
      assert.equal(
        result.results[0]?.status,
        scenario === 'default_off' || scenario === 'disabled'
          ? 'disabled'
          : scenario === 'type_inactive'
            ? 'type_inactive'
            : 'not_found',
      );
    });
  }

  it('applies explicit opt-in to all Telegram accounts and continues after a delivery failure', async () => {
    const store = new MemoryStore(notificationType({ default_enabled: false }));
    await store.setPreference('admin-1', 'order_assigned', true);
    const service = new EmployeeNotificationService(
      store,
      {
        async findActiveEmployeesByCrmAdminIds() {
          return [target('7001'), target('7002')];
        },
        async findByTelegramId(id) {
          return registration(id);
        },
      },
      {
        async sendToRecipient(user) {
          if (user.telegram_id === '7001') throw new Error('Unavailable');
          return { status: 'sent' };
        },
      },
      logger,
    );
    const result = await service.send({
      typeKey: 'order_assigned',
      crmAdminIds: ['admin-1', 'unregistered'],
    });
    assert.deepEqual(
      result.results.map((row) => row.status),
      ['failed', 'sent', 'disabled'],
    );
  });

  it('returns type_not_found without looking up recipients', async () => {
    const service = new EmployeeNotificationService(
      new MemoryStore(),
      {
        async findActiveEmployeesByCrmAdminIds() {
          throw new Error('must not be called');
        },
        async findByTelegramId() {
          return null;
        },
      },
      {
        async sendToRecipient() {
          throw new Error('must not be called');
        },
      },
      logger,
    );
    assert.deepEqual(await service.send({ typeKey: 'unknown', crmAdminIds: ['admin-1'] }), {
      status: 'type_not_found',
      results: [],
    });
  });

  it('allows plain message overrides of a localized default without changing its parse mode', async () => {
    let captured: unknown;
    const service = new EmployeeNotificationService(
      new MemoryStore(),
      {
        async findActiveEmployeesByCrmAdminIds() {
          return [target()];
        },
        async findByTelegramId(id) {
          return registration(id);
        },
      },
      {
        async sendToRecipient(_user, content) {
          captured = content;
          return { status: 'sent' };
        },
      },
      logger,
    );
    await service.send({
      typeKey: 'order_assigned',
      crmAdminIds: ['admin-1'],
      content: { message: '*Override*' },
    });
    assert.equal((captured as { localizedMessages?: unknown }).localizedMessages, undefined);
    assert.equal((captured as { parseMode: string }).parseMode, 'MarkdownV2');
  });
});

describe('employee notification API', () => {
  it('requires authorization on every route and works without Telegram for catalog/preferences', async () => {
    const app = createApiServer(config, logger, { employeeNotificationStore: new MemoryStore() });
    for (const [method, url] of [
      ['GET', '/types'],
      ['PUT', '/types/order_assigned'],
      ['GET', '/employees/admin-1/preferences'],
      ['PUT', '/employees/admin-1/preferences/order_assigned'],
      ['POST', '/send'],
    ] as const) {
      assert.equal(
        (await app.inject({ method, url: `/employee-notifications${url}` })).statusCode,
        401,
      );
    }
    assert.equal(
      (await app.inject({ method: 'GET', url: '/employee-notifications/types', headers }))
        .statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/employee-notifications/send',
          headers,
          payload: {},
        })
      ).statusCode,
      503,
    );
    await app.close();
  });

  it('upserts and round-trips full templates, attachments and localized inline keyboards', async () => {
    const store = new MemoryStore();
    const app = createApiServer(config, logger, { employeeNotificationStore: store });
    const payload = {
      name_uz: 'Yangi buyurtma',
      name_ru: 'Новый заказ',
      is_active: true,
      default_enabled: true,
      message_template: {
        localized_messages: { uz: '*{{first_name}}*', ru: '*{{first_name}}*' },
        parse_mode: 'MarkdownV2',
        attachments: [{ type: 'document', url: 'https://files.test/a.pdf', file_name: 'a.pdf' }],
        inline_keyboard: {
          rows: [
            [
              {
                type: 'url',
                url: 'https://crm.test',
                localized_text: { uz: 'CRM', ru: 'CRM' },
                style: 'primary',
              },
            ],
          ],
        },
      },
    };
    const response = await app.inject({
      method: 'PUT',
      url: '/employee-notifications/types/order_assigned',
      headers,
      payload,
    });
    assert.equal(response.statusCode, 200, response.body);
    const data = response.json<{ data: EmployeeNotificationType & { message_template: unknown } }>()
      .data;
    const parsed = parseNotificationContent(data.message_template);
    assert.equal(parsed.ok, true);
    if (parsed.ok)
      assert.deepEqual(parsed.content, store.types.get('order_assigned')?.message_template);
    assert.equal(
      (await app.inject({ method: 'GET', url: '/employee-notifications/types', headers })).json<{
        data: unknown[];
      }>().data.length,
      1,
    );
    await app.close();
  });

  it('validates content and type metadata before storing it', async () => {
    const store = new MemoryStore();
    const app = createApiServer(config, logger, { employeeNotificationStore: store });
    const valid = {
      name_uz: 'Uz',
      name_ru: 'Ru',
      is_active: true,
      default_enabled: true,
      message_template: { message: 'Hi' },
    };
    for (const payload of [
      { ...valid, is_active: 'true' },
      { ...valid, name_ru: '' },
      { ...valid, message_template: { message: 'Hi', parse_mode: 'Markdown' } },
      { ...valid, message_template: { message: 'Hi', phone_number: '+998901234567' } },
      {
        ...valid,
        message_template: { attachments: [{ type: 'video', url: 'https://files.test/a' }] },
      },
    ]) {
      assert.equal(
        (
          await app.inject({
            method: 'PUT',
            url: '/employee-notifications/types/order_assigned',
            headers,
            payload,
          })
        ).statusCode,
        400,
      );
    }
    assert.equal(
      (
        await app.inject({
          method: 'PUT',
          url: `/employee-notifications/types/${'x'.repeat(33)}`,
          headers,
          payload: valid,
        })
      ).statusCode,
      400,
    );
    await app.close();
  });

  it('persists opt-outs, reads effective preferences, and rejects unknown types', async () => {
    const store = new MemoryStore();
    const app = createApiServer(config, logger, { employeeNotificationStore: store });
    const url = '/employee-notifications/employees/admin-1/preferences';
    assert.equal(
      (
        await app.inject({
          method: 'PUT',
          url: `${url}/order_assigned`,
          headers,
          payload: { enabled: false },
        })
      ).statusCode,
      200,
    );
    const data = (await app.inject({ method: 'GET', url, headers })).json<{
      data: { enabled: boolean }[];
    }>().data;
    assert.equal(data[0]?.enabled, false);
    assert.equal(
      (
        await app.inject({
          method: 'PUT',
          url: `${url}/order_assigned`,
          headers,
          payload: { enabled: 'false' },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: 'PUT',
          url: `${url}/unknown`,
          headers,
          payload: { enabled: true },
        })
      ).statusCode,
      404,
    );
    assert.equal(store.writes.length, 1);
    await app.close();
  });

  it('deduplicates recipients, preserves variables-only overrides, and reports each outcome', async () => {
    const app = createApiServer(config, logger, {
      employeeNotificationStore: new MemoryStore(),
      employeeNotificationService: {
        async send(params) {
          assert.deepEqual(params.crmAdminIds, ['admin-1']);
          assert.deepEqual(params.content, { variables: { number: 'DP-1' } });
          return {
            status: 'processed',
            results: [{ crm_admin_id: 'admin-1', status: 'disabled' }],
          };
        },
      },
    });
    const url = '/employee-notifications/send';
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url,
          headers,
          payload: {
            type_key: 'order_assigned',
            crm_admin_ids: ['admin-1'],
            content: null,
          },
        })
      ).statusCode,
      400,
    );
    const response = await app.inject({
      method: 'POST',
      url,
      headers,
      payload: {
        type_key: 'order_assigned',
        crm_admin_ids: [' admin-1 ', 'admin-1'],
        content: { variables: { number: 'DP-1' } },
      },
    });
    assert.equal(response.statusCode, 200, response.body);
    for (const ids of [[], Array.from({ length: 101 }, () => 'admin-1'), [null], ['']]) {
      assert.equal(
        (
          await app.inject({
            method: 'POST',
            url,
            headers,
            payload: { type_key: 'order_assigned', crm_admin_ids: ids },
          })
        ).statusCode,
        400,
      );
    }
    await app.close();
  });
});

describe('notification PostgreSQL preferences', () => {
  it('keeps explicit false/true overrides above defaults and binds the CRM account ID', async () => {
    const filters: unknown[] = [];
    const database = ((table: string) => {
      const rows =
        table === 'employee_notification_types'
          ? [
              notificationType(),
              notificationType({ key: 'default_off', default_enabled: false }),
              notificationType({ key: 'default_only' }),
            ]
          : [
              { type_key: 'order_assigned', enabled: false },
              { type_key: 'default_off', enabled: true },
            ];
      return {
        select() {
          return this;
        },
        orderBy() {
          return Promise.resolve(rows);
        },
        where(filter: unknown) {
          filters.push(filter);
          return Promise.resolve(rows);
        },
      };
    }) as unknown as Knex;
    const store = new PostgresEmployeeNotificationStore(database);
    assert.deepEqual(
      (await store.listPreferences('crm-account')).map(({ enabled }) => enabled),
      [false, true, true],
    );
    assert.deepEqual(filters, [{ crm_admin_id: 'crm-account' }]);
  });

  it('upserts preferences by account and type without replacing creation timestamps', async () => {
    const calls: unknown[] = [];
    const database = Object.assign(
      () => ({
        insert(value: unknown) {
          calls.push(value);
          return this;
        },
        onConflict(value: unknown) {
          calls.push(value);
          return this;
        },
        merge(value: unknown) {
          calls.push(value);
          return Promise.resolve();
        },
      }),
      { fn: { now: () => 'database-now' } },
    ) as unknown as Knex;
    await new PostgresEmployeeNotificationStore(database).setPreference(
      'admin-1',
      'order_assigned',
      false,
    );
    assert.deepEqual(calls, [
      { crm_admin_id: 'admin-1', type_key: 'order_assigned', enabled: false },
      ['crm_admin_id', 'type_key'],
      { enabled: false, updated_at: 'database-now' },
    ]);
  });
});

describe('employee notification Telegram preferences', () => {
  const harness = (locale: 'uz' | 'ru', employeeActive = true) => {
    const store = new MemoryStore();
    const state = registration('7001');
    state.user.locale = locale;
    state.employee!.is_active = employeeActive;
    const dependencies = {
      employeeNotificationStore: store,
      registeredUserStore: {
        async findByTelegramId() {
          return state;
        },
      },
      logger,
      richMessagesEnabled: false,
      allowManualPhoneEntry: false,
    } as unknown as BotDependencies;
    const bot = createBot('synthetic-token', dependencies);
    bot.botInfo = {
      id: 9999,
      is_bot: true,
      first_name: 'Bot',
      username: 'test_bot',
      can_join_groups: false,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
      can_manage_bots: false,
      supports_join_request_queries: false,
    };
    const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
    bot.api.config.use(async (_previous, method, payload) => {
      calls.push({ method, payload: payload as Record<string, unknown> });
      return {
        ok: true,
        result: { message_id: 100, date: 1, chat: { id: 7001, type: 'private' }, text: 'reply' },
      } as never;
    });
    const from = { id: 7001, is_bot: false, first_name: 'Ali' };
    const chat = { id: 7001, type: 'private', first_name: 'Ali' } as const;
    let updateId = 0;
    return {
      bot,
      store,
      calls,
      state,
      message: async (text: string) =>
        bot.handleUpdate({
          update_id: ++updateId,
          message: {
            message_id: updateId,
            date: 1,
            from,
            chat,
            text,
          },
        }),
      callback: async (data: string, messageId = 100) =>
        bot.handleUpdate({
          update_id: ++updateId,
          callback_query: {
            id: String(updateId),
            from,
            chat_instance: 'private',
            data,
            message: { message_id: messageId, date: 1, chat, text: 'preferences' },
          },
        } as Update),
    };
  };

  for (const locale of ['uz', 'ru'] as const) {
    it(`opens localized preferences and persists a single-account opt-out in ${locale}`, async () => {
      const h = harness(locale);
      await h.message(t(locale, 'employeeNotifications'));
      const payload = h.calls.find((call) => call.method === 'sendMessage')?.payload;
      assert.equal(payload?.text, t(locale, 'employeeNotificationsTitle'));
      assert.ok(
        JSON.stringify(payload?.reply_markup).includes(
          locale === 'ru' ? 'Новый заказ' : 'Yangi buyurtma',
        ),
      );
      await h.callback('en:set:order_assigned:0');
      assert.deepEqual(h.store.writes, [{ id: 'admin-1', key: 'order_assigned', enabled: false }]);
      const ack = h.calls.findIndex((call) => call.method === 'answerCallbackQuery');
      const edit = h.calls.findIndex((call) => call.method === 'editMessageText');
      assert.ok(ack >= 0 && edit > ack);
      // Duplicate requests set the desired state instead of toggling it again.
      await h.callback('en:set:order_assigned:0');
      assert.equal(h.store.overrides.get('admin-1:order_assigned'), false);
    });
  }

  it('rejects stale buttons after leaving the menu, and buttons from older messages', async () => {
    const h = harness('ru');
    await h.message(t('ru', 'employeeNotifications'));
    await h.callback('en:set:order_assigned:0', 99);
    assert.equal(h.store.writes.length, 0);
    await h.message('/help');
    await h.callback('en:set:order_assigned:0');
    assert.equal(h.store.writes.length, 0);
  });

  it('checks persisted employee activity before accepting an old preference button', async () => {
    const h = harness('uz');
    await h.message(t('uz', 'employeeNotifications'));
    h.state.employee!.is_active = false;
    await h.callback('en:set:order_assigned:0');
    assert.equal(h.store.writes.length, 0);
  });

  it('paginates active types and returns to the personal menu', async () => {
    const h = harness('uz');
    for (let index = 0; index < 11; index++) {
      const type = notificationType({ key: `type_${index}`, name_uz: `Type ${index}` });
      h.store.types.set(type.key, type);
    }
    await h.message(t('uz', 'employeeNotifications'));
    const markup = h.calls[0]?.payload.reply_markup as {
      inline_keyboard: Array<Array<{ callback_data: string }>>;
    };
    assert.equal(
      markup.inline_keyboard.flat().filter((button) => button.callback_data.startsWith('en:set'))
        .length,
      10,
    );
    await h.callback('en:page:1');
    await h.callback('en:back');
    await h.callback('en:set:order_assigned:0');
    assert.equal(h.store.writes.length, 0);
  });

  it('rejects preference access without an active employee role', async () => {
    const h = harness('ru', false);
    await h.message(t('ru', 'employeeNotifications'));
    assert.equal(
      h.calls.find((call) => call.method === 'sendMessage')?.payload.text,
      t('ru', 'staleAction'),
    );
    assert.equal(h.store.writes.length, 0);
  });
});
