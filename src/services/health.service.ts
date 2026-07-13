import type { Knex } from 'knex';

export type HealthStatus = 'ok' | 'degraded' | 'unhealthy';
export type ComponentHealthStatus = HealthStatus | 'disabled';
export type BotPollingState =
  | 'disabled'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'failed';

export interface HealthCheck {
  status: ComponentHealthStatus;
  message?: string;
  latencyMs?: number;
  details?: Record<string, unknown>;
}

export interface SystemHealthSnapshot {
  status: HealthStatus;
  service: 'procare-telegram-bot';
  timestamp: string;
  uptimeSeconds: number;
  checks: {
    process: HealthCheck;
    configuration: HealthCheck;
    database: HealthCheck;
    migrations: HealthCheck;
    api: HealthCheck;
    telegram: HealthCheck;
  };
}

export interface TelegramHealthProbeResult {
  id: number;
  username?: string;
}

export interface SystemHealthMonitorOptions {
  database: Pick<Knex, 'raw'>;
  botEnabled: boolean;
  apiEnabled: boolean;
  timeoutMs?: number;
}

const timeoutResult = Symbol('timeout');

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | typeof timeoutResult> =>
  Promise.race([
    promise,
    new Promise<typeof timeoutResult>((resolve) => {
      setTimeout(() => resolve(timeoutResult), timeoutMs);
    }),
  ]);

export class SystemHealthMonitor {
  private readonly startedAtMs = Date.now();
  private readonly timeoutMs: number;
  private migrationsCompleted = false;
  private apiListening = false;
  private botAuthenticated = false;
  private botUsername: string | undefined;
  private botPollingState: BotPollingState;
  private botFailureMessage: string | undefined;
  private telegramProbe: (() => Promise<TelegramHealthProbeResult>) | undefined;

  constructor(private readonly options: SystemHealthMonitorOptions) {
    this.timeoutMs = options.timeoutMs ?? 2000;
    this.botPollingState = options.botEnabled ? 'starting' : 'disabled';
  }

  markMigrationsCompleted(): void {
    this.migrationsCompleted = true;
  }

  markApiListening(): void {
    this.apiListening = true;
  }

  markBotAuthenticated(username: string | undefined): void {
    this.botAuthenticated = true;
    this.botUsername = username;
  }

  markBotPollingStarting(): void {
    if (this.options.botEnabled) this.botPollingState = 'starting';
  }

  markBotPollingRunning(username: string | undefined): void {
    this.botPollingState = 'running';
    this.botUsername = username ?? this.botUsername;
    this.botFailureMessage = undefined;
  }

  markBotPollingStopping(): void {
    if (this.options.botEnabled) this.botPollingState = 'stopping';
  }

  markBotPollingStopped(): void {
    if (this.options.botEnabled) this.botPollingState = 'stopped';
  }

  markBotPollingFailed(error: unknown): void {
    this.botPollingState = 'failed';
    this.botFailureMessage = errorMessage(error);
  }

  setTelegramProbe(probe: () => Promise<TelegramHealthProbeResult>): void {
    this.telegramProbe = probe;
  }

  async snapshot(): Promise<SystemHealthSnapshot> {
    const checks = {
      process: this.processCheck(),
      configuration: this.configurationCheck(),
      database: await this.databaseCheck(),
      migrations: this.migrationCheck(),
      api: this.apiCheck(),
      telegram: await this.telegramCheck(),
    };

    return {
      status: aggregateHealth(Object.values(checks)),
      service: 'procare-telegram-bot',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor((Date.now() - this.startedAtMs) / 1000),
      checks,
    };
  }

  private processCheck(): HealthCheck {
    return {
      status: 'ok',
      details: {
        pid: process.pid,
        node: process.version,
        uptimeSeconds: Math.floor(process.uptime()),
        memoryRssBytes: process.memoryUsage().rss,
      },
    };
  }

  private configurationCheck(): HealthCheck {
    return {
      status: 'ok',
      details: {
        botEnabled: this.options.botEnabled,
        apiEnabled: this.options.apiEnabled,
      },
    };
  }

  private async databaseCheck(): Promise<HealthCheck> {
    const startedAt = Date.now();
    try {
      const result = await withTimeout(this.options.database.raw('select 1'), this.timeoutMs);
      const latencyMs = Date.now() - startedAt;
      if (result === timeoutResult) {
        return { status: 'unhealthy', latencyMs, message: 'PostgreSQL health query timed out' };
      }
      return { status: 'ok', latencyMs };
    } catch (error) {
      return {
        status: 'unhealthy',
        latencyMs: Date.now() - startedAt,
        message: errorMessage(error),
      };
    }
  }

  private migrationCheck(): HealthCheck {
    if (this.migrationsCompleted) return { status: 'ok' };
    return { status: 'unhealthy', message: 'Database migrations have not completed' };
  }

  private apiCheck(): HealthCheck {
    if (!this.options.apiEnabled) return { status: 'disabled' };
    if (this.apiListening) return { status: 'ok' };
    return { status: 'unhealthy', message: 'Fastify is not listening' };
  }

  private async telegramCheck(): Promise<HealthCheck> {
    if (!this.options.botEnabled) return { status: 'disabled' };

    const details: Record<string, unknown> = {
      authenticated: this.botAuthenticated,
      polling: this.botPollingState,
      username: this.botUsername,
    };

    if (!this.botAuthenticated) {
      return { status: 'unhealthy', message: 'Telegram bot is not authenticated', details };
    }
    if (this.botPollingState !== 'running') {
      return {
        status: 'unhealthy',
        message: this.botFailureMessage ?? `Telegram polling is ${this.botPollingState}`,
        details,
      };
    }
    if (!this.telegramProbe) return { status: 'ok', details };

    const startedAt = Date.now();
    try {
      const result = await withTimeout(this.telegramProbe(), this.timeoutMs);
      const latencyMs = Date.now() - startedAt;
      if (result === timeoutResult) {
        return {
          status: 'unhealthy',
          latencyMs,
          message: 'Telegram getMe probe timed out',
          details,
        };
      }

      details.probeUsername = result.username;
      return { status: 'ok', latencyMs, details };
    } catch (error) {
      return {
        status: 'unhealthy',
        latencyMs: Date.now() - startedAt,
        message: errorMessage(error),
        details,
      };
    }
  }
}

const aggregateHealth = (checks: HealthCheck[]): HealthStatus => {
  if (checks.some((check) => check.status === 'unhealthy')) return 'unhealthy';
  if (checks.some((check) => check.status === 'degraded')) return 'degraded';
  return 'ok';
};
