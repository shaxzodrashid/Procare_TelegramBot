import { InlineKeyboard, InputFile, InputMediaBuilder } from 'grammy';
import type { Api } from 'grammy';

import type { TemplateRecipient, MessageTemplateType } from '../types/message-template.js';
import type { SupportMessageReplyTarget } from '../types/support-message.js';
import type { RegisteredUserStore } from './registered-user.store.js';
import { MessageTemplateRenderer, type MessageTemplateStore } from './message-template.service.js';
import type { SupportMessageStore } from './support-message.store.js';
import type { Logger } from '../utils/logger.js';
import { t } from '../bot/messages.js';
import {
  DEFAULT_TELEGRAM_PARSE_MODE,
  TELEGRAM_FORMATTED_SOURCE_LIMIT,
  escapeTelegramVariable,
  telegramFormattedText,
  type TelegramParseMode,
} from '../utils/telegram-formatting.js';

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
  message?: string;
  localizedMessages?: DirectMessageLocalizedMessages;
  variables?: DirectMessageVariables;
  localizedVariables?: DirectMessageLocalizedVariables;
  parseMode?: TelegramParseMode;
  inlineKeyboard?: DirectMessageInlineKeyboard;
  supportReply?: DirectMessageSupportReply;
  type?: MessageTemplateType;
  crmCommentId?: string;
  repairOrderUuid?: string;
  orderNumber?: string;
  attachments?: DirectMessageAttachment[];
}

export interface DirectMessageDeliveryResult {
  status: 'sent' | 'failed' | 'not_found' | 'blocked' | 'invalid_message' | 'invalid_attachments';
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
type TelegramDirectMessageApi = Pick<
  Api,
  'sendMessage' | 'sendDocument' | 'sendPhoto' | 'sendMediaGroup'
>;

const TELEGRAM_CAPTION_LIMIT = 1024;
export const TELEGRAM_TEXT_LIMIT = 4096;
const MAX_DIRECT_MESSAGE_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_DIRECT_MESSAGE_DOCUMENT_BYTES = 20 * 1024 * 1024;
const TELEGRAM_PARSE_MODE_HTML = 'HTML';
const DIRECT_MESSAGE_DISPATCH_TYPE = 'api_direct_message';
const DIRECT_MESSAGE_PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export type DirectMessageVariableValue = string | number | boolean | null | undefined;
export type DirectMessageVariables = Record<string, DirectMessageVariableValue>;

export interface DirectMessageLocalizedMessages {
  uz: string;
  ru: string;
  en?: string | null;
}

export interface DirectMessageLocalizedVariable {
  uz: DirectMessageVariableValue;
  ru: DirectMessageVariableValue;
  en?: DirectMessageVariableValue;
}

export type DirectMessageLocalizedVariables = Record<string, DirectMessageLocalizedVariable>;

export type DirectMessageButtonStyle = 'danger' | 'success' | 'primary';

interface DirectMessageButtonPresentation {
  text?: string;
  localizedText?: DirectMessageLocalizedButtonText;
  style?: DirectMessageButtonStyle;
}

export interface DirectMessageUrlButton extends DirectMessageButtonPresentation {
  type: 'url';
  url: string;
}

export interface DirectMessageRepairOrderButton extends DirectMessageButtonPresentation {
  type: 'repair_order' | 'details' | 'approval' | 'rating';
  repairOrderUuid: string;
}

export type DirectMessageInlineButton = DirectMessageUrlButton | DirectMessageRepairOrderButton;

export interface DirectMessageRowsInlineKeyboard {
  rows: DirectMessageInlineButton[][];
}

export type DirectMessageRatingButtonType =
  | 'rating_1'
  | 'rating_2'
  | 'rating_3'
  | 'rating_4'
  | 'rating_5'
  | 'rating_6'
  | 'rating_7'
  | 'rating_8'
  | 'rating_9'
  | 'rating_10';

export type DirectMessageActionButtonType =
  | 'details'
  | 'reject'
  | 'approve'
  | DirectMessageRatingButtonType;

export interface DirectMessageActionButton extends DirectMessageButtonPresentation {
  type: DirectMessageActionButtonType;
}

export interface DirectMessageActionInlineKeyboard {
  type: 'details' | 'approval' | 'rating';
  repairOrderUuid: string;
  text?: string;
  localizedText?: DirectMessageLocalizedButtonText;
  style?: DirectMessageButtonStyle;
  layout?: DirectMessageActionButton[][];
}

export type DirectMessageInlineKeyboard =
  | DirectMessageRowsInlineKeyboard
  | DirectMessageActionInlineKeyboard;

export interface DirectMessageSupportReply {
  targetCrmCommentId: string;
}

export interface DirectMessageLocalizedButtonText {
  uz: string;
  ru: string;
  en?: string | null;
}

export interface DirectMessageAttachment {
  type: 'photo' | 'document';
  url: string;
  fileName?: string;
}

interface DownloadedDirectMessageAttachment {
  type: DirectMessageAttachment['type'];
  file: InputFile;
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

export const isTelegramFormattingError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const record = error as Record<string, unknown>;
  const description =
    typeof record.description === 'string'
      ? record.description
      : typeof record.message === 'string'
        ? record.message
        : '';
  const normalized = description.toLowerCase();

