import { InlineKeyboard, type Bot } from 'grammy';
import type { InlineKeyboardMarkup, MessageEntity } from 'grammy/types';

import { ClientRepairOrderError } from '../../services/client-repair-order.service.js';
import type {
  CustomerRepairOrderDetail,
  CustomerRepairOrderRatingGrade,
} from '../../types/client-repair-order.js';
import { escapeHtml } from '../../utils/html.js';
import { telegramFormattedText } from '../../utils/telegram-formatting.js';
import { formatClientRepairOrderDetail } from '../formatters.js';
import { safeHttpUrl } from '../helpers.js';
import { t } from '../messages.js';
import type { BotContext, BotSession } from '../context.js';
import type { BotDependencies } from '../create-bot.js';
import { applyStatusNameOverridesToDetail } from './repair-orders.js';

const repairOrderCallbackPattern =
  /^dm:ro:(?<action>o|r|b):(?<repairOrderUuid>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?::(?<orderNumber>[0-9]{1,15}))?$/i;
const approvalCallbackPattern =
  /^dm:ap:(?<action>o|a|r|ca|cr|b):(?<repairOrderUuid>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?::(?<orderNumber>[0-9]{1,15}))?$/i;
const ratingCallbackPattern =
  /^dm:rt:(?<action>o|b|[0-9]{1,2}):(?<repairOrderUuid>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?::(?<orderNumber>[0-9]{1,15}))?$/i;
const TELEGRAM_CAPTION_LIMIT = 1024;

interface DirectMessageContent {
  text: string;
  entities: MessageEntity[] | undefined;
  contentType: 'text' | 'caption';
}

interface DirectMessageEditOptions {
  parse_mode?: 'HTML';
  entities?: MessageEntity[];
  reply_markup?: InlineKeyboardMarkup;
}

const callbackMessageId = (ctx: BotContext): string | null => {
  const message = ctx.callbackQuery?.message;
  if (!message || !('message_id' in message)) return null;
  return String(message.message_id);
};

const callbackMessageContent = (ctx: BotContext): DirectMessageContent | null => {
  const message = ctx.callbackQuery?.message;
  if (!message) return null;
  if ('text' in message && typeof message.text === 'string') {
    return {
      text: message.text,
      entities: message.entities,
      contentType: 'text',
    };
  }
  if ('caption' in message && typeof message.caption === 'string') {
    return {
      text: message.caption,
      entities: message.caption_entities,
      contentType: 'caption',
    };
  }
  return null;
};

const editCurrentDirectMessage = async (
  ctx: BotContext,
  text: string,
  options: DirectMessageEditOptions,
): Promise<void> => {
  const content = callbackMessageContent(ctx);
  if (content?.contentType === 'caption') {
    const { entities, ...captionOptions } = options;
    await ctx.editMessageCaption({
      caption: text,
      ...captionOptions,
      ...(entities ? { caption_entities: entities } : {}),
    });
    return;
  }
  await ctx.editMessageText(text, options);
};

const editStoredDirectMessage = async (
  ctx: BotContext,
  messageId: string,
  contentType: 'text' | 'caption',
  text: string,
  options: DirectMessageEditOptions,
): Promise<void> => {
  if (!ctx.chat) return;
  if (contentType === 'caption') {
    const { entities, ...captionOptions } = options;
    await ctx.api.editMessageCaption(ctx.chat.id, Number(messageId), {
      caption: text,
      ...captionOptions,
      ...(entities ? { caption_entities: entities } : {}),
    });
    return;
  }
  await ctx.api.editMessageText(ctx.chat.id, Number(messageId), text, options);
};

const approvalActionFromVisibleButton = (ctx: BotContext, callbackAction: 'a' | 'r'): 'a' | 'r' => {
  const callbackData = ctx.callbackQuery?.data;
  const rows = ctx.callbackQuery?.message?.reply_markup?.inline_keyboard;
  const button = rows
    ?.flat()
    .find((candidate) => 'callback_data' in candidate && candidate.callback_data === callbackData);
  if (button?.style === 'success') return 'a';
  if (button?.style === 'danger') return 'r';
  return callbackAction;
};

