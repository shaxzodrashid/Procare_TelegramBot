import { Bot, GrammyError, HttpError, session } from 'grammy';
import type { RawApi, Transformer } from 'grammy';
import type { BotCommand } from 'grammy/types';

import type { ClientRegistrationGateway } from '../services/client-registration.service.js';
import { RegistrationError } from '../services/client-registration.service.js';
import type { ClientRepairOrderGateway } from '../services/client-repair-order.service.js';
import { ClientRepairOrderError } from '../services/client-repair-order.service.js';
import type { MessageTemplateStore } from '../services/message-template.service.js';
import type { RegisteredUserStore } from '../services/registered-user.store.js';
import type { RepairOrderGateway } from '../services/repair-order.service.js';
import { RepairOrderError } from '../services/repair-order.service.js';
import type { UnknownClientStore } from '../services/unknown-client.store.js';
import type { AdminProfile, Locale, RegistrationResult } from '../types/client.js';
import type {
  MessageTemplate,
  MessageTemplateDraft,
  MessageTemplateField,
  MessageTemplateType,
} from '../types/message-template.js';
import { isMessageTemplateType, MESSAGE_TEMPLATE_TYPES } from '../types/message-template.js';
import { localizedCatalogName } from '../types/repair-order.js';
import type { UnknownClientDeclineReason } from '../types/unknown-client.js';
import { escapeHtml } from '../utils/html.js';
import {
  redactPhoneNumber,
  redactPhoneNumbersInText,
  summarizeText,
  summarizeUnknownPayload,
} from '../utils/log-redaction.js';
import type { Logger } from '../utils/logger.js';
import { normalizeUzPhone } from '../utils/phone.js';
import type { BotContext, BotSession, RegistrationStage, RepairRequestDraft } from './context.js';
import {
  buildRepairDescription,
  formatCategoryPage,
  formatClientRepairOrderDetail,
  formatClientRepairOrderList,
  formatProblemList,
  formatRepairRequestSummary,
} from './formatters.js';
import {
  categoryKeyboard,
  adminTemplateCancelKeyboard,
  adminTemplateDetailKeyboard,
  adminTemplateListKeyboard,
  confirmationKeyboard,
  languageKeyboard,
  noteKeyboard,
  osTypesKeyboard,
  personalMenuKeyboard,
  problemsKeyboard,
  registrationKeyboard,
  repairOrderDetailKeyboard,
  repairOrdersKeyboard,
  requestOfferKeyboard,
  settingsBackKeyboard,
  settingsKeyboard,
  settingsLanguageKeyboard,
  settingsPhoneKeyboard,
} from './keyboards.js';
import { t } from './messages.js';
import { replySmart } from './rich-messages.js';

export interface BotDependencies {
  registrationService: ClientRegistrationGateway;
  repairOrderService: RepairOrderGateway;
  clientRepairOrderService: ClientRepairOrderGateway;
  unknownClientStore: UnknownClientStore;
  registeredUserStore: RegisteredUserStore;
  messageTemplateStore: MessageTemplateStore;
  logger: Logger;
  allowManualPhoneEntry: boolean;
  richMessagesEnabled: boolean;
}

const CATEGORY_PAGE_SIZE = 10;
const REPAIR_ORDERS_PAGE_SIZE = 10;

export type RegistrationAccountKind = 'client' | 'employee';

export const registrationAccountKind = (
  registration: RegistrationResult,
): RegistrationAccountKind => (registration.is_admin ? 'employee' : 'client');

const initialSession = (): BotSession => ({ locale: 'uz', stage: 'choosing_language' });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';

