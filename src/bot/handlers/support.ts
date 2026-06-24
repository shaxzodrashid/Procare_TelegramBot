import type { Bot } from 'grammy';
import type { BotContext } from '../context.js';
import type { BotDependencies } from '../create-bot.js';
import { t } from '../messages.js';
import {
  CUSTOMER_SUPPORT_PHOTO_MIME_TYPES,
  type CustomerSupportPhotoUpload,
} from '../../types/client-repair-order.js';
import type { SupportMessageContentType } from '../../types/support-message.js';
import { ClientRepairOrderError } from '../../services/client-repair-order.service.js';
import {
  clearAdminTemplateFlow,
  clearSettingsFlow,
  clearSupportFlow,
} from '../session.js';
import {
  personalMenuKeyboard,
  supportCommentKeyboard,
} from '../keyboards.js';
const SUPPORT_COMMENT_MAX_LENGTH = 4_000;
const SUPPORT_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const SUPPORT_PHOTO_MIME_TYPES = new Set<string>(CUSTOMER_SUPPORT_PHOTO_MIME_TYPES);

const startSupportComment = async (ctx: BotContext): Promise<void> => {
  const repairOrderId = ctx.session.repairOrdersView?.selectedRepairOrderId;
  const orderNumber = ctx.session.repairOrdersView?.selectedOrderNumber;
  if (!ctx.session.client || !repairOrderId || !orderNumber) {
    await ctx.reply(t(ctx.session.locale, 'supportOrderUnavailable'));
    return;
  }

  clearAdminTemplateFlow(ctx.session);
  clearSettingsFlow(ctx.session);
  ctx.session.stage = 'support_comment_input';
  ctx.session.supportComment = {
    repairOrderId,
    orderNumber,
    submitting: false,
  };
  await ctx.reply(t(ctx.session.locale, 'supportPrompt', { number: orderNumber }), {
    reply_markup: supportCommentKeyboard(ctx.session.locale),
  });
};

const submitSupportComment = async (
  ctx: BotContext,
  dependencies: BotDependencies,
  input: {
    text?: string;
    photos?: CustomerSupportPhotoUpload[];
    telegramMessage?: {
      chatId: string;
      messageId: number;
      date: Date | null;
      contentType: SupportMessageContentType;
    };
  },
): Promise<void> => {
  const draft = ctx.session.supportComment;
  if (ctx.session.stage !== 'support_comment_input' || !draft || !ctx.session.client) {
    await ctx.reply(t(ctx.session.locale, 'staleAction'));
    return;
  }
  if (draft.submitting) return;

  const text = input.text?.trim();
  const photos = input.photos ?? [];
  if (!text && photos.length === 0) {
    await ctx.reply(t(ctx.session.locale, 'supportEmpty'), {
      reply_markup: supportCommentKeyboard(ctx.session.locale),
    });
    return;
  }
  if (text && text.length > SUPPORT_COMMENT_MAX_LENGTH) {
    await ctx.reply(t(ctx.session.locale, 'supportTooLong'), {
      reply_markup: supportCommentKeyboard(ctx.session.locale),
    });
    return;
  }

  draft.submitting = true;
  const pendingMessage = ctx.chat ? await ctx.reply(t(ctx.session.locale, 'supportSending')) : null;
  try {
    const result = await dependencies.clientRepairOrderService.registerClientSupportComment(
      draft.repairOrderId,
      {
        text,
        photos,
      },
    );
    if (input.telegramMessage && ctx.from) {
      try {
        await dependencies.supportMessageStore.save({
          crm_comment_id: result.comment.id,
          crm_client_id: ctx.session.client.client_id,
          repair_order_id: draft.repairOrderId,
          order_number: draft.orderNumber,
          telegram_id: String(ctx.from.id),
          telegram_chat_id: input.telegramMessage.chatId,
          telegram_message_id: input.telegramMessage.messageId,
          telegram_message_date: input.telegramMessage.date,
          sender_type: 'client',
          direction: 'inbound',
          content_type: input.telegramMessage.contentType,
          text: text ?? null,
          photo_count: photos.length,
        });
      } catch (storageError) {
        dependencies.logger.error('Failed to store support message mapping', storageError, {
          crm_comment_id: result.comment.id,
          repair_order_id: draft.repairOrderId,
          telegram_message_id: input.telegramMessage.messageId,
        });
      }
    }
    if (pendingMessage && ctx.chat) {
      await ctx.api.deleteMessage(ctx.chat.id, pendingMessage.message_id).catch(() => undefined);
    }
    clearSupportFlow(ctx.session);
    await ctx.reply(t(ctx.session.locale, result.created ? 'supportSent' : 'supportDuplicate'), {
      reply_markup: personalMenuKeyboard(ctx.session),
    });
  } catch (error) {
    draft.submitting = false;
    if (pendingMessage && ctx.chat) {
      await ctx.api.deleteMessage(ctx.chat.id, pendingMessage.message_id).catch(() => undefined);
    }
    dependencies.logger.error('Failed to register client support comment', error);
    const key =
      error instanceof ClientRepairOrderError && error.code === 'not_found'
        ? 'supportOrderUnavailable'
        : 'supportUnavailable';
    await ctx.reply(t(ctx.session.locale, key), {
      reply_markup: supportCommentKeyboard(ctx.session.locale),
    });
  }
};

