import { Bot, GrammyError, HttpError, session } from 'grammy';
import type { RawApi, Transformer } from 'grammy';
import type { BotCommand } from 'grammy/types';

import type { ClientRegistrationGateway } from '../services/client-registration.service.js';
import { RegistrationError } from '../services/client-registration.service.js';
import type { RepairOrderGateway } from '../services/repair-order.service.js';
import { RepairOrderError } from '../services/repair-order.service.js';
import type { UnknownClientStore } from '../services/unknown-client.store.js';
import type { Locale } from '../types/client.js';
import { localizedCatalogName } from '../types/repair-order.js';
import type { UnknownClientDeclineReason } from '../types/unknown-client.js';
import {
  redactPhoneNumber,
  redactPhoneNumbersInText,
  summarizeText,
  summarizeUnknownPayload,
} from '../utils/log-redaction.js';
import type { Logger } from '../utils/logger.js';
import { normalizeUzPhone } from '../utils/phone.js';
import type { BotContext, BotSession, RepairRequestDraft } from './context.js';
import {
  buildRepairDescription,
  formatCategoryPage,
  formatProblemList,
  formatRepairOrders,
  formatRepairRequestSummary,
} from './formatters.js';
import {
  categoryKeyboard,
  confirmationKeyboard,
  languageKeyboard,
  mainKeyboard,
  noteKeyboard,
  osTypesKeyboard,
  problemsKeyboard,
  registrationKeyboard,
  requestOfferKeyboard,
} from './keyboards.js';
import { t } from './messages.js';

export interface BotDependencies {
  registrationService: ClientRegistrationGateway;
  repairOrderService: RepairOrderGateway;
  unknownClientStore: UnknownClientStore;
  logger: Logger;
  allowManualPhoneEntry: boolean;
}

const CATEGORY_PAGE_SIZE = 10;

const initialSession = (): BotSession => ({ locale: 'uz', stage: 'choosing_language' });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';

const summarizeSession = (sessionData: BotSession): Record<string, unknown> => ({
  locale: sessionData.locale,
  stage: sessionData.stage ?? 'registered',
  client: sessionData.client
    ? {
        id: sessionData.client.id,
        status: sessionData.client.status,
        repair_orders_count: sessionData.client.repair_orders.length,
      }
    : undefined,
  unknownClient: sessionData.unknownClient
    ? {
        phoneNumber: redactPhoneNumber(sessionData.unknownClient.phoneNumber),
        username_present: Boolean(sessionData.unknownClient.username),
        first_name_present: Boolean(sessionData.unknownClient.firstName),
        last_name_present: Boolean(sessionData.unknownClient.lastName),
      }
    : undefined,
  repairDraft: sessionData.repairDraft
    ? {
        selectedOsId: sessionData.repairDraft.selectedOs?.id,
        selectedCategoryId: sessionData.repairDraft.selectedCategory?.id,
        categoryPathIds: sessionData.repairDraft.categoryPath.map((item) => item.id),
        categoriesCount: sessionData.repairDraft.categories.length,
        categoryPage: sessionData.repairDraft.categoryPage,
        problemsCount: sessionData.repairDraft.problems.length,
        selectedProblemIds: sessionData.repairDraft.selectedProblemIds,
        note: summarizeText(sessionData.repairDraft.note),
        submitting: sessionData.repairDraft.submitting,
      }
    : undefined,
});

const summarizeTelegramText = (text: string): Record<string, unknown> => ({
  kind: text.startsWith('/') ? 'command' : 'text',
  command: text.startsWith('/') ? text.split(/\s+/, 1)[0] : undefined,
  length: text.length,
});

