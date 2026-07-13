import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canRegisterWithManualPhone,
  clearLocalizedBotCommands,
  hasEmployeeMenuAccess,
  localizedBotCommands,
  parseSettingsName,
  registrationAccountKind,
  createRestartGateMiddleware,
  createSessionRestorationMiddleware,
  setLocalizedBotCommands,
} from '../src/bot/create-bot.js';
import { formatCurrentSettings } from '../src/bot/handlers/settings.js';
import type { BotContext, BotSession } from '../src/bot/context.js';
import type { Logger } from '../src/utils/logger.js';
import type { RegisteredUserStore } from '../src/services/registered-user.store.js';
import type { Bot } from 'grammy';

describe('bot command metadata', () => {
  it('builds localized Telegram menu commands', () => {
    assert.deepEqual(
      localizedBotCommands('uz').map((command) => command.command),
      ['start', 'help', 'logout'],
    );
    assert.deepEqual(
      localizedBotCommands('uz').map((command) => command.description),
      ['Procare botini boshlash yoki qayta boshlash', 'Yordam olish', 'Tizimdan chiqish'],
    );
    assert.deepEqual(
      localizedBotCommands('ru').map((command) => command.description),
      ['Начать или перезапустить Procare', 'Получить помощь', 'Выйти из системы'],
    );
  });

  it('publishes commands to default and private-chat scopes', async () => {
    const calls: Array<{
      commands: ReturnType<typeof localizedBotCommands>;
      options: unknown;
    }> = [];
    const bot = {
      api: {
        setMyCommands: async (
          commands: ReturnType<typeof localizedBotCommands>,
          options?: unknown,
        ) => {
          calls.push({ commands, options });
        },
      },
    } as unknown as Bot<BotContext>;

    await setLocalizedBotCommands(bot);

    assert.equal(calls.length, 6);
    assert.deepEqual(
      calls.map((call) => call.commands.map((command) => command.command)),
      [
        ['start', 'help', 'logout'],
        ['start', 'help', 'logout'],
        ['start', 'help', 'logout'],
        ['start', 'help', 'logout'],
        ['start', 'help', 'logout'],
        ['start', 'help', 'logout'],
      ],
    );
    assert.deepEqual(
      calls.map((call) => call.options),
      [
        undefined,
        { language_code: 'uz' },
        { language_code: 'ru' },
        { scope: { type: 'all_private_chats' } },
        { scope: { type: 'all_private_chats' }, language_code: 'uz' },
        { scope: { type: 'all_private_chats' }, language_code: 'ru' },
      ],
    );
  });

  it('clears commands from default and private-chat scopes during shutdown', async () => {
    const calls: unknown[] = [];
    const bot = {
      api: {
        deleteMyCommands: async (options?: unknown) => {
          calls.push(options);
        },
      },
    } as unknown as Bot<BotContext>;

    await clearLocalizedBotCommands(bot);

    assert.deepEqual(calls, [
      undefined,
      { language_code: 'uz' },
      { language_code: 'ru' },
      { scope: { type: 'all_private_chats' } },
      { scope: { type: 'all_private_chats' }, language_code: 'uz' },
      { scope: { type: 'all_private_chats' }, language_code: 'ru' },
    ]);
  });
});

describe('settings name parsing', () => {
  it('normalizes whitespace and splits first and last name', () => {
    assert.deepEqual(parseSettingsName('  Ali   Valiyev  '), {
      firstName: 'Ali',
      lastName: 'Valiyev',
      fullName: 'Ali Valiyev',
    });
  });

  it('allows a single display name', () => {
    assert.deepEqual(parseSettingsName('Ali'), {
      firstName: 'Ali',
      lastName: null,
      fullName: 'Ali',
    });
  });

  it('rejects empty, punctuation-only, and overlong names', () => {
    assert.equal(parseSettingsName(' '), null);
    assert.equal(parseSettingsName('---'), null);
    assert.equal(parseSettingsName('A'.repeat(121)), null);
  });
});

