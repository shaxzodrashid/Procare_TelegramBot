import type { AsyncLocalStorage } from 'node:async_hooks';

import type { Api, RawApi } from 'grammy';

import type { BotContext } from '../bot/context.js';
import { summarizeTelegramUpdate } from '../bot/session.js';
import { redactPhoneNumbersInText } from '../utils/log-redaction.js';
import type { Logger } from '../utils/logger.js';

const TELEGRAM_REPORT_CHUNK_LENGTH = 3_400;
const SECRET_KEY_PATTERN = /authorization|cookie|password|secret|token|api[-_]?key/i;
const TELEGRAM_BOT_TOKEN_PATTERN = /\b\d{6,12}:[A-Za-z0-9_-]{20,}\b/g;
const AUTH_VALUE_PATTERN = /\b(Basic|Bearer)\s+[A-Za-z0-9+/=_-]+/gi;

type DeveloperErrorMetadata = Record<string, unknown>;

interface DeveloperErrorNotificationParams {
  api: Api<RawApi>;
  developerTelegramIds?: ReadonlySet<string>;
  logger: Logger;
  ctx: BotContext;
  source: string;
  error: unknown;
  metadata?: DeveloperErrorMetadata;
}

const redactString = (value: string): string =>
  redactPhoneNumbersInText(value)
    .replace(TELEGRAM_BOT_TOKEN_PATTERN, '[REDACTED_BOT_TOKEN]')
    .replace(AUTH_VALUE_PATTERN, '$1 [REDACTED]');

const sanitizeValue = (value: unknown, seen = new WeakSet<object>(), key?: string): unknown => {
  if (key && SECRET_KEY_PATTERN.test(key)) return '[REDACTED]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'symbol' || typeof value === 'function') return String(value);
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[Circular]';

  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, seen));
  }

  const sanitized: Record<string, unknown> = {};
  for (const property of Object.keys(value)) {
    let propertyValue: unknown;
    try {
      propertyValue = (value as Record<string, unknown>)[property];
    } catch (error) {
      propertyValue = `[Unreadable: ${error instanceof Error ? error.message : String(error)}]`;
    }
    sanitized[property] = sanitizeValue(propertyValue, seen, property);
  }
  return sanitized;
};

const serializeError = (error: unknown): Record<string, unknown> => {
  if (!(error instanceof Error)) {
    return { type: 'NonErrorThrown', value: sanitizeValue(error) };
  }

  const details: Record<string, unknown> = {
    name: error.name,
    message: redactString(error.message),
    stack: error.stack ? redactString(error.stack) : null,
  };
  const seen = new WeakSet<object>([error]);
  for (const property of Object.getOwnPropertyNames(error)) {
    if (property === 'name' || property === 'message' || property === 'stack') continue;
    details[property] = sanitizeValue(
      (error as unknown as Record<string, unknown>)[property],
      seen,
      property,
    );
  }
  return details;
};

const getUserInput = (ctx: BotContext): string | null => {
  if (ctx.callbackQuery?.data) return ctx.callbackQuery.data;
  if (ctx.message && 'text' in ctx.message && typeof ctx.message.text === 'string') {
    return redactString(ctx.message.text);
  }
  if (ctx.message && 'caption' in ctx.message && typeof ctx.message.caption === 'string') {
    return redactString(ctx.message.caption);
  }
  return null;
};

