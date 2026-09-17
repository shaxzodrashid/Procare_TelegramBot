import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HttpOtpAuthService } from '../src/services/otp-auth.service.js';
import type { Logger } from '../src/utils/logger.js';

const logger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  extra: () => undefined,
  table: () => undefined,
};

describe('HttpOtpAuthService', () => {
  it('fetches session status by token when valid', async () => {
    let capturedUrl = '';
    let capturedAuth = '';
    const service = new HttpOtpAuthService(
      {
        baseUrl: 'http://crm.test',
        username: 'bot_user',
        password: 'bot_password',
        timeoutMs: 1000,
        maxRetries: 0,
        fetchImpl: (async (url, init) => {
          capturedUrl = String(url);
          capturedAuth = String(
            init?.headers && 'authorization' in init.headers ? init.headers.authorization : '',
          );
          return new Response(
            JSON.stringify({ status: 'PENDING_TELEGRAM', phone_number: '+998901234567' }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          );
        }) as typeof fetch,
      },
      logger,
    );

    const session = await service.getSession('sess_abc123');

    assert.equal(
      capturedUrl,
      'http://crm.test/api/v1/auth/session-status?session_token=sess_abc123',
    );
    assert.equal(capturedAuth, `Basic ${Buffer.from('bot_user:bot_password').toString('base64')}`);
    assert.deepEqual(session, {
      status: 'PENDING_TELEGRAM',
      phone_number: '+998901234567',
      is_new_user: undefined,
    });
  });

  it('returns null when session lookup yields 404', async () => {
    const service = new HttpOtpAuthService(
      {
        baseUrl: 'http://crm.test',
        username: 'bot_user',
        password: 'bot_password',
        timeoutMs: 1000,
        maxRetries: 0,
        fetchImpl: (async () => {
          return new Response(JSON.stringify({ message: 'Session not found' }), {
            status: 404,
            headers: { 'content-type': 'application/json' },
          });
        }) as typeof fetch,
      },
      logger,
    );

    const session = await service.getSession('sess_not_found');
    assert.equal(session, null);
  });

  it('retries session lookup on network failure and succeeds', async () => {
    let attempts = 0;
    const service = new HttpOtpAuthService(
      {
        baseUrl: 'http://crm.test',
        username: 'bot_user',
        password: 'bot_password',
        timeoutMs: 1000,
        maxRetries: 2,
        sleep: async () => undefined,
        fetchImpl: (async () => {
          attempts += 1;
          if (attempts === 1) {
            throw new Error('Connection refused');
          }
          return new Response(JSON.stringify({ status: 'PENDING_TELEGRAM' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }) as typeof fetch,
      },
      logger,
    );

    const session = await service.getSession('sess_retry');
    assert.equal(attempts, 2);
    assert.deepEqual(session, {
      status: 'PENDING_TELEGRAM',
      phone_number: undefined,
      is_new_user: undefined,
    });
  });

  it('submits verifyContact payload and returns success', async () => {
    let capturedBody: unknown;
    const service = new HttpOtpAuthService(
      {
        baseUrl: 'http://crm.test',
        username: 'bot_user',
        password: 'bot_password',
        timeoutMs: 1000,
        maxRetries: 0,
        fetchImpl: (async (_url, init) => {
          capturedBody = JSON.parse(String(init?.body));
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }) as typeof fetch,
      },
      logger,
    );

    const result = await service.verifyContact({
      session_token: 'sess_xyz',
      telegram_user_id: 111,
      telegram_chat_id: 222,
      contact_phone: '+998 90 123 45 67',
      contact_user_id: 111,
    });

    assert.deepEqual(capturedBody, {
      session_token: 'sess_xyz',
      telegram_user_id: 111,
      telegram_chat_id: 222,
      contact_phone: '+998901234567',
      contact_user_id: 111,
    });
    assert.deepEqual(result, { success: true, user: undefined });
  });

  it('handles phone number mismatch error from backend', async () => {
    const service = new HttpOtpAuthService(
      {
        baseUrl: 'http://crm.test',
        username: 'bot_user',
        password: 'bot_password',
        timeoutMs: 1000,
        maxRetries: 0,
        fetchImpl: (async () => {
          return new Response(
            JSON.stringify({ error: 'PHONE_NUMBER_MISMATCH', message: 'Mismatch' }),
            {
              status: 400,
              headers: { 'content-type': 'application/json' },
            },
          );
        }) as typeof fetch,
      },
      logger,
    );

    const result = await service.verifyContact({
      session_token: 'sess_xyz',
      telegram_user_id: 111,
      telegram_chat_id: 222,
      contact_phone: '+998901234567',
      contact_user_id: 111,
    });

    assert.deepEqual(result, {
      success: false,
      error: 'PHONE_NUMBER_MISMATCH',
      message: 'Mismatch',
    });
  });

  it('handles 403 sender not contact owner', async () => {
    const service = new HttpOtpAuthService(
      {
        baseUrl: 'http://crm.test',
        username: 'bot_user',
        password: 'bot_password',
        timeoutMs: 1000,
        maxRetries: 0,
        fetchImpl: (async () => {
          return new Response(JSON.stringify({ error: 'SENDER_NOT_CONTACT_OWNER' }), {
            status: 403,
            headers: { 'content-type': 'application/json' },
          });
        }) as typeof fetch,
      },
      logger,
    );

    const result = await service.verifyContact({
      session_token: 'sess_xyz',
      telegram_user_id: 111,
      telegram_chat_id: 222,
      contact_phone: '+998901234567',
      contact_user_id: 999,
    });

    assert.deepEqual(result, {
      success: false,
      error: 'SENDER_NOT_CONTACT_OWNER',
    });
  });

  it('handles network error during verifyContact gracefully', async () => {
    const service = new HttpOtpAuthService(
      {
        baseUrl: 'http://crm.test',
        username: 'bot_user',
        password: 'bot_password',
        timeoutMs: 1000,
        maxRetries: 0,
        fetchImpl: (async () => {
          throw new Error('DNS resolution failed');
        }) as typeof fetch,
      },
      logger,
    );

    const result = await service.verifyContact({
      session_token: 'sess_xyz',
      telegram_user_id: 111,
      telegram_chat_id: 222,
      contact_phone: '+998901234567',
      contact_user_id: 111,
    });

    assert.equal(result.success, false);
    assert.equal(result.error, 'UNAVAILABLE');
  });
});
