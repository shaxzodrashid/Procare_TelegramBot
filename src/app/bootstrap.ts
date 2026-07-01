import type { Bot } from 'grammy';
import type { FastifyInstance } from 'fastify';

import { createApiServer } from '../api/server.js';
import { createBot, setLocalizedBotCommands } from '../bot/create-bot.js';
import type { BotContext } from '../bot/context.js';
import type { AppConfig } from '../config/index.js';
import { createDatabase, migrateDatabase } from '../database/database.js';
import { PostgresActionExportService } from '../services/action-export.service.js';
import { PostgresApiErrorLocalizationStore } from '../services/api-error-localization.service.js';
import { BotDirectMessageService } from '../services/bot-notification.service.js';
import { HttpClientRepairOrderService } from '../services/client-repair-order.service.js';
import { HttpClientRegistrationService } from '../services/client-registration.service.js';
import { SystemHealthMonitor } from '../services/health.service.js';
import {
  BotLifecycleNotificationService,
  type LifecycleBroadcastSummary,
} from '../services/lifecycle-notification.service.js';
import { PostgresMessageTemplateStore } from '../services/message-template.service.js';
import { PostgresRegisteredUserStore } from '../services/registered-user.store.js';
import {
  HttpRepairOrderStatusService,
  PostgresRepairOrderStatusNameStore,
} from '../services/repair-order-status.service.js';
import { HttpRepairOrderService } from '../services/repair-order.service.js';
import { PostgresSupportMessageStore } from '../services/support-message.store.js';
import { PostgresUnknownClientStore } from '../services/unknown-client.store.js';
import type { Logger } from '../utils/logger.js';

export interface RunningApplication {
  stop(signal?: string): Promise<void>;
}