const summarizeTelegramMessage = (ctx: BotContext): Record<string, unknown> | undefined => {
  const message = ctx.message;
  if (!message) return undefined;

  const summary: Record<string, unknown> = {
    message_id: message.message_id,
    date: message.date,
  };

  if ('text' in message && typeof message.text === 'string') {
    summary.kind = 'text';
    summary.text = summarizeTelegramText(message.text);
  } else if ('contact' in message && message.contact) {
    const { contact } = message;
    summary.kind = 'contact';
    summary.contact = {
      user_id: contact.user_id,
      is_own_contact: contact.user_id === ctx.from?.id,
      phone_number: redactPhoneNumber(contact.phone_number),
    };
  } else {
    summary.kind = 'other';
    summary.keys = Object.keys(message).slice(0, 20);
  }

  return summary;
};

const summarizeTelegramCallback = (ctx: BotContext): Record<string, unknown> | undefined => {
  const callbackQuery = ctx.callbackQuery;
  if (!callbackQuery) return undefined;

  return {
    id: callbackQuery.id,
    data: callbackQuery.data,
    from_id: callbackQuery.from.id,
    message_id:
      callbackQuery.message && 'message_id' in callbackQuery.message
        ? callbackQuery.message.message_id
        : undefined,
  };
};

const summarizeTelegramUpdate = (ctx: BotContext): Record<string, unknown> => ({
  update_id: ctx.update.update_id,
  type: ctx.callbackQuery ? 'callback_query' : ctx.message ? 'message' : 'other',
  from: ctx.from
    ? {
        id: ctx.from.id,
        is_bot: ctx.from.is_bot,
        language_code: ctx.from.language_code,
      }
    : undefined,
  chat: ctx.chat
    ? {
        id: ctx.chat.id,
        type: ctx.chat.type,
      }
    : undefined,
  message: summarizeTelegramMessage(ctx),
  callbackQuery: summarizeTelegramCallback(ctx),
  session: summarizeSession(ctx.session),
});

const summarizeReplyMarkup = (value: unknown): unknown => {
  if (!isRecord(value)) return summarizeUnknownPayload(value);
  if ('inline_keyboard' in value && Array.isArray(value.inline_keyboard)) {
    return {
      type: 'inline_keyboard',
      rows: value.inline_keyboard.length,
      buttons: value.inline_keyboard.reduce(
        (count, row) => count + (Array.isArray(row) ? row.length : 0),
        0,
      ),
    };
  }
  if ('keyboard' in value && Array.isArray(value.keyboard)) {
    return {
      type: 'reply_keyboard',
      rows: value.keyboard.length,
      buttons: value.keyboard.reduce(
        (count, row) => count + (Array.isArray(row) ? row.length : 0),
        0,
      ),
      resize_keyboard: value.resize_keyboard,
      one_time_keyboard: value.one_time_keyboard,
    };
  }
  return summarizeUnknownPayload(value);
};

const summarizeTelegramApiPayload = (payload: unknown): unknown => {
  if (!isRecord(payload)) return summarizeUnknownPayload(payload);

  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'phone_number') {
      summary[key] = redactPhoneNumber(typeof value === 'string' ? value : undefined);
    } else if (key === 'contact') {
      summary[key] = summarizeUnknownPayload(value);
    } else if (key === 'text' || key === 'caption') {
      summary[key] = summarizeText(typeof value === 'string' ? value : undefined);
    } else if (key === 'reply_markup') {
      summary[key] = summarizeReplyMarkup(value);
    } else {
      summary[key] = value;
    }
  }
  return summary;
};

const summarizeTelegramApiResult = (result: unknown): unknown => {
  if (result === true) return true;
  if (!isRecord(result)) return summarizeUnknownPayload(result);

  if ('message_id' in result) {
    const text = typeof result.text === 'string' ? result.text : undefined;
    const chat = isRecord(result.chat) ? result.chat : undefined;
    return {
      type: 'message',
      message_id: result.message_id,
      date: result.date,
      chat: chat ? { id: chat.id, type: chat.type } : undefined,
      text: summarizeText(text),
    };
  }

  if ('id' in result && 'username' in result && 'is_bot' in result) {
    return {
      type: 'bot_user',
      id: result.id,
      username: result.username,
      is_bot: result.is_bot,
    };
  }

  return summarizeUnknownPayload(result);
};