describe('settings summary formatting', () => {
  it('renders a clean Uzbek settings summary with escaped profile values', () => {
    const text = formatCurrentSettings('uz', {
      name: 'Ali <Valiyev>',
      phone: '+998901234567',
      locale: 'ru',
    });

    assert.match(text, /<b>Joriy sozlamalaringiz<\/b>/);
    assert.match(text, /Ali &lt;Valiyev&gt;/);
    assert.match(text, /Telefon:<\/b> \+998901234567/);
    assert.match(text, /Til:<\/b> Ruscha/);
    assert.doesNotMatch(text, /Profil turi/);
  });

  it('renders Russian employee settings with a professional fallback for missing phone', () => {
    const text = formatCurrentSettings('ru', {
      name: 'Admin User',
      phone: null,
      locale: 'uz',
    });

    assert.match(text, /<b>Ваши текущие настройки<\/b>/);
    assert.match(text, /Имя:<\/b> Admin User/);
    assert.match(text, /Телефон:<\/b> Не указан/);
    assert.match(text, /Язык:<\/b> Узбекский/);
    assert.doesNotMatch(text, /Тип профиля/);
  });
});

describe('manual phone registration gate', () => {
  it('allows typed phone numbers only while awaiting phone in development mode', () => {
    const session: BotSession = { locale: 'uz', stage: 'awaiting_phone' };

    assert.equal(canRegisterWithManualPhone(session, true), true);
    assert.equal(canRegisterWithManualPhone(session, false), false);
  });

  it('allows typed phone numbers for developer-only sessions even outside development mode', () => {
    const session: BotSession = {
      locale: 'uz',
      stage: 'awaiting_phone',
      developer: { is_active: true },
    };

    assert.equal(canRegisterWithManualPhone(session, false), true);
  });

  it('does not allow typed phone numbers for registered sessions', () => {
    const session: BotSession = {
      locale: 'uz',
      stage: 'awaiting_phone',
      client: {
        account_type: 'client',
        client_id: 'client-1',
        first_name: 'Ali',
        last_name: null,
        language: null,
        has_repair_orders: false,
        is_admin: false,
        admin: null,
      },
    };

    assert.equal(canRegisterWithManualPhone(session, true), false);
  });

  it('does not allow typed phone numbers for admin sessions', () => {
    const session: BotSession = {
      locale: 'uz',
      stage: 'awaiting_phone',
      admin: {
        id: 'admin-1',
        first_name: 'Ali',
        last_name: null,
        phone_number: '+998901234567',
        phone_verified: true,
        language: 'uz',
        status: 'Open',
        is_active: true,
        created_at: '2026-06-15T10:00:00.000Z',
        updated_at: '2026-06-15T10:00:00.000Z',
      },
    };

    assert.equal(canRegisterWithManualPhone(session, true), false);
  });
});

describe('registration account classification', () => {
  it('treats is_admin registration responses as employees', () => {
    assert.equal(
      registrationAccountKind({
        account_type: 'admin',
        is_admin: true,
        admin: {
          id: 'admin-1',
          first_name: 'Ali',
          last_name: null,
          phone_number: '+998901234567',
          phone_verified: true,
          language: 'uz',
          status: 'Open',
          is_active: true,
          created_at: '2026-06-15T10:00:00.000Z',
          updated_at: '2026-06-15T10:00:00.000Z',
        },
      }),
      'employee',
    );
  });

  it('treats client-shaped is_admin responses as employees', () => {
    assert.equal(
      registrationAccountKind({
        account_type: 'client',
        client_id: 'client-1',
        first_name: 'Ali',
        last_name: null,
        language: 'uz',
        has_repair_orders: true,
        is_admin: true,
        admin: {
          id: 'admin-1',
          first_name: 'Ali',
          last_name: null,
          phone_number: '+998901234567',
          phone_verified: true,
          language: 'uz',
          status: 'Open',
          is_active: true,
          created_at: '2026-06-15T10:00:00.000Z',
          updated_at: '2026-06-15T10:00:00.000Z',
        },
      }),
      'employee',
    );
  });
});

describe('employee menu access', () => {
  it('requires an active employee session', () => {
    assert.equal(
      hasEmployeeMenuAccess({
        admin: {
          id: 'admin-1',
          first_name: 'Ali',
          last_name: null,
          phone_number: '+998901234567',
          phone_verified: true,
          language: 'uz',
          status: 'Open',
          is_active: true,
          created_at: '2026-06-15T10:00:00.000Z',
          updated_at: '2026-06-15T10:00:00.000Z',
        },
      }),
      true,
    );

    assert.equal(
      hasEmployeeMenuAccess({
        admin: {
          id: 'admin-1',
          first_name: 'Ali',
          last_name: null,
          phone_number: '+998901234567',
          phone_verified: true,
          language: 'uz',
          status: 'Open',
          is_active: false,
          created_at: '2026-06-15T10:00:00.000Z',
          updated_at: '2026-06-15T10:00:00.000Z',
        },
      }),
      false,
    );

    assert.equal(hasEmployeeMenuAccess({}), false);
  });
});

