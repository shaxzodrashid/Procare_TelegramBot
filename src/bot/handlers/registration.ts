import type { Bot } from 'grammy';
import type { BotContext, BotSession } from '../context.js';
import type { BotDependencies } from '../create-bot.js';
import type { Locale, RegistrationResult, AdminProfile } from '../../types/client.js';
import { RegistrationError } from '../../services/client-registration.service.js';
import { normalizeUzPhone } from '../../utils/phone.js';
import { t } from '../messages.js';
import {
  hasRegisteredProfile,
  hasEmployeeMenuAccess,
  adminDisplayName,
  registrationLocale,
  registrationAccountKind,
  canRegisterWithManualPhone,
  currentReplyKeyboard,
  registeredHelpKey,
} from '../helpers.js';
import { clearSettingsFlow, clearUnknownFlow } from '../session.js';
import {
  personalMenuKeyboard,
  registrationKeyboard,
  settingsPhoneKeyboard,
  requestOfferKeyboard,
} from '../keyboards.js';

export const updateSessionLanguage = (sessionData: BotSession, locale: Locale): void => {
  sessionData.locale = locale;
  if (sessionData.client) sessionData.client.language = locale;
  if (sessionData.admin) sessionData.admin.language = locale;
};

export const updateRegisteredLanguage = async (
  ctx: BotContext,
  dependencies: BotDependencies,
  locale: Locale,
): Promise<void> => {
  if (!ctx.from || !hasRegisteredProfile(ctx.session)) {
    updateSessionLanguage(ctx.session, locale);
    return;
  }

  await dependencies.registeredUserStore.updateSettings({
    telegram_id: String(ctx.from.id),
    telegram_username: ctx.from.username ?? null,
    locale,
  });
  updateSessionLanguage(ctx.session, locale);
};

const registrationAdminProfile = (registration: RegistrationResult): AdminProfile | null =>
  registration.account_type === 'admin' ? registration.admin : registration.admin;

const saveRegisteredUser = async (
  ctx: BotContext,
  dependencies: BotDependencies,
  registration: RegistrationResult,
  phoneNumber: string,
): Promise<void> => {
  if (!ctx.from) return;

  const crmFirstName =
    registration.account_type === 'client'
      ? registration.first_name
      : registration.admin.first_name;
  const crmLastName =
    registration.account_type === 'client' ? registration.last_name : registration.admin.last_name;

  const user = {
    telegram_id: String(ctx.from.id),
    telegram_username: ctx.from.username ?? null,
    first_name: crmFirstName || ctx.from.first_name,
    last_name: crmLastName || ctx.from.last_name || null,
    phone_number: phoneNumber,
    locale: ctx.session.locale,
  };

  if (registrationAccountKind(registration) === 'employee') {
    const admin = registrationAdminProfile(registration);
    if (!admin) throw new Error('CRM marked registration as admin without an admin profile');

    await dependencies.registeredUserStore.saveEmployee({
      ...user,
      crm_admin_id: admin.id,
      status: admin.status,
      is_active: admin.is_active,
    });
    return;
  }

  if (registration.account_type !== 'client') {
    throw new Error('CRM returned a non-client registration without admin privileges');
  }

  await dependencies.registeredUserStore.saveClient({
    ...user,
    crm_client_id: registration.client_id,
    customer_code: null,
    status: 'Open',
    is_active: true,
  });
};