const createTelegramApiLoggingTransformer =
  (logger: Logger): Transformer<RawApi> =>
  async (prev, method, payload, signal) => {
    logger.extra('Telegram API request', {
      method,
      payload: summarizeTelegramApiPayload(payload),
    });

    try {
      const response = await prev(method, payload, signal);
      logger.extra('Telegram API response', {
        method,
        ok: response.ok,
        result: response.ok ? summarizeTelegramApiResult(response.result) : undefined,
        error:
          response.ok === false
            ? {
                error_code: response.error_code,
                description: redactPhoneNumbersInText(response.description),
              }
            : undefined,
      });
      return response;
    } catch (error) {
      logger.extra('Telegram API request failed', { method });
      throw error;
    }
  };

export const localizedBotCommands = (locale: Locale): BotCommand[] => [
  { command: 'start', description: t(locale, 'commandStart') },
  { command: 'help', description: t(locale, 'commandHelp') },
  { command: 'logout', description: t(locale, 'commandLogout') },
];

export const setLocalizedBotCommands = async (bot: Bot<BotContext>): Promise<void> => {
  await bot.api.setMyCommands(localizedBotCommands('uz'));
  await bot.api.setMyCommands(localizedBotCommands('uz'), { language_code: 'uz' });
  await bot.api.setMyCommands(localizedBotCommands('ru'), { language_code: 'ru' });
};

const clearUnknownFlow = (sessionData: BotSession): void => {
  delete sessionData.unknownClient;
  delete sessionData.repairDraft;
};

const resetSession = (sessionData: BotSession, locale: Locale): void => {
  delete sessionData.client;
  clearUnknownFlow(sessionData);
  sessionData.locale = locale;
  sessionData.stage = 'choosing_language';
};

const createDraft = (): RepairRequestDraft => ({
  osTypes: [],
  categoryPath: [],
  categories: [],
  categoryPage: 0,
  problems: [],
  selectedProblemIds: [],
  note: '',
  submitting: false,
});