  return (
    record.error_code === 400 &&
    (normalized.includes("can't parse entities") ||
      normalized.includes('unsupported start tag') ||
      normalized.includes('unsupported end tag') ||
      normalized.includes('entity is too long'))
  );
};

const localizedVariablesFor = (
  variables: DirectMessageLocalizedVariables | undefined,
  locale: string | null | undefined,
): DirectMessageVariables => {
  if (!variables) return {};
  const selectedLocale = locale === 'ru' ? 'ru' : 'uz';
  return Object.fromEntries(
    Object.entries(variables).map(([key, value]) => [key, value[selectedLocale]]),
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
            parse_mode: TELEGRAM_PARSE_MODE_HTML,
          });
        } else {
          await this.telegram.sendPhoto(params.user.telegram_id, photo);
          await this.telegram.sendMessage(params.user.telegram_id, text, {
            parse_mode: TELEGRAM_PARSE_MODE_HTML,
          });
        }
      } else {
        await this.telegram.sendMessage(params.user.telegram_id, text, {
          parse_mode: TELEGRAM_PARSE_MODE_HTML,
        });
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
  private readonly logger?: Logger;

  constructor(
    private readonly users: Pick<RegisteredUserStore, 'findByPhoneNumber'>,
    private readonly templates: Pick<
      MessageTemplateStore,
      'logDispatch' | 'setUserBlocked' | 'findActiveTemplateByType'
    >,
    private readonly telegram: TelegramDirectMessageApi,
    private readonly supportMessages?: Pick<
      SupportMessageStore,
      'findReplyTargetByCrmCommentId' | 'save'
    >,
    options?: { fetchImpl?: typeof fetch; logger?: Logger },
  ) {
    this.fetchImpl = options?.fetchImpl ?? fetch;
    this.logger = options?.logger;
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

  private async downloadDirectMessageAttachments(
    attachments: DirectMessageAttachment[] | undefined,
  ): Promise<DownloadedDirectMessageAttachment[]> {
    return Promise.all(
      (attachments ?? []).map(async (attachment, index) => {
        const response = await this.fetchImpl(attachment.url);
        if (!response.ok) {
          throw new Error(`attachment ${index + 1} download returned HTTP ${response.status}`);
        }
        const declaredLength = Number(response.headers.get('content-length'));
        const maximumBytes =
          attachment.type === 'document'
            ? MAX_DIRECT_MESSAGE_DOCUMENT_BYTES
            : MAX_DIRECT_MESSAGE_PHOTO_BYTES;
        if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
          throw new Error(
            `attachment ${index + 1} exceeds ${attachment.type === 'document' ? 20 : 5} MB`,
          );
        }
        const reader = response.body?.getReader();
        const chunks: Buffer[] = [];
        let downloadedBytes = 0;
        if (reader) {
          try {
            while (true) {
              const chunk = await reader.read();
              if (chunk.done) break;
              downloadedBytes += chunk.value.byteLength;
              if (downloadedBytes > maximumBytes) {
                await reader.cancel();
                throw new Error(
                  `attachment ${index + 1} exceeds ${attachment.type === 'document' ? 20 : 5} MB`,
                );
              }
              chunks.push(Buffer.from(chunk.value));
            }
          } finally {
            reader.releaseLock();
          }
        }
        const buffer = reader
          ? Buffer.concat(chunks, downloadedBytes)
          : Buffer.from(await response.arrayBuffer());
        if (!buffer.length) throw new Error(`attachment ${index + 1} is empty`);
        if (buffer.length > maximumBytes) {
          throw new Error(
            `attachment ${index + 1} exceeds ${attachment.type === 'document' ? 20 : 5} MB`,
          );
        }
        return {
          type: attachment.type,
          file: new InputFile(
            buffer,
            attachment.fileName ??
              (attachment.type === 'document'
                ? `document-${index + 1}.pdf`
                : `photo-${index + 1}.jpg`),
          ),
        };
      }),
    );
  }

  private async sendDirectContent(params: {
    chatId: string;
    messageText: string;
    parseMode: TelegramParseMode;
    replyMarkup: InlineKeyboard | undefined;
    replyTarget: SupportMessageReplyTarget | null;
    attachments: DownloadedDirectMessageAttachment[];
  }): Promise<{ message_id: number; chat: { id: number }; date: number }> {
    const replyParameters = params.replyTarget
      ? {
          message_id: params.replyTarget.telegram_message_id,
          allow_sending_without_reply: true,
        }
      : undefined;
    if (!params.attachments.length) {
      return this.telegram.sendMessage(params.chatId, params.messageText, {
        ...directMessageOptions(params.replyMarkup, params.replyTarget),
        parse_mode: params.parseMode,
      });
    }

    const captionFits =
      Boolean(params.messageText) &&
      telegramFormattedText(params.messageText, params.parseMode).length <= TELEGRAM_CAPTION_LIMIT;
    if (params.attachments.length === 1) {
      const useAttachmentCaption = captionFits && !params.replyMarkup;
      const attachment = params.attachments[0]!;
      const mediaMessage =
        attachment.type === 'document'
          ? await this.telegram.sendDocument(params.chatId, attachment.file, {
              ...(useAttachmentCaption
                ? { caption: params.messageText, parse_mode: params.parseMode }
                : {}),
              ...(replyParameters ? { reply_parameters: replyParameters } : {}),
            })
          : await this.telegram.sendPhoto(params.chatId, attachment.file, {
              ...(useAttachmentCaption
                ? { caption: params.messageText, parse_mode: params.parseMode }
                : {}),
              ...(replyParameters ? { reply_parameters: replyParameters } : {}),
            });
      if (!params.messageText || useAttachmentCaption) return mediaMessage;
      return this.telegram.sendMessage(params.chatId, params.messageText, {
        ...(params.replyMarkup ? { reply_markup: params.replyMarkup } : {}),
        parse_mode: params.parseMode,
      });
    }

    const onlyPhotos = params.attachments.every((attachment) => attachment.type === 'photo');
    if (onlyPhotos) {
      const useAlbumCaption = captionFits && !params.replyMarkup;
      const media = params.attachments.map((attachment, index) =>
        InputMediaBuilder.photo(attachment.file, {
          ...(index === 0 && useAlbumCaption
            ? { caption: params.messageText, parse_mode: params.parseMode }
            : {}),
        }),
      );
      const album = await this.telegram.sendMediaGroup(params.chatId, media, {
        ...(replyParameters ? { reply_parameters: replyParameters } : {}),
      });
      if (!params.messageText || useAlbumCaption) return album[0]!;
    } else {
      let lastMediaMessage: { message_id: number; chat: { id: number }; date: number } | undefined;
      for (const [index, attachment] of params.attachments.entries()) {
        const mediaOptions =
          index === 0 && replyParameters ? { reply_parameters: replyParameters } : {};
        lastMediaMessage =
          attachment.type === 'document'
            ? await this.telegram.sendDocument(params.chatId, attachment.file, mediaOptions)
            : await this.telegram.sendPhoto(params.chatId, attachment.file, mediaOptions);
      }
      if (!params.messageText) return lastMediaMessage!;
    }

    return this.telegram.sendMessage(params.chatId, params.messageText, {
      ...(params.replyMarkup ? { reply_markup: params.replyMarkup } : {}),
      parse_mode: params.parseMode,
    });
  }

  async sendDirectMessage(params: SendDirectMessageParams): Promise<DirectMessageDeliveryResult> {
    const user = await this.users.findByPhoneNumber(params.phoneNumber);
    if (!user) return { status: 'not_found' };

    const template = params.type
      ? await this.templates.findActiveTemplateByType(params.type)
      : null;

    const dispatchType = template ? params.type! : DIRECT_MESSAGE_DISPATCH_TYPE;

    if (user.is_blocked) {
      await this.templates.logDispatch({
        user_id: user.id,
        template_id: template?.id ?? null,
        dispatch_type: dispatchType,
        status: 'failed',
        error_message: 'Telegram user is marked as blocked',
      });
      return { status: 'blocked' };
    }

    let messageText = '';
    let messageParseMode: TelegramParseMode = DEFAULT_TELEGRAM_PARSE_MODE;
    if (template) {
      const placeholders = {
        ...params.variables,
        ...localizedVariablesFor(params.localizedVariables, user.locale),
        first_name: user.first_name,
        last_name: user.last_name,
        full_name: [user.first_name, user.last_name].filter(Boolean).join(' '),
        phone_number: user.phone_number,
        telegram_username: user.telegram_username,
        locale: user.locale,
      };
      messageText = MessageTemplateRenderer.render(template, user.locale ?? 'uz', placeholders);
      if (messageText.length > TELEGRAM_FORMATTED_SOURCE_LIMIT) {
        return {
          status: 'invalid_message',
          message: `formatted message source must be ${TELEGRAM_FORMATTED_SOURCE_LIMIT} characters or fewer`,
        };
      }
      const visibleText = telegramFormattedText(messageText, messageParseMode);
      if (!visibleText.trim()) {
        return { status: 'invalid_message', message: 'message must not be empty after rendering' };
      }
      if (visibleText.length > TELEGRAM_TEXT_LIMIT) {
        return {
          status: 'invalid_message',
          message: `message must be ${TELEGRAM_TEXT_LIMIT} characters or fewer after rendering`,
        };
      }
    } else {
      messageParseMode = params.parseMode ?? DEFAULT_TELEGRAM_PARSE_MODE;
      const localizedMessage =
        params.localizedMessages?.[user.locale === 'ru' ? 'ru' : 'uz'] ?? params.message;
      if (localizedMessage === undefined && !params.attachments?.length) {
        return {
          status: 'invalid_message',
          message: 'message, localized_messages, or attachments must be provided',
        };
      }
      if (localizedMessage !== undefined) {
        const rendered = renderDirectMessage(
          localizedMessage,
          {
            ...params.variables,
            ...localizedVariablesFor(params.localizedVariables, user.locale),
            first_name: user.first_name,
            last_name: user.last_name,
            full_name: [user.first_name, user.last_name].filter(Boolean).join(' '),
            phone_number: user.phone_number,
            telegram_username: user.telegram_username,
            locale: user.locale,
          },
          messageParseMode,
        );
        if (!rendered.ok) return { status: 'invalid_message', message: rendered.message };
        messageText = rendered.message;
      }
    }

    let attachments: DownloadedDirectMessageAttachment[];
    try {
      attachments = await this.downloadDirectMessageAttachments(params.attachments);
    } catch (error) {
      await this.templates.logDispatch({
        user_id: user.id,
        template_id: template?.id ?? null,
        dispatch_type: dispatchType,
        status: 'failed',
        error_message: `Attachment download failed: ${errorMessage(error)}`,
      });
      return {
        status: 'invalid_attachments',
        message: `Failed to download a message attachment: ${errorMessage(error)}`,
      };
    }

    try {
      const replyMarkup = buildDirectMessageInlineKeyboard(params.inlineKeyboard, user.locale);
      const replyTarget = params.supportReply
        ? await this.supportMessages?.findReplyTargetByCrmCommentId(
            params.supportReply.targetCrmCommentId,
            user.telegram_id,
          )
        : null;
      let sentMessage;
      try {
        sentMessage = await this.sendDirectContent({
          chatId: replyTarget?.telegram_chat_id ?? user.telegram_id,
          messageText,
          parseMode: messageParseMode,
          replyMarkup,
          replyTarget: replyTarget ?? null,
          attachments,
        });
      } catch (error) {
        if (!replyTarget || !isTelegramReplyTargetError(error)) throw error;
        sentMessage = await this.sendDirectContent({
          chatId: user.telegram_id,
          messageText,
          parseMode: messageParseMode,
          replyMarkup,
          replyTarget: null,
          attachments,
        });
      }

      if (params.crmCommentId && this.supportMessages && user.crm_client_id) {
        const repairOrderId = replyTarget?.repair_order_id ?? params.repairOrderUuid;
        const orderNumber = replyTarget?.order_number ?? params.orderNumber;
        if (repairOrderId && orderNumber) {
          try {
            await this.supportMessages.save({
              crm_comment_id: params.crmCommentId,
              crm_client_id: user.crm_client_id,
              repair_order_id: repairOrderId,
              order_number: orderNumber,
              user_id: user.id,
              telegram_id: user.telegram_id,
              telegram_chat_id: String(sentMessage.chat.id),
              telegram_message_id: sentMessage.message_id,
              telegram_message_date: new Date(sentMessage.date * 1000),
              sender_type: 'employee',
              direction: 'outbound',
              content_type:
                attachments.length && !messageText
                  ? attachments.some((attachment) => attachment.type === 'document')
                    ? 'document'
                    : 'photo'
                  : 'text',
              text: messageText || null,
              photo_count: attachments.filter((attachment) => attachment.type === 'photo').length,
              reply_to_support_message_id: replyTarget?.id ?? null,
            });
          } catch (saveError) {
            this.logger?.error(
              'Failed to save outbound direct support message to database',
              saveError,
              {
                crm_comment_id: params.crmCommentId,
                telegram_message_id: sentMessage.message_id,
              },
            );
          }
        }
      }

      await this.templates.setUserBlocked(user.telegram_id, false);
      await this.templates.logDispatch({
        user_id: user.id,
        template_id: template?.id ?? null,
        dispatch_type: dispatchType,
        status: 'sent',
        error_message: null,
      });
      return { status: 'sent', message: messageText };
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
      if (isTelegramFormattingError(error)) {
        return {
          status: 'invalid_message',
          message: `Invalid ${messageParseMode} message formatting`,
        };
      }
      return { status: 'failed' };
    }
  }
}

