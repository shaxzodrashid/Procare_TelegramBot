import { InlineKeyboard, InputFile } from 'grammy';
import type { Api } from 'grammy';

import type { TemplateRecipient, MessageTemplateType } from '../types/message-template.js';
import type { SupportMessageReplyTarget } from '../types/support-message.js';
import type { RegisteredUserStore } from './registered-user.store.js';
import { MessageTemplateRenderer, type MessageTemplateStore } from './message-template.service.js';
import type { SupportMessageStore } from './support-message.store.js';

export interface TemplatePhoto {
  buffer: Buffer | Uint8Array;
  fileName?: string;
}

export interface SendTemplateMessageParams {
  user: TemplateRecipient;
  type: MessageTemplateType;
  placeholders: Record<string, string | number | null | undefined>;
  dispatchType?: string;
  photo?: TemplatePhoto;
}

export interface TemplateMessageDeliveryResult {
  status: 'sent' | 'failed' | 'template_not_found';
}

export interface SendDirectMessageParams {
  phoneNumber: string;
  message: string;
  variables?: DirectMessageVariables;
  inlineKeyboard?: DirectMessageInlineKeyboard;
  supportReply?: DirectMessageSupportReply;
}

export interface DirectMessageDeliveryResult {
  status: 'sent' | 'failed' | 'not_found' | 'blocked' | 'invalid_message';
  message?: string;
}

export interface SendDirectFileParams {
  phoneNumber: string;
  fileType: 'warranty' | 'offerta' | 'checklist';
  fileUrl: string;
  fileName?: string;
  variables?: DirectMessageVariables;
  caption?: string;
}

export interface DirectFileDeliveryResult {
  status: 'sent' | 'failed' | 'not_found' | 'blocked' | 'invalid_file';
  message?: string;
}

type TelegramTemplateApi = Pick<Api, 'sendMessage' | 'sendPhoto'>;
type TelegramDirectMessageApi = Pick<Api, 'sendMessage' | 'sendDocument'>;

const TELEGRAM_CAPTION_LIMIT = 1024;
export const TELEGRAM_TEXT_LIMIT = 4096;
const DIRECT_MESSAGE_DISPATCH_TYPE = 'api_direct_message';
const DIRECT_MESSAGE_PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export type DirectMessageVariableValue = string | number | boolean | null | undefined;
export type DirectMessageVariables = Record<string, DirectMessageVariableValue>;

export interface DirectMessageUrlButton {
  type: 'url';
  text: string;
  url: string;
}

export interface DirectMessageRepairOrderButton {
  type: 'repair_order';
  text?: string;
  repairOrderUuid: string;
}

export type DirectMessageInlineButton = DirectMessageUrlButton | DirectMessageRepairOrderButton;

export interface DirectMessageInlineKeyboard {
  rows: DirectMessageInlineButton[][];
}

export interface DirectMessageSupportReply {
  targetCrmCommentId: string;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const isTelegramBlockedError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const record = error as Record<string, unknown>;
  const errorCode = record.error_code;
  const description =
    typeof record.description === 'string'
      ? record.description
      : typeof record.message === 'string'
        ? record.message
        : '';

  return (
    errorCode === 403 ||
    description.toLowerCase().includes('bot was blocked') ||
    description.toLowerCase().includes('forbidden')
  );
};

const isTelegramReplyTargetError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const record = error as Record<string, unknown>;
  const errorCode = record.error_code;
  const description =
    typeof record.description === 'string'
      ? record.description
      : typeof record.message === 'string'
        ? record.message
        : '';
  const normalized = description.toLowerCase();

  return (
    errorCode === 400 &&
    (normalized.includes('reply') ||
      normalized.includes('replied') ||
      normalized.includes('message to be replied'))
  );
};

const directMessageOptions = (
  replyMarkup: InlineKeyboard | undefined,
  replyTarget: SupportMessageReplyTarget | null,
): Parameters<TelegramDirectMessageApi['sendMessage']>[2] | undefined => {
  const options: NonNullable<Parameters<TelegramDirectMessageApi['sendMessage']>[2]> = {};
  if (replyMarkup) options.reply_markup = replyMarkup;
  if (replyTarget) {
    options.reply_parameters = {
      message_id: replyTarget.telegram_message_id,
      allow_sending_without_reply: true,
    };
  }
  return Object.keys(options).length > 0 ? options : undefined;
};

export class BotNotificationService {
  constructor(
    private readonly templates: MessageTemplateStore,
    private readonly telegram: TelegramTemplateApi,
  ) {}

