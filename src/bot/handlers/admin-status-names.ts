import type { Bot } from 'grammy';

import type { RepairOrderStatusNameRecord } from '../../types/repair-order-status.js';
import { escapeHtml } from '../../utils/html.js';
import type { BotContext } from '../context.js';
import type { BotDependencies } from '../create-bot.js';
import {
  adminStatusNameCancelKeyboard,
  adminStatusNameDetailKeyboard,
  adminStatusNameListKeyboard,
  personalMenuKeyboard,
} from '../keyboards.js';
import { t } from '../messages.js';
import {
  clearAdminExportFlow,
  clearAdminStatusNameFlow,
  clearAdminTemplateFlow,
} from '../session.js';
import { requireAdmin } from './admin-clients.js';

type StatusWindowOptions = NonNullable<Parameters<BotContext['reply']>[1]> &
  NonNullable<Parameters<BotContext['editMessageText']>[1]>;

const formatStatusList = (statuses: RepairOrderStatusNameRecord[], locale: 'uz' | 'ru'): string => {
  const rows = statuses.map((status, index) => {
    const crmName = locale === 'ru' ? status.crm_name_ru : status.crm_name_uz;
    const display = locale === 'ru' ? status.display_name_ru : status.display_name_uz;
    return `${index + 1}. <b>${escapeHtml(crmName)}</b>\n<code>${escapeHtml(
      status.crm_status_id,
    )}</code> → ${escapeHtml(display ?? '—')}`;
  });

  return [
    `<b>${escapeHtml(t(locale, 'adminStatusNamesTitle'))}</b>`,
    '',
    rows.length > 0 ? rows.join('\n\n') : escapeHtml(t(locale, 'adminStatusNamesEmpty')),
  ].join('\n');
};

const formatStatusDetail = (status: RepairOrderStatusNameRecord, locale: 'uz' | 'ru'): string =>
  t(locale, 'adminStatusNameDetail', {
    crmName: escapeHtml(locale === 'ru' ? status.crm_name_ru : status.crm_name_uz),
    crmStatusId: escapeHtml(status.crm_status_id),
    displayUz: escapeHtml(status.display_name_uz ?? '—'),
    displayRu: escapeHtml(status.display_name_ru ?? '—'),
  });

const replyOrEdit = async (
  ctx: BotContext,
  text: string,
  options: StatusWindowOptions,
  preferEdit: boolean,
): Promise<void> => {
  if (!preferEdit || !ctx.callbackQuery?.message) {
    await ctx.reply(text, options);
    return;
  }

  try {
    await ctx.editMessageText(text, options);
  } catch (error) {
    if (isMessageNotModifiedError(error)) return;
    await ctx.reply(text, options);
  }
};

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

const refreshStatusesFromCrm = async (dependencies: BotDependencies): Promise<void> => {
  if (!dependencies.repairOrderStatusService || !dependencies.repairOrderStatusNameStore) {
    throw new Error('Repair-order status dependencies are not configured');
  }
  const result = await dependencies.repairOrderStatusService.listStatuses();
  await dependencies.repairOrderStatusNameStore.upsertFromCrm(result.statuses);
};

const showStatusList = async (
  ctx: BotContext,
  dependencies: BotDependencies,
  options: { refresh?: boolean; preferEdit?: boolean } = {},
): Promise<void> => {
  if (options.refresh) await refreshStatusesFromCrm(dependencies);
  if (!dependencies.repairOrderStatusNameStore) {
    throw new Error('Repair-order status name store is not configured');
  }
  const statuses = await dependencies.repairOrderStatusNameStore.listStatuses();
  await replyOrEdit(
    ctx,
    formatStatusList(statuses, ctx.session.locale),
    {
      parse_mode: 'HTML',
      reply_markup: adminStatusNameListKeyboard(statuses, ctx.session.locale),
    },
    options.preferEdit ?? false,
  );
};

const showStatusDetail = async (
  ctx: BotContext,
  dependencies: BotDependencies,
  statusId: string,
  options: { preferEdit?: boolean } = {},
): Promise<void> => {
  if (!dependencies.repairOrderStatusNameStore) {
    throw new Error('Repair-order status name store is not configured');
  }
  const status = await dependencies.repairOrderStatusNameStore.findById(statusId);
  if (!status) {
    await ctx.reply(t(ctx.session.locale, 'adminStatusNameNotFound'));
    return;
  }
  await replyOrEdit(
    ctx,
    formatStatusDetail(status, ctx.session.locale),
    {
      parse_mode: 'HTML',
      reply_markup: adminStatusNameDetailKeyboard(status, ctx.session.locale),
    },
    options.preferEdit ?? false,
  );
};