const captureOriginalMessage = (ctx: BotContext, repairOrderUuid: string): string | null => {
  const messageId = callbackMessageId(ctx);
  const content = callbackMessageContent(ctx);
  const inlineKeyboard = ctx.callbackQuery?.message?.reply_markup?.inline_keyboard;
  if (!messageId || !content || !inlineKeyboard) return null;

  ctx.session.directMessageViews ??= {};
  const current = ctx.session.directMessageViews[messageId];
  if (current && current.repairOrderUuid !== repairOrderUuid) return null;
  ctx.session.directMessageViews[messageId] ??= {
    text: content.text,
    entities: content.entities,
    contentType: content.contentType,
    repairOrderUuid,
    inlineKeyboard,
  };
  return messageId;
};

const clearApprovalFlow = (session: BotSession): void => {
  delete session.directMessageApproval;
  if (session.stage === 'direct_message_rejection_note') delete session.stage;
};

const restoreOriginalMessage = async (ctx: BotContext, repairOrderUuid: string): Promise<void> => {
  const messageId = callbackMessageId(ctx);
  const view = messageId ? ctx.session.directMessageViews?.[messageId] : undefined;
  if (!view || view.repairOrderUuid !== repairOrderUuid) {
    await ctx.reply(t(ctx.session.locale, 'staleAction'));
    return;
  }

  clearApprovalFlow(ctx.session);
  await editCurrentDirectMessage(ctx, view.text, {
    entities: view.entities,
    reply_markup: { inline_keyboard: view.inlineKeyboard },
  });
  if (messageId) delete ctx.session.directMessageViews?.[messageId];
};

const completeOriginalMessage = async (
  ctx: BotContext,
  messageId: string,
  repairOrderUuid: string,
): Promise<boolean> => {
  const view = ctx.session.directMessageViews?.[messageId];
  if (!view || view.repairOrderUuid !== repairOrderUuid || !ctx.chat) return false;

  await editStoredDirectMessage(ctx, messageId, view.contentType, view.text, {
    entities: view.entities,
    reply_markup: { inline_keyboard: [] },
  });
  delete ctx.session.directMessageViews?.[messageId];
  return true;
};

const loadAuthorizedOrder = async (
  ctx: BotContext,
  dependencies: BotDependencies,
  repairOrderUuid: string,
  knownOrderNumber?: string,
): Promise<CustomerRepairOrderDetail | null> => {
  const client = ctx.session.client;
  if (!client) {
    await ctx.reply(t(ctx.session.locale, 'registerFirst'));
    return null;
  }

  let orderNumber = knownOrderNumber;
  if (!orderNumber) {
    const messageId = ctx.callbackQuery?.message?.message_id;
    const chatId = ctx.chat?.id;
    if (messageId === undefined || chatId === undefined) {
      dependencies.logger.error('Direct-message repair order has no Telegram message context', {
        client_id: client.client_id,
        repair_order_id: repairOrderUuid,
      });
      await ctx.reply(t(ctx.session.locale, 'directActionUnavailable'));
      return null;
    }

    let mappedOrder;
    try {
      mappedOrder = await dependencies.supportMessageStore.findByTelegramMessageId(
        messageId,
        String(chatId),
      );
    } catch (error) {
      dependencies.logger.error('Failed to resolve direct-message repair-order context', error, {
        client_id: client.client_id,
        repair_order_id: repairOrderUuid,
        telegram_message_id: messageId,
      });
      await ctx.reply(t(ctx.session.locale, 'directActionUnavailable'));
      return null;
    }

    if (
      !mappedOrder ||
      mappedOrder.repair_order_id !== repairOrderUuid ||
      mappedOrder.crm_client_id !== client.client_id
    ) {
      dependencies.logger.error('Direct-message repair-order context is missing or mismatched', {
        client_id: client.client_id,
        repair_order_id: repairOrderUuid,
        telegram_message_id: messageId,
        mapped_client_id: mappedOrder?.crm_client_id,
        mapped_repair_order_id: mappedOrder?.repair_order_id,
      });
      await ctx.reply(t(ctx.session.locale, 'orderNotFound'));
      return null;
    }
    orderNumber = mappedOrder.order_number;
  }

  try {
    const order = await dependencies.clientRepairOrderService.getClientRepairOrder(
      client.client_id,
      orderNumber,
    );
    if (order.id !== repairOrderUuid) {
      dependencies.logger.error('CRM returned a mismatched direct-message repair order', {
        requested_repair_order_id: repairOrderUuid,
        returned_repair_order_id: order.id,
      });
      await ctx.reply(t(ctx.session.locale, 'orderNotFound'));
      return null;
    }
    return order;
  } catch (error) {
    if (error instanceof ClientRepairOrderError && error.code === 'not_found') {
      dependencies.logger.error(
        'Direct-message repair order was not found or is not visible to the client',
        error,
        {
          client_id: client.client_id,
          repair_order_id: repairOrderUuid,
        },
      );
      await ctx.reply(t(ctx.session.locale, 'orderNotFound'));
      return null;
    }
    dependencies.logger.error('Failed to authorize direct-message repair-order action', error);
    await ctx.reply(t(ctx.session.locale, 'directActionUnavailable'));
    return null;
  }
};