  async sendTemplateMessage(
    params: SendTemplateMessageParams,
  ): Promise<TemplateMessageDeliveryResult> {
    const dispatchType = params.dispatchType ?? params.type;

    if (params.user.is_blocked) {
      await this.templates.logDispatch({
        user_id: params.user.id ?? null,
        template_id: null,
        dispatch_type: dispatchType,
        status: 'failed',
        error_message: 'Telegram user is marked as blocked',
      });
      return { status: 'failed' };
    }

    const template = await this.templates.findActiveTemplateByType(params.type);
    if (!template) {
      await this.templates.logDispatch({
        user_id: params.user.id ?? null,
        template_id: null,
        dispatch_type: dispatchType,
        status: 'template_not_found',
        error_message: null,
      });
      return { status: 'template_not_found' };
    }

    const locale = params.user.language_code ?? 'uz';
    const text = MessageTemplateRenderer.render(template, locale, params.placeholders);

    try {
      if (params.photo && MessageTemplateRenderer.hasPlaceholder(template, locale, 'prize_name')) {
        const photo = new InputFile(params.photo.buffer, params.photo.fileName ?? 'photo.jpg');
        if (text.length <= TELEGRAM_CAPTION_LIMIT) {
          await this.telegram.sendPhoto(params.user.telegram_id, photo, {
            caption: text,
            parse_mode: 'HTML',
          });
        } else {
          await this.telegram.sendPhoto(params.user.telegram_id, photo);
          await this.telegram.sendMessage(params.user.telegram_id, text, { parse_mode: 'HTML' });
        }
      } else {
        await this.telegram.sendMessage(params.user.telegram_id, text, { parse_mode: 'HTML' });
      }

      await this.templates.setUserBlocked(params.user.telegram_id, false);
      await this.templates.logDispatch({
        user_id: params.user.id ?? null,
        template_id: template.id,
        dispatch_type: dispatchType,
        status: 'sent',
        error_message: null,
      });
      return { status: 'sent' };
    } catch (error) {
      if (isTelegramBlockedError(error)) {
        await this.templates.setUserBlocked(params.user.telegram_id, true);
      }
      await this.templates.logDispatch({
        user_id: params.user.id ?? null,
        template_id: template.id,
        dispatch_type: dispatchType,
        status: 'failed',
        error_message: errorMessage(error),
      });
      return { status: 'failed' };
    }
  }
}