const fullTelegramName = (ctx: BotContext): string =>
  [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ').trim() || 'Telegram user';

const categoryMessage = (draft: RepairRequestDraft, locale: Locale): string => {
  const path = draft.categoryPath.map((item) => localizedCatalogName(item, locale)).join(' → ');
  const list = formatCategoryPage(draft.categories, draft.categoryPage, locale, CATEGORY_PAGE_SIZE);
  return [
    t(locale, 'chooseCategory'),
    path ? `\n${path}` : '',
    `\n${list || t(locale, 'noCategories')}`,
  ].join('');
};

const saveUnknownClient = async (
  ctx: BotContext,
  store: UnknownClientStore,
  reason: UnknownClientDeclineReason,
): Promise<void> => {
  const unknown = ctx.session.unknownClient;
  if (!unknown || !ctx.from) return;

  await store.save({
    telegram_id: String(ctx.from.id),
    telegram_username: unknown.username,
    first_name: unknown.firstName,
    last_name: unknown.lastName,
    phone_number: unknown.phoneNumber,
    locale: ctx.session.locale,
    reason,
    saved_at: new Date().toISOString(),
  });
};

export const canRegisterWithManualPhone = (
  sessionData: BotSession,
  allowManualPhoneEntry: boolean,
): boolean =>
  allowManualPhoneEntry && sessionData.stage === 'awaiting_phone' && !sessionData.client;

const registerByPhone = async (
  ctx: BotContext,
  dependencies: BotDependencies,
  phoneNumber: string,
): Promise<void> => {
  if (!ctx.from || !ctx.chat) return;

  const normalizedPhone = normalizeUzPhone(phoneNumber);
  if (!normalizedPhone) {
    await ctx.reply(t(ctx.session.locale, 'invalidPhone'), {
      reply_markup: registrationKeyboard(ctx.session.locale),
    });
    return;
  }

  const pendingMessage = await ctx.reply(t(ctx.session.locale, 'registering'));
  try {
    const client = await dependencies.registrationService.registerByPhone(normalizedPhone);
    ctx.session.client = client;
    clearUnknownFlow(ctx.session);
    delete ctx.session.stage;
    await ctx.api.deleteMessage(ctx.chat.id, pendingMessage.message_id).catch(() => undefined);
    await ctx.reply(
      t(ctx.session.locale, 'registered', {
        name: client.first_name || ctx.from.first_name,
      }),
      { reply_markup: mainKeyboard(ctx.session.locale) },
    );
  } catch (error) {
    await ctx.api.deleteMessage(ctx.chat.id, pendingMessage.message_id).catch(() => undefined);
    if (error instanceof RegistrationError && error.code === 'not_found') {
      ctx.session.unknownClient = {
        phoneNumber: normalizedPhone,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name ?? null,
        username: ctx.from.username ?? null,
      };
      ctx.session.stage = 'offering_request';
      await ctx.reply(t(ctx.session.locale, 'notFound'), {
        reply_markup: requestOfferKeyboard(ctx.session.locale),
      });
      return;
    }

    const key =
      error instanceof RegistrationError
        ? error.code === 'invalid_phone'
          ? 'invalidPhone'
          : error.code === 'maintenance'
            ? 'maintenance'
            : 'unavailable'
        : 'unavailable';
    dependencies.logger.error('Client registration failed', error);
    await ctx.reply(t(ctx.session.locale, key), {
      reply_markup: registrationKeyboard(ctx.session.locale),
    });
  }
};

const showConfirmation = async (ctx: BotContext): Promise<void> => {
  const unknown = ctx.session.unknownClient;
  const draft = ctx.session.repairDraft;
  if (!unknown || !draft || !draft.selectedCategory) {
    await ctx.reply(t(ctx.session.locale, 'staleAction'));
    return;
  }

  ctx.session.stage = 'confirming_request';
  await ctx.reply(
    `${t(ctx.session.locale, 'confirmRequest')}\n\n${formatRepairRequestSummary(
      unknown,
      draft,
      ctx.session.locale,
    )}`,
    {
      parse_mode: 'HTML',
      reply_markup: confirmationKeyboard(ctx.session.locale),
    },
  );
};

const acceptNote = async (ctx: BotContext, note: string): Promise<void> => {
  const draft = ctx.session.repairDraft;
  if (!draft || ctx.session.stage !== 'awaiting_note') {
    await ctx.reply(t(ctx.session.locale, 'staleAction'));
    return;
  }

  draft.note = note.trim();
  if (
    draft.note.length > 9_000 ||
    buildRepairDescription(draft, ctx.session.locale).length > 10_000
  ) {
    draft.note = '';
    await ctx.reply(t(ctx.session.locale, 'noteTooLong'), {
      reply_markup: noteKeyboard(ctx.session.locale),
    });
    return;
  }
  await showConfirmation(ctx);
};

export const createBot = (token: string, dependencies: BotDependencies): Bot<BotContext> => {
  const bot = new Bot<BotContext>(token);

  bot.api.config.use(createTelegramApiLoggingTransformer(dependencies.logger));

  bot.use(session({ initial: initialSession }));
  bot.use(async (ctx, next) => {
    const startedAt = Date.now();
    dependencies.logger.debug(`Incoming Telegram update ${ctx.update.update_id}`);
    dependencies.logger.extra(`Incoming Telegram update ${ctx.update.update_id}`, {
      update: summarizeTelegramUpdate(ctx),
    });
    try {
      await next();
    } finally {
      const durationMs = Date.now() - startedAt;
      dependencies.logger.info(
        `Telegram update ${ctx.update.update_id} processed in ${durationMs}ms`,
      );
      dependencies.logger.extra(`Telegram update ${ctx.update.update_id} completed`, {
        durationMs,
        session: summarizeSession(ctx.session),
      });
    }
  });

  bot.command('start', async (ctx) => {
    if (ctx.session.client) {
      await ctx.reply(
        t(ctx.session.locale, 'registered', {
          name: ctx.session.client.first_name || ctx.from?.first_name || 'Procare',
        }),
        { reply_markup: mainKeyboard(ctx.session.locale) },
      );
      return;
    }

    clearUnknownFlow(ctx.session);
    ctx.session.stage = 'choosing_language';
    await ctx.reply(t(ctx.session.locale, 'chooseLanguage'), {
      reply_markup: languageKeyboard(),
    });
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(t(ctx.session.locale, 'help'), {
      reply_markup: ctx.session.client
        ? mainKeyboard(ctx.session.locale)
        : ctx.session.stage === 'awaiting_phone'
          ? registrationKeyboard(ctx.session.locale)
          : languageKeyboard(),
    });
  });

  bot.command('logout', async (ctx) => {
    if (!ctx.from) return;

    try {
      await dependencies.unknownClientStore.deleteByTelegramId(String(ctx.from.id));
      const locale = ctx.session.locale;
      resetSession(ctx.session, locale);
      await ctx.reply(t(locale, 'logoutSuccess'), {
        reply_markup: languageKeyboard(),
      });
    } catch (error) {
      dependencies.logger.error('Failed to delete Telegram user during logout', error);
      await ctx.reply(t(ctx.session.locale, 'logoutFailed'), {
        reply_markup: ctx.session.client
          ? mainKeyboard(ctx.session.locale)
          : ctx.session.stage === 'awaiting_phone'
            ? registrationKeyboard(ctx.session.locale)
            : languageKeyboard(),
      });
    }
  });

  bot.hears([t('uz', 'uzbek'), t('ru', 'russian')], async (ctx) => {
    const text = ctx.msg?.text;
    if (!text) return;
    if (ctx.session.stage === 'awaiting_note') {
      await acceptNote(ctx, text);
      return;
    }

    ctx.session.locale = text === t('ru', 'russian') ? 'ru' : 'uz';
    if (ctx.session.client) {
      await ctx.reply(
        t(ctx.session.locale, 'registered', {
          name: ctx.session.client.first_name || ctx.from?.first_name || 'Procare',
        }),
        { reply_markup: mainKeyboard(ctx.session.locale) },
      );
      return;
    }

    ctx.session.stage = 'awaiting_phone';
    await ctx.reply(t(ctx.session.locale, 'welcome'), {
      reply_markup: registrationKeyboard(ctx.session.locale),
    });
  });

  bot.on('message:contact', async (ctx) => {
    if (ctx.session.stage !== 'awaiting_phone' && !ctx.session.client) {
      await ctx.reply(t(ctx.session.locale, 'chooseLanguage'), {
        reply_markup: languageKeyboard(),
      });
      return;
    }

    const contact = ctx.message.contact;
    if (contact.user_id !== ctx.from.id) {
      await ctx.reply(t(ctx.session.locale, 'phoneOnly'), {
        reply_markup: registrationKeyboard(ctx.session.locale),
      });
      return;
    }

    await registerByPhone(ctx, dependencies, contact.phone_number);
  });

  bot.callbackQuery('request:accept', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (ctx.session.stage !== 'offering_request' || !ctx.session.unknownClient) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }

    try {
      const osTypes = await dependencies.repairOrderService.getOsTypes();
      if (osTypes.length === 0) {
        await ctx.editMessageText(t(ctx.session.locale, 'noOsTypes'));
        return;
      }
      ctx.session.repairDraft = createDraft();
      ctx.session.repairDraft.osTypes = osTypes;
      ctx.session.stage = 'choosing_os';
      await ctx.editMessageText(t(ctx.session.locale, 'chooseOs'), {
        reply_markup: osTypesKeyboard(osTypes, ctx.session.locale),
      });
    } catch (error) {
      dependencies.logger.error('Failed to load OS types', error);
      await ctx.editMessageText(
        t(
          ctx.session.locale,
          error instanceof RepairOrderError && error.code === 'maintenance'
            ? 'maintenance'
            : 'requestUnavailable',
        ),
      );
    }
  });

  bot.callbackQuery('request:decline', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (ctx.session.stage !== 'offering_request' || !ctx.session.unknownClient) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }

    try {
      await saveUnknownClient(ctx, dependencies.unknownClientStore, 'declined_offer');
      ctx.session.stage = 'request_declined';
      await ctx.editMessageText(t(ctx.session.locale, 'requestDeclined'));
    } catch (error) {
      dependencies.logger.error('Failed to persist declined unknown client', error);
      await ctx.editMessageText(t(ctx.session.locale, 'requestUnavailable'));
    }
  });

  bot.callbackQuery(/^os:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const draft = ctx.session.repairDraft;
    const match = /^os:(\d+)$/.exec(ctx.callbackQuery.data);
    const selected = draft && match ? draft.osTypes[Number(match[1])] : undefined;
    if (ctx.session.stage !== 'choosing_os' || !draft || !selected) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }

    try {
      const categories = await dependencies.repairOrderService.getPhoneCategories(selected.id);
      draft.selectedOs = selected;
      draft.categoryPath = [];
      draft.categories = categories;
      draft.categoryPage = 0;
      ctx.session.stage = 'choosing_category';
      await ctx.editMessageText(categoryMessage(draft, ctx.session.locale), {
        reply_markup: categoryKeyboard(
          categories.length,
          0,
          ctx.session.locale,
          CATEGORY_PAGE_SIZE,
        ),
      });
    } catch (error) {
      dependencies.logger.error('Failed to load root phone categories', error);
      await ctx.reply(t(ctx.session.locale, 'requestUnavailable'));
    }
  });

  bot.callbackQuery(/^category-page:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const draft = ctx.session.repairDraft;
    const match = /^category-page:(\d+)$/.exec(ctx.callbackQuery.data);
    const page = match ? Number(match[1]) : -1;
    const maxPage = draft
      ? Math.max(0, Math.ceil(draft.categories.length / CATEGORY_PAGE_SIZE) - 1)
      : 0;
    if (ctx.session.stage !== 'choosing_category' || !draft || page < 0 || page > maxPage) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }

    draft.categoryPage = page;
    await ctx.editMessageText(categoryMessage(draft, ctx.session.locale), {
      reply_markup: categoryKeyboard(
        draft.categories.length,
        page,
        ctx.session.locale,
        CATEGORY_PAGE_SIZE,
      ),
    });
  });

  bot.callbackQuery('category:back', async (ctx) => {
    await ctx.answerCallbackQuery();
    const draft = ctx.session.repairDraft;
    if (ctx.session.stage !== 'choosing_category' || !draft?.selectedOs) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }

    if (draft.categoryPath.length === 0) {
      ctx.session.stage = 'choosing_os';
      await ctx.editMessageText(t(ctx.session.locale, 'chooseOs'), {
        reply_markup: osTypesKeyboard(draft.osTypes, ctx.session.locale),
      });
      return;
    }

    draft.categoryPath.pop();
    const parent = draft.categoryPath.at(-1);
    try {
      draft.categories = await dependencies.repairOrderService.getPhoneCategories(
        draft.selectedOs.id,
        parent?.id,
      );
      draft.categoryPage = 0;
      await ctx.editMessageText(categoryMessage(draft, ctx.session.locale), {
        reply_markup: categoryKeyboard(
          draft.categories.length,
          0,
          ctx.session.locale,
          CATEGORY_PAGE_SIZE,
        ),
      });
    } catch (error) {
      dependencies.logger.error('Failed to navigate back through phone categories', error);
      await ctx.reply(t(ctx.session.locale, 'requestUnavailable'));
    }
  });

  bot.callbackQuery(/^category:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const draft = ctx.session.repairDraft;
    const match = /^category:(\d+)$/.exec(ctx.callbackQuery.data);
    const selected = draft && match ? draft.categories[Number(match[1])] : undefined;
    if (ctx.session.stage !== 'choosing_category' || !draft?.selectedOs || !selected) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }

    try {
      if (selected.has_children) {
        draft.categoryPath.push(selected);
        draft.categories = await dependencies.repairOrderService.getPhoneCategories(
          draft.selectedOs.id,
          selected.id,
        );
        draft.categoryPage = 0;
        await ctx.editMessageText(categoryMessage(draft, ctx.session.locale), {
          reply_markup: categoryKeyboard(
            draft.categories.length,
            0,
            ctx.session.locale,
            CATEGORY_PAGE_SIZE,
          ),
        });
        return;
      }

      draft.selectedCategory = selected;
      draft.problems = await dependencies.repairOrderService.getProblemCategories(selected.id);
      draft.selectedProblemIds = [];
      ctx.session.stage = 'choosing_problems';
      const problemList = formatProblemList(draft.problems, ctx.session.locale);
      await ctx.editMessageText(
        `${t(ctx.session.locale, 'chooseProblems')}\n\n${
          problemList || t(ctx.session.locale, 'emptyProblems')
        }`,
        {
          reply_markup: problemsKeyboard(
            draft.problems,
            draft.selectedProblemIds,
            ctx.session.locale,
          ),
        },
      );
    } catch (error) {
      dependencies.logger.error('Failed to load phone category children or problems', error);
      await ctx.reply(t(ctx.session.locale, 'requestUnavailable'));
    }
  });

  bot.callbackQuery('problem:back', async (ctx) => {
    await ctx.answerCallbackQuery();
    const draft = ctx.session.repairDraft;
    if (ctx.session.stage !== 'choosing_problems' || !draft) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }
    delete draft.selectedCategory;
    draft.problems = [];
    draft.selectedProblemIds = [];
    ctx.session.stage = 'choosing_category';
    await ctx.editMessageText(categoryMessage(draft, ctx.session.locale), {
      reply_markup: categoryKeyboard(
        draft.categories.length,
        draft.categoryPage,
        ctx.session.locale,
        CATEGORY_PAGE_SIZE,
      ),
    });
  });

  bot.callbackQuery('problem:done', async (ctx) => {
    await ctx.answerCallbackQuery();
    const draft = ctx.session.repairDraft;
    if (ctx.session.stage !== 'choosing_problems' || !draft?.selectedCategory) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }

    ctx.session.stage = 'awaiting_note';
    await ctx.editMessageText(
      `${t(ctx.session.locale, 'chooseProblems')}\n\n${
        formatProblemList(draft.problems, ctx.session.locale) ||
        t(ctx.session.locale, 'emptyProblems')
      }`,
    );
    await ctx.reply(t(ctx.session.locale, 'enterNote'), {
      reply_markup: noteKeyboard(ctx.session.locale),
    });
  });

  bot.callbackQuery(/^problem:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const draft = ctx.session.repairDraft;
    const match = /^problem:(\d+)$/.exec(ctx.callbackQuery.data);
    const problem = draft && match ? draft.problems[Number(match[1])] : undefined;
    if (ctx.session.stage !== 'choosing_problems' || !draft || !problem) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }

    draft.selectedProblemIds = draft.selectedProblemIds.includes(problem.id)
      ? draft.selectedProblemIds.filter((id) => id !== problem.id)
      : [...draft.selectedProblemIds, problem.id];
    await ctx.editMessageText(
      `${t(ctx.session.locale, 'chooseProblems')}\n\n${formatProblemList(
        draft.problems,
        ctx.session.locale,
      )}`,
      {
        reply_markup: problemsKeyboard(
          draft.problems,
          draft.selectedProblemIds,
          ctx.session.locale,
        ),
      },
    );
  });

  bot.callbackQuery('confirm:no', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (ctx.session.stage !== 'confirming_request' || !ctx.session.unknownClient) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }

    try {
      await saveUnknownClient(ctx, dependencies.unknownClientStore, 'cancelled_confirmation');
      ctx.session.stage = 'request_declined';
      await ctx.editMessageText(t(ctx.session.locale, 'requestCancelled'));
    } catch (error) {
      dependencies.logger.error('Failed to persist cancelled unknown client', error);
      await ctx.reply(t(ctx.session.locale, 'requestUnavailable'));
    }
  });

  bot.callbackQuery('confirm:yes', async (ctx) => {
    await ctx.answerCallbackQuery();
    const unknown = ctx.session.unknownClient;
    const draft = ctx.session.repairDraft;
    if (
      ctx.session.stage !== 'confirming_request' ||
      !unknown ||
      !draft?.selectedCategory ||
      draft.submitting
    ) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }

    draft.submitting = true;
    await ctx.editMessageText(t(ctx.session.locale, 'submittingRequest'));
    try {
      const result = await dependencies.repairOrderService.createOpenRepairOrder({
        name: fullTelegramName(ctx),
        phone_number: unknown.phoneNumber,
        phone_category: draft.selectedCategory.id,
        description: buildRepairDescription(draft, ctx.session.locale),
      });
      ctx.session.stage = 'request_submitted';
      await ctx.editMessageText(
        t(ctx.session.locale, 'requestCreated', { number: result.number_id }),
      );
    } catch (error) {
      draft.submitting = false;
      dependencies.logger.error('Failed to create public repair order', error);
      const messageKey =
        error instanceof RepairOrderError
          ? error.code === 'rate_limited'
            ? 'requestRateLimited'
            : error.code === 'maintenance'
              ? 'maintenance'
              : 'requestUnavailable'
          : 'requestUnavailable';
      await ctx.editMessageText(
        `${t(ctx.session.locale, messageKey)}\n\n${formatRepairRequestSummary(
          unknown,
          draft,
          ctx.session.locale,
        )}`,
        {
          parse_mode: 'HTML',
          reply_markup: confirmationKeyboard(ctx.session.locale),
        },
      );
    }
  });

  bot.hears([t('uz', 'orders'), t('ru', 'orders')], async (ctx) => {
    const client = ctx.session.client;
    if (!client) {
      await ctx.reply(t(ctx.session.locale, 'registerFirst'), {
        reply_markup: languageKeyboard(),
      });
      return;
    }
    await ctx.reply(
      client.repair_orders.length > 0
        ? formatRepairOrders(client.repair_orders, ctx.session.locale)
        : t(ctx.session.locale, 'noOrders'),
      { parse_mode: 'HTML', reply_markup: mainKeyboard(ctx.session.locale) },
    );
  });

  bot.on('message:text', async (ctx) => {
    if (ctx.session.stage === 'awaiting_note') {
      await acceptNote(
        ctx,
        ctx.message.text === t(ctx.session.locale, 'skipNote') ? '' : ctx.message.text,
      );
      return;
    }

    if (canRegisterWithManualPhone(ctx.session, dependencies.allowManualPhoneEntry)) {
      await registerByPhone(ctx, dependencies, ctx.message.text);
      return;
    }

    await ctx.reply(t(ctx.session.locale, ctx.session.client ? 'help' : 'phoneOnly'), {
      reply_markup: ctx.session.client
        ? mainKeyboard(ctx.session.locale)
        : ctx.session.stage === 'awaiting_phone'
          ? registrationKeyboard(ctx.session.locale)
          : languageKeyboard(),
    });
  });

  bot.catch((error) => {
    const cause = error.error;
    if (cause instanceof GrammyError) {
      dependencies.logger.error(`Telegram API error: ${cause.description}`, cause);
    } else if (cause instanceof HttpError) {
      dependencies.logger.error('Telegram network error', cause);
    } else {
      dependencies.logger.error('Unhandled bot update error', cause);
    }
  });

  return bot;
};
