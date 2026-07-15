import { InlineKeyboard, type Bot } from 'grammy';

import { ClientRepairOrderError } from '../../services/client-repair-order.service.js';
import type {
  CustomerRepairOrderDetail,
  CustomerRepairOrderRatingGrade,
} from '../../types/client-repair-order.js';
import { escapeHtml } from '../../utils/html.js';
import { formatClientRepairOrderDetail } from '../formatters.js';
import { safeHttpUrl } from '../helpers.js';
import { t } from '../messages.js';
import type { BotContext, BotSession } from '../context.js';
import type { BotDependencies } from '../create-bot.js';
import { applyStatusNameOverridesToDetail } from './repair-orders.js';

const repairOrderCallbackPattern =
  /^dm:ro:(?<action>o|r|b):(?<repairOrderUuid>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const approvalCallbackPattern =
  /^dm:ap:(?<action>o|a|r|ca|cr|b):(?<repairOrderUuid>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const ratingCallbackPattern =
  /^dm:rt:(?<action>o|b|10|[1-9]):(?<repairOrderUuid>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

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

const captureOriginalMessage = (ctx: BotContext, repairOrderUuid: string): string | null => {
  const messageId = callbackMessageId(ctx);
  const text = callbackMessageText(ctx);
  const inlineKeyboard = ctx.callbackQuery?.message?.reply_markup?.inline_keyboard;
  if (!messageId || !text || !inlineKeyboard) return null;

  ctx.session.directMessageViews ??= {};
  const current = ctx.session.directMessageViews[messageId];
  if (current && current.repairOrderUuid !== repairOrderUuid) return null;
  ctx.session.directMessageViews[messageId] ??= {
    text,
    entities:
      ctx.callbackQuery?.message && 'entities' in ctx.callbackQuery.message
        ? ctx.callbackQuery.message.entities
        : undefined,
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
  await ctx.editMessageText(view.text, {
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

  await ctx.api.editMessageText(ctx.chat.id, Number(messageId), view.text, {
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
): Promise<CustomerRepairOrderDetail | null> => {
  const client = ctx.session.client;
  if (!client) {
    await ctx.reply(t(ctx.session.locale, 'registerFirst'));
    return null;
  }

  try {
    const order = await dependencies.clientRepairOrderService.getClientRepairOrder(
      client.client_id,
      repairOrderUuid,
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
): Promise<void> => {
  if (shouldCaptureOriginalMessage && !captureOriginalMessage(ctx, repairOrderUuid)) {
    await ctx.reply(t(ctx.session.locale, 'staleAction'));
    return;
  }

  const order = await loadAuthorizedOrder(ctx, dependencies, repairOrderUuid);
  if (!order) return;

  try {
    const displayedOrder = await applyStatusNameOverridesToDetail(order, dependencies);
    const content = formatClientRepairOrderDetail(displayedOrder, ctx.session.locale);
    await ctx.editMessageText(content.fallbackHtml, {
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
): Promise<void> => {
  const messageId = captureOriginalMessage(ctx, repairOrderUuid);
  if (!messageId) {
    await ctx.reply(t(ctx.session.locale, 'staleAction'));
    return;
  }
  const order = await loadAuthorizedOrder(ctx, dependencies, repairOrderUuid);
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
      .text(t(ctx.session.locale, 'directApprovalApprove'), `dm:ap:a:${repairOrderUuid}`)
      .row()
      .text(t(ctx.session.locale, 'back'), `dm:ap:b:${repairOrderUuid}`),
  });
};

const showRatingOptions = async (
  ctx: BotContext,
  dependencies: BotDependencies,
  repairOrderUuid: string,
): Promise<void> => {
  if (!captureOriginalMessage(ctx, repairOrderUuid)) {
    await ctx.reply(t(ctx.session.locale, 'staleAction'));
    return;
  }
  if (!(await loadAuthorizedOrder(ctx, dependencies, repairOrderUuid))) return;
  await ctx.editMessageReplyMarkup({
    reply_markup: new InlineKeyboard()
      .text('1', `dm:rt:1:${repairOrderUuid}`)
      .text('2', `dm:rt:2:${repairOrderUuid}`)
      .text('3', `dm:rt:3:${repairOrderUuid}`)
      .text('4', `dm:rt:4:${repairOrderUuid}`)
      .text('5', `dm:rt:5:${repairOrderUuid}`)
      .row()
      .text('6', `dm:rt:6:${repairOrderUuid}`)
      .text('7', `dm:rt:7:${repairOrderUuid}`)
      .text('8', `dm:rt:8:${repairOrderUuid}`)
      .text('9', `dm:rt:9:${repairOrderUuid}`)
      .text('10', `dm:rt:10:${repairOrderUuid}`)
      .row()
      .text(t(ctx.session.locale, 'back'), `dm:rt:b:${repairOrderUuid}`),
  });
};

const startApprovalAction = async (
  ctx: BotContext,
  dependencies: BotDependencies,
  repairOrderUuid: string,
  action: 'a' | 'r',
): Promise<void> => {
  const messageId = captureOriginalMessage(ctx, repairOrderUuid);
  if (!messageId) {
    await ctx.reply(t(ctx.session.locale, 'staleAction'));
    return;
  }
  const order = await loadAuthorizedOrder(ctx, dependencies, repairOrderUuid);
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
    messageId,
    mode: action === 'a' ? 'approve_confirmation' : 'rejection_note',
    submitting: false,
  };

  if (action === 'a') {
    await ctx.editMessageText(
      t(ctx.session.locale, 'directApprovalConfirm', {
        number: escapeHtml(order.order_number),
      }),
      {
        parse_mode: 'HTML',
        reply_markup: approvalBackKeyboard(ctx, repairOrderUuid).text(
          t(ctx.session.locale, 'directApprovalConfirmButton'),
          `dm:ap:ca:${repairOrderUuid}`,
        ),
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

  const order = await loadAuthorizedOrder(ctx, dependencies, flow.repairOrderUuid);
  if (!order) return;
  flow.note = note;
  flow.mode = 'reject_confirmation';
  delete ctx.session.stage;

  if (!ctx.chat) return;
  await ctx.api.editMessageText(
    ctx.chat.id,
    Number(flow.messageId),
    t(ctx.session.locale, 'directRejectionReview', {
      number: escapeHtml(order.order_number),
      note: escapeHtml(note),
    }),
    {
      parse_mode: 'HTML',
      reply_markup: approvalBackKeyboard(ctx, flow.repairOrderUuid).text(
        t(ctx.session.locale, 'directRejectionConfirmButton'),
        `dm:ap:cr:${flow.repairOrderUuid}`,
      ),
    },
  );
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

  const order = await loadAuthorizedOrder(ctx, dependencies, repairOrderUuid);
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
): Promise<void> => {
  if (!(await loadAuthorizedOrder(ctx, dependencies, repairOrderUuid))) return;

  try {
    await dependencies.clientRepairOrderService.submitRepairOrderRating(repairOrderUuid, { grade });
    const messageId = callbackMessageId(ctx);
    if (!messageId || !(await completeOriginalMessage(ctx, messageId, repairOrderUuid))) {
      await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
    }
    await ctx.reply(t(ctx.session.locale, 'directRatingAccepted', { grade: String(grade) }));
  } catch (error) {
    if (error instanceof ClientRepairOrderError && error.code === 'not_found') {
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

  bot.callbackQuery(approvalCallbackPattern, async (ctx) => {
    await ctx.answerCallbackQuery();
    const match = approvalCallbackPattern.exec(ctx.callbackQuery.data);
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
    if (action === 'o') {
      await showApprovalOptions(ctx, dependencies, repairOrderUuid);
      return;
    }
    if (action === 'a' || action === 'r') {
      await startApprovalAction(ctx, dependencies, repairOrderUuid, action);
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
    if (!repairOrderUuid || !action) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }
    if (action === 'b') {
      await restoreOriginalMessage(ctx, repairOrderUuid);
      return;
    }
    if (action === 'o') {
      await showRatingOptions(ctx, dependencies, repairOrderUuid);
      return;
    }
    const grade = Number(action);
    if (!Number.isInteger(grade) || grade < 1 || grade > 10) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }
    await submitRating(ctx, dependencies, repairOrderUuid, grade as CustomerRepairOrderRatingGrade);
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