export const renderDirectMessage = (
  message: string,
  variables: DirectMessageVariables,
  parseMode: TelegramParseMode = DEFAULT_TELEGRAM_PARSE_MODE,
): { ok: true; message: string } | { ok: false; message: string } => {
  const missingVariables = new Set<string>();
  const rendered = message.replace(
    DIRECT_MESSAGE_PLACEHOLDER_PATTERN,
    (match, key: string, offset: number) => {
      if (!Object.hasOwn(variables, key)) {
        missingVariables.add(key);
        return match;
      }

      const value = variables[key];
      if (value === null || value === undefined || value === '') return '';
      return escapeTelegramVariable(String(value), parseMode, message, offset);
    },
  );

  if (missingVariables.size > 0) {
    return {
      ok: false,
      message: `Missing message variables: ${Array.from(missingVariables).sort().join(', ')}`,
    };
  }

  if (rendered.length > TELEGRAM_FORMATTED_SOURCE_LIMIT) {
    return {
      ok: false,
      message: `formatted message source must be ${TELEGRAM_FORMATTED_SOURCE_LIMIT} characters or fewer`,
    };
  }

  const visibleText = telegramFormattedText(rendered, parseMode);
  if (!visibleText.trim()) {
    return { ok: false, message: 'message must not be empty after rendering' };
  }
  if (visibleText.length > TELEGRAM_TEXT_LIMIT) {
    return {
      ok: false,
      message: `message must be ${TELEGRAM_TEXT_LIMIT} characters or fewer after rendering`,
    };
  }

  return { ok: true, message: rendered };
};