const supportPhotoMimeTypeFromPath = (
  filePath: string,
): CustomerSupportPhotoUpload['mimeType'] | null => {
  const extension = filePath.split(/[\\/]/).pop()?.split('.').pop()?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  return null;
};

const supportPhotoExtension = (mimeType: CustomerSupportPhotoUpload['mimeType']): string => {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
};

const normalizeTelegramSupportPhotoMimeType = (
  contentType: string | null,
  filePath: string,
): CustomerSupportPhotoUpload['mimeType'] | null => {
  const mimeType = contentType?.split(';', 1)[0]?.trim().toLowerCase();
  if (mimeType && SUPPORT_PHOTO_MIME_TYPES.has(mimeType)) {
    return mimeType as CustomerSupportPhotoUpload['mimeType'];
  }
  return supportPhotoMimeTypeFromPath(filePath);
};

const downloadTelegramSupportPhoto = async (
  ctx: BotContext,
  botToken: string,
): Promise<CustomerSupportPhotoUpload | null> => {
  const photos = ctx.message && 'photo' in ctx.message ? ctx.message.photo : undefined;
  if (!photos || photos.length === 0) return null;

  const largest = photos.reduce((best, current) =>
    (current.file_size ?? 0) > (best.file_size ?? 0) ? current : best,
  );
  if (largest.file_size && largest.file_size > SUPPORT_PHOTO_MAX_BYTES) {
    throw new ClientRepairOrderError('invalid_request', 'support photo is too large');
  }

  const file = await ctx.api.getFile(largest.file_id);
  if (!file.file_path) return null;
  const response = await fetch(`https://api.telegram.org/file/bot${botToken}/${file.file_path}`, {
    method: 'GET',
  });
  if (!response.ok) return null;
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > SUPPORT_PHOTO_MAX_BYTES) {
    throw new ClientRepairOrderError('invalid_request', 'support photo is too large');
  }

  const mimeType = normalizeTelegramSupportPhotoMimeType(
    response.headers.get('content-type'),
    file.file_path,
  );
  if (!mimeType) return null;

  const fileName = `telegram-${largest.file_unique_id}.${supportPhotoExtension(mimeType)}`;
  return { data: buffer, fileName, mimeType };
};

export const registerSupportHandlers = (
  bot: Bot<BotContext>,
  token: string,
  dependencies: BotDependencies,
): void => {
  bot.callbackQuery('ro:s', async (ctx) => {
    await ctx.answerCallbackQuery();
    await startSupportComment(ctx);
  });

  bot.on('message:photo', async (ctx, next) => {
    if (ctx.session.stage !== 'support_comment_input') {
      return next();
    }

    try {
      const photo = await downloadTelegramSupportPhoto(ctx, token);
      if (!photo) {
        await ctx.reply(t(ctx.session.locale, 'supportPhotoUnavailable'), {
          reply_markup: supportCommentKeyboard(ctx.session.locale),
        });
        return;
      }
      await submitSupportComment(ctx, dependencies, {
        text: ctx.message.caption,
        photos: [photo],
        telegramMessage: {
          chatId: String(ctx.chat.id),
          messageId: ctx.message.message_id,
          date: new Date(ctx.message.date * 1000),
          contentType: 'photo',
        },
      });
    } catch (error) {
      if (error instanceof ClientRepairOrderError && error.code === 'invalid_request') {
        await ctx.reply(t(ctx.session.locale, 'supportPhotoTooLarge'), {
          reply_markup: supportCommentKeyboard(ctx.session.locale),
        });
        return;
      }
      dependencies.logger.error('Failed to prepare Telegram support photo', error);
      await ctx.reply(t(ctx.session.locale, 'supportPhotoUnavailable'), {
        reply_markup: supportCommentKeyboard(ctx.session.locale),
      });
    }
  });

  bot.on('message:text', async (ctx, next) => {
    if (ctx.session.stage !== 'support_comment_input') {
      return next();
    }

    if (ctx.message.text === t(ctx.session.locale, 'supportCancel')) {
      clearSupportFlow(ctx.session);
      await ctx.reply(t(ctx.session.locale, 'supportCancelled'), {
        reply_markup: personalMenuKeyboard(ctx.session),
      });
      return;
    }

    await submitSupportComment(ctx, dependencies, {
      text: ctx.message.text,
      telegramMessage: {
        chatId: String(ctx.chat.id),
        messageId: ctx.message.message_id,
        date: new Date(ctx.message.date * 1000),
        contentType: 'text',
      },
    });
  });
};