export const registerByPhone = async (
  ctx: BotContext,
  dependencies: BotDependencies,
  phoneNumber: string,
  mode: 'registration' | 'settings_phone' = 'registration',
): Promise<void> => {
  if (!ctx.from || !ctx.chat) return;

  const replyKeyboard =
    mode === 'settings_phone'
      ? settingsPhoneKeyboard(ctx.session.locale)
      : registrationKeyboard(ctx.session.locale);

  const normalizedPhone = normalizeUzPhone(phoneNumber);
  if (!normalizedPhone) {
    await ctx.reply(t(ctx.session.locale, 'invalidPhone'), {
      reply_markup: replyKeyboard,
    });
    return;
  }

  const pendingMessage = await ctx.reply(t(ctx.session.locale, 'registering'));
  try {
    const registration = await dependencies.registrationService.registerByPhone(normalizedPhone);

    ctx.session.locale = registrationLocale(registration) ?? ctx.session.locale;

    await saveRegisteredUser(ctx, dependencies, registration, normalizedPhone);
    delete ctx.session.client;
    delete ctx.session.admin;
    delete ctx.session.repairOrdersView;
    clearUnknownFlow(ctx.session);
    if (mode === 'settings_phone') clearSettingsFlow(ctx.session);
    else delete ctx.session.stage;
    await ctx.api.deleteMessage(ctx.chat.id, pendingMessage.message_id).catch(() => undefined);

    if (registrationAccountKind(registration) === 'employee') {
      const admin = registrationAdminProfile(registration);
      if (!admin) throw new Error('CRM marked registration as admin without an admin profile');
      ctx.session.admin = admin;
      if (mode === 'settings_phone') {
        await ctx.reply(t(ctx.session.locale, 'settingsPhoneUpdated'), {
          reply_markup: personalMenuKeyboard(ctx.session),
        });
        return;
      }
      await ctx.reply(
        t(ctx.session.locale, 'adminRegistered', {
          name: adminDisplayName(ctx),
        }),
        {
          reply_markup: personalMenuKeyboard(ctx.session),
          parse_mode: 'HTML',
        },
      );
      return;
    }

    if (registration.account_type !== 'client') {
      throw new Error('CRM returned a non-client registration without admin privileges');
    }

    ctx.session.client = { ...registration, phone_number: normalizedPhone };
    if (mode === 'settings_phone') {
      await ctx.reply(t(ctx.session.locale, 'settingsPhoneUpdated'), {
        reply_markup: personalMenuKeyboard(ctx.session),
      });
      return;
    }
    await ctx.reply(
      t(ctx.session.locale, 'registered', {
        name: registration.first_name || ctx.from.first_name,
      }),
      {
        reply_markup: personalMenuKeyboard(ctx.session),
        parse_mode: 'HTML',
      },
    );
  } catch (error) {
    await ctx.api.deleteMessage(ctx.chat.id, pendingMessage.message_id).catch(() => undefined);
    if (error instanceof RegistrationError && error.code === 'not_found') {
      if (mode === 'settings_phone') {
        await ctx.reply(t(ctx.session.locale, 'settingsPhoneNotFound'), {
          reply_markup: settingsPhoneKeyboard(ctx.session.locale),
        });
        return;
      }

      ctx.session.unknownClient = {
        phoneNumber: normalizedPhone,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name ?? null,
        username: ctx.from.username ?? null,
      };
      ctx.session.stage = 'offering_request';
      await ctx.reply(t(ctx.session.locale, 'notFound'), {
        reply_markup: requestOfferKeyboard(ctx.session.locale),
      });
      return;
    }

    const key =
      error instanceof RegistrationError
        ? error.code === 'invalid_phone'
          ? 'invalidPhone'
          : error.code === 'maintenance'
            ? 'maintenance'
            : 'unavailable'
        : 'unavailable';
    dependencies.logger.error('Client registration failed', error);
    await ctx.reply(t(ctx.session.locale, key), {
      reply_markup: replyKeyboard,
    });
  }
};