const summarizeSession = (sessionData: BotSession): Record<string, unknown> => ({
  locale: sessionData.locale,
  stage: sessionData.stage ?? 'registered',
  client: sessionData.client
    ? {
        client_id: sessionData.client.client_id,
        has_repair_orders: sessionData.client.has_repair_orders,
      }
    : undefined,
  admin: sessionData.admin
    ? {
        id: sessionData.admin.id,
        status: sessionData.admin.status,
        is_active: sessionData.admin.is_active,
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
  adminTemplateInput: sessionData.adminTemplateInput
    ? {
        mode: sessionData.adminTemplateInput.mode,
        field: sessionData.adminTemplateInput.field,
        templateId: sessionData.adminTemplateInput.templateId,
        draftKeys: sessionData.adminTemplateInput.draft
          ? Object.keys(sessionData.adminTemplateInput.draft)
          : undefined,
      }
    : undefined,
  repairOrdersView: sessionData.repairOrdersView
    ? {
        offset: sessionData.repairOrdersView.offset,
        orderNumbers: sessionData.repairOrdersView.orderNumbers,
        selectedOrderNumber: sessionData.repairOrdersView.selectedOrderNumber,
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
    } else if (key === 'rich_message' && isRecord(value)) {
      summary[key] = {
        html: summarizeText(typeof value.html === 'string' ? value.html : undefined),
        markdown: summarizeText(typeof value.markdown === 'string' ? value.markdown : undefined),
      };
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

const clearAdminTemplateFlow = (sessionData: BotSession): void => {
  delete sessionData.adminTemplateInput;
  if (sessionData.stage === 'admin_template_input') delete sessionData.stage;
};

const settingsStages = new Set<RegistrationStage>([
  'settings',
  'settings_awaiting_name',
  'settings_awaiting_phone',
  'settings_choosing_language',
]);

const clearSettingsFlow = (sessionData: BotSession): void => {
  if (sessionData.stage && settingsStages.has(sessionData.stage)) delete sessionData.stage;
};

const resetSession = (sessionData: BotSession, locale: Locale): void => {
  delete sessionData.client;
  delete sessionData.admin;
  delete sessionData.repairOrdersView;
  clearUnknownFlow(sessionData);
  clearAdminTemplateFlow(sessionData);
  clearSettingsFlow(sessionData);
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

const adminDisplayName = (ctx: BotContext): string =>
  ctx.session.admin?.first_name || ctx.from?.first_name || 'Procare';

export interface SettingsName {
  firstName: string;
  lastName: string | null;
  fullName: string;
}

export const parseSettingsName = (value: string): SettingsName | null => {
  const fullName = value.trim().replace(/\s+/g, ' ');
  if (fullName.length < 2 || fullName.length > 120 || !/[\p{L}\p{N}]/u.test(fullName)) {
    return null;
  }

  const [firstName, ...rest] = fullName.split(' ');
  if (!firstName) return null;

  return {
    firstName,
    lastName: rest.length > 0 ? rest.join(' ') : null,
    fullName,
  };
};

const hasRegisteredProfile = (sessionData: BotSession): boolean =>
  Boolean(sessionData.client || sessionData.admin);

const currentReplyKeyboard = (sessionData: BotSession) =>
  sessionData.stage === 'settings'
    ? settingsKeyboard(sessionData.locale)
    : sessionData.stage === 'settings_awaiting_name'
      ? settingsBackKeyboard(sessionData.locale)
      : sessionData.stage === 'settings_awaiting_phone'
        ? settingsPhoneKeyboard(sessionData.locale)
        : sessionData.stage === 'settings_choosing_language'
          ? settingsLanguageKeyboard(sessionData.locale)
          : sessionData.client || sessionData.admin
            ? personalMenuKeyboard(sessionData)
            : sessionData.stage === 'awaiting_phone'
              ? registrationKeyboard(sessionData.locale)
              : languageKeyboard();

const showSettingsMenu = async (ctx: BotContext): Promise<void> => {
  clearUnknownFlow(ctx.session);
  clearAdminTemplateFlow(ctx.session);
  ctx.session.stage = 'settings';
  await ctx.reply(t(ctx.session.locale, 'settingsTitle'), {
    reply_markup: settingsKeyboard(ctx.session.locale),
  });
};

const updateSessionName = (sessionData: BotSession, name: SettingsName): void => {
  if (sessionData.client) {
    sessionData.client.first_name = name.firstName;
    sessionData.client.last_name = name.lastName;
  }
  if (sessionData.admin) {
    sessionData.admin.first_name = name.firstName;
    sessionData.admin.last_name = name.lastName;
  }
};

const updateSessionLanguage = (sessionData: BotSession, locale: Locale): void => {
  sessionData.locale = locale;
  if (sessionData.client) sessionData.client.language = locale;
  if (sessionData.admin) sessionData.admin.language = locale;
};

const replyWithAdminRegistration = async (ctx: BotContext): Promise<void> => {
  await ctx.reply(
    t(ctx.session.locale, 'adminRegistered', {
      name: adminDisplayName(ctx),
    }),
    { reply_markup: personalMenuKeyboard(ctx.session) },
  );
};

const categoryMessage = (draft: RepairRequestDraft, locale: Locale): string => {
  const path = draft.categoryPath.map((item) => localizedCatalogName(item, locale)).join(' → ');
  const list = formatCategoryPage(draft.categories, draft.categoryPage, locale, CATEGORY_PAGE_SIZE);
  return [
    t(locale, 'chooseCategory'),
    path ? `\n${path}` : '',
    `\n${list || t(locale, 'noCategories')}`,
  ].join('');
};

const templateFieldByCode = (code: string): MessageTemplateField | null => {
  switch (code) {
    case 'k':
      return 'template_key';
    case 'tp':
      return 'template_type';
    case 'ti':
      return 'title';
    case 'uz':
      return 'content_uz';
    case 'ru':
      return 'content_ru';
    default:
      return null;
  }
};

const adminTemplatePrompt = (locale: Locale, field: MessageTemplateField): string => {
  switch (field) {
    case 'template_key':
      return t(locale, 'adminTemplatePromptKey');
    case 'template_type':
      return t(locale, 'adminTemplatePromptType', {
        types: MESSAGE_TEMPLATE_TYPES.join(', '),
      });
    case 'title':
      return t(locale, 'adminTemplatePromptTitle');
    case 'content_uz':
      return t(locale, 'adminTemplatePromptUz');
    case 'content_ru':
      return t(locale, 'adminTemplatePromptRu');
  }
};

const validateTemplateField = (
  field: MessageTemplateField,
  value: string,
): string | MessageTemplateType | null => {
  const trimmed = value.trim();
  switch (field) {
    case 'template_key':
      return /^[a-z][a-z0-9_:-]{1,119}$/.test(trimmed) ? trimmed : null;
    case 'template_type':
      return isMessageTemplateType(trimmed) ? trimmed : null;
    case 'title':
      return trimmed.length > 0 && trimmed.length <= 255 ? trimmed : null;
    case 'content_uz':
    case 'content_ru':
      return trimmed.length > 0 && trimmed.length <= 10_000 ? trimmed : null;
  }
};

const nextCreateTemplateField = (draft: MessageTemplateDraft): MessageTemplateField | null => {
  if (!draft.template_key) return 'template_key';
  if (!draft.template_type) return 'template_type';
  if (!draft.title) return 'title';
  if (!draft.content_uz) return 'content_uz';
  if (!draft.content_ru) return 'content_ru';
  return null;
};

const completeTemplateDraft = (draft: MessageTemplateDraft) => {
  if (
    !draft.template_key ||
    !draft.template_type ||
    !draft.title ||
    !draft.content_uz ||
    !draft.content_ru
  ) {
    return null;
  }

  return {
    template_key: draft.template_key,
    template_type: draft.template_type,
    title: draft.title,
    content_uz: draft.content_uz,
    content_ru: draft.content_ru,
  };
};

const formatTemplateList = (templates: MessageTemplate[], locale: Locale): string => {
  const rows = templates.map(
    (template) =>
      `${template.is_active ? '●' : '○'} ${escapeHtml(template.title)}\n` +
      `<code>${escapeHtml(template.template_key)}</code> · ${escapeHtml(template.template_type)}`,
  );

  return [
    `<b>${escapeHtml(t(locale, 'adminTemplatesTitle'))}</b>`,
    '',
    rows.length > 0 ? rows.join('\n\n') : escapeHtml(t(locale, 'adminTemplatesEmpty')),
  ].join('\n');
};

const formatTemplateDetail = (template: MessageTemplate): string =>
  [
    `<b>${escapeHtml(template.title)}</b>`,
    '',
    `<b>Key:</b> <code>${escapeHtml(template.template_key)}</code>`,
    `<b>Type:</b> ${escapeHtml(template.template_type)}`,
    `<b>Status:</b> ${template.is_active ? 'active' : 'inactive'}`,
    '',
    '<b>UZ:</b>',
    escapeHtml(template.content_uz),
    '',
    '<b>RU:</b>',
    escapeHtml(template.content_ru),
  ].join('\n');

const requireAdmin = async (ctx: BotContext): Promise<boolean> => {
  if (ctx.session.admin) return true;
  await ctx.reply(t(ctx.session.locale, 'staleAction'));
  return false;
};

const showAdminTemplateList = async (
  ctx: BotContext,
  store: MessageTemplateStore,
): Promise<void> => {
  const templates = await store.listTemplates();
  await ctx.reply(formatTemplateList(templates, ctx.session.locale), {
    parse_mode: 'HTML',
    reply_markup: adminTemplateListKeyboard(templates, ctx.session.locale),
  });
};

const showAdminTemplateDetail = async (
  ctx: BotContext,
  store: MessageTemplateStore,
  templateId: string,
): Promise<void> => {
  const template = await store.findTemplateById(templateId);
  if (!template) {
    await ctx.reply(t(ctx.session.locale, 'adminTemplateNotFound'));
    return;
  }

  await ctx.reply(formatTemplateDetail(template), {
    parse_mode: 'HTML',
    reply_markup: adminTemplateDetailKeyboard(template, ctx.session.locale),
  });
};

const promptTemplateInput = async (ctx: BotContext): Promise<void> => {
  const input = ctx.session.adminTemplateInput;
  if (!input) return;

  await ctx.reply(adminTemplatePrompt(ctx.session.locale, input.field), {
    reply_markup: adminTemplateCancelKeyboard(ctx.session.locale),
  });
};

const startTemplateCreate = async (ctx: BotContext): Promise<void> => {
  ctx.session.adminTemplateInput = {
    mode: 'create',
    field: 'template_key',
    draft: {},
  };
  ctx.session.stage = 'admin_template_input';
  await promptTemplateInput(ctx);
};

const startTemplateEdit = async (
  ctx: BotContext,
  templateId: string,
  field: MessageTemplateField,
): Promise<void> => {
  ctx.session.adminTemplateInput = {
    mode: 'edit',
    templateId,
    field,
  };
  ctx.session.stage = 'admin_template_input';
  await promptTemplateInput(ctx);
};

const handleAdminTemplateInput = async (
  ctx: BotContext,
  store: MessageTemplateStore,
  logger: Logger,
  text: string,
): Promise<void> => {
  const input = ctx.session.adminTemplateInput;
  if (!input || ctx.session.stage !== 'admin_template_input') {
    await ctx.reply(t(ctx.session.locale, 'staleAction'));
    return;
  }

  if (text.trim() === t(ctx.session.locale, 'adminTemplateCancel')) {
    clearAdminTemplateFlow(ctx.session);
    await ctx.reply(t(ctx.session.locale, 'adminTemplateCancelled'), {
      reply_markup: personalMenuKeyboard(ctx.session),
    });
    return;
  }

  const value = validateTemplateField(input.field, text);
  if (value === null) {
    await ctx.reply(t(ctx.session.locale, 'adminTemplateInvalidValue'), {
      reply_markup: adminTemplateCancelKeyboard(ctx.session.locale),
    });
    await promptTemplateInput(ctx);
    return;
  }

  try {
    if (input.mode === 'edit') {
      if (!input.templateId) {
        clearAdminTemplateFlow(ctx.session);
        await ctx.reply(t(ctx.session.locale, 'staleAction'));
        return;
      }
      const updated = await store.updateTemplate(input.templateId, { [input.field]: value });
      clearAdminTemplateFlow(ctx.session);
      if (!updated) {
        await ctx.reply(t(ctx.session.locale, 'adminTemplateNotFound'), {
          reply_markup: personalMenuKeyboard(ctx.session),
        });
        return;
      }
      await ctx.reply(t(ctx.session.locale, 'adminTemplateUpdated'), {
        reply_markup: personalMenuKeyboard(ctx.session),
      });
      await showAdminTemplateDetail(ctx, store, updated.id);
      return;
    }

    const draft = { ...(input.draft ?? {}), [input.field]: value } as MessageTemplateDraft;
    const nextField = nextCreateTemplateField(draft);
    if (nextField) {
      ctx.session.adminTemplateInput = {
        mode: 'create',
        field: nextField,
        draft,
      };
      await promptTemplateInput(ctx);
      return;
    }

    const completeDraft = completeTemplateDraft(draft);
    if (!completeDraft) {
      clearAdminTemplateFlow(ctx.session);
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }

    const created = await store.createTemplate(completeDraft);
    clearAdminTemplateFlow(ctx.session);
    await ctx.reply(t(ctx.session.locale, 'adminTemplateSaved'), {
      reply_markup: personalMenuKeyboard(ctx.session),
    });
    await showAdminTemplateDetail(ctx, store, created.id);
  } catch (error) {
    logger.error('Failed to process admin template input', error);
    await ctx.reply(t(ctx.session.locale, 'adminTemplateUnavailable'), {
      reply_markup: personalMenuKeyboard(ctx.session),
    });
  }
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

const registrationAdminProfile = (registration: RegistrationResult): AdminProfile | null =>
  registration.account_type === 'admin' ? registration.admin : registration.admin;

const saveRegisteredUser = async (
  ctx: BotContext,
  store: RegisteredUserStore,
  registration: RegistrationResult,
  phoneNumber: string,
): Promise<void> => {
  if (!ctx.from) return;

  const user = {
    telegram_id: String(ctx.from.id),
    telegram_username: ctx.from.username ?? null,
    first_name: ctx.from.first_name,
    last_name: ctx.from.last_name ?? null,
    phone_number: phoneNumber,
    locale: ctx.session.locale,
  };

  if (registrationAccountKind(registration) === 'employee') {
    const admin = registrationAdminProfile(registration);
    if (!admin) throw new Error('CRM marked registration as admin without an admin profile');

    await store.saveEmployee({
      ...user,
      crm_admin_id: admin.id,
      status: admin.status,
      is_active: admin.is_active,
    });
    return;
  }

  if (registration.account_type !== 'client') {
    throw new Error('CRM returned a non-client registration without admin privileges');
  }

  await store.saveClient({
    ...user,
    crm_client_id: registration.client_id,
    customer_code: null,
    status: 'Open',
    is_active: true,
  });
};

const updateRegisteredLanguage = async (
  ctx: BotContext,
  dependencies: BotDependencies,
  locale: Locale,
): Promise<void> => {
  if (!ctx.from || !hasRegisteredProfile(ctx.session)) {
    updateSessionLanguage(ctx.session, locale);
    return;
  }

  await dependencies.registeredUserStore.updateSettings({
    telegram_id: String(ctx.from.id),
    telegram_username: ctx.from.username ?? null,
    locale,
  });
  updateSessionLanguage(ctx.session, locale);
};

const handleSettingsNameInput = async (
  ctx: BotContext,
  dependencies: BotDependencies,
  text: string,
): Promise<void> => {
  if (!ctx.from || !hasRegisteredProfile(ctx.session)) {
    await ctx.reply(t(ctx.session.locale, 'registerFirst'), {
      reply_markup: languageKeyboard(),
    });
    return;
  }

  const name = parseSettingsName(text);
  if (!name) {
    await ctx.reply(t(ctx.session.locale, 'settingsNameInvalid'), {
      reply_markup: settingsBackKeyboard(ctx.session.locale),
    });
    return;
  }

  try {
    await dependencies.registeredUserStore.updateSettings({
      telegram_id: String(ctx.from.id),
      telegram_username: ctx.from.username ?? null,
      first_name: name.firstName,
      last_name: name.lastName,
    });
    updateSessionName(ctx.session, name);
    clearSettingsFlow(ctx.session);
    await ctx.reply(t(ctx.session.locale, 'settingsNameUpdated', { name: name.fullName }), {
      reply_markup: personalMenuKeyboard(ctx.session),
    });
  } catch (error) {
    dependencies.logger.error('Failed to update Telegram user name settings', error);
    await ctx.reply(t(ctx.session.locale, 'settingsUnavailable'), {
      reply_markup: currentReplyKeyboard(ctx.session),
    });
  }
};

export const canRegisterWithManualPhone = (
  sessionData: BotSession,
  allowManualPhoneEntry: boolean,
): boolean =>
  allowManualPhoneEntry &&
  sessionData.stage === 'awaiting_phone' &&
  !sessionData.client &&
  !sessionData.admin;

const registerByPhone = async (
  ctx: BotContext,
  dependencies: BotDependencies,
  phoneNumber: string,
  mode: 'registration' | 'settings_phone' = 'registration',
): Promise<void> => {
  if (!ctx.from || !ctx.chat) return;

  const replyKeyboard =
    mode === 'settings_phone'
      ? settingsPhoneKeyboard(ctx.session.locale)
      : registrationKeyboard(ctx.session.locale);

  const normalizedPhone = normalizeUzPhone(phoneNumber);
  if (!normalizedPhone) {
    await ctx.reply(t(ctx.session.locale, 'invalidPhone'), {
      reply_markup: replyKeyboard,
    });
    return;
  }

  const pendingMessage = await ctx.reply(t(ctx.session.locale, 'registering'));
  try {
    const registration = await dependencies.registrationService.registerByPhone(normalizedPhone);
    await saveRegisteredUser(ctx, dependencies.registeredUserStore, registration, normalizedPhone);
    delete ctx.session.client;
    delete ctx.session.admin;
    delete ctx.session.repairOrdersView;
    clearUnknownFlow(ctx.session);
    if (mode === 'settings_phone') clearSettingsFlow(ctx.session);
    else delete ctx.session.stage;
    await ctx.api.deleteMessage(ctx.chat.id, pendingMessage.message_id).catch(() => undefined);

    if (registrationAccountKind(registration) === 'employee') {
      const admin = registrationAdminProfile(registration);
      if (!admin) throw new Error('CRM marked registration as admin without an admin profile');
      ctx.session.admin = admin;
      if (mode === 'settings_phone') {
        await ctx.reply(t(ctx.session.locale, 'settingsPhoneUpdated'), {
          reply_markup: personalMenuKeyboard(ctx.session),
        });
        return;
      }
      await replyWithAdminRegistration(ctx);
      return;
    }

    if (registration.account_type !== 'client') {
      throw new Error('CRM returned a non-client registration without admin privileges');
    }

    ctx.session.client = registration;
    if (mode === 'settings_phone') {
      await ctx.reply(t(ctx.session.locale, 'settingsPhoneUpdated'), {
        reply_markup: personalMenuKeyboard(ctx.session),
      });
      return;
    }
    await ctx.reply(
      t(ctx.session.locale, 'registered', {
        name: registration.first_name || ctx.from.first_name,
      }),
      { reply_markup: personalMenuKeyboard(ctx.session) },
    );
  } catch (error) {
    await ctx.api.deleteMessage(ctx.chat.id, pendingMessage.message_id).catch(() => undefined);
    if (error instanceof RegistrationError && error.code === 'not_found') {
      if (mode === 'settings_phone') {
        await ctx.reply(t(ctx.session.locale, 'settingsPhoneNotFound'), {
          reply_markup: settingsPhoneKeyboard(ctx.session.locale),
        });
        return;
      }

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
      reply_markup: replyKeyboard,
    });
  }
};

const safeHttpUrl = (value: string | null | undefined): string | null => {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
};

const showClientRepairOrders = async (
  ctx: BotContext,
  dependencies: BotDependencies,
  offset: number,
  showLoading = false,
): Promise<void> => {
  const client = ctx.session.client;
  if (!client) {
    await ctx.reply(t(ctx.session.locale, 'registerFirst'), {
      reply_markup: languageKeyboard(),
    });
    return;
  }

  const pendingMessage =
    showLoading && ctx.chat ? await ctx.reply(t(ctx.session.locale, 'ordersLoading')) : undefined;
  try {
    const result = await dependencies.clientRepairOrderService.listClientRepairOrders(
      client.client_id,
      {
        limit: REPAIR_ORDERS_PAGE_SIZE,
        offset,
      },
    );
    if (pendingMessage && ctx.chat) {
      await ctx.api.deleteMessage(ctx.chat.id, pendingMessage.message_id).catch(() => undefined);
    }

    if (result.orders.length === 0) {
      ctx.session.repairOrdersView = { offset: result.pagination.offset, orderNumbers: [] };
      await ctx.reply(t(ctx.session.locale, 'noOrders'), {
        reply_markup: personalMenuKeyboard(ctx.session),
      });
      return;
    }

    const orderNumbers = result.orders.map((order) => order.order_number);
    ctx.session.repairOrdersView = {
      offset: result.pagination.offset,
      orderNumbers,
    };
    await replySmart(ctx, formatClientRepairOrderList(result, ctx.session.locale), {
      enabled: dependencies.richMessagesEnabled,
      logger: dependencies.logger,
      replyMarkup: repairOrdersKeyboard(orderNumbers, result.pagination, ctx.session.locale),
    });
  } catch (error) {
    if (pendingMessage && ctx.chat) {
      await ctx.api.deleteMessage(ctx.chat.id, pendingMessage.message_id).catch(() => undefined);
    }
    dependencies.logger.error('Failed to load client repair orders', error);
    await ctx.reply(t(ctx.session.locale, 'ordersUnavailable'), {
      reply_markup: personalMenuKeyboard(ctx.session),
    });
  }
};

const showClientRepairOrderDetail = async (
  ctx: BotContext,
  dependencies: BotDependencies,
  orderNumber: string,
): Promise<void> => {
  const client = ctx.session.client;
  if (!client) {
    await ctx.reply(t(ctx.session.locale, 'registerFirst'), {
      reply_markup: languageKeyboard(),
    });
    return;
  }

  try {
    const order = await dependencies.clientRepairOrderService.getClientRepairOrder(
      client.client_id,
      orderNumber,
    );
    ctx.session.repairOrdersView ??= { offset: 0, orderNumbers: [] };
    ctx.session.repairOrdersView.selectedOrderNumber = order.order_number;
    await replySmart(ctx, formatClientRepairOrderDetail(order, ctx.session.locale), {
      enabled: dependencies.richMessagesEnabled,
      logger: dependencies.logger,
      replyMarkup: repairOrderDetailKeyboard(ctx.session.locale, {
        mapUrl: safeHttpUrl(order.branch?.map_url),
      }),
    });
  } catch (error) {
    if (error instanceof ClientRepairOrderError && error.code === 'not_found') {
      await ctx.reply(t(ctx.session.locale, 'orderNotFound'));
      return;
    }
    dependencies.logger.error('Failed to load client repair-order detail', error);
    await ctx.reply(t(ctx.session.locale, 'ordersUnavailable'));
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
    if (ctx.from) {
      await dependencies.messageTemplateStore
        .setUserBlocked(String(ctx.from.id), false)
        .catch((error: unknown) =>
          dependencies.logger.warn('Failed to clear Telegram blocked flag on /start', error),
        );
    }

    if (ctx.session.client) {
      await ctx.reply(
        t(ctx.session.locale, 'registered', {
          name: ctx.session.client.first_name || ctx.from?.first_name || 'Procare',
        }),
        { reply_markup: personalMenuKeyboard(ctx.session) },
      );
      return;
    }
    if (ctx.session.admin) {
      await replyWithAdminRegistration(ctx);
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
      reply_markup: currentReplyKeyboard(ctx.session),
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
        reply_markup: currentReplyKeyboard(ctx.session),
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

    const locale = text === t('ru', 'russian') ? 'ru' : 'uz';
    if (hasRegisteredProfile(ctx.session)) {
      try {
        const wasChoosingSettingsLanguage = ctx.session.stage === 'settings_choosing_language';
        await updateRegisteredLanguage(ctx, dependencies, locale);
        clearSettingsFlow(ctx.session);
        await ctx.reply(
          wasChoosingSettingsLanguage
            ? t(ctx.session.locale, 'settingsLanguageUpdated')
            : ctx.session.client
              ? t(ctx.session.locale, 'registered', {
                  name: ctx.session.client.first_name || ctx.from?.first_name || 'Procare',
                })
              : t(ctx.session.locale, 'adminRegistered', {
                  name: adminDisplayName(ctx),
                }),
          { reply_markup: personalMenuKeyboard(ctx.session) },
        );
      } catch (error) {
        dependencies.logger.error('Failed to update Telegram user language settings', error);
        await ctx.reply(t(ctx.session.locale, 'settingsUnavailable'), {
          reply_markup: currentReplyKeyboard(ctx.session),
        });
      }
      return;
    }

    ctx.session.locale = locale;
    ctx.session.stage = 'awaiting_phone';
    await ctx.reply(t(ctx.session.locale, 'welcome'), {
      reply_markup: registrationKeyboard(ctx.session.locale),
    });
  });

  bot.on('message:contact', async (ctx) => {
    const acceptsInitialPhone =
      ctx.session.stage === 'awaiting_phone' && !ctx.session.client && !ctx.session.admin;
    const acceptsSettingsPhone =
      ctx.session.stage === 'settings_awaiting_phone' && hasRegisteredProfile(ctx.session);

    if (!acceptsInitialPhone && !acceptsSettingsPhone) {
      if (ctx.session.admin) {
        await replyWithAdminRegistration(ctx);
        return;
      }
      await ctx.reply(t(ctx.session.locale, ctx.session.client ? 'help' : 'chooseLanguage'), {
        reply_markup: currentReplyKeyboard(ctx.session),
      });
      return;
    }

    if (ctx.session.admin && !acceptsSettingsPhone) {
      await replyWithAdminRegistration(ctx);
      return;
    }

    const contact = ctx.message.contact;
    if (contact.user_id !== ctx.from.id) {
      await ctx.reply(t(ctx.session.locale, 'phoneOnly'), {
        reply_markup: acceptsSettingsPhone
          ? settingsPhoneKeyboard(ctx.session.locale)
          : registrationKeyboard(ctx.session.locale),
      });
      return;
    }

    await registerByPhone(
      ctx,
      dependencies,
      contact.phone_number,
      acceptsSettingsPhone ? 'settings_phone' : 'registration',
    );
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

  bot.hears([t('uz', 'settings'), t('ru', 'settings')], async (ctx) => {
    if (!hasRegisteredProfile(ctx.session)) {
      await ctx.reply(t(ctx.session.locale, 'registerFirst'), {
        reply_markup: languageKeyboard(),
      });
      return;
    }

    await showSettingsMenu(ctx);
  });

  bot.hears([t('uz', 'settingsBack'), t('ru', 'settingsBack')], async (ctx) => {
    if (!hasRegisteredProfile(ctx.session)) {
      await ctx.reply(t(ctx.session.locale, 'registerFirst'), {
        reply_markup: languageKeyboard(),
      });
      return;
    }

    clearSettingsFlow(ctx.session);
    await ctx.reply(t(ctx.session.locale, 'help'), {
      reply_markup: personalMenuKeyboard(ctx.session),
    });
  });

  bot.hears([t('uz', 'settingsName'), t('ru', 'settingsName')], async (ctx) => {
    if (!hasRegisteredProfile(ctx.session)) {
      await ctx.reply(t(ctx.session.locale, 'registerFirst'), {
        reply_markup: languageKeyboard(),
      });
      return;
    }

    ctx.session.stage = 'settings_awaiting_name';
    await ctx.reply(t(ctx.session.locale, 'settingsNamePrompt'), {
      reply_markup: settingsBackKeyboard(ctx.session.locale),
    });
  });

  bot.hears([t('uz', 'settingsPhone'), t('ru', 'settingsPhone')], async (ctx) => {
    if (!hasRegisteredProfile(ctx.session)) {
      await ctx.reply(t(ctx.session.locale, 'registerFirst'), {
        reply_markup: languageKeyboard(),
      });
      return;
    }

    ctx.session.stage = 'settings_awaiting_phone';
    await ctx.reply(t(ctx.session.locale, 'settingsPhonePrompt'), {
      reply_markup: settingsPhoneKeyboard(ctx.session.locale),
    });
  });

  bot.hears([t('uz', 'settingsLanguage'), t('ru', 'settingsLanguage')], async (ctx) => {
    if (!hasRegisteredProfile(ctx.session)) {
      await ctx.reply(t(ctx.session.locale, 'registerFirst'), {
        reply_markup: languageKeyboard(),
      });
      return;
    }

    ctx.session.stage = 'settings_choosing_language';
    await ctx.reply(t(ctx.session.locale, 'settingsLanguagePrompt'), {
      reply_markup: settingsLanguageKeyboard(ctx.session.locale),
    });
  });

  bot.hears([t('uz', 'orders'), t('ru', 'orders')], async (ctx) => {
    if (!ctx.session.client) {
      if (ctx.session.admin) {
        await replyWithAdminRegistration(ctx);
      } else {
        await ctx.reply(t(ctx.session.locale, 'registerFirst'), {
          reply_markup: languageKeyboard(),
        });
      }
      return;
    }
    await showClientRepairOrders(ctx, dependencies, 0, true);
  });

  bot.callbackQuery(/^ro:p:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const match = /^ro:p:(\d+)$/.exec(ctx.callbackQuery.data);
    const offset = match?.[1] ? Number(match[1]) : Number.NaN;
    if (!Number.isSafeInteger(offset) || offset < 0 || !ctx.session.client) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }
    await showClientRepairOrders(ctx, dependencies, offset);
  });

  bot.callbackQuery(/^ro:v:(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const match = /^ro:v:(\d+):(\d+)$/.exec(ctx.callbackQuery.data);
    const offset = match?.[1] ? Number(match[1]) : Number.NaN;
    const index = match?.[2] ? Number(match[2]) : Number.NaN;
    const currentView = ctx.session.repairOrdersView;
    const orderNumber =
      Number.isSafeInteger(offset) &&
      offset >= 0 &&
      Number.isSafeInteger(index) &&
      index >= 0 &&
      currentView?.offset === offset
        ? currentView.orderNumbers[index]
        : undefined;
    if (!orderNumber || !ctx.session.client) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }
    await showClientRepairOrderDetail(ctx, dependencies, orderNumber);
  });

  bot.callbackQuery('ro:r', async (ctx) => {
    await ctx.answerCallbackQuery();
    const orderNumber = ctx.session.repairOrdersView?.selectedOrderNumber;
    if (!orderNumber || !ctx.session.client) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }
    await showClientRepairOrderDetail(ctx, dependencies, orderNumber);
  });

  bot.callbackQuery('ro:b', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.session.client) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }
    await showClientRepairOrders(ctx, dependencies, ctx.session.repairOrdersView?.offset ?? 0);
  });

  bot.hears([t('uz', 'adminTemplates'), t('ru', 'adminTemplates')], async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    try {
      clearAdminTemplateFlow(ctx.session);
      await showAdminTemplateList(ctx, dependencies.messageTemplateStore);
    } catch (error) {
      dependencies.logger.error('Failed to show admin template list', error);
      await ctx.reply(t(ctx.session.locale, 'adminTemplateUnavailable'), {
        reply_markup: personalMenuKeyboard(ctx.session),
      });
    }
  });

  bot.callbackQuery('tmpl:l', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireAdmin(ctx))) return;
    try {
      clearAdminTemplateFlow(ctx.session);
      await showAdminTemplateList(ctx, dependencies.messageTemplateStore);
    } catch (error) {
      dependencies.logger.error('Failed to show admin template list', error);
      await ctx.reply(t(ctx.session.locale, 'adminTemplateUnavailable'));
    }
  });

  bot.callbackQuery('tmpl:c', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireAdmin(ctx))) return;
    await startTemplateCreate(ctx);
  });

  bot.callbackQuery(/^tmpl:v:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireAdmin(ctx))) return;
    const match = /^tmpl:v:(\d+)$/.exec(ctx.callbackQuery.data);
    if (!match?.[1]) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }
    try {
      await showAdminTemplateDetail(ctx, dependencies.messageTemplateStore, match[1]);
    } catch (error) {
      dependencies.logger.error('Failed to show admin template detail', error);
      await ctx.reply(t(ctx.session.locale, 'adminTemplateUnavailable'));
    }
  });

  bot.callbackQuery(/^tmpl:e:(\d+):(k|tp|ti|uz|ru)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireAdmin(ctx))) return;
    const match = /^tmpl:e:(\d+):(k|tp|ti|uz|ru)$/.exec(ctx.callbackQuery.data);
    const field = match?.[2] ? templateFieldByCode(match[2]) : null;
    if (!match?.[1] || !field) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }
    await startTemplateEdit(ctx, match[1], field);
  });

  bot.callbackQuery(/^tmpl:t:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireAdmin(ctx))) return;
    const match = /^tmpl:t:(\d+)$/.exec(ctx.callbackQuery.data);
    if (!match?.[1]) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }
    try {
      const template = await dependencies.messageTemplateStore.findTemplateById(match[1]);
      if (!template) {
        await ctx.reply(t(ctx.session.locale, 'adminTemplateNotFound'));
        return;
      }
      const updated = await dependencies.messageTemplateStore.updateTemplate(template.id, {
        is_active: !template.is_active,
      });
      if (!updated) {
        await ctx.reply(t(ctx.session.locale, 'adminTemplateNotFound'));
        return;
      }
      await showAdminTemplateDetail(ctx, dependencies.messageTemplateStore, updated.id);
    } catch (error) {
      dependencies.logger.error('Failed to toggle admin template', error);
      await ctx.reply(t(ctx.session.locale, 'adminTemplateUnavailable'));
    }
  });

  bot.callbackQuery(/^tmpl:d:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireAdmin(ctx))) return;
    const match = /^tmpl:d:(\d+)$/.exec(ctx.callbackQuery.data);
    if (!match?.[1]) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }
    try {
      const deleted = await dependencies.messageTemplateStore.deleteTemplate(match[1]);
      await ctx.reply(
        t(ctx.session.locale, deleted ? 'adminTemplateDeleted' : 'adminTemplateNotFound'),
      );
      await showAdminTemplateList(ctx, dependencies.messageTemplateStore);
    } catch (error) {
      dependencies.logger.error('Failed to delete admin template', error);
      await ctx.reply(t(ctx.session.locale, 'adminTemplateUnavailable'));
    }
  });

  bot.on('message:text', async (ctx) => {
    if (ctx.session.stage === 'admin_template_input' && ctx.session.adminTemplateInput) {
      await handleAdminTemplateInput(
        ctx,
        dependencies.messageTemplateStore,
        dependencies.logger,
        ctx.message.text,
      );
      return;
    }

    if (ctx.session.stage === 'awaiting_note') {
      await acceptNote(
        ctx,
        ctx.message.text === t(ctx.session.locale, 'skipNote') ? '' : ctx.message.text,
      );
      return;
    }

    if (ctx.session.stage === 'settings_awaiting_name') {
      await handleSettingsNameInput(ctx, dependencies, ctx.message.text);
      return;
    }

    if (ctx.session.stage === 'settings_awaiting_phone') {
      await ctx.reply(t(ctx.session.locale, 'settingsPhonePrompt'), {
        reply_markup: settingsPhoneKeyboard(ctx.session.locale),
      });
      return;
    }

    if (ctx.session.stage === 'settings_choosing_language') {
      await ctx.reply(t(ctx.session.locale, 'settingsLanguagePrompt'), {
        reply_markup: settingsLanguageKeyboard(ctx.session.locale),
      });
      return;
    }

    if (canRegisterWithManualPhone(ctx.session, dependencies.allowManualPhoneEntry)) {
      await registerByPhone(ctx, dependencies, ctx.message.text);
      return;
    }

    await ctx.reply(
      t(ctx.session.locale, ctx.session.client || ctx.session.admin ? 'help' : 'phoneOnly'),
      {
        reply_markup: currentReplyKeyboard(ctx.session),
      },
    );
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
