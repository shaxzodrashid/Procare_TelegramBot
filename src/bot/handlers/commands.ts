import type { Bot } from 'grammy';
import type { BotContext } from '../context.js';
import type { BotDependencies } from '../create-bot.js';
import {
  hasEmployeeMenuAccess,
  adminDisplayName,
  registeredHelpKey,
  currentReplyKeyboard,
} from '../helpers.js';
import { clearUnknownFlow, resetSession } from '../session.js';
import { t } from '../messages.js';
import { personalMenuKeyboard, languageKeyboard } from '../keyboards.js';

export const registerCommandHandlers = (
  bot: Bot<BotContext>,
  dependencies: BotDependencies,
): void => {
  bot.command('start', async (ctx) => {
    if (ctx.from) {
      await dependencies.messageTemplateStore
        .setUserBlocked(String(ctx.from.id), false)
        .catch((error: unknown) =>
          dependencies.logger.warn('Failed to clear Telegram blocked flag on /start', error),
        );
    }

    if (hasEmployeeMenuAccess(ctx.session)) {
      await ctx.reply(
        t(ctx.session.locale, 'adminRegistered', {
          name: adminDisplayName(ctx),
        }),
        { reply_markup: personalMenuKeyboard(ctx.session) },
      );
      return;
    }
    if (ctx.session.client) {
      await ctx.reply(
        t(ctx.session.locale, 'registered', {
          name: ctx.session.client.first_name || ctx.from?.first_name || 'Procare',
        }),
        { reply_markup: personalMenuKeyboard(ctx.session) },
      );
      return;
    }

    clearUnknownFlow(ctx.session);
    ctx.session.stage = 'choosing_language';
    await ctx.reply(t(ctx.session.locale, 'chooseLanguage'), {
      reply_markup: languageKeyboard(),
    });
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(t(ctx.session.locale, registeredHelpKey(ctx.session)), {
      reply_markup: currentReplyKeyboard(ctx.session),
    });
  });

  bot.command('logout', async (ctx) => {
    if (!ctx.from) return;

    try {
      await dependencies.unknownClientStore.deleteByTelegramId(String(ctx.from.id));
      const locale = ctx.session.locale;
      resetSession(ctx.session, locale);
      await ctx.reply(t(locale, 'logoutSuccess'), {
        reply_markup: languageKeyboard(),
      });
    } catch (error) {
      dependencies.logger.error('Failed to delete Telegram user during logout', error);
      await ctx.reply(t(ctx.session.locale, 'logoutFailed'), {
        reply_markup: currentReplyKeyboard(ctx.session),
      });
    }
  });
};
