import { InlineKeyboard, type Bot } from 'grammy';

import type { BotContext } from '../context.js';
import type { BotDependencies } from '../create-bot.js';
import { personalMenuKeyboard } from '../keyboards.js';
import { t } from '../messages.js';
import {
  clearAdminClientFlow,
  clearAdminExportFlow,
  clearAdminStatusNameFlow,
  clearAdminTemplateFlow,
  clearDeveloperFlow,
  clearSettingsFlow,
} from '../session.js';

const PAGE_SIZE = 10;

const activeAccount = async (
  ctx: BotContext,
  dependencies: BotDependencies,
): Promise<string | null> => {
  if (!ctx.from || ctx.chat?.type !== 'private' || !ctx.session.admin?.is_active) return null;
  const state = await dependencies.registeredUserStore.findByTelegramId(String(ctx.from.id));
  return state?.employee?.is_active && state.employee.crm_admin_id === ctx.session.admin.id
    ? state.employee.crm_admin_id
    : null;
};

const showPreferences = async (
  ctx: BotContext,
  dependencies: BotDependencies,
  account: string,
  requestedPage: number,
  edit: boolean,
): Promise<void> => {
  const preferences = (
    await dependencies.employeeNotificationStore!.listPreferences(account)
  ).filter(({ type }) => type.is_active);
  const page = Math.max(
    0,
    Math.min(requestedPage, Math.max(0, Math.ceil(preferences.length / PAGE_SIZE) - 1)),
  );
  const keyboard = new InlineKeyboard();
  for (const { type, enabled } of preferences.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
    const name = ctx.session.locale === 'ru' ? type.name_ru : type.name_uz;
    keyboard
      .text(
        `${enabled ? '✅' : '🔕'} ${name.slice(0, 48)}`,
        `en:set:${type.key}:${enabled ? '0' : '1'}`,
      )
      .row();
  }
  if (page > 0) keyboard.text('‹', `en:page:${page - 1}`);
  if ((page + 1) * PAGE_SIZE < preferences.length) keyboard.text('›', `en:page:${page + 1}`);
  keyboard.row().text(t(ctx.session.locale, 'settingsBack'), 'en:back');
  const text = preferences.length
    ? t(ctx.session.locale, 'employeeNotificationsTitle')
    : t(ctx.session.locale, 'employeeNotificationsEmpty');
  const message = edit
    ? await ctx.editMessageText(text, { reply_markup: keyboard })
    : await ctx.reply(text, { reply_markup: keyboard });
  const messageId =
    typeof message === 'object' ? message.message_id : ctx.callbackQuery?.message?.message_id;
  if (messageId !== undefined) {
    ctx.session.employeeNotificationView = { messageId, page };
    ctx.session.stage = 'employee_notification_preferences';
  }
};

export const registerEmployeeNotificationHandlers = (
  bot: Bot<BotContext>,
  dependencies: BotDependencies,
): void => {
  bot.hears([t('uz', 'employeeNotifications'), t('ru', 'employeeNotifications')], async (ctx) => {
    try {
      const account = await activeAccount(ctx, dependencies);
      if (!account || !dependencies.employeeNotificationStore) {
        await ctx.reply(t(ctx.session.locale, 'staleAction'));
        return;
      }
      clearAdminClientFlow(ctx.session);
      clearAdminExportFlow(ctx.session);
      clearAdminStatusNameFlow(ctx.session);
      clearAdminTemplateFlow(ctx.session);
      clearDeveloperFlow(ctx.session);
      clearSettingsFlow(ctx.session);
      await showPreferences(ctx, dependencies, account, 0, false);
    } catch (error) {
      dependencies.logger.error('Failed to open employee notification preferences', error);
      await ctx.reply(t(ctx.session.locale, 'unavailable'));
    }
  });
  bot.callbackQuery(/^en:/, async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      const view = ctx.session.employeeNotificationView;
      const account = await activeAccount(ctx, dependencies);
      if (
        !account ||
        !dependencies.employeeNotificationStore ||
        !view ||
        ctx.session.stage !== 'employee_notification_preferences' ||
        ctx.callbackQuery.message?.message_id !== view.messageId
      ) {
        await ctx.reply(t(ctx.session.locale, 'staleAction'));
        return;
      }
      const data = ctx.callbackQuery.data;
      if (data === 'en:back') {
        delete ctx.session.employeeNotificationView;
        delete ctx.session.stage;
        await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
        await ctx.reply(t(ctx.session.locale, 'employeeNotifications'), {
          reply_markup: personalMenuKeyboard(ctx.session),
        });
        return;
      }
      const set = /^en:set:([a-z][a-z0-9_]{0,31}):([01])$/.exec(data);
      if (set?.[1]) {
        const type = await dependencies.employeeNotificationStore.findType(set[1]);
        if (!type?.is_active) {
          await ctx.reply(t(ctx.session.locale, 'staleAction'));
          return;
        }
        await dependencies.employeeNotificationStore.setPreference(
          account,
          type.key,
          set[2] === '1',
        );
        await showPreferences(ctx, dependencies, account, view.page, true);
        return;
      }
      const page = /^en:page:([0-9]{1,6})$/.exec(data);
      if (page?.[1]) {
        await showPreferences(ctx, dependencies, account, Number(page[1]), true);
        return;
      }
      await ctx.reply(t(ctx.session.locale, 'staleAction'));
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'description' in error &&
        typeof error.description === 'string' &&
        error.description.includes('message is not modified')
      )
        return;
      dependencies.logger.error('Failed to update employee notification preferences', error);
      await ctx.reply(t(ctx.session.locale, 'unavailable'));
    }
  });
};
