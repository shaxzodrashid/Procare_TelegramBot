import type { BotContext, OtpAuthSession } from '../context.js';
import type { BotDependencies } from '../create-bot.js';
import type { ProfileNameField } from '../../types/otp-auth.js';
import { clearOtpAuthFlow } from '../session.js';
import { t } from '../messages.js';
import { otpContactKeyboard, personalMenuKeyboard, settingsKeyboard } from '../keyboards.js';
import { normalizeUzPhone } from '../../utils/phone.js';

const currentField = (auth: OtpAuthSession): ProfileNameField | undefined =>
  auth.requestedFields?.find((field) => !auth.names?.[field]);

const isMenuAction = (text: string): boolean =>
  (['uz', 'ru'] as const).some((locale) => {
    const keyboards = [
      personalMenuKeyboard({
        locale,
        client: { account_type: 'client' },
        developer: { is_active: true },
      }),
      personalMenuKeyboard({
        locale,
        admin: { id: 'menu', is_active: true },
        developer: { is_active: true },
      }),
      settingsKeyboard(locale),
      otpContactKeyboard(locale),
    ];
    return (
      keyboards.some((keyboard) =>
        keyboard
          .build()
          .flat()
          .some((button) => (typeof button === 'string' ? button : button.text) === text),
      ) ||
      (['skipNote', 'cancel', 'back', 'uzbek', 'russian', 'adminTemplateCancel'] as const).some(
        (key) => t(locale, key) === text,
      )
    );
  });

const prompt = async (ctx: BotContext, auth: OtpAuthSession): Promise<void> => {
  const field = currentField(auth);
  if (field) {
    ctx.session.stage =
      field === 'first_name' ? 'awaiting_otp_first_name' : 'awaiting_otp_last_name';
    await ctx.reply(
      t(ctx.session.locale, field === 'first_name' ? 'otpFirstName' : 'otpLastName'),
      {
        reply_markup: { remove_keyboard: true },
      },
    );
  } else {
    await ctx.reply(
      t(ctx.session.locale, auth.needsReadback ? 'otpCheckStatus' : 'otpOwnPhoneOnly'),
      {
        reply_markup: otpContactKeyboard(ctx.session.locale),
      },
    );
  }
};

const expire = async (ctx: BotContext): Promise<void> => {
  clearOtpAuthFlow(ctx.session);
  await ctx.reply(t(ctx.session.locale, 'otpSessionExpired'), {
    reply_markup: { remove_keyboard: true },
  });
};

const complete = async (
  ctx: BotContext,
  dependencies: BotDependencies,
  auth: OtpAuthSession,
): Promise<void> => {
  const contact = auth.verifiedContact;
  // The backend owns CRM names. Preserve existing local names as well when saving the bot identity.
  if (contact && ctx.from && auth.displayName) {
    try {
      const existing = await dependencies.registeredUserStore.findByTelegramId(
        String(contact.telegram_user_id),
      );
      await dependencies.registeredUserStore.saveTelegramUser({
        telegram_id: String(contact.telegram_user_id),
        telegram_username: ctx.from.username ?? null,
        first_name:
          existing?.user.first_name?.trim() || auth.names?.first_name || auth.displayName.firstName,
        last_name:
          existing?.user.last_name?.trim() || auth.names?.last_name || auth.displayName.lastName,
        phone_number: contact.contact_phone,
        locale: ctx.session.locale,
      });
    } catch {
      dependencies.logger.warn('Failed to save Telegram user on OTP contact verification');
    }
  }
  clearOtpAuthFlow(ctx.session);
  await ctx.reply(t(ctx.session.locale, 'otpSuccess'), {
    parse_mode: 'HTML',
    reply_markup: { remove_keyboard: true },
  });
};

