import type { Bot } from 'grammy';
import type { FastifyInstance } from 'fastify';

import { createApiServer } from '../api/server.js';
import { createBot, setLocalizedBotCommands } from '../bot/create-bot.js';
import type { BotContext } from '../bot/context.js';
import type { AppConfig } from '../config/index.js';
import { createDatabase, migrateDatabase } from '../database/database.js';
import { BotDirectMessageService } from '../services/bot-notification.service.js';
import { HttpClientRepairOrderService } from '../services/client-repair-order.service.js';
import { HttpClientRegistrationService } from '../services/client-registration.service.js';
import { PostgresMessageTemplateStore } from '../services/message-template.service.js';
import { PostgresRegisteredUserStore } from '../services/registered-user.store.js';
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
  let stopping = false;

  const database = createDatabase(config.database);
  try {
    await migrateDatabase(database);
  } catch (error) {
    await database.destroy();
    throw error;
  }
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
  const unknownClientStore = new PostgresUnknownClientStore(database);
  const registeredUserStore = new PostgresRegisteredUserStore(database);
  const messageTemplateStore = new PostgresMessageTemplateStore(database);
  const supportMessageStore = new PostgresSupportMessageStore(database);

  if (config.bot.enabled) {
    bot = createBot(config.bot.token!, {
      registrationService,
      repairOrderService,
      clientRepairOrderService,
      unknownClientStore,
      registeredUserStore,
      messageTemplateStore,
      supportMessageStore,
      logger,
      allowManualPhoneEntry: config.nodeEnv === 'development',
      richMessagesEnabled: config.bot.richMessagesEnabled,
    });
    await bot.init();
    await setLocalizedBotCommands(bot);
    directMessageService = new BotDirectMessageService(
      registeredUserStore,
      messageTemplateStore,
      bot.api,
    );
    logger.info(`Telegram bot @${bot.botInfo.username} authenticated`);
  }

  if (config.api.enabled) {
    api = createApiServer(config, logger, { directMessageSender: directMessageService });
    await api.listen({ host: config.api.host, port: config.api.port });
    logger.info(`Health API listening on ${config.api.host}:${config.api.port}`);
  }

  if (bot) {
    botTask = bot
      .start({
        onStart: (botInfo) => logger.info(`Telegram bot @${botInfo.username} started`),
      })
      .catch((error: unknown) => {
        if (!stopping) logger.error('Telegram bot polling stopped unexpectedly', error);
      });
  }

  return {
    async stop(signal = 'shutdown'): Promise<void> {
      if (stopping) return;
      stopping = true;
      logger.info(`Stopping application after ${signal}`);

      if (bot) await bot.stop();
      if (botTask) await botTask;
      if (api) await api.close();
      await database.destroy();

      logger.info('Application stopped');
    },
  };
};
