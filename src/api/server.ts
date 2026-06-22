import Fastify, { type FastifyInstance } from 'fastify';

import type { AppConfig } from '../config/index.js';
import {
  TELEGRAM_TEXT_LIMIT,
  type DirectMessageDeliveryResult,
} from '../services/bot-notification.service.js';
import type { Logger } from '../utils/logger.js';
import { normalizeUzPhone } from '../utils/phone.js';

export interface DirectMessageSender {
  sendDirectMessage(params: {
    phoneNumber: string;
    message: string;
  }): Promise<DirectMessageDeliveryResult>;
}

export interface ApiServerDependencies {
  directMessageSender?: DirectMessageSender;
}

interface SendMessageRequestBody {
  phone_number?: unknown;
  message?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseSendMessageBody = (
  body: unknown,
): { ok: true; phoneNumber: string; message: string } | { ok: false; message: string } => {
  if (!isRecord(body)) return { ok: false, message: 'Request body must be a JSON object' };

  const { phone_number: rawPhoneNumber, message: rawMessage } = body as SendMessageRequestBody;
  if (typeof rawPhoneNumber !== 'string') {
    return { ok: false, message: 'phone_number must be a string' };
  }
  if (typeof rawMessage !== 'string') return { ok: false, message: 'message must be a string' };

  const phoneNumber = normalizeUzPhone(rawPhoneNumber);
  if (!phoneNumber)
    return { ok: false, message: 'phone_number must be a valid Uzbek phone number' };

  const message = rawMessage.trim();
  if (!message) return { ok: false, message: 'message must not be empty' };
  if (message.length > TELEGRAM_TEXT_LIMIT) {
    return { ok: false, message: `message must be ${TELEGRAM_TEXT_LIMIT} characters or fewer` };
  }

  return { ok: true, phoneNumber, message };
};

export const createApiServer = (
  config: AppConfig,
  logger: Logger,
  dependencies: ApiServerDependencies = {},
): FastifyInstance => {
  const app = Fastify({ logger: false });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'procare-telegram-bot',
    timestamp: new Date().toISOString(),
    botEnabled: config.bot.enabled,
  }));

  app.post('/messages/send', async (request, reply) => {
    if (!dependencies.directMessageSender) {
      return reply.status(503).send({
        statusCode: 503,
        error: 'ServiceUnavailable',
        message: 'Telegram message delivery is not available',
      });
    }

    const parsed = parseSendMessageBody(request.body);
    if (!parsed.ok) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'BadRequest',
        message: parsed.message,
      });
    }

    const result = await dependencies.directMessageSender.sendDirectMessage({
      phoneNumber: parsed.phoneNumber,
      message: parsed.message,
    });

    if (result.status === 'sent') return reply.send({ status: 'sent' });
    if (result.status === 'not_found') {
      return reply.status(404).send({
        statusCode: 404,
        error: 'NotFound',
        message: 'No registered Telegram user was found for this phone number',
      });
    }
    if (result.status === 'blocked') {
      return reply.status(409).send({
        statusCode: 409,
        error: 'Conflict',
        message: 'Telegram user is marked as blocked',
      });
    }

    return reply.status(502).send({
      statusCode: 502,
      error: 'BadGateway',
      message: 'Telegram message delivery failed',
    });
  });

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