const startEdit = async (
  ctx: BotContext,
  statusId: string,
  field: 'display_name_uz' | 'display_name_ru',
): Promise<void> => {
  ctx.session.adminStatusNameInput = { statusId, field };
  ctx.session.stage = 'admin_status_name_input';
  await ctx.reply(
    t(
      ctx.session.locale,
      field === 'display_name_uz' ? 'adminStatusNamePromptUz' : 'adminStatusNamePromptRu',
    ),
    {
      reply_markup: adminStatusNameCancelKeyboard(ctx.session.locale),
    },
  );
};

const handleInput = async (
  ctx: BotContext,
  dependencies: BotDependencies,
  text: string,
): Promise<void> => {
  const input = ctx.session.adminStatusNameInput;
  if (!input || ctx.session.stage !== 'admin_status_name_input') {
    await ctx.reply(t(ctx.session.locale, 'staleAction'));
    return;
  }

  if (text.trim() === t(ctx.session.locale, 'adminStatusNameCancel')) {
    clearAdminStatusNameFlow(ctx.session);
    await ctx.reply(t(ctx.session.locale, 'adminStatusNameCancelled'), {
      reply_markup: personalMenuKeyboard(ctx.session),
    });
    return;
  }

  const value = text.trim().replace(/\s+/g, ' ');
  if (value.length < 1 || value.length > 120) {
    await ctx.reply(t(ctx.session.locale, 'adminStatusNameInvalid'), {
      reply_markup: adminStatusNameCancelKeyboard(ctx.session.locale),
    });
    return;
  }

  try {
    if (!dependencies.repairOrderStatusNameStore) {
      throw new Error('Repair-order status name store is not configured');
    }
    const updated = await dependencies.repairOrderStatusNameStore.updateDisplayNames(
      input.statusId,
      {
        [input.field]: value,
      },
    );
    clearAdminStatusNameFlow(ctx.session);
    if (!updated) {
      await ctx.reply(t(ctx.session.locale, 'adminStatusNameNotFound'), {
        reply_markup: personalMenuKeyboard(ctx.session),
      });
      return;
    }
    await ctx.reply(t(ctx.session.locale, 'adminStatusNameSaved'), {
      reply_markup: personalMenuKeyboard(ctx.session),
    });
    await showStatusDetail(ctx, dependencies, updated.id);
  } catch (error) {
    dependencies.logger.error('Failed to update repair-order status display name', error);
    clearAdminStatusNameFlow(ctx.session);
    await ctx.reply(t(ctx.session.locale, 'adminStatusNameUnavailable'), {
      reply_markup: personalMenuKeyboard(ctx.session),
    });
  }
};

export const registerAdminStatusNamesHandlers = (
  bot: Bot<BotContext>,
  dependencies: BotDependencies,
): void => {
  bot.hears([t('uz', 'adminStatusNames'), t('ru', 'adminStatusNames')], async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    try {
      clearAdminTemplateFlow(ctx.session);
      clearAdminStatusNameFlow(ctx.session);
      clearAdminExportFlow(ctx.session);
      await showStatusList(ctx, dependencies, { refresh: true });
    } catch (error) {
      dependencies.logger.error('Failed to show repair-order status names', error);
      await ctx.reply(t(ctx.session.locale, 'adminStatusNameUnavailable'), {
        reply_markup: personalMenuKeyboard(ctx.session),
      });
    }
  });

  bot.callbackQuery(['st:list', 'st:refresh'], async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireAdmin(ctx))) return;
    try {
      clearAdminStatusNameFlow(ctx.session);
      await showStatusList(ctx, dependencies, {
        refresh: ctx.callbackQuery.data === 'st:refresh',
        preferEdit: true,
      });
    } catch (error) {
      dependencies.logger.error('Failed to refresh repair-order status names', error);
      await ctx.reply(t(ctx.session.locale, 'adminStatusNameUnavailable'));
    }
  });

  bot.callbackQuery(/^st:v:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireAdmin(ctx))) return;
    const match = /^st:v:(\d+)$/.exec(ctx.callbackQuery.data);
    if (!match?.[1]) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }
    await showStatusDetail(ctx, dependencies, match[1], { preferEdit: true });
  });

  bot.callbackQuery(/^st:e:(\d+):(uz|ru)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireAdmin(ctx))) return;
    const match = /^st:e:(\d+):(uz|ru)$/.exec(ctx.callbackQuery.data);
    if (!match?.[1] || !match[2]) {
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
      return;
    }
    await startEdit(ctx, match[1], match[2] === 'uz' ? 'display_name_uz' : 'display_name_ru');
  });

  bot.on('message:text', async (ctx, next) => {
    if (ctx.session.stage === 'admin_status_name_input' && ctx.session.adminStatusNameInput) {
      await handleInput(ctx, dependencies, ctx.message.text);
      return;
    }
    await next();
  });
};