export const directMessageRepairOrderKeyboard = (
  locale: string,
  repairOrderUuid: string,
  options: {
    mapUrl?: string | null;
    checklistUrl?: string | null;
    warrantyDocumentUrl?: string | null;
    offerUrl?: string | null;
  } = {},
): InlineKeyboard => {
  const resolvedLocale = locale === 'ru' ? 'ru' : 'uz';
  const keyboard = new InlineKeyboard()
    .text(t(resolvedLocale, 'orderRefresh'), `dm:ro:r:${repairOrderUuid}`)
    .text(t(resolvedLocale, 'back'), `dm:ro:b:${repairOrderUuid}`);

  const externalActions = [
    options.mapUrl ? { text: t(resolvedLocale, 'orderMap'), url: options.mapUrl } : null,
    options.checklistUrl
      ? { text: t(resolvedLocale, 'orderChecklist'), url: options.checklistUrl }
      : null,
    options.warrantyDocumentUrl
      ? { text: t(resolvedLocale, 'orderWarrantyDocument'), url: options.warrantyDocumentUrl }
      : null,
    options.offerUrl ? { text: t(resolvedLocale, 'orderOffer'), url: options.offerUrl } : null,
  ].filter((action): action is { text: string; url: string } => action !== null);

  externalActions.forEach((action, index) => {
    if (index % 2 === 0) keyboard.row();
    keyboard.url(action.text, action.url);
  });

  return keyboard;
};

const showDirectMessageRepairOrder = async (
  ctx: BotContext,
  dependencies: BotDependencies,
  repairOrderUuid: string,
  shouldCaptureOriginalMessage: boolean,
  knownOrderNumber?: string,
): Promise<void> => {
  let capturedMessageId: string | null = null;
  if (shouldCaptureOriginalMessage) {
    capturedMessageId = captureOriginalMessage(ctx, repairOrderUuid);
    if (!capturedMessageId) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }
  }

  const order = await loadAuthorizedOrder(ctx, dependencies, repairOrderUuid, knownOrderNumber);
  if (!order) return;

  try {
    const displayedOrder = await applyStatusNameOverridesToDetail(order, dependencies);
    const content = formatClientRepairOrderDetail(displayedOrder, ctx.session.locale);
    if (
      callbackMessageContent(ctx)?.contentType === 'caption' &&
      telegramFormattedText(content.fallbackHtml, 'HTML').length > TELEGRAM_CAPTION_LIMIT
    ) {
      if (capturedMessageId) delete ctx.session.directMessageViews?.[capturedMessageId];
      await ctx.reply(content.fallbackHtml, { parse_mode: 'HTML' });
      return;
    }
    await editCurrentDirectMessage(ctx, content.fallbackHtml, {
      parse_mode: 'HTML',
      reply_markup: directMessageRepairOrderKeyboard(ctx.session.locale, repairOrderUuid, {
        mapUrl: safeHttpUrl(displayedOrder.branch?.map_url),
        checklistUrl: safeHttpUrl(displayedOrder.documents.checklist_url),
        warrantyDocumentUrl: safeHttpUrl(displayedOrder.documents.warranty_document_url),
        offerUrl: safeHttpUrl(displayedOrder.documents.offer_url),
      }),
    });
  } catch (error) {
    dependencies.logger.error('Failed to render direct-message repair-order detail', error);
    await ctx.reply(t(ctx.session.locale, 'ordersUnavailable'));
  }
};

const approvalBackKeyboard = (ctx: BotContext, repairOrderUuid: string): InlineKeyboard =>
  new InlineKeyboard().text(t(ctx.session.locale, 'back'), `dm:ap:b:${repairOrderUuid}`);