export const bootstrap = async (config: AppConfig, logger: Logger): Promise<RunningApplication> => {
  let bot: Bot<BotContext> | undefined;
  let botTask: Promise<void> | undefined;
  let api: FastifyInstance | undefined;
  let directMessageService: BotDirectMessageService | undefined;
  let lifecycleNotificationService: BotLifecycleNotificationService | undefined;
  let startupNotificationTask: Promise<void> | undefined;
  let stopping = false;

  const database = createDatabase(config.database);
  const healthMonitor = new SystemHealthMonitor({
    database,
    botEnabled: config.bot.enabled,
    apiEnabled: config.api.enabled,
    lifecycleNotificationsEnabled: config.lifecycleNotifications.enabled,
  });
  try {
    await migrateDatabase(database);
  } catch (error) {
    await database.destroy();
    throw error;
  }
  healthMonitor.markMigrationsCompleted();
  logger.info('PostgreSQL migrations completed');

  const registrationService = new HttpClientRegistrationService(
    {
      baseUrl: config.crm.baseUrl,
      username: config.crm.username,
      password: config.crm.password,
      timeoutMs: config.crm.requestTimeoutMs,
      maxRetries: config.crm.maxRetries,
    },
    logger,
  );
  const repairOrderService = new HttpRepairOrderService(
    {
      baseUrl: config.crm.baseUrl,
      timeoutMs: config.crm.requestTimeoutMs,
      maxRetries: config.crm.maxRetries,
    },
    logger,
  );
  const clientRepairOrderService = new HttpClientRepairOrderService(
    {
      baseUrl: config.crm.baseUrl,
      username: config.crm.username,
      password: config.crm.password,
      timeoutMs: config.crm.requestTimeoutMs,
      maxRetries: config.crm.maxRetries,
    },
    logger,
  );
  const repairOrderStatusService = new HttpRepairOrderStatusService(
    {
      baseUrl: config.crm.baseUrl,
      username: config.crm.username,
      password: config.crm.password,
      timeoutMs: config.crm.requestTimeoutMs,
      maxRetries: config.crm.maxRetries,
    },
    logger,
  );
  const unknownClientStore = new PostgresUnknownClientStore(database);
  const registeredUserStore = new PostgresRegisteredUserStore(database);
  const messageTemplateStore = new PostgresMessageTemplateStore(database);
  const repairOrderStatusNameStore = new PostgresRepairOrderStatusNameStore(database);
  const apiErrorLocalizationStore = new PostgresApiErrorLocalizationStore(database);
  const supportMessageStore = new PostgresSupportMessageStore(database);
  const actionExportService = new PostgresActionExportService(database);

  if (config.bot.enabled) {
    bot = createBot(config.bot.token!, {
      registrationService,
      repairOrderService,
      clientRepairOrderService,
      repairOrderStatusService,
      unknownClientStore,
      registeredUserStore,
      messageTemplateStore,
      repairOrderStatusNameStore,
      apiErrorLocalizationStore,
      supportMessageStore,
      actionExportService,
      logger,
      allowManualPhoneEntry: config.nodeEnv === 'development',
      richMessagesEnabled: config.bot.richMessagesEnabled,
      developerTelegramIds: new Set(config.bot.developerTelegramIds),
    });
    await bot.init();
    healthMonitor.markBotAuthenticated(bot.botInfo.username);
    healthMonitor.setTelegramProbe(async () => {
      const me = await bot!.api.getMe();
      return { id: me.id, username: me.username };
    });
    await setLocalizedBotCommands(bot);
    directMessageService = new BotDirectMessageService(
      registeredUserStore,
      messageTemplateStore,
      bot.api,
      supportMessageStore,
    );
    if (config.lifecycleNotifications.enabled) {
      lifecycleNotificationService = new BotLifecycleNotificationService(
        registeredUserStore,
        messageTemplateStore,
        bot.api,
        logger,
        {
          batchSize: config.lifecycleNotifications.batchSize,
          concurrency: config.lifecycleNotifications.concurrency,
        },
      );
    }
    logger.info(`Telegram bot @${bot.botInfo.username} authenticated`);
  }

  if (config.api.enabled) {
    api = createApiServer(config, logger, {
      directMessageSender: directMessageService,
      directFileSender: directMessageService,
      healthReporter: healthMonitor,
    });
    await api.listen({ host: config.api.host, port: config.api.port });
    healthMonitor.markApiListening();
    logger.info(`Health API listening on ${config.api.host}:${config.api.port}`);
  }

  if (bot) {
    healthMonitor.markBotPollingStarting();
    botTask = bot
      .start({
        onStart: (botInfo) => {
          healthMonitor.markBotPollingRunning(botInfo.username);
          logger.info(`Telegram bot @${botInfo.username} started`);
          if (lifecycleNotificationService) {
            startupNotificationTask = runLifecycleNotification(
              'startup',
              lifecycleNotificationService.notifyStartup(
                config.lifecycleNotifications.startupTimeoutMs,
              ),
              healthMonitor,
              logger,
            );
          }
        },
      })
      .catch((error: unknown) => {
        if (!stopping) {
          healthMonitor.markBotPollingFailed(error);
          logger.error('Telegram bot polling stopped unexpectedly', error);
        }
      });
  }

  return {
    async stop(signal = 'shutdown'): Promise<void> {
      if (stopping) return;
      stopping = true;
      logger.info(`Stopping application after ${signal}`);

      if (bot) {
        healthMonitor.markBotPollingStopping();
        if (startupNotificationTask) await startupNotificationTask.catch(() => undefined);
        if (lifecycleNotificationService) {
          await runLifecycleNotification(
            'shutdown',
            lifecycleNotificationService.notifyShutdown(
              config.lifecycleNotifications.shutdownTimeoutMs,
            ),
            healthMonitor,
            logger,
          );
        }
        await bot.stop();
        healthMonitor.markBotPollingStopped();
      }
      if (botTask) await botTask;
      if (api) await api.close();
      await database.destroy();

      logger.info('Application stopped');
    },
  };
};

const runLifecycleNotification = async (
  kind: LifecycleBroadcastSummary['kind'],
  task: Promise<LifecycleBroadcastSummary>,
  healthMonitor: SystemHealthMonitor,
  logger: Logger,
): Promise<void> => {
  try {
    const summary = await task;
    healthMonitor.recordLifecycleBroadcast(summary);
  } catch (error) {
    logger.error(`Lifecycle ${kind} notification failed`, error);
  }
};
