import type { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../context.js';
import type { BotDependencies } from '../create-bot.js';
import { t } from '../messages.js';
import { hasEmployeeMenuAccess, replyWithAdminRegistration, safeHttpUrl } from '../helpers.js';
import { clearSupportFlow } from '../session.js';
import type { SmartReplyContent } from '../rich-messages.js';
import { replySmart } from '../rich-messages.js';
import { formatClientRepairOrderDetail, formatClientRepairOrderList } from '../formatters.js';
import {
  languageKeyboard,
  osTypesKeyboard,
  personalMenuKeyboard,
  repairOrderDetailKeyboard,
  repairOrdersKeyboard,
} from '../keyboards.js';
import { ClientRepairOrderError } from '../../services/client-repair-order.service.js';
import { RepairOrderError } from '../../services/repair-order.service.js';
import type {
  CustomerRepairOrderDetail,
  CustomerRepairOrderList,
} from '../../types/client-repair-order.js';

const applyStatusNameOverridesToList = async (
  result: CustomerRepairOrderList,
  dependencies: BotDependencies,
): Promise<CustomerRepairOrderList> => {
  if (!dependencies.repairOrderStatusNameStore) return result;
  const overrides = await dependencies.repairOrderStatusNameStore.findDisplayNamesByStatusIds(
    result.orders.map((order) => order.status.code),
  );
  if (overrides.size === 0) return result;
  return {
    ...result,
    orders: result.orders.map((order) => {
      const override = overrides.get(order.status.code);
      if (!override) return order;
      return {
        ...order,
        status: {
          ...order.status,
          name_uz: override.display_name_uz ?? order.status.name_uz,
          name_ru: override.display_name_ru ?? order.status.name_ru,
        },
      };
    }),
  };
};

export const applyStatusNameOverridesToDetail = async (
  order: CustomerRepairOrderDetail,
  dependencies: BotDependencies,
): Promise<CustomerRepairOrderDetail> => {
  if (!dependencies.repairOrderStatusNameStore) return order;
  const overrides = await dependencies.repairOrderStatusNameStore.findDisplayNamesByStatusIds([
    order.status.code,
  ]);
  const override = overrides.get(order.status.code);
  if (!override) return order;
  return {
    ...order,
    status: {
      ...order.status,
      name_uz: override.display_name_uz ?? order.status.name_uz,
      name_ru: override.display_name_ru ?? order.status.name_ru,
    },
  };
};

const REPAIR_ORDERS_PAGE_SIZE = 10;

type RepairOrderEditOptions = NonNullable<Parameters<BotContext['editMessageText']>[1]>;
type RepairOrderReplyOptions = NonNullable<Parameters<BotContext['reply']>[1]>;
type RepairOrderSmartOptions = RepairOrderEditOptions & { reply_markup?: InlineKeyboard };

const isMessageNotModifiedError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const description =
    'description' in error && typeof error.description === 'string'
      ? error.description
      : 'message' in error && typeof error.message === 'string'
        ? error.message
        : '';
  return description.toLowerCase().includes('message is not modified');
};

const editRepairOrderWindow = async (
  ctx: BotContext,
  text: string,
  options: RepairOrderEditOptions,
): Promise<boolean> => {
  if (!ctx.callbackQuery?.message) return false;

  try {
    await ctx.editMessageText(text, options);
    return true;
  } catch (error) {
    return isMessageNotModifiedError(error);
  }
};

const sendOrEditRepairOrderWindow = async (
  ctx: BotContext,
  content: SmartReplyContent,
  dependencies: BotDependencies,
  options: RepairOrderSmartOptions,
  preferEdit: boolean,
): Promise<void> => {
  if (preferEdit && (await editRepairOrderWindow(ctx, content.fallbackHtml, options))) return;

  await replySmart(ctx, content, {
    enabled: dependencies.richMessagesEnabled,
    logger: dependencies.logger,
    replyMarkup: options.reply_markup,
  });
};

const sendOrEditPlainWindow = async (
  ctx: BotContext,
  text: string,
  options: RepairOrderReplyOptions,
  preferEdit: boolean,
): Promise<void> => {
  if (preferEdit && (await editRepairOrderWindow(ctx, text, {}))) return;
  await ctx.reply(text, options);
};