const showApprovalOptions = async (
  ctx: BotContext,
  dependencies: BotDependencies,
  repairOrderUuid: string,
  knownOrderNumber?: string,
): Promise<void> => {
  const messageId = captureOriginalMessage(ctx, repairOrderUuid);
  if (!messageId) {
    await ctx.reply(t(ctx.session.locale, 'staleAction'));
    return;
  }
  const order = await loadAuthorizedOrder(ctx, dependencies, repairOrderUuid, knownOrderNumber);
  if (!order) return;
  if (
    order.initial_problems_approval.status !== 'pending' ||
    !order.initial_problems_approval.requires_action
  ) {
    await completeOriginalMessage(ctx, messageId, repairOrderUuid);
    await ctx.reply(t(ctx.session.locale, 'directApprovalNoLongerPending'));
    return;
  }
  await ctx.editMessageReplyMarkup({
    reply_markup: new InlineKeyboard()
      .text(t(ctx.session.locale, 'directApprovalReject'), `dm:ap:r:${repairOrderUuid}`)
      .danger()
      .text(t(ctx.session.locale, 'directApprovalApprove'), `dm:ap:a:${repairOrderUuid}`)
      .success()
      .row()
      .text(t(ctx.session.locale, 'back'), `dm:ap:b:${repairOrderUuid}`),
  });
};

const showRatingOptions = async (
  ctx: BotContext,
  dependencies: BotDependencies,
  repairOrderUuid: string,
  knownOrderNumber?: string,
): Promise<void> => {
  if (!captureOriginalMessage(ctx, repairOrderUuid)) {
    await ctx.reply(t(ctx.session.locale, 'staleAction'));
    return;
  }
  if (!(await loadAuthorizedOrder(ctx, dependencies, repairOrderUuid, knownOrderNumber))) return;
  await ctx.editMessageReplyMarkup({
    reply_markup: new InlineKeyboard()
      .text('1', `dm:rt:1:${repairOrderUuid}`)
      .text('2', `dm:rt:2:${repairOrderUuid}`)
      .text('3', `dm:rt:3:${repairOrderUuid}`)
      .text('4', `dm:rt:4:${repairOrderUuid}`)
      .text('5', `dm:rt:5:${repairOrderUuid}`)
      .row()
      .text(t(ctx.session.locale, 'back'), `dm:rt:b:${repairOrderUuid}`),
  });
};

const startApprovalAction = async (
  ctx: BotContext,
  dependencies: BotDependencies,
  repairOrderUuid: string,
  action: 'a' | 'r',
  knownOrderNumber?: string,
): Promise<void> => {
  const messageId = captureOriginalMessage(ctx, repairOrderUuid);
  if (!messageId) {
    await ctx.reply(t(ctx.session.locale, 'staleAction'));
    return;
  }
  const order = await loadAuthorizedOrder(ctx, dependencies, repairOrderUuid, knownOrderNumber);
  if (!order) return;
  if (
    order.initial_problems_approval.status !== 'pending' ||
    !order.initial_problems_approval.requires_action
  ) {
    await completeOriginalMessage(ctx, messageId, repairOrderUuid);
    await ctx.reply(t(ctx.session.locale, 'directApprovalNoLongerPending'));
    return;
  }

  ctx.session.directMessageApproval = {
    repairOrderUuid,
    orderNumber: order.order_number,
    messageId,
    mode: action === 'a' ? 'approve_confirmation' : 'rejection_note',
    submitting: false,
  };

  if (action === 'a') {
    await editCurrentDirectMessage(
      ctx,
      t(ctx.session.locale, 'directApprovalConfirm', {
        number: escapeHtml(order.order_number),
      }),
      {
        parse_mode: 'HTML',
        reply_markup: approvalBackKeyboard(ctx, repairOrderUuid)
          .text(t(ctx.session.locale, 'directApprovalConfirmButton'), `dm:ap:ca:${repairOrderUuid}`)
          .success(),
      },
    );
    return;
  }

  ctx.session.stage = 'direct_message_rejection_note';
  await ctx.editMessageReplyMarkup({
    reply_markup: approvalBackKeyboard(ctx, repairOrderUuid),
  });
  await ctx.reply(
    t(ctx.session.locale, 'directRejectionPrompt', {
      number: escapeHtml(order.order_number),
    }),
    { parse_mode: 'HTML', reply_markup: { force_reply: true, selective: true } },
  );
};

