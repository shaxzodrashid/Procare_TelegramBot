import 'dotenv/config';

export type LogLevel = 'info' | 'debug' | 'extra-high';

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  logLevel: LogLevel;
  bot: {
    enabled: boolean;
    token?: string;
    username?: string;
    richMessagesEnabled: boolean;
    developerTelegramIds: string[];
  };
  api: {
    enabled: boolean;
    host: string;
    port: number;
    messageSendToken: string;
  };
  lifecycleNotifications: {
    enabled: boolean;
    batchSize: number;
    concurrency: number;
    startupTimeoutMs: number;
    shutdownTimeoutMs: number;
  };
  crm: {
    baseUrl: string;
    username: string;
    password: string;
    repairStatusBranchId: string;
    requestTimeoutMs: number;
    maxRetries: number;
  };
  database: {
    host: string;
    port: number;
    user: string;
    password: string;
    name: string;
    ssl: boolean;
    poolMin: number;
    poolMax: number;
    acquireTimeoutMs: number;
  };
}

export class ConfigurationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid application configuration:\n- ${issues.join('\n- ')}`);
    this.name = 'ConfigurationError';
  }
}

const readBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('must be "true" or "false"');
};

const readInteger = (
  value: string | undefined,
  fallback: number,
  options: { min: number; max: number },
): number => {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < options.min || parsed > options.max) {
    throw new Error(`must be an integer between ${options.min} and ${options.max}`);
  }
  return parsed;
};

const readEnum = <T extends string>(
  value: string | undefined,
  fallback: T,
  allowed: readonly T[],
): T => {
  if (value === undefined || value === '') return fallback;
  if (allowed.includes(value as T)) return value as T;
  throw new Error(`must be one of: ${allowed.join(', ')}`);
};

const readTelegramIdList = (value: string | undefined): string[] => {
  if (value === undefined || value.trim() === '') return [];
  const ids = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const invalid = ids.find((id) => !/^[1-9]\d{0,18}$/.test(id));
  if (invalid) throw new Error('must be a comma-separated list of Telegram numeric IDs');
  return [...new Set(ids)];
};

const readUuid = (value: string | undefined): string => {
  const trimmed = value?.trim() ?? '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
    throw new Error('must be a UUID');
  }
  return trimmed;
};

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
  const issues: string[] = [];
  const capture = <T>(name: string, reader: () => T, fallback: T): T => {
    try {
      return reader();
    } catch (error) {
      issues.push(`${name} ${error instanceof Error ? error.message : 'is invalid'}`);
      return fallback;
    }
  };

  const nodeEnv = capture(
    'NODE_ENV',
    () => readEnum(env.NODE_ENV, 'development', ['development', 'test', 'production'] as const),
    'development' as const,
  );
  const logLevel = capture(
    'LOG_LEVEL',
    () => readEnum(env.LOG_LEVEL, 'info', ['info', 'debug', 'extra-high'] as const),
    'info' as const,
  );
  const botEnabled = capture('BOT_ENABLED', () => readBoolean(env.BOT_ENABLED, true), true);
  const richMessagesEnabled = capture(
    'RICH_MESSAGES_ENABLED',
    () => readBoolean(env.RICH_MESSAGES_ENABLED, false),
    false,
  );
  const developerTelegramIds = capture(
    'DEVELOPER_TELEGRAM_IDS',
    () => readTelegramIdList(env.DEVELOPER_TELEGRAM_IDS),
    [],
  );
  const apiEnabled = capture('API_ENABLED', () => readBoolean(env.API_ENABLED, true), true);
  const apiPort = capture(
    'API_PORT',
    () => readInteger(env.API_PORT, 3000, { min: 1, max: 65535 }),
    3000,
  );
  const lifecycleNotificationsEnabled = capture(
    'LIFECYCLE_NOTIFICATIONS_ENABLED',
    () => readBoolean(env.LIFECYCLE_NOTIFICATIONS_ENABLED, true),
    true,
  );
  const lifecycleBroadcastBatchSize = capture(
    'LIFECYCLE_BROADCAST_BATCH_SIZE',
    () => readInteger(env.LIFECYCLE_BROADCAST_BATCH_SIZE, 100, { min: 1, max: 1000 }),
    100,
  );
  const lifecycleBroadcastConcurrency = capture(
    'LIFECYCLE_BROADCAST_CONCURRENCY',
    () => readInteger(env.LIFECYCLE_BROADCAST_CONCURRENCY, 10, { min: 1, max: 50 }),
    10,
  );
  const lifecycleStartupTimeoutMs = capture(
    'LIFECYCLE_STARTUP_TIMEOUT_MS',
    () => readInteger(env.LIFECYCLE_STARTUP_TIMEOUT_MS, 60_000, { min: 1000, max: 300_000 }),
    60_000,
  );
  const lifecycleShutdownTimeoutMs = capture(
    'LIFECYCLE_SHUTDOWN_TIMEOUT_MS',
    () => readInteger(env.LIFECYCLE_SHUTDOWN_TIMEOUT_MS, 60_000, { min: 1000, max: 300_000 }),
    60_000,
  );
  const requestTimeoutMs = capture(
    'CRM_REQUEST_TIMEOUT_MS',
    () => readInteger(env.CRM_REQUEST_TIMEOUT_MS, 10_000, { min: 100, max: 120_000 }),
    10_000,
  );
  const maxRetries = capture(
    'CRM_MAX_RETRIES',
    () => readInteger(env.CRM_MAX_RETRIES, 2, { min: 0, max: 5 }),
    2,
  );
  const databasePort = capture(
    'DB_PORT',
    () => readInteger(env.DB_PORT, 5432, { min: 1, max: 65535 }),
    5432,
  );
  const databaseSsl = capture('DB_SSL', () => readBoolean(env.DB_SSL, false), false);
  const databasePoolMin = capture(
    'DB_POOL_MIN',
    () => readInteger(env.DB_POOL_MIN, 0, { min: 0, max: 100 }),
    0,
  );
  const databasePoolMax = capture(
    'DB_POOL_MAX',
    () => readInteger(env.DB_POOL_MAX, 10, { min: 1, max: 100 }),
    10,
  );
  const databaseAcquireTimeoutMs = capture(
    'DB_ACQUIRE_TIMEOUT_MS',
    () => readInteger(env.DB_ACQUIRE_TIMEOUT_MS, 10_000, { min: 100, max: 120_000 }),
    10_000,
  );

  if (botEnabled && !env.BOT_TOKEN?.trim())
    issues.push('BOT_TOKEN is required when BOT_ENABLED=true');
  if (!env.CRM_BASE_URL?.trim()) issues.push('CRM_BASE_URL is required');
  if (!env.TELEGRAM_BOT_BASIC_AUTH_USER?.trim()) {
    issues.push('TELEGRAM_BOT_BASIC_AUTH_USER is required');
  }
  if (!env.TELEGRAM_BOT_BASIC_AUTH_PASSWORD?.trim()) {
    issues.push('TELEGRAM_BOT_BASIC_AUTH_PASSWORD is required');
  }
  const repairStatusBranchId = capture(
    'CRM_REPAIR_STATUS_BRANCH_ID',
    () => readUuid(env.CRM_REPAIR_STATUS_BRANCH_ID),
    '',
  );
  if (!env.DB_PASS) issues.push('DB_PASS is required');
  if (apiEnabled && !env.API_MESSAGE_SEND_TOKEN?.trim()) {
    issues.push('API_MESSAGE_SEND_TOKEN is required when API_ENABLED=true');
  }
  if (databasePoolMin > databasePoolMax) {
    issues.push('DB_POOL_MIN must be less than or equal to DB_POOL_MAX');
  }

  if (issues.length > 0) throw new ConfigurationError(issues);

  return {
    nodeEnv,
    logLevel,
    bot: {
      enabled: botEnabled,
      token: env.BOT_TOKEN?.trim(),
      username: env.BOT_USERNAME?.trim(),
      richMessagesEnabled,
      developerTelegramIds,
    },
    api: {
      enabled: apiEnabled,
      host: env.API_HOST?.trim() || '0.0.0.0',
      port: apiPort,
      messageSendToken: env.API_MESSAGE_SEND_TOKEN?.trim() ?? '',
    },
    lifecycleNotifications: {
      enabled: lifecycleNotificationsEnabled,
      batchSize: lifecycleBroadcastBatchSize,
      concurrency: lifecycleBroadcastConcurrency,
      startupTimeoutMs: lifecycleStartupTimeoutMs,
      shutdownTimeoutMs: lifecycleShutdownTimeoutMs,
    },
    crm: {
      baseUrl: env.CRM_BASE_URL!.trim().replace(/\/+$/, ''),
      username: env.TELEGRAM_BOT_BASIC_AUTH_USER!.trim(),
      password: env.TELEGRAM_BOT_BASIC_AUTH_PASSWORD!,
      repairStatusBranchId,
      requestTimeoutMs,
      maxRetries,
    },
    database: {
      host: env.DB_HOST?.trim() || 'localhost',
      port: databasePort,
      user: env.DB_USER?.trim() || 'postgres',
      password: env.DB_PASS!,
      name: env.DB_NAME?.trim() || 'probox_bot_db',
      ssl: databaseSsl,
      poolMin: databasePoolMin,
      poolMax: databasePoolMax,
      acquireTimeoutMs: databaseAcquireTimeoutMs,
    },
  };
};