const editPendingMessage = async (
  ctx: BotContext,
  pendingMessage: { message_id: number } | undefined,
  text: string,
  options: RepairOrderEditOptions,
): Promise<boolean> => {
  if (!pendingMessage || !ctx.chat) return false;

  try {
    await ctx.api.editMessageText(ctx.chat.id, pendingMessage.message_id, text, options);
    return true;
  } catch (error) {
    return isMessageNotModifiedError(error);
  }
};

export const showClientRepairOrders = async (
  ctx: BotContext,
  dependencies: BotDependencies,
  offset: number,
  showLoading = false,
  preferEdit = false,
): Promise<void> => {
  const client = ctx.session.client;
  if (!client) {
    await ctx.reply(t(ctx.session.locale, 'registerFirst'), {
      reply_markup: languageKeyboard(),
    });
    return;
  }

  const pendingMessage =
    showLoading && !preferEdit && ctx.chat
      ? await ctx.reply(t(ctx.session.locale, 'ordersLoading'))
      : undefined;
  if (showLoading && preferEdit) {
    await editRepairOrderWindow(ctx, t(ctx.session.locale, 'ordersLoading'), {});
  }

  try {
    const result = await dependencies.clientRepairOrderService.listClientRepairOrders(
      client.client_id,
      {
        limit: REPAIR_ORDERS_PAGE_SIZE,
        offset,
      },
    );
    const displayedResult = await applyStatusNameOverridesToList(result, dependencies);

    if (displayedResult.orders.length === 0) {
      ctx.session.repairOrdersView = { offset: result.pagination.offset, orderNumbers: [] };
      const noOrdersOptions = {
        reply_markup: personalMenuKeyboard(ctx.session),
      };
      if (await editPendingMessage(ctx, pendingMessage, t(ctx.session.locale, 'noOrders'), {})) {
        return;
      }
      await sendOrEditPlainWindow(
        ctx,
        t(ctx.session.locale, 'noOrders'),
        noOrdersOptions,
        preferEdit,
      );
      return;
    }

    const orderNumbers = displayedResult.orders.map((order) => order.order_number);
    ctx.session.repairOrdersView = {
      offset: result.pagination.offset,
      orderNumbers,
    };
    const listContent = formatClientRepairOrderList(displayedResult, ctx.session.locale);
    const listOptions = {
      parse_mode: 'HTML' as const,
      reply_markup: repairOrdersKeyboard(orderNumbers, result.pagination, ctx.session.locale),
    };
    if (await editPendingMessage(ctx, pendingMessage, listContent.fallbackHtml, listOptions)) {
      return;
    }
    await sendOrEditRepairOrderWindow(ctx, listContent, dependencies, listOptions, preferEdit);
  } catch (error) {
    dependencies.logger.error('Failed to load client repair orders', error);
    const unavailableOptions = {
      reply_markup: personalMenuKeyboard(ctx.session),
    };
    if (
      await editPendingMessage(ctx, pendingMessage, t(ctx.session.locale, 'ordersUnavailable'), {})
    ) {
      return;
    }
    await sendOrEditPlainWindow(
      ctx,
      t(ctx.session.locale, 'ordersUnavailable'),
      unavailableOptions,
      preferEdit,
    );
  }
};

