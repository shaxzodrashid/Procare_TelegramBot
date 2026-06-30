import type { Bot } from 'grammy';
import type { BotCommand, BotCommandScope } from 'grammy/types';
import type { BotContext, BotSession } from './context.js';
import type { Locale, RegistrationResult } from '../types/client.js';
import { t, type MessageKey } from './messages.js';
import {
  settingsKeyboard,
  supportCommentKeyboard,
  developerCancelKeyboard,
  adminExportCancelKeyboard,
  settingsBackKeyboard,
  settingsPhoneKeyboard,
  settingsLanguageKeyboard,
  personalMenuKeyboard,
  registrationKeyboard,
  languageKeyboard,
} from './keyboards.js';

export interface SettingsName {
  firstName: string;
  lastName: string | null;
  fullName: string;
}

export type RegistrationAccountKind = 'client' | 'employee';

export const registrationAccountKind = (
  registration: RegistrationResult,
): RegistrationAccountKind => (registration.is_admin ? 'employee' : 'client');

export const localizedBotCommands = (locale: Locale): BotCommand[] => [
  { command: 'start', description: t(locale, 'commandStart') },
  { command: 'help', description: t(locale, 'commandHelp') },
  { command: 'logout', description: t(locale, 'commandLogout') },
];

export const setLocalizedBotCommands = async (bot: Bot<BotContext>): Promise<void> => {
  const defaultPrivateScope: BotCommandScope = { type: 'all_private_chats' };

  await bot.api.setMyCommands(localizedBotCommands('uz'));
  await bot.api.setMyCommands(localizedBotCommands('uz'), { language_code: 'uz' });
  await bot.api.setMyCommands(localizedBotCommands('ru'), { language_code: 'ru' });
  await bot.api.setMyCommands(localizedBotCommands('uz'), { scope: defaultPrivateScope });
  await bot.api.setMyCommands(localizedBotCommands('uz'), {
    scope: defaultPrivateScope,
    language_code: 'uz',
  });
  await bot.api.setMyCommands(localizedBotCommands('ru'), {
    scope: defaultPrivateScope,
    language_code: 'ru',
  });
};

export const parseSettingsName = (value: string): SettingsName | null => {
  const fullName = value.trim().replace(/\s+/g, ' ');
  if (fullName.length < 2 || fullName.length > 120 || !/[\p{L}\p{N}]/u.test(fullName)) {
    return null;
  }

  const [firstName, ...rest] = fullName.split(' ');
  if (!firstName) return null;

  return {
    firstName,
    lastName: rest.length > 0 ? rest.join(' ') : null,
    fullName,
  };
};

export const hasEmployeeMenuAccess = (sessionData: Pick<BotSession, 'admin'>): boolean =>
  Boolean(sessionData.admin?.is_active);

export const hasDeveloperMenuAccess = (sessionData: Pick<BotSession, 'developer'>): boolean =>
  Boolean(sessionData.developer?.is_active);

export const canRegisterWithManualPhone = (
  sessionData: BotSession,
  allowManualPhoneEntry: boolean,
): boolean =>
  allowManualPhoneEntry &&
  sessionData.stage === 'awaiting_phone' &&
  !sessionData.client &&
  !sessionData.admin;

export const fullTelegramName = (ctx: BotContext): string =>
  [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ').trim() || 'Telegram user';

export const adminDisplayName = (ctx: BotContext): string =>
  ctx.session.admin?.first_name || ctx.from?.first_name || 'Procare';

export const registrationLocale = (registration: RegistrationResult): Locale | null => {
  const language =
    registration.account_type === 'client' ? registration.language : registration.admin.language;
  return language === 'uz' || language === 'ru' ? language : null;
};

export const safeHttpUrl = (value: string | null | undefined): string | null => {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
};

export const hasRegisteredProfile = (sessionData: BotSession): boolean =>
  Boolean(
    sessionData.client || hasEmployeeMenuAccess(sessionData) || hasDeveloperMenuAccess(sessionData),
  );

export const registeredHelpKey = (sessionData: BotSession): MessageKey =>
  hasEmployeeMenuAccess(sessionData)
    ? 'employeeHelp'
    : sessionData.client
      ? 'clientHelp'
      : hasDeveloperMenuAccess(sessionData)
        ? 'developerHelp'
        : 'help';

export const currentReplyKeyboard = (sessionData: BotSession) =>
  sessionData.stage === 'settings'
    ? settingsKeyboard(sessionData.locale)
    : sessionData.stage === 'support_comment_input'
      ? supportCommentKeyboard(sessionData.locale)
      : sessionData.stage === 'developer_error_location_input' ||
          sessionData.stage === 'developer_error_message_uz_input' ||
          sessionData.stage === 'developer_error_message_ru_input'
        ? developerCancelKeyboard(sessionData.locale)
        : sessionData.stage === 'admin_export_period_input'
          ? adminExportCancelKeyboard(sessionData.locale)
          : sessionData.stage === 'settings_awaiting_name'
            ? settingsBackKeyboard(sessionData.locale)
            : sessionData.stage === 'settings_awaiting_phone'
              ? settingsPhoneKeyboard(sessionData.locale)
              : sessionData.stage === 'settings_choosing_language'
                ? settingsLanguageKeyboard(sessionData.locale)
                : sessionData.client || hasEmployeeMenuAccess(sessionData)
                  ? personalMenuKeyboard(sessionData)
                  : sessionData.stage === 'awaiting_phone'
                    ? registrationKeyboard(sessionData.locale)
                    : languageKeyboard();

export const replyWithAdminRegistration = async (ctx: BotContext): Promise<void> => {
  await ctx.reply(
    t(ctx.session.locale, 'adminRegistered', {
      name: adminDisplayName(ctx),
    }),
    { reply_markup: personalMenuKeyboard(ctx.session) },
  );
};