const handleRejectionNote = async (
  ctx: BotContext,
  dependencies: BotDependencies,
): Promise<void> => {
  const flow = ctx.session.directMessageApproval;
  if (
    ctx.session.stage !== 'direct_message_rejection_note' ||
    !flow ||
    flow.mode !== 'rejection_note'
  ) {
    return;
  }
  const note = ctx.message?.text?.trim() ?? '';
  if (!note) {
    await ctx.reply(t(ctx.session.locale, 'directRejectionEmpty'));
    return;
  }
  if (note.length > 4_000) {
    await ctx.reply(t(ctx.session.locale, 'directRejectionTooLong'));
    return;
  }

  const order = await loadAuthorizedOrder(
    ctx,
    dependencies,
    flow.repairOrderUuid,
    flow.orderNumber,
  );
  if (!order) return;
  const reviewText = t(ctx.session.locale, 'directRejectionReview', {
    number: escapeHtml(order.order_number),
    note: escapeHtml(note),
  });
  const view = ctx.session.directMessageViews?.[flow.messageId];
  if (
    view?.contentType === 'caption' &&
    telegramFormattedText(reviewText, 'HTML').length > TELEGRAM_CAPTION_LIMIT
  ) {
    await ctx.reply(t(ctx.session.locale, 'directRejectionTooLong'));
    return;
  }
  flow.note = note;
  flow.mode = 'reject_confirmation';
  delete ctx.session.stage;

  if (!ctx.chat) return;
  await editStoredDirectMessage(ctx, flow.messageId, view?.contentType ?? 'text', reviewText, {
    parse_mode: 'HTML',
    reply_markup: approvalBackKeyboard(ctx, flow.repairOrderUuid)
      .text(
        t(ctx.session.locale, 'directRejectionConfirmButton'),
        `dm:ap:cr:${flow.repairOrderUuid}`,
      )
      .danger(),
  });
};

const submitApprovalAction = async (
  ctx: BotContext,
  dependencies: BotDependencies,
  repairOrderUuid: string,
  result: 'approved' | 'rejected',
): Promise<void> => {
  const flow = ctx.session.directMessageApproval;
  const expectedMode = result === 'approved' ? 'approve_confirmation' : 'reject_confirmation';
  if (
    !flow ||
    flow.repairOrderUuid !== repairOrderUuid ||
    flow.messageId !== callbackMessageId(ctx) ||
    flow.mode !== expectedMode ||
    flow.submitting ||
    (result === 'rejected' && !flow.note)
  ) {
    await ctx.reply(t(ctx.session.locale, 'staleAction'));
    return;
  }

  const order = await loadAuthorizedOrder(ctx, dependencies, repairOrderUuid, flow.orderNumber);
  if (!order) return;
  if (
    order.initial_problems_approval.status !== 'pending' ||
    !order.initial_problems_approval.requires_action
  ) {
    await completeOriginalMessage(ctx, flow.messageId, repairOrderUuid);
    clearApprovalFlow(ctx.session);
    await ctx.reply(t(ctx.session.locale, 'directApprovalNoLongerPending'));
    return;
  }

  flow.submitting = true;
  try {
    await dependencies.clientRepairOrderService.submitRepairOrderApproval(
      repairOrderUuid,
      result === 'rejected' ? { result, note: flow.note! } : { result },
    );
    await completeOriginalMessage(ctx, flow.messageId, repairOrderUuid);
    clearApprovalFlow(ctx.session);
    await ctx.reply(
      t(
        ctx.session.locale,
        result === 'approved' ? 'directApprovalAccepted' : 'directApprovalRejected',
      ),
    );
  } catch (error) {
    flow.submitting = false;
    if (
      error instanceof ClientRepairOrderError &&
      (error.code === 'not_found' ||
        error.location === 'telegram_initial_problems_approval_not_pending')
    ) {
      dependencies.logger.error('Repair-order approval action is no longer available', error, {
        repair_order_id: repairOrderUuid,
      });
      await completeOriginalMessage(ctx, flow.messageId, repairOrderUuid);
      clearApprovalFlow(ctx.session);
      await ctx.reply(t(ctx.session.locale, 'directApprovalNoLongerPending'));
      return;
    }
    dependencies.logger.error('Failed to submit repair-order approval decision', error);
    await ctx.reply(t(ctx.session.locale, 'directActionUnavailable'));
  }
};

