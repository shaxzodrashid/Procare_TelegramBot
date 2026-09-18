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
});

describe('mobile auth configuration', () => {
  const mobile = {
    MOBILE_API_BASE_URL: 'https://mobile.test/',
    MOBILE_API_BASIC_AUTH_USER: 'mobile-bot',
    MOBILE_API_BASIC_AUTH_PASSWORD: 'mobile-secret',
  };
  it('keeps mobile auth disabled without affecting CRM configuration', () => {
    assert.equal(loadConfig(validEnv).mobile, undefined);
  });
  it('uses separate origins and credentials', () => {
    const config = loadConfig({ ...validEnv, ...mobile });
    assert.deepEqual(config.mobile, {
      baseUrl: 'https://mobile.test',
      username: 'mobile-bot',
      password: 'mobile-secret',
    });
    assert.equal(config.crm.baseUrl, 'http://localhost:5001');
    assert.equal(config.crm.password, 'secret');
  });
  for (const baseUrl of [
    'file:///secret',
    'https://user:secret@mobile.test',
    'https://mobile.test/api/v1',
    'https://mobile.test?token=x',
  ]) {
    it(`rejects invalid mobile origin ${baseUrl}`, () => {
      assert.throws(
        () => loadConfig({ ...validEnv, ...mobile, MOBILE_API_BASE_URL: baseUrl }),
        ConfigurationError,
      );
    });
  }
  it('rejects incomplete mobile configuration', () => {
    assert.throws(
      () => loadConfig({ ...validEnv, MOBILE_API_BASE_URL: 'https://mobile.test' }),
      ConfigurationError,
    );
  });
});
