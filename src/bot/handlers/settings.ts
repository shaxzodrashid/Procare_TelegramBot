import type { Bot } from 'grammy';
import type { BotContext, BotSession } from '../context.js';
import type { BotDependencies } from '../create-bot.js';
import { t } from '../messages.js';
import {
  hasRegisteredProfile,
  parseSettingsName,
  currentReplyKeyboard,
  registeredHelpKey,
  type SettingsName,
} from '../helpers.js';
import {
  clearAdminTemplateFlow,
  clearSettingsFlow,
  clearSupportFlow,
  clearUnknownFlow,
} from '../session.js';
import {
  languageKeyboard,
  settingsKeyboard,
  settingsBackKeyboard,
  settingsPhoneKeyboard,
  settingsLanguageKeyboard,
  personalMenuKeyboard,
} from '../keyboards.js';

const showSettingsMenu = async (ctx: BotContext): Promise<void> => {
  clearUnknownFlow(ctx.session);
  clearAdminTemplateFlow(ctx.session);
  clearSupportFlow(ctx.session);
  ctx.session.stage = 'settings';
  await ctx.reply(t(ctx.session.locale, 'settingsTitle'), {
    reply_markup: settingsKeyboard(ctx.session.locale),
  });
};

const updateSessionName = (sessionData: BotSession, name: SettingsName): void => {
  if (sessionData.client) {
    sessionData.client.first_name = name.firstName;
    sessionData.client.last_name = name.lastName;
  }
  if (sessionData.admin) {
    sessionData.admin.first_name = name.firstName;
    sessionData.admin.last_name = name.lastName;
  }
};

const handleSettingsNameInput = async (
  ctx: BotContext,
  dependencies: BotDependencies,
  text: string,
): Promise<void> => {
  if (!ctx.from || !hasRegisteredProfile(ctx.session)) {
    await ctx.reply(t(ctx.session.locale, 'registerFirst'), {
      reply_markup: languageKeyboard(),
    });
    return;
  }

  const name = parseSettingsName(text);
  if (!name) {
    await ctx.reply(t(ctx.session.locale, 'settingsNameInvalid'), {
      reply_markup: settingsBackKeyboard(ctx.session.locale),
    });
    return;
  }

  try {
    await dependencies.registeredUserStore.updateSettings({
      telegram_id: String(ctx.from.id),
      telegram_username: ctx.from.username ?? null,
      first_name: name.firstName,
      last_name: name.lastName,
    });
    updateSessionName(ctx.session, name);
    clearSettingsFlow(ctx.session);
    await ctx.reply(t(ctx.session.locale, 'settingsNameUpdated', { name: name.fullName }), {
      reply_markup: personalMenuKeyboard(ctx.session),
    });
  } catch (error) {
    dependencies.logger.error('Failed to update Telegram user name settings', error);
    await ctx.reply(t(ctx.session.locale, 'settingsUnavailable'), {
      reply_markup: currentReplyKeyboard(ctx.session),
    });
  }
};

export const registerSettingsHandlers = (
  bot: Bot<BotContext>,
  dependencies: BotDependencies,
): void => {
  bot.hears([t('uz', 'settings'), t('ru', 'settings')], async (ctx) => {
    if (!hasRegisteredProfile(ctx.session)) {
      await ctx.reply(t(ctx.session.locale, 'registerFirst'), {
        reply_markup: languageKeyboard(),
      });
      return;
    }
    await showSettingsMenu(ctx);
  });

  bot.hears([t('uz', 'settingsBack'), t('ru', 'settingsBack')], async (ctx) => {
    if (!hasRegisteredProfile(ctx.session)) {
      await ctx.reply(t(ctx.session.locale, 'registerFirst'), {
        reply_markup: languageKeyboard(),
      });
      return;
    }
    clearSettingsFlow(ctx.session);
    await ctx.reply(t(ctx.session.locale, registeredHelpKey(ctx.session)), {
      reply_markup: personalMenuKeyboard(ctx.session),
    });
  });

  bot.hears([t('uz', 'settingsName'), t('ru', 'settingsName')], async (ctx) => {
    if (!hasRegisteredProfile(ctx.session)) {
      await ctx.reply(t(ctx.session.locale, 'registerFirst'), {
        reply_markup: languageKeyboard(),
      });
      return;
    }
    ctx.session.stage = 'settings_awaiting_name';
    await ctx.reply(t(ctx.session.locale, 'settingsNamePrompt'), {
      reply_markup: settingsBackKeyboard(ctx.session.locale),
    });
  });

  bot.hears([t('uz', 'settingsPhone'), t('ru', 'settingsPhone')], async (ctx) => {
    if (!hasRegisteredProfile(ctx.session)) {
      await ctx.reply(t(ctx.session.locale, 'registerFirst'), {
        reply_markup: languageKeyboard(),
      });
      return;
    }
    ctx.session.stage = 'settings_awaiting_phone';
    await ctx.reply(t(ctx.session.locale, 'settingsPhonePrompt'), {
      reply_markup: settingsPhoneKeyboard(ctx.session.locale),
    });
  });

  bot.hears([t('uz', 'settingsLanguage'), t('ru', 'settingsLanguage')], async (ctx) => {
    if (!hasRegisteredProfile(ctx.session)) {
      await ctx.reply(t(ctx.session.locale, 'registerFirst'), {
        reply_markup: languageKeyboard(),
      });
      return;
    }
    ctx.session.stage = 'settings_choosing_language';
    await ctx.reply(t(ctx.session.locale, 'settingsLanguagePrompt'), {
      reply_markup: settingsLanguageKeyboard(ctx.session.locale),
    });
  });

  bot.on('message:text', async (ctx, next) => {
    if (ctx.session.stage === 'settings_awaiting_name') {
      await handleSettingsNameInput(ctx, dependencies, ctx.message.text);
      return;
    }
    if (ctx.session.stage === 'settings_awaiting_phone') {
      await ctx.reply(t(ctx.session.locale, 'settingsPhonePrompt'), {
        reply_markup: settingsPhoneKeyboard(ctx.session.locale),
      });
      return;
    }
    if (ctx.session.stage === 'settings_choosing_language') {
      await ctx.reply(t(ctx.session.locale, 'settingsLanguagePrompt'), {
        reply_markup: settingsLanguageKeyboard(ctx.session.locale),
      });
      return;
    }
    await next();
  });
};
