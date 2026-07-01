import { Bot, session, GrammyError, HttpError } from 'grammy';
import type { ClientRegistrationGateway } from '../services/client-registration.service.js';
import type { ClientRepairOrderGateway } from '../services/client-repair-order.service.js';
import type { ActionExportService } from '../services/action-export.service.js';
import type { ApiErrorLocalizationStore } from '../services/api-error-localization.service.js';
import type { MessageTemplateStore } from '../services/message-template.service.js';
import type { RegisteredUserStore } from '../services/registered-user.store.js';
import type {
  RepairOrderStatusGateway,
  RepairOrderStatusNameStore,
} from '../services/repair-order-status.service.js';
import type { RepairOrderGateway } from '../services/repair-order.service.js';
import type { SupportMessageStore } from '../services/support-message.store.js';
import type { UnknownClientStore } from '../services/unknown-client.store.js';
import type { Logger } from '../utils/logger.js';
import type { BotContext } from './context.js';
import { t } from './messages.js';
import {
  hasRegisteredProfile,
  registeredHelpKey,
  registeredHelpParseMode,
  currentReplyKeyboard,
} from './helpers.js';
import {
  initialSession,
  createTelegramApiLoggingTransformer,
  createSessionRestorationMiddleware,
  summarizeTelegramUpdate,
  summarizeSession,
} from './session.js';

// Handler registrations
import { registerCommandHandlers } from './handlers/commands.js';
import { registerRegistrationHandlers } from './handlers/registration.js';
import { registerSettingsHandlers } from './handlers/settings.js';
import { registerRepairOrdersHandlers } from './handlers/repair-orders.js';
import { registerSupportHandlers } from './handlers/support.js';
import { registerUnknownFlowHandlers } from './handlers/unknown-flow.js';
import { registerAdminClientsHandlers } from './handlers/admin-clients.js';
import { registerAdminTemplatesHandlers } from './handlers/admin-templates.js';
import { registerAdminStatusNamesHandlers } from './handlers/admin-status-names.js';
import { registerAdminExportHandlers } from './handlers/admin-export.js';
import { registerDirectMessageHandlers } from './handlers/direct-messages.js';
import { registerDeveloperHandlers } from './handlers/developer.js';

export interface BotDependencies {
  registrationService: ClientRegistrationGateway;
  repairOrderService: RepairOrderGateway;
  clientRepairOrderService: ClientRepairOrderGateway;
  repairOrderStatusService?: RepairOrderStatusGateway;
  unknownClientStore: UnknownClientStore;
  registeredUserStore: RegisteredUserStore;
  messageTemplateStore: MessageTemplateStore;
  repairOrderStatusNameStore?: RepairOrderStatusNameStore;
  apiErrorLocalizationStore?: ApiErrorLocalizationStore;
  supportMessageStore: SupportMessageStore;
  actionExportService?: ActionExportService;
  logger: Logger;
  allowManualPhoneEntry: boolean;
  richMessagesEnabled: boolean;
  developerTelegramIds?: ReadonlySet<string>;
}

export type { RegistrationAccountKind, SettingsName } from './helpers.js';
export {
  registrationAccountKind,
  clearLocalizedBotCommands,
  localizedBotCommands,
  setLocalizedBotCommands,
  parseSettingsName,
  hasEmployeeMenuAccess,
  hasDeveloperMenuAccess,
  canRegisterWithManualPhone,
} from './helpers.js';

export { createSessionRestorationMiddleware } from './session.js';

export const createBot = (token: string, dependencies: BotDependencies): Bot<BotContext> => {
  const bot = new Bot<BotContext>(token);

  // Configure Telegram API request/response logging
  bot.api.config.use(createTelegramApiLoggingTransformer(dependencies.logger));

  // Initialize session support
  bot.use(session({ initial: initialSession }));

  bot.use(async (ctx, next) => {
    if (ctx.from && dependencies.developerTelegramIds?.has(String(ctx.from.id))) {
      ctx.session.developer = { is_active: true };
    } else {
      delete ctx.session.developer;
    }
    await next();
  });

  // Automatically restore sessions for registered users
  bot.use(createSessionRestorationMiddleware(dependencies));

  // Diagnostic update tracing middleware
  bot.use(async (ctx, next) => {
    const startedAt = Date.now();
    dependencies.logger.debug(`Incoming Telegram update ${ctx.update.update_id}`);
    dependencies.logger.extra(`Incoming Telegram update ${ctx.update.update_id}`, {
      update: summarizeTelegramUpdate(ctx),
    });
    try {
      await next();
    } finally {
      const durationMs = Date.now() - startedAt;
      dependencies.logger.info(
        `Telegram update ${ctx.update.update_id} processed in ${durationMs}ms`,
      );
      dependencies.logger.extra(`Telegram update ${ctx.update.update_id} completed`, {
        durationMs,
        session: summarizeSession(ctx.session),
      });
    }
  });

  // Register feature handlers
  registerSupportHandlers(bot, token, dependencies);
  registerCommandHandlers(bot, dependencies);
  registerRegistrationHandlers(bot, dependencies);
  registerSettingsHandlers(bot, dependencies);
  registerRepairOrdersHandlers(bot, dependencies);
  registerDirectMessageHandlers(bot, dependencies);
  registerUnknownFlowHandlers(bot, dependencies);
  registerAdminClientsHandlers(bot, dependencies);
  registerAdminTemplatesHandlers(bot, dependencies);
  registerAdminStatusNamesHandlers(bot, dependencies);
  registerAdminExportHandlers(bot, dependencies);
  if (dependencies.apiErrorLocalizationStore) {
    registerDeveloperHandlers(bot, {
      ...dependencies,
      apiErrorLocalizationStore: dependencies.apiErrorLocalizationStore,
    });
  }

  // Fallback handlers for unhandled messages
  const sendHelpOrPhoneOnly = async (ctx: BotContext) => {
    await ctx.reply(
      t(
        ctx.session.locale,
        hasRegisteredProfile(ctx.session) ? registeredHelpKey(ctx.session) : 'phoneOnly',
      ),
      {
        reply_markup: currentReplyKeyboard(ctx.session),
        parse_mode: hasRegisteredProfile(ctx.session)
          ? registeredHelpParseMode(ctx.session)
          : undefined,
      },
    );
  };

  bot.on('message:text', sendHelpOrPhoneOnly);
  bot.on('message:photo', sendHelpOrPhoneOnly);

  // Global update error boundaries
  bot.catch((error) => {
    const cause = error.error;
    if (cause instanceof GrammyError) {
      dependencies.logger.error(`Telegram API error: ${cause.description}`, cause);
    } else if (cause instanceof HttpError) {
      dependencies.logger.error('Telegram network error', cause);
    } else {
      dependencies.logger.error('Unhandled bot update error', cause);
    }
  });

  return bot;
};
