import { InlineKeyboard, type Bot } from 'grammy';

import { ClientRepairOrderError } from '../../services/client-repair-order.service.js';
import { formatClientRepairOrderDetail } from '../formatters.js';
import { safeHttpUrl } from '../helpers.js';
import { t } from '../messages.js';
import type { BotContext } from '../context.js';
import type { BotDependencies } from '../create-bot.js';

const repairOrderCallbackPattern =
  /^dm:ro:(?<action>o|r|b):(?<repairOrderUuid>[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

const callbackMessageId = (ctx: BotContext): string | null => {
  const message = ctx.callbackQuery?.message;
  if (!message || !('message_id' in message)) return null;
  return String(message.message_id);
};

const callbackMessageText = (ctx: BotContext): string | null => {
  const message = ctx.callbackQuery?.message;
  if (!message || !('text' in message) || typeof message.text !== 'string') return null;
  return message.text;
};

const buttonTextForOriginalMessage = (
  ctx: BotContext,
  repairOrderUuid: string,
): string | undefined => {
  const keyboard = ctx.callbackQuery?.message?.reply_markup?.inline_keyboard;
  const button = keyboard
    ?.flat()
    .find((item) => 'callback_data' in item && item.callback_data === `dm:ro:o:${repairOrderUuid}`);
  return button?.text;
};

export const directMessageRepairOrderKeyboard = (
  locale: string,
  repairOrderUuid: string,
  options: {
    originalButtonText?: string;
    mapUrl?: string | null;
    checklistUrl?: string | null;
    warrantyDocumentUrl?: string | null;
    offerUrl?: string | null;
  } = {},
): InlineKeyboard => {
  const keyboard = new InlineKeyboard()
    .text(t(locale === 'ru' ? 'ru' : 'uz', 'orderRefresh'), `dm:ro:r:${repairOrderUuid}`)
    .text(t(locale === 'ru' ? 'ru' : 'uz', 'back'), `dm:ro:b:${repairOrderUuid}`);

  const externalActions = [
    options.mapUrl
      ? { text: t(locale === 'ru' ? 'ru' : 'uz', 'orderMap'), url: options.mapUrl }
      : null,
    options.checklistUrl
      ? { text: t(locale === 'ru' ? 'ru' : 'uz', 'orderChecklist'), url: options.checklistUrl }
      : null,
    options.warrantyDocumentUrl
      ? {
          text: t(locale === 'ru' ? 'ru' : 'uz', 'orderWarrantyDocument'),
          url: options.warrantyDocumentUrl,
        }
      : null,
    options.offerUrl
      ? { text: t(locale === 'ru' ? 'ru' : 'uz', 'orderOffer'), url: options.offerUrl }
      : null,
  ].filter((action): action is { text: string; url: string } => action !== null);

  externalActions.forEach((action, index) => {
    if (index % 2 === 0) keyboard.row();
    keyboard.url(action.text, action.url);
  });

  return keyboard;
};

const restoreOriginalMessage = async (ctx: BotContext, repairOrderUuid: string): Promise<void> => {
  const messageId = callbackMessageId(ctx);
  const view = messageId ? ctx.session.directMessageViews?.[messageId] : undefined;
  if (!view || view.repairOrderUuid !== repairOrderUuid) {
    await ctx.reply(t(ctx.session.locale, 'staleAction'));
    return;
  }

  const keyboard = new InlineKeyboard().text(
    view.buttonText || (ctx.session.locale === 'ru' ? '🧾 Детали заказа' : '🧾 Buyurtmani ko‘rish'),
    `dm:ro:o:${repairOrderUuid}`,
  );
  await ctx.editMessageText(view.text, { reply_markup: keyboard });
};

const showDirectMessageRepairOrder = async (
  ctx: BotContext,
  dependencies: BotDependencies,
  repairOrderUuid: string,
  shouldCaptureOriginalMessage: boolean,
): Promise<void> => {
  const client = ctx.session.client;
  if (!client) {
    await ctx.reply(t(ctx.session.locale, 'registerFirst'));
    return;
  }

  const messageId = callbackMessageId(ctx);
  const originalText = callbackMessageText(ctx);
  if (shouldCaptureOriginalMessage && messageId && originalText) {
    ctx.session.directMessageViews ??= {};
    ctx.session.directMessageViews[messageId] ??= {
      text: originalText,
      repairOrderUuid,
      buttonText: buttonTextForOriginalMessage(ctx, repairOrderUuid),
    };
  }

  try {
    const order = await dependencies.clientRepairOrderService.getClientRepairOrder(
      client.client_id,
      repairOrderUuid,
    );
    const content = formatClientRepairOrderDetail(order, ctx.session.locale);
    await ctx.editMessageText(content.fallbackHtml, {
      parse_mode: 'HTML',
      reply_markup: directMessageRepairOrderKeyboard(ctx.session.locale, repairOrderUuid, {
        mapUrl: safeHttpUrl(order.branch?.map_url),
        checklistUrl: safeHttpUrl(order.documents.checklist_url),
        warrantyDocumentUrl: safeHttpUrl(order.documents.warranty_document_url),
        offerUrl: safeHttpUrl(order.documents.offer_url),
      }),
    });
  } catch (error) {
    if (error instanceof ClientRepairOrderError && error.code === 'not_found') {
      await ctx.reply(t(ctx.session.locale, 'orderNotFound'));
      return;
    }
    dependencies.logger.error('Failed to load direct-message repair-order detail', error);
    await ctx.reply(t(ctx.session.locale, 'ordersUnavailable'));
  }
};

export const registerDirectMessageHandlers = (
  bot: Bot<BotContext>,
  dependencies: BotDependencies,
): void => {
  bot.callbackQuery(repairOrderCallbackPattern, async (ctx) => {
    await ctx.answerCallbackQuery();
    const match = repairOrderCallbackPattern.exec(ctx.callbackQuery.data);
    const action = match?.groups?.action;
    const repairOrderUuid = match?.groups?.repairOrderUuid;
    if (!action || !repairOrderUuid) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }

    if (action === 'b') {
      await restoreOriginalMessage(ctx, repairOrderUuid);
      return;
    }

    await showDirectMessageRepairOrder(ctx, dependencies, repairOrderUuid, action === 'o');
  });
};