const submit = async (
  ctx: BotContext,
  dependencies: BotDependencies,
  auth: OtpAuthSession,
): Promise<void> => {
  const gateway = dependencies.otpAuthService;
  if (!gateway || !auth.verifiedContact || auth.submitting) return;
  auth.submitting = true;
  try {
    // An uncertain POST must always be read back before another attempt.
    if (auth.needsReadback) {
      const status = await gateway.getSession(auth.sessionToken);
      if (ctx.session.otpAuth !== auth) return;
      if (status?.status === 'VERIFIED') {
        await complete(ctx, dependencies, auth);
        return;
      }
      if (status?.status === 'EXPIRED') {
        await expire(ctx);
        return;
      }
      if (status?.status !== 'PENDING_TELEGRAM') {
        await ctx.reply(t(ctx.session.locale, 'otpCheckStatus'));
        return;
      }
      auth.needsReadback = false;
    }
    const names = Object.fromEntries(
      (auth.requestedFields ?? []).map((field) => [field, auth.names?.[field]]),
    );
    const result = await gateway.verifyContact({ ...auth.verifiedContact, ...names });
    if (ctx.session.otpAuth !== auth) return;
    if (result.success) {
      await complete(ctx, dependencies, auth);
      return;
    }
    if (result.error === 'PROFILE_NAMES_REQUIRED' && result.missing_fields?.length) {
      auth.requestedFields = result.missing_fields;
      // A repeated backend challenge is authoritative: ask for these fields again.
      auth.names = Object.fromEntries(
        Object.entries(auth.names ?? {}).filter(
          ([key]) => !result.missing_fields?.includes(key as ProfileNameField),
        ),
      );
      await prompt(ctx, auth);
      return;
    }
    if (result.error === 'SESSION_EXPIRED' || result.error === 'SESSION_NOT_FOUND') {
      await expire(ctx);
      return;
    }
    if (
      result.error === 'PHONE_NUMBER_MISMATCH' ||
      result.error === 'PHONE_MISMATCH' ||
      result.error === 'SENDER_NOT_CONTACT_OWNER'
    ) {
      delete auth.verifiedContact;
      delete auth.names;
      delete auth.requestedFields;
      ctx.session.stage = 'awaiting_otp_contact';
      await ctx.reply(
        t(
          ctx.session.locale,
          result.error === 'SENDER_NOT_CONTACT_OWNER' ? 'otpOwnPhoneOnly' : 'otpPhoneMismatch',
        ),
        {
          parse_mode: 'HTML',
          reply_markup: otpContactKeyboard(ctx.session.locale),
        },
      );
      return;
    }
    if (
      auth.requestedFields?.length &&
      (result.error === 'INVALID_PROFILE_NAME' ||
        result.error === 'INVALID_REQUEST' ||
        result.error === 'Bad Request')
    ) {
      const field =
        auth.requestedFields.find((item) => item === result.location) ?? auth.requestedFields[0];
      if (field && auth.names) delete auth.names[field];
      await ctx.reply(t(ctx.session.locale, 'otpInvalidName'));
      await prompt(ctx, auth);
      return;
    }
    auth.needsReadback = true;
    const status = await gateway.getSession(auth.sessionToken);
    if (ctx.session.otpAuth !== auth) return;
    if (status?.status === 'VERIFIED') {
      await complete(ctx, dependencies, auth);
      return;
    }
    if (status?.status === 'EXPIRED') {
      await expire(ctx);
      return;
    }
    await ctx.reply(t(ctx.session.locale, 'otpCheckStatus'));
  } catch {
    auth.needsReadback = true;
    dependencies.logger.warn('Mobile contact verification outcome is uncertain');
    await ctx.reply(t(ctx.session.locale, 'otpCheckStatus'));
  } finally {
    auth.submitting = false;
  }
};

// Installed before every feature handler, so menus, stale callbacks and non-text updates
// cannot escape the pending mobile conversation. /start alone replaces it.
export const createMobileRegistrationMiddleware =
  (dependencies: BotDependencies) =>
  async (ctx: BotContext, next: () => Promise<void>): Promise<void> => {
    const auth = ctx.session.otpAuth;
    if (!auth) {
      await next();
      return;
    }
    if (
      !ctx.from ||
      !ctx.chat ||
      ctx.chat.type !== 'private' ||
      (auth.senderId !== undefined && auth.senderId !== ctx.from.id) ||
      (auth.chatId !== undefined && auth.chatId !== ctx.chat.id)
    )
      return;
    const text = ctx.message?.text;
    if (text && /^\/start(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.test(text)) {
      await next();
      return;
    }
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    if (text && /^\/cancel(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.test(text)) {
      clearOtpAuthFlow(ctx.session);
      await ctx.reply(t(ctx.session.locale, 'otpCancelled'), {
        reply_markup: { remove_keyboard: true },
      });
      return;
    }
    if (Date.now() >= (auth.deadline ?? auth.createdAt + 300_000)) {
      await expire(ctx);
      return;
    }
    if (auth.submitting) return;
    if (auth.needsReadback) {
      await submit(ctx, dependencies, auth);
      return;
    }
    const field = currentField(auth);
    if (field) {
      const value = text?.trim();
      if (
        !value ||
        Array.from(value).length > 255 ||
        value.startsWith('/') ||
        isMenuAction(value) ||
        ctx.callbackQuery
      ) {
        await ctx.reply(t(ctx.session.locale, 'otpInvalidName'));
        await prompt(ctx, auth);
        return;
      }
      // Check the backend's original deadline; opening a late link never extends it.
      const status = await dependencies.otpAuthService?.getSession(auth.sessionToken);
      if (ctx.session.otpAuth !== auth) return;
      if (!status || status.status === 'EXPIRED') {
        await expire(ctx);
        return;
      }
      if (status.status !== 'PENDING_TELEGRAM') {
        await ctx.reply(t(ctx.session.locale, 'otpCheckStatus'));
        return;
      }
      auth.names = { ...auth.names, [field]: value };
      if (currentField(auth)) await prompt(ctx, auth);
      else await submit(ctx, dependencies, auth);
      return;
    }
    const contact = ctx.message?.contact;
    if (!contact || contact.user_id !== ctx.from.id) {
      await prompt(ctx, auth);
      return;
    }
    const phone = normalizeUzPhone(contact.phone_number);
    if (!phone) {
      await prompt(ctx, auth);
      return;
    }
    auth.senderId = ctx.from.id;
    auth.chatId = ctx.chat.id;
    auth.verifiedContact = {
      session_token: auth.sessionToken,
      telegram_user_id: ctx.from.id,
      telegram_chat_id: ctx.chat.id,
      contact_phone: phone,
      contact_user_id: contact.user_id,
    };
    auth.displayName = {
      firstName: contact.first_name || ctx.from.first_name,
      lastName: contact.last_name || ctx.from.last_name || null,
    };
    await submit(ctx, dependencies, auth);
  };