export const showClientRepairOrderDetail = async (
  ctx: BotContext,
  dependencies: BotDependencies,
  orderNumber: string,
  preferEdit = false,
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
    const displayedOrder = await applyStatusNameOverridesToDetail(order, dependencies);
    ctx.session.repairOrdersView ??= { offset: 0, orderNumbers: [] };
    ctx.session.repairOrdersView.selectedOrderNumber = displayedOrder.order_number;
    ctx.session.repairOrdersView.selectedRepairOrderId = displayedOrder.id;
    ctx.session.repairOrdersView.selectedAssignedAdminIds = displayedOrder.assigned_admins.map(
      (admin) => admin.id,
    );
    await sendOrEditRepairOrderWindow(
      ctx,
      formatClientRepairOrderDetail(displayedOrder, ctx.session.locale),
      dependencies,
      {
        parse_mode: 'HTML',
        reply_markup: repairOrderDetailKeyboard(ctx.session.locale, {
          supportEnabled: true,
          mapUrl: safeHttpUrl(displayedOrder.branch?.map_url),
          checklistUrl: safeHttpUrl(displayedOrder.documents.checklist_url),
          warrantyDocumentUrl: safeHttpUrl(displayedOrder.documents.warranty_document_url),
          offerUrl: safeHttpUrl(displayedOrder.documents.offer_url),
        }),
      },
      preferEdit,
    );
  } catch (error) {
    if (error instanceof ClientRepairOrderError && error.code === 'not_found') {
      dependencies.logger.error(
        'Client repair order was not found or is not visible to the client',
        error,
        {
          client_id: client.client_id,
          order_number: orderNumber,
        },
      );
      await sendOrEditPlainWindow(ctx, t(ctx.session.locale, 'orderNotFound'), {}, preferEdit);
      return;
    }
    dependencies.logger.error('Failed to load client repair-order detail', error);
    await sendOrEditPlainWindow(ctx, t(ctx.session.locale, 'ordersUnavailable'), {}, preferEdit);
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

  bot.hears([t('uz', 'leaveRequestMenu'), t('ru', 'leaveRequestMenu')], async (ctx) => {
    const client = ctx.session.client;
    if (!client) {
      if (hasEmployeeMenuAccess(ctx.session)) {
        await replyWithAdminRegistration(ctx);
      } else {
        await ctx.reply(t(ctx.session.locale, 'registerFirst'), {
          reply_markup: languageKeyboard(),
        });
      }
      return;
    }

    if (!client.phone_number) {
      await ctx.reply(t(ctx.session.locale, 'requestUnavailable'), {
        reply_markup: personalMenuKeyboard(ctx.session),
      });
      return;
    }

    // Populate unknownClient from the registered profile so the shared flow works
    ctx.session.unknownClient = {
      phoneNumber: client.phone_number,
      firstName: client.first_name ?? ctx.from?.first_name ?? 'Telegram user',
      lastName: client.last_name ?? null,
      username: ctx.from?.username ?? null,
    };
    ctx.session.stage = 'client_repair_request';

    try {
      const osTypes = await dependencies.repairOrderService.getOsTypes();
      if (osTypes.length === 0) {
        delete ctx.session.unknownClient;
        delete ctx.session.stage;
        await ctx.reply(t(ctx.session.locale, 'noOsTypes'), {
          reply_markup: personalMenuKeyboard(ctx.session),
        });
        return;
      }
      ctx.session.repairDraft = {
        osTypes,
        categoryPath: [],
        categories: [],
        categoryPage: 0,
        problems: [],
        selectedProblemIds: [],
        note: '',
        submitting: false,
      };
      ctx.session.stage = 'choosing_os';
      await ctx.reply(t(ctx.session.locale, 'leaveRequestIntro'), {
        reply_markup: personalMenuKeyboard(ctx.session),
      });
      await ctx.reply(t(ctx.session.locale, 'chooseOs'), {
        reply_markup: osTypesKeyboard(osTypes, ctx.session.locale),
      });
    } catch (error) {
      dependencies.logger.error('Failed to load OS types for client repair request', error);
      delete ctx.session.unknownClient;
      delete ctx.session.stage;
      await ctx.reply(
        t(
          ctx.session.locale,
          error instanceof RepairOrderError && error.code === 'maintenance'
            ? 'maintenance'
            : 'requestUnavailable',
        ),
        { reply_markup: personalMenuKeyboard(ctx.session) },
      );
    }
  });

  bot.callbackQuery(/^ro:p:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const match = /^ro:p:(\d+)$/.exec(ctx.callbackQuery.data);
    const offset = match?.[1] ? Number(match[1]) : Number.NaN;
    if (!Number.isSafeInteger(offset) || offset < 0 || !ctx.session.client) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }
    await showClientRepairOrders(ctx, dependencies, offset, false, true);
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
    await showClientRepairOrderDetail(ctx, dependencies, orderNumber, true);
  });

  bot.callbackQuery('ro:r', async (ctx) => {
    await ctx.answerCallbackQuery();
    const orderNumber = ctx.session.repairOrdersView?.selectedOrderNumber;
    if (!orderNumber || !ctx.session.client) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }
    await showClientRepairOrderDetail(ctx, dependencies, orderNumber, true);
  });

  bot.callbackQuery('ro:b', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.session.client) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }
    await showClientRepairOrders(
      ctx,
      dependencies,
      ctx.session.repairOrdersView?.offset ?? 0,
      false,
      true,
    );
  });
};