const directMessageLocale = (locale: string): 'uz' | 'ru' => (locale === 'ru' ? 'ru' : 'uz');

const defaultRepairOrderButtonText = (locale: string): string =>
  t(directMessageLocale(locale), 'directDetails');

const localizedButtonText = (
  button: DirectMessageButtonPresentation,
  locale: string,
): string | undefined => {
  const localized = button.localizedText;
  if (localized) {
    const preferred = locale === 'ru' ? localized.ru : localized.uz;
    return (
      preferred?.trim() ||
      localized.uz?.trim() ||
      localized.ru?.trim() ||
      localized.en?.trim() ||
      button.text?.trim() ||
      undefined
    );
  }
  return button.text?.trim() || undefined;
};

const applyButtonStyle = (
  markup: InlineKeyboard,
  style: DirectMessageButtonStyle | undefined,
): InlineKeyboard => (style ? markup.style(style) : markup);

const actionButtonCallbackData = (
  button: DirectMessageActionButton,
  repairOrderUuid: string,
): string => {
  if (button.type === 'details') return `dm:ro:o:${repairOrderUuid}`;
  if (button.type === 'reject') return `dm:ap:r:${repairOrderUuid}`;
  if (button.type === 'approve') return `dm:ap:a:${repairOrderUuid}`;
  return `dm:rt:${button.type.slice('rating_'.length)}:${repairOrderUuid}`;
};

