import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ConfigurationError, loadConfig } from '../src/config/index.js';

const validEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  BOT_ENABLED: 'false',
  API_ENABLED: 'true',
  API_PORT: '3001',
  API_MESSAGE_SEND_TOKEN: 'message-token',
  RICH_MESSAGES_ENABLED: 'true',
  DEVELOPER_TELEGRAM_IDS: '1001, 1002,1001',
  CRM_BASE_URL: 'http://localhost:5001/',
  TELEGRAM_BOT_BASIC_AUTH_USER: 'bot',
  TELEGRAM_BOT_BASIC_AUTH_PASSWORD: 'secret',
  DB_PASS: 'postgres',
};

describe('loadConfig', () => {
  it('loads and normalizes valid settings', () => {
    const config = loadConfig(validEnv);
    assert.equal(config.api.port, 3001);
    assert.equal(config.api.messageSendToken, 'message-token');
    assert.equal(config.bot.enabled, false);
    assert.equal(config.bot.richMessagesEnabled, true);
    assert.deepEqual(config.bot.developerTelegramIds, ['1001', '1002']);
    assert.equal(config.lifecycleNotifications.enabled, true);
    assert.equal(config.lifecycleNotifications.batchSize, 100);
    assert.equal(config.lifecycleNotifications.concurrency, 10);
    assert.equal(config.lifecycleNotifications.startupTimeoutMs, 60_000);
    assert.equal(config.lifecycleNotifications.shutdownTimeoutMs, 60_000);
    assert.equal(config.crm.baseUrl, 'http://localhost:5001');
    assert.equal(config.database.host, 'localhost');
    assert.equal(config.database.name, 'probox_bot_db');
    assert.equal(config.database.password, 'postgres');
  });

  it('does not require a message send token when the API is disabled', () => {
    const config = loadConfig({ ...validEnv, API_ENABLED: 'false', API_MESSAGE_SEND_TOKEN: '' });
    assert.equal(config.api.enabled, false);
    assert.equal(config.api.messageSendToken, '');
  });

  it('reports all missing required settings', () => {
    assert.throws(
      () => loadConfig({ BOT_ENABLED: 'true' }),
      (error: unknown) =>
        error instanceof ConfigurationError &&
        error.issues.includes('BOT_TOKEN is required when BOT_ENABLED=true') &&
        error.issues.includes('CRM_BASE_URL is required') &&
        error.issues.includes('API_MESSAGE_SEND_TOKEN is required when API_ENABLED=true'),
    );
  });

  it('rejects invalid developer Telegram IDs', () => {
    assert.throws(
      () => loadConfig({ ...validEnv, DEVELOPER_TELEGRAM_IDS: '1001,abc' }),
      (error: unknown) =>
        error instanceof ConfigurationError &&
        error.issues.includes(
          'DEVELOPER_TELEGRAM_IDS must be a comma-separated list of Telegram numeric IDs',
        ),
    );
  });

  it('rejects invalid lifecycle notification bounds', () => {
    assert.throws(
      () => loadConfig({ ...validEnv, LIFECYCLE_BROADCAST_CONCURRENCY: '0' }),
      (error: unknown) =>
        error instanceof ConfigurationError &&
        error.issues.includes(
          'LIFECYCLE_BROADCAST_CONCURRENCY must be an integer between 1 and 50',
        ),
    );
  });
});
