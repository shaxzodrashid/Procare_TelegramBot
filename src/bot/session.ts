import type { RawApi, Transformer } from 'grammy';
import type { BotContext, BotSession, RegistrationStage } from './context.js';
import type { Logger } from '../utils/logger.js';
import type { RegisteredUserStore } from '../services/registered-user.store.js';
import type { Locale } from '../types/client.js';
import {
  redactPhoneNumber,
  redactPhoneNumbersInText,
  summarizeText,
  summarizeUnknownPayload,
} from '../utils/log-redaction.js';
export const initialSession = (): BotSession => ({ locale: 'uz', stage: 'choosing_language' });

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';

export const summarizeSession = (sessionData: BotSession): Record<string, unknown> => ({
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
        selectedRepairOrderId: sessionData.repairOrdersView.selectedRepairOrderId,
      }
    : undefined,
  supportComment: sessionData.supportComment
    ? {
        repairOrderId: sessionData.supportComment.repairOrderId,
        orderNumber: sessionData.supportComment.orderNumber,
        submitting: sessionData.supportComment.submitting,
      }
    : undefined,
});

export const summarizeTelegramText = (text: string): Record<string, unknown> => ({
  kind: text.startsWith('/') ? 'command' : 'text',
  command: text.startsWith('/') ? text.split(/\s+/, 1)[0] : undefined,
  length: text.length,
});

export const summarizeTelegramMessage = (ctx: BotContext): Record<string, unknown> | undefined => {
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

export const summarizeTelegramCallback = (ctx: BotContext): Record<string, unknown> | undefined => {
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

export const summarizeTelegramUpdate = (ctx: BotContext): Record<string, unknown> => ({
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

export const summarizeReplyMarkup = (value: unknown): unknown => {
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

export const summarizeTelegramApiPayload = (payload: unknown): unknown => {
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

export const summarizeTelegramApiResult = (result: unknown): unknown => {
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

export const createTelegramApiLoggingTransformer =
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

export const clearUnknownFlow = (sessionData: BotSession): void => {
  delete sessionData.unknownClient;
  delete sessionData.repairDraft;
};

export const clearAdminTemplateFlow = (sessionData: BotSession): void => {
  delete sessionData.adminTemplateInput;
  if (sessionData.stage === 'admin_template_input') delete sessionData.stage;
};

export const clearSupportFlow = (sessionData: BotSession): void => {
  delete sessionData.supportComment;
  if (sessionData.stage === 'support_comment_input') delete sessionData.stage;
};

export const clearAdminClientFlow = (sessionData: BotSession): void => {
  delete sessionData.adminClientFlow;
  if (
    sessionData.stage === 'admin_client_search_input' ||
    sessionData.stage === 'admin_client_send_custom_message' ||
    sessionData.stage === 'admin_client_template_placeholder'
  ) {
    delete sessionData.stage;
  }
};

export const clearAdminExportFlow = (sessionData: BotSession): void => {
  if (sessionData.stage === 'admin_export_period_input') delete sessionData.stage;
};

const settingsStages = new Set<RegistrationStage>([
  'settings',
  'settings_awaiting_name',
  'settings_awaiting_phone',
  'settings_choosing_language',
]);

export const clearSettingsFlow = (sessionData: BotSession): void => {
  if (sessionData.stage && settingsStages.has(sessionData.stage)) delete sessionData.stage;
};

export const resetSession = (sessionData: BotSession, locale: Locale): void => {
  delete sessionData.client;
  delete sessionData.admin;
  delete sessionData.repairOrdersView;
  clearUnknownFlow(sessionData);
  clearAdminTemplateFlow(sessionData);
  clearSupportFlow(sessionData);
  clearAdminClientFlow(sessionData);
  clearAdminExportFlow(sessionData);
  clearSettingsFlow(sessionData);
  sessionData.locale = locale;
  sessionData.stage = 'choosing_language';
};

export const createSessionRestorationMiddleware = (dependencies: {
  registeredUserStore: RegisteredUserStore;
  logger: Logger;
}) => {
  return async (ctx: BotContext, next: () => Promise<void>) => {
    if (ctx.from && !ctx.session.client && !ctx.session.admin) {
      try {
        const registrationState = await dependencies.registeredUserStore.findByTelegramId(
          String(ctx.from.id),
        );
        if (registrationState) {
          ctx.session.locale = registrationState.user.locale;

          if (registrationState.employee && registrationState.employee.is_active) {
            ctx.session.admin = {
              id: registrationState.employee.crm_admin_id,
              first_name: registrationState.user.first_name,
              last_name: registrationState.user.last_name,
              phone_number: registrationState.user.phone_number,
              phone_verified: true,
              language: registrationState.user.locale,
              status: registrationState.employee.status,
              is_active: registrationState.employee.is_active,
              created_at: registrationState.employee.created_at,
              updated_at: registrationState.employee.updated_at,
            };
            dependencies.logger.info(`Restored admin session for telegram_id: ${ctx.from.id}`);
            if (
              ctx.session.stage === 'choosing_language' ||
              ctx.session.stage === 'awaiting_phone'
            ) {
              delete ctx.session.stage;
            }
          } else if (registrationState.client && registrationState.client.is_active) {
            ctx.session.client = {
              account_type: 'client',
              client_id: registrationState.client.crm_client_id,
              first_name: registrationState.user.first_name,
              last_name: registrationState.user.last_name,
              language: registrationState.user.locale,
              has_repair_orders: true,
              is_admin: false,
              admin: null,
            };
            dependencies.logger.info(`Restored client session for telegram_id: ${ctx.from.id}`);
            if (
              ctx.session.stage === 'choosing_language' ||
              ctx.session.stage === 'awaiting_phone'
            ) {
              delete ctx.session.stage;
            }
          }
        }
      } catch (error) {
        dependencies.logger.error('Failed to restore user session from database', error);
      }
    }
    await next();
  };
};
