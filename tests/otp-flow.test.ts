/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Bot } from 'grammy';
import type { BotContext, BotSession } from '../src/bot/context.js';
import type { BotDependencies } from '../src/bot/create-bot.js';
import { registerCommandHandlers } from '../src/bot/handlers/commands.js';
import { registerRegistrationHandlers } from '../src/bot/handlers/registration.js';
import type { OtpAuthGateway } from '../src/types/otp-auth.js';
import type { RegisteredUserStore } from '../src/services/registered-user.store.js';
import type { MessageTemplateStore } from '../src/services/message-template.service.js';
import type { Logger } from '../src/utils/logger.js';
import { BotDirectMessageService } from '../src/services/bot-notification.service.js';

const mockLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  extra: () => undefined,
  table: () => undefined,
};

const createMockBot = () => {
  const commands: Record<string, (ctx: BotContext) => Promise<void>> = {};
  const hears: Array<{
    patterns: string[];
    handler: (ctx: BotContext, next: () => Promise<void>) => Promise<void>;
  }> = [];
  const onHandlers: Record<string, (ctx: BotContext, next: () => Promise<void>) => Promise<void>> =
    {};

  const bot = {
    command(name: string, handler: (ctx: BotContext) => Promise<void>) {
      commands[name] = handler;
      return bot;
    },
    hears(
      patterns: string[],
      handler: (ctx: BotContext, next: () => Promise<void>) => Promise<void>,
    ) {
      hears.push({ patterns, handler });
      return bot;
    },
    on(event: string, handler: (ctx: BotContext, next: () => Promise<void>) => Promise<void>) {
      onHandlers[event] = handler;
      return bot;
    },
  } as unknown as Bot<BotContext>;

  return {
    bot,
    commands,
    hears,
    onHandlers,
    async executeCommand(name: string, ctx: BotContext) {
      const handler = commands[name];
      if (!handler) {
        throw new Error(`Command ${name} not found`);
      }
      await handler(ctx);
    },
    async executeOn(event: string, ctx: BotContext, next: () => Promise<void> = async () => {}) {
      const handler = onHandlers[event];
      if (!handler) {
        throw new Error(`Handler for event ${event} not found`);
      }
      await handler(ctx, next);
    },
  };
};

