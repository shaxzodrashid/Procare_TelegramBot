import Fastify, { type FastifyInstance } from 'fastify';

import type { AppConfig } from '../config/index.js';
import type { Logger } from '../utils/logger.js';

export const createApiServer = (config: AppConfig, logger: Logger): FastifyInstance => {
  const app = Fastify({ logger: false });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'procare-telegram-bot',
    timestamp: new Date().toISOString(),
    botEnabled: config.bot.enabled,
  }));

  app.setErrorHandler((error, request, reply) => {
    logger.error(`Unhandled API error on ${request.method} ${request.url}`, error);
    void reply.status(500).send({
      statusCode: 500,
      error: 'InternalServerError',
      message: 'Unexpected error',
    });
  });

  return app;
};