describe('deployment restart gate', () => {
  const mockLogger: Logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    extra: () => {},
    table: () => {},
  };

  const restartState = {
    user: {
      id: '42',
      telegram_id: '123',
      telegram_username: 'testuser',
      first_name: 'Test',
      last_name: null,
      phone_number: '+998901234567',
      locale: 'ru' as const,
      should_restart: true,
    },
  };

  it('blocks normal messages and replaces stale session state with a /start prompt', async () => {
    let calledNext = false;
    const replies: Array<{
      text: string;
      options: { reply_markup: { keyboard: Array<Array<{ text: string }>> } };
    }> = [];
    const store = {
      findByTelegramId: async () => restartState,
      clearRestartRequired: async () => {},
    } as unknown as RegisteredUserStore;
    const middleware = createRestartGateMiddleware({
      registeredUserStore: store,
      logger: mockLogger,
    });
    const ctx = {
      from: { id: 123 },
      message: { text: 'Мои заказы' },
      session: {
        locale: 'uz' as const,
        client: { client_id: 'stale-client' },
      },
      reply: async (
        text: string,
        options: { reply_markup: { keyboard: Array<Array<{ text: string }>> } },
      ) => {
        replies.push({ text, options });
      },
    } as unknown as BotContext;

    await middleware(ctx, async () => {
      calledNext = true;
    });

    assert.equal(calledNext, false);
    assert.equal(ctx.session.locale, 'ru');
    assert.equal(ctx.session.stage, 'choosing_language');
    assert.equal(ctx.session.client, undefined);
    assert.match(replies[0]?.text ?? '', /перезапустите бота командой \/start/);
    assert.equal(replies[0]?.options.reply_markup.keyboard[0]?.[0]?.text, '/start');
  });

  it('clears the durable flag and allows a real /start command through', async () => {
    let calledNext = false;
    const clearedIds: string[] = [];
    const store = {
      findByTelegramId: async () => restartState,
      clearRestartRequired: async (telegramId: string) => {
        clearedIds.push(telegramId);
      },
    } as unknown as RegisteredUserStore;
    const middleware = createRestartGateMiddleware({
      registeredUserStore: store,
      logger: mockLogger,
    });
    const ctx = {
      from: { id: 123 },
      message: { text: '/start@TestBot referral' },
      session: { locale: 'uz' as const },
      reply: async () => {},
    } as unknown as BotContext;

    await middleware(ctx, async () => {
      calledNext = true;
    });

    assert.equal(calledNext, true);
    assert.deepEqual(clearedIds, ['123']);
    assert.equal(ctx.session.locale, 'ru');
    assert.equal(ctx.session.stage, 'choosing_language');
  });

  it('keeps /start blocked when the durable flag cannot be cleared', async () => {
    let calledNext = false;
    const replies: string[] = [];
    const store = {
      findByTelegramId: async () => restartState,
      clearRestartRequired: async () => {
        throw new Error('database unavailable');
      },
    } as unknown as RegisteredUserStore;
    const middleware = createRestartGateMiddleware({
      registeredUserStore: store,
      logger: mockLogger,
    });
    const ctx = {
      from: { id: 123 },
      message: { text: '/start' },
      session: { locale: 'uz' as const },
      reply: async (text: string) => {
        replies.push(text);
      },
    } as unknown as BotContext;

    await middleware(ctx, async () => {
      calledNext = true;
    });

    assert.equal(calledNext, false);
    assert.match(replies[0] ?? '', /Сервис временно недоступен/);
  });

  it('answers stale callbacks before showing the restart prompt', async () => {
    let answered = false;
    let replied = false;
    const store = {
      findByTelegramId: async () => restartState,
      clearRestartRequired: async () => {},
    } as unknown as RegisteredUserStore;
    const middleware = createRestartGateMiddleware({
      registeredUserStore: store,
      logger: mockLogger,
    });
    const ctx = {
      from: { id: 123 },
      callbackQuery: { id: 'callback-1', data: 'ro:r' },
      session: { locale: 'uz' as const },
      answerCallbackQuery: async () => {
        answered = true;
      },
      reply: async () => {
        replied = true;
      },
    } as unknown as BotContext;

    await middleware(ctx, async () => {});

    assert.equal(answered, true);
    assert.equal(replied, true);
  });
});