describe('OTP Auth Bot Flow', () => {
  describe('/start with OTP deep-link payload', () => {
    it('validates session token and presents native contact request button on success', async () => {
      const { bot, executeCommand } = createMockBot();
      let lookedUpToken = '';
      const otpAuthService: OtpAuthGateway = {
        async getSession(token: string) {
          lookedUpToken = token;
          return { status: 'PENDING_TELEGRAM', phone_number: '+998901234567' };
        },
        async verifyContact() {
          return { success: true };
        },
      };

      const messageTemplateStore = {
        async setUserBlocked() {
          return undefined;
        },
      } as unknown as MessageTemplateStore;

      registerCommandHandlers(bot, {
        otpAuthService,
        messageTemplateStore,
        logger: mockLogger,
      } as unknown as BotDependencies);

      const replies: Array<{ text: string; options?: any }> = [];
      const session: BotSession = { locale: 'uz', stage: 'choosing_language' };
      const ctx = {
        from: { id: 12345, first_name: 'John' },
        match: 'sess_valid123',
        session,
        reply: async (text: string, options?: any) => {
          replies.push({ text, options });
        },
      } as unknown as BotContext;

      await executeCommand('start', ctx);

      assert.equal(lookedUpToken, 'sess_valid123');
      assert.equal(session.stage, 'awaiting_otp_contact');
      assert.equal(session.otpAuth?.sessionToken, 'sess_valid123');
      assert.equal(typeof session.otpAuth?.createdAt, 'number');
      assert.equal(replies.length, 1);
      assert.match(replies[0]?.text ?? '', /ProCare tizimiga xush kelibsiz/);
      assert.equal(replies[0]?.options?.reply_markup?.keyboard?.[0]?.[0]?.request_contact, true);
    });

    it('rejects /start with expired or invalid session token', async () => {
      const { bot, executeCommand } = createMockBot();
      const otpAuthService: OtpAuthGateway = {
        async getSession() {
          return null; // Not found / expired
        },
        async verifyContact() {
          return { success: true };
        },
      };

      const messageTemplateStore = {
        async setUserBlocked() {
          return undefined;
        },
      } as unknown as MessageTemplateStore;

      registerCommandHandlers(bot, {
        otpAuthService,
        messageTemplateStore,
        logger: mockLogger,
      } as unknown as BotDependencies);

      const replies: Array<{ text: string; options?: any }> = [];
      const session: BotSession = { locale: 'uz', stage: 'choosing_language' };
      const ctx = {
        from: { id: 12345, first_name: 'John' },
        match: 'sess_expired123',
        session,
        reply: async (text: string, options?: any) => {
          replies.push({ text, options });
        },
      } as unknown as BotContext;

      await executeCommand('start', ctx);

      assert.equal(session.stage, 'choosing_language');
      assert.equal(session.otpAuth, undefined);
      assert.equal(replies.length, 1);
      assert.match(replies[0]?.text ?? '', /havola eskirgan yoki yaroqsiz/);
    });

    it('defaults new user to Russian locale if Telegram language_code is ru', async () => {
      const { bot, executeCommand } = createMockBot();
      const otpAuthService: OtpAuthGateway = {
        async getSession() {
          return { status: 'PENDING_TELEGRAM' };
        },
        async verifyContact() {
          return { success: true };
        },
      };

      const messageTemplateStore = {
        async setUserBlocked() {
          return undefined;
        },
      } as unknown as MessageTemplateStore;

      registerCommandHandlers(bot, {
        otpAuthService,
        messageTemplateStore,
        logger: mockLogger,
      } as unknown as BotDependencies);

      const replies: Array<{ text: string; options?: any }> = [];
      const session: BotSession = { locale: 'uz', stage: 'choosing_language' };
      const ctx = {
        from: { id: 12345, language_code: 'ru', first_name: 'Ivan' },
        match: 'sess_ru123',
        session,
        reply: async (text: string, options?: any) => {
          replies.push({ text, options });
        },
      } as unknown as BotContext;

      await executeCommand('start', ctx);

      assert.equal(session.locale, 'ru');
      assert.match(replies[0]?.text ?? '', /Добро пожаловать в ProCare/);
    });
  });

  describe('contact sharing in OTP flow', () => {
    it('verifies contact with backend and returns ProCare return link on success', async () => {
      const { bot, executeOn } = createMockBot();
      let verifiedParams: any;
      let savedUserRecord: any;

      const otpAuthService: OtpAuthGateway = {
        async getSession() {
          return { status: 'PENDING_TELEGRAM' };
        },
        async verifyContact(params) {
          verifiedParams = params;
          return { success: true };
        },
      };

      const registeredUserStore = {
        async saveTelegramUser(record: any) {
          savedUserRecord = record;
          return 'user-1';
        },
      } as unknown as RegisteredUserStore;

      registerRegistrationHandlers(bot, {
        otpAuthService,
        registeredUserStore,
        logger: mockLogger,
      } as unknown as BotDependencies);

      const replies: Array<{ text: string; options?: any }> = [];
      const session: BotSession = {
        locale: 'uz',
        stage: 'awaiting_otp_contact',
        otpAuth: {
          sessionToken: 'sess_test123',
          createdAt: Date.now(),
        },
      };

      const ctx = {
        from: { id: 777, username: 'tester', first_name: 'Bob', last_name: 'Test' },
        chat: { id: 777 },
        message: {
          contact: {
            user_id: 777,
            phone_number: '+998901234567',
            first_name: 'Bob',
            last_name: 'Test',
          },
        },
        session,
        reply: async (text: string, options?: any) => {
          replies.push({ text, options });
        },
      } as unknown as BotContext;

      await executeOn('message:contact', ctx);

      assert.deepEqual(verifiedParams, {
        session_token: 'sess_test123',
        telegram_user_id: 777,
        telegram_chat_id: 777,
        contact_phone: '+998901234567',
        contact_user_id: 777,
      });

      assert.deepEqual(savedUserRecord, {
        telegram_id: '777',
        telegram_username: 'tester',
        first_name: 'Bob',
        last_name: 'Test',
        phone_number: '+998901234567',
        locale: 'uz',
      });

      assert.equal(session.otpAuth, undefined);
      assert.equal(session.stage, undefined);
      assert.equal(replies.length, 1);
      assert.match(replies[0]?.text ?? '', /Raqamingiz muvaffaqiyatli tasdiqlandi/);
      assert.equal(
        replies[0]?.options?.reply_markup?.inline_keyboard?.[0]?.[0]?.url,
        'procare://auth/verify',
      );
    });

    it('rejects contact from a different user ID (anti-spoofing)', async () => {
      const { bot, executeOn } = createMockBot();
      let backendCalled = false;

      const otpAuthService: OtpAuthGateway = {
        async getSession() {
          return null;
        },
        async verifyContact() {
          backendCalled = true;
          return { success: true };
        },
      };

      registerRegistrationHandlers(bot, {
        otpAuthService,
        logger: mockLogger,
      } as unknown as BotDependencies);

      const replies: Array<{ text: string; options?: any }> = [];
      const session: BotSession = {
        locale: 'uz',
        stage: 'awaiting_otp_contact',
        otpAuth: {
          sessionToken: 'sess_test123',
          createdAt: Date.now(),
        },
      };

      const ctx = {
        from: { id: 777 },
        chat: { id: 777 },
        message: {
          contact: {
            user_id: 888, // Different user ID!
            phone_number: '+998901234567',
          },
        },
        session,
        reply: async (text: string, options?: any) => {
          replies.push({ text, options });
        },
      } as unknown as BotContext;

      await executeOn('message:contact', ctx);

      assert.equal(backendCalled, false);
      assert.equal(replies.length, 1);
      assert.match(replies[0]?.text ?? '', /faqat o‘zingizning shaxsiy raqamingizni yuboring/);
      assert.equal(session.stage, 'awaiting_otp_contact');
    });

    it('displays error message when phone number mismatches the app session', async () => {
      const { bot, executeOn } = createMockBot();

      const otpAuthService: OtpAuthGateway = {
        async getSession() {
          return null;
        },
        async verifyContact() {
          return { success: false, error: 'PHONE_NUMBER_MISMATCH' };
        },
      };

      registerRegistrationHandlers(bot, {
        otpAuthService,
        logger: mockLogger,
      } as unknown as BotDependencies);

      const replies: Array<{ text: string; options?: any }> = [];
      const session: BotSession = {
        locale: 'uz',
        stage: 'awaiting_otp_contact',
        otpAuth: {
          sessionToken: 'sess_test123',
          createdAt: Date.now(),
        },
      };

      const ctx = {
        from: { id: 777 },
        chat: { id: 777 },
        message: {
          contact: {
            user_id: 777,
            phone_number: '+998909999999',
          },
        },
        session,
        reply: async (text: string, options?: any) => {
          replies.push({ text, options });
        },
      } as unknown as BotContext;

      await executeOn('message:contact', ctx);

      assert.equal(replies.length, 1);
      assert.match(replies[0]?.text ?? '', /raqam ilovaga kiritilgan raqamga mos kelmadi/);
    });

    it('informs user when OTP session has expired (> 5 minutes)', async () => {
      const { bot, executeOn } = createMockBot();

      registerRegistrationHandlers(bot, {
        logger: mockLogger,
      } as unknown as BotDependencies);

      const replies: Array<{ text: string; options?: any }> = [];
      const session: BotSession = {
        locale: 'uz',
        stage: 'awaiting_otp_contact',
        otpAuth: {
          sessionToken: 'sess_test123',
          createdAt: Date.now() - 6 * 60 * 1000, // 6 minutes ago
        },
      };

      const ctx = {
        from: { id: 777 },
        chat: { id: 777 },
        message: {
          contact: {
            user_id: 777,
            phone_number: '+998901234567',
          },
        },
        session,
        reply: async (text: string, options?: any) => {
          replies.push({ text, options });
        },
      } as unknown as BotContext;

      await executeOn('message:contact', ctx);

      assert.equal(session.otpAuth, undefined);
      assert.equal(session.stage, undefined);
      assert.match(replies[0]?.text ?? '', /Aktiv tasdiqlash sessiyasi topilmadi/);
    });
  });

  describe('BotDirectMessageService.sendOtp', () => {
    it('formats OTP message with code tag and expiry, and sends to telegram chat', async () => {
      let sentChatId = '';
      let sentText = '';
      let sentOptions: any;

      const telegramApi = {
        sendMessage: async (chatId: string, text: string, options: any) => {
          sentChatId = chatId;
          sentText = text;
          sentOptions = options;
          return { message_id: 555 };
        },
      };

      const templates = {
        logDispatch: async () => {},
        setUserBlocked: async () => {},
        findActiveTemplateByType: async () => null,
      };

      const users = {
        findByPhoneNumber: async () => null,
        findClientByCrmClientId: async () => null,
      };

      const service = new BotDirectMessageService(
        users as any,
        templates as any,
        telegramApi as any,
      );

      const result = await service.sendOtp({
        chatId: '987654321',
        otp: '849201',
        expiresIn: 180,
        locale: 'uz',
      });

      assert.equal(result.status, 'sent');
      assert.equal(result.messageId, 555);
      assert.equal(sentChatId, '987654321');
      assert.match(sentText, /<code>849201<\/code>/);
      assert.match(sentText, /Kod 3 daqiqa davomida amal qiladi/);
      assert.equal(sentOptions?.parse_mode, 'HTML');
    });

    it('looks up user by phone number when chatId is not provided', async () => {
      let sentChatId = '';
      const telegramApi = {
        sendMessage: async (chatId: string) => {
          sentChatId = chatId;
          return { message_id: 666 };
        },
      };

      const templates = {
        logDispatch: async () => {},
        setUserBlocked: async () => {},
        findActiveTemplateByType: async () => null,
      };

      const users = {
        findByPhoneNumber: async (phone: string) => {
          if (phone === '+998901234567') {
            return {
              id: 'user-99',
              telegram_id: '445566',
              first_name: 'Timur',
              last_name: null,
              phone_number: phone,
              locale: 'ru' as const,
              is_blocked: false,
            };
          }
          return null;
        },
        findClientByCrmClientId: async () => null,
      };

      const service = new BotDirectMessageService(
        users as any,
        templates as any,
        telegramApi as any,
      );

      const result = await service.sendOtp({
        phoneNumber: '+998 90 123 45 67',
        otp: '444111',
      });

      assert.equal(result.status, 'sent');
      assert.equal(result.messageId, 666);
      assert.equal(sentChatId, '445566');
    });

    it('returns blocked status and marks user blocked when Telegram reports 403 bot blocked', async () => {
      let markedBlocked = false;
      const telegramApi = {
        sendMessage: async () => {
          const error: any = new Error('Forbidden: bot was blocked by the user');
          error.error_code = 403;
          error.description = 'Forbidden: bot was blocked by the user';
          throw error;
        },
      };

      const templates = {
        logDispatch: async () => {},
        setUserBlocked: async (telegramId: string, isBlocked: boolean) => {
          if (telegramId === '123' && isBlocked) markedBlocked = true;
        },
        findActiveTemplateByType: async () => null,
      };

      const users = {
        findByPhoneNumber: async () => null,
        findClientByCrmClientId: async () => null,
      };

      const service = new BotDirectMessageService(
        users as any,
        templates as any,
        telegramApi as any,
      );

      const result = await service.sendOtp({
        chatId: '123',
        otp: '123456',
      });

      assert.equal(result.status, 'blocked');
      assert.equal(markedBlocked, true);
    });
  });
});
