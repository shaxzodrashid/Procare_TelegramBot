import type { Bot } from 'grammy';
import type { BotContext, BotSession } from '../context.js';
import type { BotDependencies } from '../create-bot.js';
import type { Locale } from '../../types/client.js';
import type { UserRegistrationState } from '../../types/registered-user.js';
import { t } from '../messages.js';
import {
  hasRegisteredProfile,
  parseSettingsName,
  currentReplyKeyboard,
  registeredHelpKey,
  registeredHelpParseMode,
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
import { escapeHtml } from '../../utils/html.js';

interface CurrentSettingsView {
  name: string;
  phone: string | null;
  locale: Locale;
}

const fullName = (firstName: string | null | undefined, lastName: string | null | undefined) =>
  [firstName, lastName].filter(Boolean).join(' ').trim();

const currentSettingsView = (
  sessionData: BotSession,
  storedState: UserRegistrationState | null,
): CurrentSettingsView => {
  const sessionProfile = sessionData.admin ?? sessionData.client;
  const name =
    fullName(storedState?.user.first_name, storedState?.user.last_name) ||
    fullName(sessionProfile?.first_name, sessionProfile?.last_name);
  const locale = storedState?.user.locale ?? sessionData.locale;

  return {
    name,
    phone: storedState?.user.phone_number ?? sessionData.admin?.phone_number ?? null,
    locale,
  };
};

export const formatCurrentSettings = (locale: Locale, settings: CurrentSettingsView): string => {
  const displayName = settings.name || t(locale, 'settingsNotProvided');
  const displayPhone = settings.phone || t(locale, 'settingsNotProvided');
  const displayLanguage =
    settings.locale === 'ru'
      ? t(locale, 'settingsLanguageRussian')
      : t(locale, 'settingsLanguageUzbek');

  return t(locale, 'settingsCurrent', {
    name: escapeHtml(displayName),
    phone: escapeHtml(displayPhone),
    language: escapeHtml(displayLanguage),
  });
};

const showSettingsMenu = async (ctx: BotContext, dependencies: BotDependencies): Promise<void> => {
  clearUnknownFlow(ctx.session);
  clearAdminTemplateFlow(ctx.session);
  clearSupportFlow(ctx.session);
  ctx.session.stage = 'settings';

  let storedState: UserRegistrationState | null = null;
  if (ctx.from) {
    try {
      storedState = await dependencies.registeredUserStore.findByTelegramId(String(ctx.from.id));
    } catch (error) {
      dependencies.logger.warn('Failed to load current Telegram user settings', error);
    }
  }

  await ctx.reply(
    formatCurrentSettings(ctx.session.locale, currentSettingsView(ctx.session, storedState)),
    {
      reply_markup: settingsKeyboard(ctx.session.locale),
      parse_mode: 'HTML',
    },
  );
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
    await showSettingsMenu(ctx, dependencies);
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
      parse_mode: registeredHelpParseMode(ctx.session),
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