const submitRating = async (
  ctx: BotContext,
  dependencies: BotDependencies,
  repairOrderUuid: string,
  grade: CustomerRepairOrderRatingGrade,
  knownOrderNumber?: string,
): Promise<void> => {
  if (!(await loadAuthorizedOrder(ctx, dependencies, repairOrderUuid, knownOrderNumber))) return;

  try {
    await dependencies.clientRepairOrderService.submitRepairOrderRating(repairOrderUuid, { grade });
    const messageId = callbackMessageId(ctx);
    if (!messageId || !(await completeOriginalMessage(ctx, messageId, repairOrderUuid))) {
      await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
    }
    await ctx.reply(t(ctx.session.locale, 'directRatingAccepted', { grade: String(grade) }));
  } catch (error) {
    if (error instanceof ClientRepairOrderError && error.code === 'not_found') {
      dependencies.logger.error('Repair-order rating target was not found', error, {
        repair_order_id: repairOrderUuid,
      });
      await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
      await ctx.reply(t(ctx.session.locale, 'orderNotFound'));
      return;
    }
    dependencies.logger.error('Failed to submit repair-order rating', error);
    await ctx.reply(t(ctx.session.locale, 'directActionUnavailable'));
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
    const orderNumber = match?.groups?.orderNumber;
    if (!action || !repairOrderUuid) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }

    if (action === 'b') {
      await restoreOriginalMessage(ctx, repairOrderUuid);
      return;
    }
    await showDirectMessageRepairOrder(
      ctx,
      dependencies,
      repairOrderUuid,
      action === 'o',
      orderNumber,
    );
  });

  bot.callbackQuery(approvalCallbackPattern, async (ctx) => {
    await ctx.answerCallbackQuery();
    const match = approvalCallbackPattern.exec(ctx.callbackQuery.data);
    const action = match?.groups?.action;
    const repairOrderUuid = match?.groups?.repairOrderUuid;
    const orderNumber = match?.groups?.orderNumber;
    if (!action || !repairOrderUuid) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }

    if (action === 'b') {
      await restoreOriginalMessage(ctx, repairOrderUuid);
      return;
    }
    if (action === 'o') {
      await showApprovalOptions(ctx, dependencies, repairOrderUuid, orderNumber);
      return;
    }
    if (action === 'a' || action === 'r') {
      const visibleAction = approvalActionFromVisibleButton(ctx, action);
      if (visibleAction !== action) {
        dependencies.logger.warn('Corrected a legacy approval callback using its visible style', {
          repair_order_id: repairOrderUuid,
          callback_action: action,
          visible_action: visibleAction,
        });
      }
      await startApprovalAction(ctx, dependencies, repairOrderUuid, visibleAction, orderNumber);
      return;
    }
    await submitApprovalAction(
      ctx,
      dependencies,
      repairOrderUuid,
      action === 'ca' ? 'approved' : 'rejected',
    );
  });

  bot.callbackQuery(ratingCallbackPattern, async (ctx) => {
    await ctx.answerCallbackQuery();
    const match = ratingCallbackPattern.exec(ctx.callbackQuery.data);
    const repairOrderUuid = match?.groups?.repairOrderUuid;
    const action = match?.groups?.action;
    const orderNumber = match?.groups?.orderNumber;
    if (!repairOrderUuid || !action) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }
    if (action === 'b') {
      await restoreOriginalMessage(ctx, repairOrderUuid);
      return;
    }
    if (action === 'o') {
      await showRatingOptions(ctx, dependencies, repairOrderUuid, orderNumber);
      return;
    }
    const grade = Number(action);
    if (!Number.isInteger(grade) || grade < 1 || grade > 5) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }
    await submitRating(
      ctx,
      dependencies,
      repairOrderUuid,
      grade as CustomerRepairOrderRatingGrade,
      orderNumber,
    );
  });

  bot.on('message:text', async (ctx, next) => {
    if (
      ctx.session.stage === 'direct_message_rejection_note' &&
      ctx.session.directMessageApproval
    ) {
      await handleRejectionNote(ctx, dependencies);
      return;
    }
    await next();
  });
};
