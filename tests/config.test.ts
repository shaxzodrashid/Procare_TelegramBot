import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ConfigurationError, loadConfig } from '../src/config/index.js';

const validEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  BOT_ENABLED: 'false',
  API_ENABLED: 'true',
  API_PORT: '3001',
  CRM_BASE_URL: 'http://localhost:5001/',
  TELEGRAM_BOT_BASIC_AUTH_USER: 'bot',
  TELEGRAM_BOT_BASIC_AUTH_PASSWORD: 'secret',
  DB_PASS: 'postgres',
};

describe('loadConfig', () => {
  it('loads and normalizes valid settings', () => {
    const config = loadConfig(validEnv);
    assert.equal(config.api.port, 3001);
    assert.equal(config.bot.enabled, false);
    assert.equal(config.crm.baseUrl, 'http://localhost:5001');
    assert.equal(config.database.host, 'localhost');
    assert.equal(config.database.name, 'probox_bot_db');
    assert.equal(config.database.password, 'postgres');
  });

  it('reports all missing required settings', () => {
    assert.throws(
      () => loadConfig({ BOT_ENABLED: 'true' }),
      (error: unknown) =>
        error instanceof ConfigurationError &&
        error.issues.includes('BOT_TOKEN is required when BOT_ENABLED=true') &&
        error.issues.includes('CRM_BASE_URL is required'),
    );
  });
});
