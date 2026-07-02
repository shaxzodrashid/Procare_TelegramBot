import Fastify, { type FastifyInstance } from 'fastify';

import type { AppConfig } from '../config/index.js';
import type { SystemHealthSnapshot } from '../services/health.service.js';
import type {
  DirectMessageInlineKeyboard,
  DirectMessageSupportReply,
  DirectMessageVariables,
  DirectMessageDeliveryResult,
  DirectFileDeliveryResult,
} from '../services/bot-notification.service.js';
import type { Logger } from '../utils/logger.js';
import type { MessageTemplateType } from '../types/message-template.js';
import { isAuthorized } from './auth.js';
import { parseSendMessageBody, parseSendFileBody } from './validators.js';

export interface DirectMessageSender {
  sendDirectMessage(params: {
    phoneNumber: string;
    message: string;
    variables: DirectMessageVariables;
    inlineKeyboard?: DirectMessageInlineKeyboard;
    supportReply?: DirectMessageSupportReply;
    type?: MessageTemplateType;
    crmCommentId?: string;
    repairOrderUuid?: string;
    orderNumber?: string;
  }): Promise<DirectMessageDeliveryResult>;
}

export interface DirectFileSender {
  sendDirectFile(params: {
    phoneNumber: string;
    fileType: 'warranty' | 'offerta' | 'checklist';
    fileUrl: string;
    fileName?: string;
    variables?: DirectMessageVariables;
    caption?: string;
  }): Promise<DirectFileDeliveryResult>;
}

export interface ApiServerDependencies {
  directMessageSender?: DirectMessageSender;
  directFileSender?: DirectFileSender;
  healthReporter?: {
    snapshot(): Promise<SystemHealthSnapshot>;
  };
}

export const createApiServer = (
  config: AppConfig,
  logger: Logger,
  dependencies: ApiServerDependencies = {},
): FastifyInstance => {
  const app = Fastify({ logger: false });

  app.get('/health', async (request, reply) => {
    void request;
    if (!dependencies.healthReporter) {
      return {
        status: 'ok',
        service: 'procare-telegram-bot',
        timestamp: new Date().toISOString(),
        botEnabled: config.bot.enabled,
      };
    }

    const snapshot = await dependencies.healthReporter.snapshot();
    if (snapshot.status === 'unhealthy') return reply.status(503).send(snapshot);
    return reply.send(snapshot);
  });

  app.post('/messages/send', async (request, reply) => {
    if (!isAuthorized(request.headers.authorization, config.api.messageSendToken)) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'A valid Bearer token is required',
      });
    }

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
      variables: parsed.variables,
      inlineKeyboard: parsed.inlineKeyboard,
      supportReply: parsed.supportReply,
      crmCommentId: parsed.crmCommentId,
      repairOrderUuid: parsed.repairOrderUuid,
      orderNumber: parsed.orderNumber,
      ...(parsed.type !== undefined ? { type: parsed.type } : {}),
    });

    if (result.status === 'sent') return reply.send({ status: 'sent' });
    if (result.status === 'invalid_message') {
      return reply.status(400).send({
        statusCode: 400,
        error: 'BadRequest',
        message: result.message,
      });
    }
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

  app.post('/messages/send-file', async (request, reply) => {
    if (!isAuthorized(request.headers.authorization, config.api.messageSendToken)) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'A valid Bearer token is required',
      });
    }

    if (!dependencies.directFileSender) {
      return reply.status(503).send({
        statusCode: 503,
        error: 'ServiceUnavailable',
        message: 'Telegram file delivery is not available',
      });
    }

    const parsed = parseSendFileBody(request.body);
    if (!parsed.ok) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'BadRequest',
        message: parsed.message,
      });
    }

    const result = await dependencies.directFileSender.sendDirectFile({
      phoneNumber: parsed.phoneNumber,
      fileType: parsed.fileType,
      fileUrl: parsed.fileUrl,
      fileName: parsed.fileName,
      variables: parsed.variables,
      caption: parsed.caption,
    });

    if (result.status === 'sent') return reply.send({ status: 'sent' });
    if (result.status === 'invalid_file') {
      return reply.status(400).send({
        statusCode: 400,
        error: 'BadRequest',
        message: result.message,
      });
    }
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
      message: 'Telegram file delivery failed',
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
