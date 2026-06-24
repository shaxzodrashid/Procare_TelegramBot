import type { Bot } from 'grammy';
import type { BotContext } from '../context.js';
import type { BotDependencies } from '../create-bot.js';
import { t } from '../messages.js';
import {
  hasEmployeeMenuAccess,
  replyWithAdminRegistration,
  safeHttpUrl,
} from '../helpers.js';
import { clearSupportFlow } from '../session.js';
import { replySmart } from '../rich-messages.js';
import {
  formatClientRepairOrderDetail,
  formatClientRepairOrderList,
} from '../formatters.js';
import {
  languageKeyboard,
  personalMenuKeyboard,
  repairOrderDetailKeyboard,
  repairOrdersKeyboard,
} from '../keyboards.js';
import { ClientRepairOrderError } from '../../services/client-repair-order.service.js';

const REPAIR_ORDERS_PAGE_SIZE = 10;

export const showClientRepairOrders = async (
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

export const showClientRepairOrderDetail = async (
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
    ctx.session.repairOrdersView.selectedRepairOrderId = order.id;
    await replySmart(ctx, formatClientRepairOrderDetail(order, ctx.session.locale), {
      enabled: dependencies.richMessagesEnabled,
      logger: dependencies.logger,
      replyMarkup: repairOrderDetailKeyboard(ctx.session.locale, {
        supportEnabled: true,
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
    dependencies.logger.error('Failed to load client repair-order detail', error);
    await ctx.reply(t(ctx.session.locale, 'ordersUnavailable'));
  }
};

export const registerRepairOrdersHandlers = (
  bot: Bot<BotContext>,
  dependencies: BotDependencies,
): void => {
  bot.hears([t('uz', 'orders'), t('ru', 'orders')], async (ctx) => {
    if (!ctx.session.client) {
      if (hasEmployeeMenuAccess(ctx.session)) {
        await replyWithAdminRegistration(ctx);
      } else {
        await ctx.reply(t(ctx.session.locale, 'registerFirst'), {
          reply_markup: languageKeyboard(),
        });
      }
      return;
    }
    clearSupportFlow(ctx.session);
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
};