describe('session restoration middleware', () => {
  const mockLogger: Logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    extra: () => {},
    table: () => {},
  };

  it('restores client session if user is registered as a client', async () => {
    let calledNext = false;
    const mockStore = {
      findByTelegramId: async (id: string) => {
        if (id === '123') {
          return {
            user: {
              telegram_id: '123',
              telegram_username: 'testuser',
              first_name: 'John',
              last_name: 'Doe',
              phone_number: '+998901234567',
              locale: 'ru' as const,
              should_restart: false,
            },
            client: {
              crm_client_id: 'client-123',
              customer_code: null,
              status: 'Open',
              is_active: true,
            },
          };
        }
        return null;
      },
    } as unknown as RegisteredUserStore;

    const middleware = createSessionRestorationMiddleware({
      registeredUserStore: mockStore,
      logger: mockLogger,
    });

    const ctx = {
      from: { id: 123, username: 'testuser', first_name: 'John', last_name: 'Doe' },
      session: {
        locale: 'uz' as const,
        stage: 'choosing_language' as const,
      },
    } as unknown as BotContext;

    await middleware(ctx, async () => {
      calledNext = true;
    });

    assert.equal(calledNext, true);
    assert.equal(ctx.session.locale, 'ru');
    assert.equal(ctx.session.stage, undefined);
    assert.deepEqual(ctx.session.client, {
      account_type: 'client',
      client_id: 'client-123',
      first_name: 'John',
      last_name: 'Doe',
      phone_number: '+998901234567',
      language: 'ru',
      has_repair_orders: true,
      is_admin: false,
      admin: null,
    });
  });

  it('restores employee session if user is registered as an employee', async () => {
    let calledNext = false;
    const mockStore = {
      findByTelegramId: async (id: string) => {
        if (id === '456') {
          return {
            user: {
              telegram_id: '456',
              telegram_username: 'adminuser',
              first_name: 'Admin',
              last_name: null,
              phone_number: '+998907654321',
              locale: 'uz' as const,
              should_restart: false,
            },
            employee: {
              crm_admin_id: 'admin-456',
              status: 'Open',
              is_active: true,
              created_at: '2026-06-17T10:00:00.000Z',
              updated_at: '2026-06-17T10:00:00.000Z',
            },
          };
        }
        return null;
      },
    } as unknown as RegisteredUserStore;

    const middleware = createSessionRestorationMiddleware({
      registeredUserStore: mockStore,
      logger: mockLogger,
    });

    const ctx = {
      from: { id: 456, username: 'adminuser', first_name: 'Admin' },
      session: {
        locale: 'ru' as const,
        stage: 'awaiting_phone' as const,
      },
    } as unknown as BotContext;

    await middleware(ctx, async () => {
      calledNext = true;
    });

    assert.equal(calledNext, true);
    assert.equal(ctx.session.locale, 'uz');
    assert.equal(ctx.session.stage, undefined);
    assert.deepEqual(ctx.session.admin, {
      id: 'admin-456',
      first_name: 'Admin',
      last_name: null,
      phone_number: '+998907654321',
      phone_verified: true,
      language: 'uz',
      status: 'Open',
      is_active: true,
      created_at: '2026-06-17T10:00:00.000Z',
      updated_at: '2026-06-17T10:00:00.000Z',
    });
  });

  it('does nothing if user is not registered', async () => {
    let calledNext = false;
    const mockStore = {
      findByTelegramId: async () => null,
    } as unknown as RegisteredUserStore;

    const middleware = createSessionRestorationMiddleware({
      registeredUserStore: mockStore,
      logger: mockLogger,
    });

    const ctx = {
      from: { id: 789, first_name: 'Stranger' },
      session: {
        locale: 'uz' as const,
        stage: 'choosing_language' as const,
      },
    } as unknown as BotContext;

    await middleware(ctx, async () => {
      calledNext = true;
    });

    assert.equal(calledNext, true);
    assert.equal(ctx.session.locale, 'uz');
    assert.equal(ctx.session.stage, 'choosing_language');
    assert.equal(ctx.session.client, undefined);
    assert.equal(ctx.session.admin, undefined);
  });
});
