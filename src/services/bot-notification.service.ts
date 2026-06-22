import { InputFile } from 'grammy';
import type { Api } from 'grammy';

import type { TemplateRecipient, MessageTemplateType } from '../types/message-template.js';
import type { RegisteredUserStore } from './registered-user.store.js';
import { MessageTemplateRenderer, type MessageTemplateStore } from './message-template.service.js';

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
}

export interface DirectMessageDeliveryResult {
  status: 'sent' | 'failed' | 'not_found' | 'blocked';
}

type TelegramTemplateApi = Pick<Api, 'sendMessage' | 'sendPhoto'>;
type TelegramDirectMessageApi = Pick<Api, 'sendMessage'>;

const TELEGRAM_CAPTION_LIMIT = 1024;
export const TELEGRAM_TEXT_LIMIT = 4096;
const DIRECT_MESSAGE_DISPATCH_TYPE = 'api_direct_message';

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
  constructor(
    private readonly users: Pick<RegisteredUserStore, 'findByPhoneNumber'>,
    private readonly templates: Pick<MessageTemplateStore, 'logDispatch' | 'setUserBlocked'>,
    private readonly telegram: TelegramDirectMessageApi,
  ) {}

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

    try {
      await this.telegram.sendMessage(user.telegram_id, params.message);
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