export const registerRegistrationHandlers = (
  bot: Bot<BotContext>,
  dependencies: BotDependencies,
): void => {
  bot.hears([t('uz', 'uzbek'), t('ru', 'russian')], async (ctx, next) => {
    const text = ctx.msg?.text;
    if (!text) return;

    // Guard stage: if awaiting_note, let the note handler process it!
    if (ctx.session.stage === 'awaiting_note') {
      return next();
    }

    const locale = text === t('ru', 'russian') ? 'ru' : 'uz';
    const hasAccountProfile = Boolean(ctx.session.client || hasEmployeeMenuAccess(ctx.session));
    const isSettingsLanguageChange = ctx.session.stage === 'settings_choosing_language';
    if (hasRegisteredProfile(ctx.session) && (hasAccountProfile || isSettingsLanguageChange)) {
      try {
        const wasChoosingSettingsLanguage = ctx.session.stage === 'settings_choosing_language';
        await updateRegisteredLanguage(ctx, dependencies, locale);
        clearSettingsFlow(ctx.session);
        await ctx.reply(
          wasChoosingSettingsLanguage
            ? t(ctx.session.locale, 'settingsLanguageUpdated')
            : hasEmployeeMenuAccess(ctx.session)
              ? t(ctx.session.locale, 'adminRegistered', {
                  name: adminDisplayName(ctx),
                })
              : ctx.session.client
                ? t(ctx.session.locale, 'registered', {
                    name: ctx.session.client.first_name || ctx.from?.first_name || 'Procare',
                  })
                : t(ctx.session.locale, 'developerHelp'),
          {
            reply_markup: personalMenuKeyboard(ctx.session),
            parse_mode: 'HTML',
          },
        );
      } catch (error) {
        dependencies.logger.error('Failed to update Telegram user language settings', error);
        await ctx.reply(t(ctx.session.locale, 'settingsUnavailable'), {
          reply_markup: currentReplyKeyboard(ctx.session),
        });
      }
      return;
    }

    ctx.session.locale = locale;
    ctx.session.stage = 'awaiting_phone';
    await ctx.reply(t(ctx.session.locale, 'welcome'), {
      reply_markup: registrationKeyboard(ctx.session.locale),
    });
  });

  bot.on('message:contact', async (ctx) => {
    const acceptsInitialPhone =
      ctx.session.stage === 'awaiting_phone' &&
      !ctx.session.client &&
      !hasEmployeeMenuAccess(ctx.session);
    const acceptsSettingsPhone =
      ctx.session.stage === 'settings_awaiting_phone' && hasRegisteredProfile(ctx.session);

    if (!acceptsInitialPhone && !acceptsSettingsPhone) {
      if (hasEmployeeMenuAccess(ctx.session)) {
        await ctx.reply(
          t(ctx.session.locale, 'adminRegistered', {
            name: adminDisplayName(ctx),
          }),
          {
            reply_markup: personalMenuKeyboard(ctx.session),
            parse_mode: 'HTML',
          },
        );
        return;
      }
      await ctx.reply(
        t(
          ctx.session.locale,
          ctx.session.client ? registeredHelpKey(ctx.session) : 'chooseLanguage',
        ),
        {
          reply_markup: currentReplyKeyboard(ctx.session),
        },
      );
      return;
    }

    if (hasEmployeeMenuAccess(ctx.session) && !acceptsSettingsPhone) {
      await ctx.reply(
        t(ctx.session.locale, 'adminRegistered', {
          name: adminDisplayName(ctx),
        }),
        {
          reply_markup: personalMenuKeyboard(ctx.session),
          parse_mode: 'HTML',
        },
      );
      return;
    }

    const contact = ctx.message.contact;
    if (contact.user_id !== ctx.from.id) {
      await ctx.reply(t(ctx.session.locale, 'phoneOnly'), {
        reply_markup: acceptsSettingsPhone
          ? settingsPhoneKeyboard(ctx.session.locale)
          : registrationKeyboard(ctx.session.locale),
      });
      return;
    }

    await registerByPhone(
      ctx,
      dependencies,
      contact.phone_number,
      acceptsSettingsPhone ? 'settings_phone' : 'registration',
    );
  });

  // Handle manual phone number entry text handler
  bot.on('message:text', async (ctx, next) => {
    if (!canRegisterWithManualPhone(ctx.session, dependencies.allowManualPhoneEntry)) {
      return next();
    }
    await registerByPhone(ctx, dependencies, ctx.message.text);
  });
};