export class BotDirectMessageService {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly users: Pick<RegisteredUserStore, 'findByPhoneNumber'>,
    private readonly templates: Pick<
      MessageTemplateStore,
      'logDispatch' | 'setUserBlocked' | 'findActiveTemplateByType'
    >,
    private readonly telegram: TelegramDirectMessageApi,
    private readonly supportMessages?: Pick<SupportMessageStore, 'findReplyTargetByCrmCommentId'>,
    options?: { fetchImpl?: typeof fetch },
  ) {
    this.fetchImpl = options?.fetchImpl ?? fetch;
  }

  async sendDirectFile(params: SendDirectFileParams): Promise<DirectFileDeliveryResult> {
    const user = await this.users.findByPhoneNumber(params.phoneNumber);
    if (!user) return { status: 'not_found' };

    const dispatchType = `api_direct_file_${params.fileType}`;

    if (user.is_blocked) {
      await this.templates.logDispatch({
        user_id: user.id,
        template_id: null,
        dispatch_type: dispatchType,
        status: 'failed',
        error_message: 'Telegram user is marked as blocked',
      });
      return { status: 'blocked' };
    }

    const template = await this.templates.findActiveTemplateByType(params.fileType);
    let finalCaption: string | undefined;

    if (template) {
      const placeholders = {
        ...params.variables,
        first_name: user.first_name,
        last_name: user.last_name,
        full_name: [user.first_name, user.last_name].filter(Boolean).join(' '),
        phone_number: user.phone_number,
        telegram_username: user.telegram_username,
        locale: user.locale,
      };
      finalCaption = MessageTemplateRenderer.render(template, user.locale ?? 'uz', placeholders);
    } else {
      finalCaption = params.caption;
    }

    let buffer: Buffer;
    try {
      const response = await this.fetchImpl(params.fileUrl);
      if (!response.ok) {
        throw new Error(
          `Failed to fetch file from URL: ${response.statusText} (Status: ${response.status})`,
        );
      }
      const arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } catch (error) {
      await this.templates.logDispatch({
        user_id: user.id,
        template_id: template?.id ?? null,
        dispatch_type: dispatchType,
        status: 'failed',
        error_message: `File download failed: ${errorMessage(error)}`,
      });
      return {
        status: 'invalid_file',
        message: `Failed to download file from URL: ${errorMessage(error)}`,
      };
    }

    const defaultFileName = `${params.fileType}.pdf`;
    const fileName = params.fileName || defaultFileName;
    const document = new InputFile(buffer, fileName);

    try {
      if (finalCaption) {
        if (finalCaption.length <= 1024) {
          await this.telegram.sendDocument(user.telegram_id, document, {
            caption: finalCaption,
            parse_mode: 'HTML',
          });
        } else {
          await this.telegram.sendDocument(user.telegram_id, document);
          await this.telegram.sendMessage(user.telegram_id, finalCaption, {
            parse_mode: 'HTML',
          });
        }
      } else {
        await this.telegram.sendDocument(user.telegram_id, document);
      }

      await this.templates.setUserBlocked(user.telegram_id, false);
      await this.templates.logDispatch({
        user_id: user.id,
        template_id: template?.id ?? null,
        dispatch_type: dispatchType,
        status: 'sent',
        error_message: null,
      });
      return { status: 'sent' };
    } catch (error) {
      if (isTelegramBlockedError(error)) {
        await this.templates.setUserBlocked(user.telegram_id, true);
      }
      await this.templates.logDispatch({
        user_id: user.id,
        template_id: template?.id ?? null,
        dispatch_type: dispatchType,
        status: 'failed',
        error_message: errorMessage(error),
      });
      return { status: 'failed' };
    }
  }

  async sendDirectMessage(params: SendDirectMessageParams): Promise<DirectMessageDeliveryResult> {
    const user = await this.users.findByPhoneNumber(params.phoneNumber);
    if (!user) return { status: 'not_found' };

    if (user.is_blocked) {
      await this.templates.logDispatch({
        user_id: user.id,
        template_id: null,
        dispatch_type: DIRECT_MESSAGE_DISPATCH_TYPE,
        status: 'failed',
        error_message: 'Telegram user is marked as blocked',
      });
      return { status: 'blocked' };
    }

    const rendered = renderDirectMessage(params.message, {
      ...params.variables,
      first_name: user.first_name,
      last_name: user.last_name,
      full_name: [user.first_name, user.last_name].filter(Boolean).join(' '),
      phone_number: user.phone_number,
      telegram_username: user.telegram_username,
      locale: user.locale,
    });
    if (!rendered.ok) return { status: 'invalid_message', message: rendered.message };

    try {
      const replyMarkup = buildDirectMessageInlineKeyboard(params.inlineKeyboard, user.locale);
      const replyTarget = params.supportReply
        ? await this.supportMessages?.findReplyTargetByCrmCommentId(
            params.supportReply.targetCrmCommentId,
            user.telegram_id,
          )
        : null;
      try {
        await this.telegram.sendMessage(
          replyTarget?.telegram_chat_id ?? user.telegram_id,
          rendered.message,
          directMessageOptions(replyMarkup, replyTarget ?? null),
        );
      } catch (error) {
        if (!replyTarget || !isTelegramReplyTargetError(error)) throw error;
        await this.telegram.sendMessage(
          user.telegram_id,
          rendered.message,
          directMessageOptions(replyMarkup, null),
        );
      }
      await this.templates.setUserBlocked(user.telegram_id, false);
      await this.templates.logDispatch({
        user_id: user.id,
        template_id: null,
        dispatch_type: DIRECT_MESSAGE_DISPATCH_TYPE,
        status: 'sent',
        error_message: null,
      });
      return { status: 'sent' };
    } catch (error) {
      if (isTelegramBlockedError(error)) {
        await this.templates.setUserBlocked(user.telegram_id, true);
      }
      await this.templates.logDispatch({
        user_id: user.id,
        template_id: null,
        dispatch_type: DIRECT_MESSAGE_DISPATCH_TYPE,
        status: 'failed',
        error_message: errorMessage(error),
      });
      return { status: 'failed' };
    }
  }
}

export const renderDirectMessage = (
  message: string,
  variables: DirectMessageVariables,
): { ok: true; message: string } | { ok: false; message: string } => {
  const missingVariables = new Set<string>();
  const rendered = message.replace(DIRECT_MESSAGE_PLACEHOLDER_PATTERN, (match, key: string) => {
    if (!Object.hasOwn(variables, key)) {
      missingVariables.add(key);
      return match;
    }

    const value = variables[key];
    if (value === null || value === undefined || value === '') return '';
    return String(value);
  });

  if (missingVariables.size > 0) {
    return {
      ok: false,
      message: `Missing message variables: ${Array.from(missingVariables).sort().join(', ')}`,
    };
  }

  if (!rendered.trim()) return { ok: false, message: 'message must not be empty after rendering' };
  if (rendered.length > TELEGRAM_TEXT_LIMIT) {
    return {
      ok: false,
      message: `message must be ${TELEGRAM_TEXT_LIMIT} characters or fewer after rendering`,
    };
  }

  return { ok: true, message: rendered };
};

const defaultRepairOrderButtonText = (locale: string): string =>
  locale === 'ru' ? '🧾 Детали заказа' : '🧾 Buyurtmani ko‘rish';

export const buildDirectMessageInlineKeyboard = (
  keyboard: DirectMessageInlineKeyboard | undefined,
  locale: string,
): InlineKeyboard | undefined => {
  if (!keyboard) return undefined;

  const markup = new InlineKeyboard();
  keyboard.rows.forEach((row, rowIndex) => {
    if (rowIndex > 0) markup.row();
    row.forEach((button) => {
      if (button.type === 'url') {
        markup.url(button.text, button.url);
        return;
      }

      markup.text(
        button.text?.trim() || defaultRepairOrderButtonText(locale),
        `dm:ro:o:${button.repairOrderUuid}`,
      );
    });
  });
  return markup;
};
