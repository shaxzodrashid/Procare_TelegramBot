import Fastify, { type FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';

import type { AppConfig } from '../config/index.js';
import {
  TELEGRAM_TEXT_LIMIT,
  type DirectMessageInlineKeyboard,
  type DirectMessageSupportReply,
  type DirectMessageVariables,
  type DirectMessageDeliveryResult,
  type DirectFileDeliveryResult,
} from '../services/bot-notification.service.js';
import type { Logger } from '../utils/logger.js';
import { normalizeUzPhone } from '../utils/phone.js';

export interface DirectMessageSender {
  sendDirectMessage(params: {
    phoneNumber: string;
    message: string;
    variables: DirectMessageVariables;
    inlineKeyboard?: DirectMessageInlineKeyboard;
    supportReply?: DirectMessageSupportReply;
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
}

interface SendMessageRequestBody {
  phone_number?: unknown;
  message?: unknown;
  variables?: unknown;
  inline_keyboard?: unknown;
  support_reply?: unknown;
}

interface SendFileRequestBody {
  phone_number?: unknown;
  file_type?: unknown;
  file_url?: unknown;
  file_name?: unknown;
  variables?: unknown;
  caption?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_INLINE_KEYBOARD_ROWS = 8;
const MAX_INLINE_KEYBOARD_BUTTONS = 32;
const MAX_INLINE_KEYBOARD_BUTTONS_PER_ROW = 4;
const MAX_INLINE_KEYBOARD_TEXT_LENGTH = 64;

const isAuthorized = (authorization: string | undefined, expectedToken: string): boolean => {
  if (!expectedToken) return false;

  const prefix = 'Bearer ';
  if (!authorization?.startsWith(prefix)) return false;

  const token = authorization.slice(prefix.length).trim();
  const actual = Buffer.from(token);
  const expected = Buffer.from(expectedToken);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

const parseVariables = (
  value: unknown,
): { ok: true; variables: DirectMessageVariables } | { ok: false; message: string } => {
  if (value === undefined) return { ok: true, variables: {} };
  if (!isRecord(value)) return { ok: false, message: 'variables must be a JSON object' };

  const variables: DirectMessageVariables = {};
  for (const [key, rawVariable] of Object.entries(value)) {
    if (!/^[a-zA-Z0-9_]{1,64}$/.test(key)) {
      return {
        ok: false,
        message: 'variable names may contain only letters, numbers, and underscores',
      };
    }
    if (
      rawVariable !== null &&
      typeof rawVariable !== 'string' &&
      typeof rawVariable !== 'number' &&
      typeof rawVariable !== 'boolean'
    ) {
      return {
        ok: false,
        message: 'variable values must be strings, numbers, booleans, or null',
      };
    }
    variables[key] = rawVariable;
  }

  return { ok: true, variables };
};

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

const parseKeyboardButton = (
  value: unknown,
):
  | { ok: true; button: DirectMessageInlineKeyboard['rows'][number][number] }
  | {
      ok: false;
      message: string;
    } => {
  if (!isRecord(value)) return { ok: false, message: 'inline keyboard buttons must be objects' };

  const { type, text } = value;
  if (type !== 'url' && type !== 'repair_order') {
    return { ok: false, message: 'inline keyboard button type must be url or repair_order' };
  }

  if (text !== undefined) {
    if (typeof text !== 'string' || text.trim().length === 0) {
      return { ok: false, message: 'inline keyboard button text must be a non-empty string' };
    }
    if (text.trim().length > MAX_INLINE_KEYBOARD_TEXT_LENGTH) {
      return {
        ok: false,
        message: `inline keyboard button text must be ${MAX_INLINE_KEYBOARD_TEXT_LENGTH} characters or fewer`,
      };
    }
  }

  if (type === 'url') {
    if (typeof text !== 'string' || text.trim().length === 0) {
      return { ok: false, message: 'url buttons require text' };
    }
    if (typeof value.url !== 'string' || !isHttpUrl(value.url)) {
      return { ok: false, message: 'url buttons require an http or https url' };
    }
    return { ok: true, button: { type, text: text.trim(), url: value.url } };
  }

  if (typeof value.repair_order_uuid !== 'string' || !UUID_PATTERN.test(value.repair_order_uuid)) {
    return { ok: false, message: 'repair_order buttons require a valid repair_order_uuid' };
  }

  return {
    ok: true,
    button: {
      type,
      text: typeof text === 'string' ? text.trim() : undefined,
      repairOrderUuid: value.repair_order_uuid,
    },
  };
};

const parseInlineKeyboard = (
  value: unknown,
): { ok: true; inlineKeyboard?: DirectMessageInlineKeyboard } | { ok: false; message: string } => {
  if (value === undefined) return { ok: true };
  if (!isRecord(value)) return { ok: false, message: 'inline_keyboard must be a JSON object' };

  if (value.type === 'repair_order') {
    const parsedButton = parseKeyboardButton(value);
    if (!parsedButton.ok) return parsedButton;
    return { ok: true, inlineKeyboard: { rows: [[parsedButton.button]] } };
  }

  if (!Array.isArray(value.rows)) {
    return { ok: false, message: 'inline_keyboard.rows must be an array' };
  }
  if (value.rows.length === 0 || value.rows.length > MAX_INLINE_KEYBOARD_ROWS) {
    return {
      ok: false,
      message: `inline_keyboard.rows must contain 1 to ${MAX_INLINE_KEYBOARD_ROWS} rows`,
    };
  }

  let buttonCount = 0;
  const rows: DirectMessageInlineKeyboard['rows'] = [];
  for (const rawRow of value.rows) {
    if (
      !Array.isArray(rawRow) ||
      rawRow.length === 0 ||
      rawRow.length > MAX_INLINE_KEYBOARD_BUTTONS_PER_ROW
    ) {
      return {
        ok: false,
        message: `each inline keyboard row must contain 1 to ${MAX_INLINE_KEYBOARD_BUTTONS_PER_ROW} buttons`,
      };
    }

    const row: DirectMessageInlineKeyboard['rows'][number] = [];
    for (const rawButton of rawRow) {
      buttonCount += 1;
      if (buttonCount > MAX_INLINE_KEYBOARD_BUTTONS) {
        return {
          ok: false,
          message: `inline keyboard must contain ${MAX_INLINE_KEYBOARD_BUTTONS} buttons or fewer`,
        };
      }

      const parsedButton = parseKeyboardButton(rawButton);
      if (!parsedButton.ok) return parsedButton;
      row.push(parsedButton.button);
    }
    rows.push(row);
  }

  return { ok: true, inlineKeyboard: { rows } };
};

const parseSupportReply = (
  value: unknown,
): { ok: true; supportReply?: DirectMessageSupportReply } | { ok: false; message: string } => {
  if (value === undefined) return { ok: true };
  if (!isRecord(value)) return { ok: false, message: 'support_reply must be a JSON object' };

  if (
    typeof value.target_crm_comment_id !== 'string' ||
    !UUID_PATTERN.test(value.target_crm_comment_id)
  ) {
    return {
      ok: false,
      message: 'support_reply.target_crm_comment_id must be a valid CRM comment UUID',
    };
  }

  return {
    ok: true,
    supportReply: { targetCrmCommentId: value.target_crm_comment_id },
  };
};

const parseSendMessageBody = (
  body: unknown,
):
  | {
      ok: true;
      phoneNumber: string;
      message: string;
      variables: DirectMessageVariables;
      inlineKeyboard?: DirectMessageInlineKeyboard;
      supportReply?: DirectMessageSupportReply;
    }
  | { ok: false; message: string } => {
  if (!isRecord(body)) return { ok: false, message: 'Request body must be a JSON object' };

  const {
    phone_number: rawPhoneNumber,
    message: rawMessage,
    variables: rawVariables,
    inline_keyboard: rawInlineKeyboard,
    support_reply: rawSupportReply,
  } = body as SendMessageRequestBody;
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

  const parsedVariables = parseVariables(rawVariables);
  if (!parsedVariables.ok) return parsedVariables;

  const parsedInlineKeyboard = parseInlineKeyboard(rawInlineKeyboard);
  if (!parsedInlineKeyboard.ok) return parsedInlineKeyboard;

  const parsedSupportReply = parseSupportReply(rawSupportReply);
  if (!parsedSupportReply.ok) return parsedSupportReply;

  return {
    ok: true,
    phoneNumber,
    message,
    variables: parsedVariables.variables,
    inlineKeyboard: parsedInlineKeyboard.inlineKeyboard,
    supportReply: parsedSupportReply.supportReply,
  };
};

const parseSendFileBody = (
  body: unknown,
):
  | {
      ok: true;
      phoneNumber: string;
      fileType: 'warranty' | 'offerta' | 'checklist';
      fileUrl: string;
      fileName?: string;
      variables?: DirectMessageVariables;
      caption?: string;
    }
  | { ok: false; message: string } => {
  if (!isRecord(body)) return { ok: false, message: 'Request body must be a JSON object' };

  const {
    phone_number: rawPhoneNumber,
    file_type: rawFileType,
    file_url: rawFileUrl,
    file_name: rawFileName,
    variables: rawVariables,
    caption: rawCaption,
  } = body as SendFileRequestBody;

  if (typeof rawPhoneNumber !== 'string') {
    return { ok: false, message: 'phone_number must be a string' };
  }
  const phoneNumber = normalizeUzPhone(rawPhoneNumber);
  if (!phoneNumber) {
    return { ok: false, message: 'phone_number must be a valid Uzbek phone number' };
  }

  if (typeof rawFileType !== 'string') {
    return { ok: false, message: 'file_type must be a string' };
  }
  if (rawFileType !== 'warranty' && rawFileType !== 'offerta' && rawFileType !== 'checklist') {
    return { ok: false, message: "file_type must be one of 'warranty', 'offerta', or 'checklist'" };
  }

  if (typeof rawFileUrl !== 'string') {
    return { ok: false, message: 'file_url must be a string' };
  }
  if (!isHttpUrl(rawFileUrl)) {
    return { ok: false, message: 'file_url must be a valid HTTP or HTTPS URL' };
  }

  let fileName: string | undefined;
  if (rawFileName !== undefined) {
    if (typeof rawFileName !== 'string' || rawFileName.trim().length === 0) {
      return { ok: false, message: 'file_name must be a non-empty string' };
    }
    if (!rawFileName.toLowerCase().endsWith('.pdf')) {
      return { ok: false, message: 'file_name must end with a .pdf extension' };
    }
    fileName = rawFileName.trim();
  }

  let caption: string | undefined;
  if (rawCaption !== undefined) {
    if (typeof rawCaption !== 'string') {
      return { ok: false, message: 'caption must be a string' };
    }
    if (rawCaption.length > 1024) {
      return { ok: false, message: 'caption must be 1024 characters or fewer' };
    }
    caption = rawCaption.trim();
  }

  const parsedVariables = parseVariables(rawVariables);
  if (!parsedVariables.ok) return parsedVariables;

  return {
    ok: true,
    phoneNumber,
    fileType: rawFileType,
    fileUrl: rawFileUrl,
    fileName,
    variables: parsedVariables.variables,
    caption,
  };
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
