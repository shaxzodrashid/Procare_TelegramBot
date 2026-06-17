import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createApiServer } from '../src/api/server.js';
import type { AppConfig } from '../src/config/index.js';
import type { Logger } from '../src/utils/logger.js';

const logger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  extra: () => undefined,
  table: () => undefined,
};

const config: AppConfig = {
  nodeEnv: 'test',
  logLevel: 'info',
  bot: { enabled: false },
  api: { enabled: true, host: '127.0.0.1', port: 3000 },
  crm: {
    baseUrl: 'http://crm.test',
    username: 'bot',
    password: 'secret',
    requestTimeoutMs: 1_000,
    maxRetries: 0,
  },
  database: {
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'postgres',
    name: 'probox_bot_db',
    ssl: false,
    poolMin: 0,
    poolMax: 10,
    acquireTimeoutMs: 10_000,
  },
};

describe('health API', () => {
  it('reports service status without opening a network port', async () => {
    const app = createApiServer(config, logger);

    const response = await app.inject({ method: 'GET', url: '/health' });
    await app.close();

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      status: 'ok',
      service: 'procare-telegram-bot',
      timestamp: response.json<{ timestamp: string }>().timestamp,
      botEnabled: false,
    });
  });
});