const appendActionLayout = (
  markup: InlineKeyboard,
  layout: DirectMessageActionButton[][],
  repairOrderUuid: string,
  locale: string,
): InlineKeyboard => {
  layout.forEach((row, rowIndex) => {
    if (rowIndex > 0) markup.row();
    row.forEach((button) => {
      const text = localizedButtonText(button, locale);
      if (!text) return;
      applyButtonStyle(
        markup.text(text, actionButtonCallbackData(button, repairOrderUuid)),
        button.style,
      );
    });
  });
  return markup;
};

const appendDefaultRatingLayout = (
  markup: InlineKeyboard,
  repairOrderUuid: string,
): InlineKeyboard => {
  for (let grade = 1; grade <= 10; grade += 1) {
    if (grade === 6) markup.row();
    markup.text(String(grade), `dm:rt:${grade}:${repairOrderUuid}`);
  }
  return markup;
};

export const buildDirectMessageInlineKeyboard = (
  keyboard: DirectMessageInlineKeyboard | undefined,
  locale: string,
): InlineKeyboard | undefined => {
  if (!keyboard) return undefined;

  const markup = new InlineKeyboard();
  if ('type' in keyboard) {
    if (keyboard.layout) {
      return appendActionLayout(markup, keyboard.layout, keyboard.repairOrderUuid, locale);
    }
    if (keyboard.type === 'details') {
      return applyButtonStyle(
        markup.text(
          localizedButtonText(keyboard, locale) ?? defaultRepairOrderButtonText(locale),
          `dm:ro:o:${keyboard.repairOrderUuid}`,
        ),
        keyboard.style,
      );
    }
    if (keyboard.type === 'approval') {
      return markup
        .text(
          t(directMessageLocale(locale), 'directApprovalReject'),
          `dm:ap:r:${keyboard.repairOrderUuid}`,
        )
        .danger()
        .text(
          t(directMessageLocale(locale), 'directApprovalApprove'),
          `dm:ap:a:${keyboard.repairOrderUuid}`,
        )
        .success();
    }

    return appendDefaultRatingLayout(markup, keyboard.repairOrderUuid);
  }

  keyboard.rows.forEach((row, rowIndex) => {
    if (rowIndex > 0) markup.row();
    row.forEach((button) => {
      if (button.type === 'url') {
        const text = localizedButtonText(button, locale);
        if (!text) return;
        applyButtonStyle(markup.url(text, button.url), button.style);
        return;
      }

      const text = localizedButtonText(button, locale);
      if (button.type === 'approval') {
        applyButtonStyle(
          markup.text(
            text ?? t(directMessageLocale(locale), 'directApprovalAction'),
            `dm:ap:o:${button.repairOrderUuid}`,
          ),
          button.style,
        );
        return;
      }
      if (button.type === 'rating') {
        applyButtonStyle(
          markup.text(
            text ?? t(directMessageLocale(locale), 'directRatingAction'),
            `dm:rt:o:${button.repairOrderUuid}`,
          ),
          button.style,
        );
        return;
      }
      applyButtonStyle(
        markup.text(
          text ?? defaultRepairOrderButtonText(locale),
          `dm:ro:o:${button.repairOrderUuid}`,
        ),
        button.style,
      );
    });
  });
  return markup;
};
