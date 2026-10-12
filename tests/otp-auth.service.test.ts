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
        baseUrl: 'http://mobile.test',
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
      'http://mobile.test/api/v1/auth/session-status?session_token=sess_abc123',
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
        baseUrl: 'http://mobile.test',
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
        baseUrl: 'http://mobile.test',
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
    let capturedUrl = '';
    let capturedAuth = '';
    const service = new HttpOtpAuthService(
      {
        baseUrl: 'http://mobile.test',
        username: 'bot_user',
        password: 'bot_password',
        timeoutMs: 1000,
        maxRetries: 0,
        fetchImpl: (async (_url, init) => {
          capturedUrl = String(_url);
          capturedAuth = new Headers(init?.headers).get('authorization') ?? '';
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

    assert.equal(capturedUrl, 'http://mobile.test/api/v1/internal/telegram/verify-contact');
    assert.equal(capturedAuth, `Basic ${Buffer.from('bot_user:bot_password').toString('base64')}`);
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
        baseUrl: 'http://mobile.test',
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
        baseUrl: 'http://mobile.test',
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
        baseUrl: 'http://mobile.test',
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

describe('verification response validation', () => {
  for (const payload of [null, {}, { success: 'true' }]) {
    it(`rejects malformed success ${JSON.stringify(payload)}`, async () => {
      const service = new HttpOtpAuthService(
        {
          baseUrl: 'https://mobile.test',
          username: 'bot',
          password: 'secret',
          timeoutMs: 1000,
          maxRetries: 0,
          fetchImpl: (async () =>
            new Response(JSON.stringify(payload), { status: 200 })) as typeof fetch,
        },
        logger,
      );
      const result = await service.verifyContact({
        session_token: 'sess_test',
        telegram_user_id: 1,
        telegram_chat_id: 1,
        contact_phone: '+998901234567',
        contact_user_id: 1,
      });
      assert.equal(result.success, false);
    });
  }
});

describe('mobile name callback contract', () => {
  const params = {
    session_token: 'sess_private',
    telegram_user_id: 1,
    telegram_chat_id: 1,
    contact_phone: '+998901234567',
    contact_user_id: 1,
  };
  const serviceFor = (fetchImpl: typeof fetch, logs: unknown[] = []) =>
    new HttpOtpAuthService(
      {
        baseUrl: 'https://mobile.test',
        username: 'mobile-only',
        password: 'synthetic-secret',
        timeoutMs: 1000,
        maxRetries: 3,
        fetchImpl,
      },
      {
        ...logger,
        extra: (...values: unknown[]) => {
          logs.push(values);
        },
        warn: (...values: unknown[]) => {
          logs.push(values);
        },
      },
    );

  for (const fields of [['first_name', 'last_name'], ['first_name'], ['last_name']]) {
    it(`validates missing_fields ${fields.join(',')}`, async () => {
      const service = serviceFor(
        async () =>
          new Response(
            JSON.stringify({
              statusCode: 400,
              error: 'PROFILE_NAMES_REQUIRED',
              location: fields[0],
              missing_fields: fields,
              timestamp: '2026-10-12T00:00:00Z',
              path: '/api/v1/internal/telegram/verify-contact',
            }),
            { status: 400 },
          ),
      );
      assert.deepEqual(await service.verifyContact(params), {
        success: false,
        error: 'PROFILE_NAMES_REQUIRED',
        missing_fields: fields,
      });
    });
  }
  for (const fields of [
    undefined,
    null,
    [],
    ['other'],
    ['last_name', 'first_name'],
    ['first_name', 'first_name'],
  ]) {
    it(`fails closed for malformed missing_fields ${JSON.stringify(fields)}`, async () => {
      const service = serviceFor(
        async () =>
          new Response(
            JSON.stringify({ error: 'PROFILE_NAMES_REQUIRED', missing_fields: fields }),
            { status: 400 },
          ),
      );
      assert.deepEqual(await service.verifyContact(params), {
        success: false,
        error: 'UNAVAILABLE',
      });
    });
  }
  it('sends trimmed separate explicit names, omits unrequested fields and keeps dedicated Basic auth', async () => {
    const logs: unknown[] = [];
    const service = serviceFor(async (_url, init) => {
      assert.deepEqual(JSON.parse(String(init?.body)), { ...params, last_name: 'Фамилия' });
      assert.equal(
        new Headers(init?.headers).get('authorization'),
        `Basic ${Buffer.from('mobile-only:synthetic-secret').toString('base64')}`,
      );
      return new Response('{"success":true}', { status: 200 });
    }, logs);
    assert.equal(
      (await service.verifyContact({ ...params, last_name: '  Фамилия  ' })).success,
      true,
    );
    const log = JSON.stringify(logs);
    for (const secret of ['sess_private', 'Фамилия', '+998901234567', 'synthetic-secret'])
      assert.equal(log.includes(secret), false);
  });
  it('never retries an uncertain POST and sanitizes network errors and session lookup logs', async () => {
    let calls = 0;
    const logs: unknown[] = [];
    const service = serviceFor(async () => {
      calls++;
      throw new Error('sess_private Фамилия synthetic-secret');
    }, logs);
    assert.equal((await service.verifyContact(params)).success, false);
    assert.equal(calls, 1);
    const log = JSON.stringify(logs);
    for (const secret of ['sess_private', 'Фамилия', 'synthetic-secret'])
      assert.equal(log.includes(secret), false);
  });
  it('rejects success outside HTTP 200', async () => {
    const service = serviceFor(async () => new Response('{"success":true}', { status: 201 }));
    assert.equal((await service.verifyContact(params)).success, false);
  });
});