const buildContext = (ctx: BotContext): Record<string, unknown> => {
  let updateSummary: unknown;
  try {
    updateSummary = summarizeTelegramUpdate(ctx);
  } catch (error) {
    updateSummary = {
      update_id: ctx.update.update_id,
      summary_error: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    update: updateSummary,
    actor: ctx.from
      ? {
          id: ctx.from.id,
          username: ctx.from.username ?? null,
          first_name: ctx.from.first_name,
          last_name: ctx.from.last_name ?? null,
          language_code: ctx.from.language_code ?? null,
        }
      : null,
    user_input: getUserInput(ctx),
  };
};

const stringifyReportSection = (value: unknown): string => {
  try {
    return JSON.stringify(sanitizeValue(value), null, 2) ?? String(value);
  } catch (error) {
    return `[Unable to serialize: ${error instanceof Error ? error.message : String(error)}]`;
  }
};

const splitReport = (report: string): string[] => {
  if (report.length <= TELEGRAM_REPORT_CHUNK_LENGTH) return [report];

  const chunks: string[] = [];
  let remaining = report;
  while (remaining.length > TELEGRAM_REPORT_CHUNK_LENGTH) {
    const candidate = remaining.slice(0, TELEGRAM_REPORT_CHUNK_LENGTH);
    const newlineIndex = candidate.lastIndexOf('\n');
    const splitIndex =
      newlineIndex > TELEGRAM_REPORT_CHUNK_LENGTH / 2 ? newlineIndex : candidate.length;
    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).replace(/^\n/, '');
  }
  if (remaining) chunks.push(remaining);

  return chunks.map((chunk, index) =>
    chunks.length === 1
      ? chunk
      : `[Developer error report ${index + 1}/${chunks.length}]\n${chunk}`,
  );
};

const buildReport = (params: DeveloperErrorNotificationParams): string => {
  const timestamp = new Date().toISOString();
  const reportId = `${params.ctx.update.update_id}-${Date.now().toString(36)}`;
  const sections = [
    '🚨 DEVELOPER ERROR REPORT',
    `Report ID: ${reportId}`,
    `Time: ${timestamp}`,
    `Source: ${params.source}`,
    '',
    'ERROR',
    stringifyReportSection(serializeError(params.error)),
    '',
    'TELEGRAM CONTEXT',
    stringifyReportSection(buildContext(params.ctx)),
  ];

  if (params.metadata && Object.keys(params.metadata).length > 0) {
    sections.push('', 'METADATA', stringifyReportSection(params.metadata));
  }

  return sections.join('\n');
};

export const notifyDevelopersOfError = async (
  params: DeveloperErrorNotificationParams,
): Promise<void> => {
  const developerTelegramIds = [...(params.developerTelegramIds ?? [])];
  if (developerTelegramIds.length === 0) return;

  const reportParts = splitReport(buildReport(params));
  await Promise.all(
    developerTelegramIds.map(async (telegramId) => {
      try {
        for (const reportPart of reportParts) {
          await params.api.sendMessage(telegramId, reportPart, {
            link_preview_options: { is_disabled: true },
          });
        }
      } catch (error) {
        params.logger.warn(
          `Failed to send developer error report to Telegram ID ${telegramId}`,
          error,
        );
      }
    }),
  );
};

export const createDeveloperErrorReportingLogger = (params: {
  logger: Logger;
  api: Api<RawApi>;
  developerTelegramIds?: ReadonlySet<string>;
  contextStorage: AsyncLocalStorage<BotContext>;
}): Logger => ({
  info: (message, ...args) => params.logger.info(message, ...args),
  warn: (message, ...args) => params.logger.warn(message, ...args),
  error: (message, ...args) => {
    params.logger.error(message, ...args);
    const ctx = params.contextStorage.getStore();
    if (!ctx) return;

    const errorIndex = args.findIndex((argument) => argument instanceof Error);
    const error = errorIndex >= 0 ? args[errorIndex] : new Error(message);
    const reportArguments = args.filter((_, index) => index !== errorIndex);
    void notifyDevelopersOfError({
      api: params.api,
      developerTelegramIds: params.developerTelegramIds,
      logger: params.logger,
      ctx,
      source: message,
      error,
      metadata: reportArguments.length > 0 ? { log_arguments: reportArguments } : undefined,
    });
  },
  debug: (message, ...args) => params.logger.debug(message, ...args),
  extra: (message, ...args) => params.logger.extra(message, ...args),
  table: (tabularData, properties) => params.logger.table(tabularData, properties),
});
