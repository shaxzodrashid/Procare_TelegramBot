import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  HttpClientRegistrationService,
  RegistrationError,
} from '../src/services/client-registration.service.js';
import type { Logger } from '../src/utils/logger.js';

const logger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  extra: () => undefined,
  table: () => undefined,
};

const profile = {
  account_type: 'client',
  client_id: 'client-id',
  first_name: 'Ali',
  last_name: null,
  language: 'uz',
  has_repair_orders: false,
  is_admin: false,
  admin: null,
} as const;

const adminProfile = {
  id: 'admin-id',
  first_name: 'Ali',
  last_name: 'Valiyev',
  phone_number: '+998901234567',
  phone_verified: true,
  language: 'uz',
  status: 'Open',
  is_active: true,
  created_at: '2026-06-15T10:00:00.000Z',
  updated_at: '2026-06-15T10:00:00.000Z',
} as const;

describe('HttpClientRegistrationService', () => {
  it('normalizes the phone and authenticates the request', async () => {
    let requestBody = '';
    let authorization = '';
    const service = new HttpClientRegistrationService(
      {
        baseUrl: 'http://crm.test',
        username: 'bot',
        password: 'secret',
        timeoutMs: 1_000,
        maxRetries: 0,
        fetchImpl: async (_input, init) => {
          requestBody = String(init?.body);
          authorization = new Headers(init?.headers).get('authorization') ?? '';
          return Response.json({
            ...profile,
            repair_orders: [{ imei: 'sensitive-value' }],
            passport_series: 'sensitive-value',
          });
        },
      },
      logger,
    );

    const result = await service.registerByPhone('90 123 45 67');

    assert.equal(result.account_type, 'client');
    if (result.account_type !== 'client') assert.fail('Expected client registration result');
    assert.equal(result.client_id, 'client-id');
    assert.equal(Object.hasOwn(result, 'repair_orders'), false);
    assert.equal(Object.hasOwn(result, 'passport_series'), false);
    assert.deepEqual(JSON.parse(requestBody), { phone_number: '+998901234567' });
    assert.equal(authorization, `Basic ${Buffer.from('bot:secret').toString('base64')}`);
  });

  it('rejects legacy client responses that contain no compact account metadata', async () => {
    const service = new HttpClientRegistrationService(
      {
        baseUrl: 'http://crm.test',
        username: 'bot',
        password: 'secret',
        timeoutMs: 1_000,
        maxRetries: 0,
        fetchImpl: async () =>
          Response.json({
            id: 'client-id',
            first_name: 'Ali',
            repair_orders: [],
          }),
      },
      logger,
    );

    await assert.rejects(
      service.registerByPhone('+998901234567'),
      (error: unknown) => error instanceof RegistrationError && error.code === 'invalid_response',
    );
  });

  it('accepts an admin-only registration response', async () => {
    const service = new HttpClientRegistrationService(
      {
        baseUrl: 'http://crm.test',
        username: 'bot',
        password: 'secret',
        timeoutMs: 1_000,
        maxRetries: 0,
        fetchImpl: async () =>
          Response.json({
            account_type: 'admin',
            is_admin: true,
            admin: adminProfile,
          }),
      },
      logger,
    );

    const result = await service.registerByPhone('+998901234567');

    assert.equal(result.account_type, 'admin');
    if (result.account_type !== 'admin') assert.fail('Expected admin registration result');
    assert.equal(result.admin.id, 'admin-id');
  });

  it('accepts a client response that also has an active admin account', async () => {
    const service = new HttpClientRegistrationService(
      {
        baseUrl: 'http://crm.test',
        username: 'bot',
        password: 'secret',
        timeoutMs: 1_000,
        maxRetries: 0,
        fetchImpl: async () =>
          Response.json({
            ...profile,
            is_admin: true,
            admin: adminProfile,
          }),
      },
      logger,
    );

    const result = await service.registerByPhone('+998901234567');

    assert.equal(result.account_type, 'client');
    if (result.account_type !== 'client') assert.fail('Expected client registration result');
    assert.equal(result.is_admin, true);
    assert.equal(result.admin?.id, 'admin-id');
  });

  it('maps a missing client to a non-retryable error', async () => {
    let attempts = 0;
    const service = new HttpClientRegistrationService(
      {
        baseUrl: 'http://crm.test',
        username: 'bot',
        password: 'secret',
        timeoutMs: 1_000,
        maxRetries: 2,
        fetchImpl: async () => {
          attempts += 1;
          return Response.json({ message: 'User not found' }, { status: 404 });
        },
      },
      logger,
    );

    await assert.rejects(
      service.registerByPhone('+998901234567'),
      (error: unknown) => error instanceof RegistrationError && error.code === 'not_found',
    );
    assert.equal(attempts, 1);
  });

  it('retries maintenance responses with bounded backoff', async () => {
    let attempts = 0;
    const delays: number[] = [];
    const service = new HttpClientRegistrationService(
      {
        baseUrl: 'http://crm.test',
        username: 'bot',
        password: 'secret',
        timeoutMs: 1_000,
        maxRetries: 2,
        fetchImpl: async () => {
          attempts += 1;
          return attempts < 3
            ? Response.json({ message: 'Maintenance' }, { status: 503 })
            : Response.json(profile);
        },
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
      logger,
    );

    await service.registerByPhone('+998901234567');

    assert.equal(attempts, 3);
    assert.deepEqual(delays, [250, 500]);
  });

  it('retries 500 responses as unavailable failures', async () => {
    let attempts = 0;
    const delays: number[] = [];
    const service = new HttpClientRegistrationService(
      {
        baseUrl: 'http://crm.test',
        username: 'bot',
        password: 'secret',
        timeoutMs: 1_000,
        maxRetries: 1,
        fetchImpl: async () => {
          attempts += 1;
          return attempts === 1
            ? Response.json({ message: 'Unexpected error' }, { status: 500 })
            : Response.json(profile);
        },
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
      logger,
    );

    const result = await service.registerByPhone('+998901234567');

    assert.equal(result.account_type, 'client');
    if (result.account_type !== 'client') assert.fail('Expected client registration result');
    assert.equal(attempts, 2);
    assert.deepEqual(delays, [250]);
  });

  it('rejects malformed success responses', async () => {
    const service = new HttpClientRegistrationService(
      {
        baseUrl: 'http://crm.test',
        username: 'bot',
        password: 'secret',
        timeoutMs: 1_000,
        maxRetries: 0,
        fetchImpl: async () =>
          Response.json({
            account_type: 'admin',
            is_admin: true,
            admin: { ...adminProfile, phone_number: null },
          }),
      },
      logger,
    );

    await assert.rejects(
      service.registerByPhone('+998901234567'),
      (error: unknown) => error instanceof RegistrationError && error.code === 'invalid_response',
    );
  });

  it('rejects inactive admin profiles before creating an employee session', async () => {
    const service = new HttpClientRegistrationService(
      {
        baseUrl: 'http://crm.test',
        username: 'bot',
        password: 'secret',
        timeoutMs: 1_000,
        maxRetries: 0,
        fetchImpl: async () =>
          Response.json({
            account_type: 'admin',
            is_admin: true,
            admin: { ...adminProfile, is_active: false },
          }),
      },
      logger,
    );

    await assert.rejects(
      service.registerByPhone('+998901234567'),
      (error: unknown) => error instanceof RegistrationError && error.code === 'invalid_response',
    );
  });

  it('emits sanitized extra diagnostics for registration traffic', async () => {
    const extraLogs: unknown[] = [];
    const service = new HttpClientRegistrationService(
      {
        baseUrl: 'http://crm.test',
        username: 'bot',
        password: 'secret',
        timeoutMs: 1_000,
        maxRetries: 0,
        fetchImpl: async () => Response.json(profile),
      },
      {
        ...logger,
        extra: (_message, ...args) => {
          extraLogs.push(args);
        },
      },
    );

    await service.registerByPhone('+998901234567');

    const serialized = JSON.stringify(extraLogs);
    assert.match(serialized, /\+998\*{5}4567/);
    assert.doesNotMatch(serialized, /901234567/);
    assert.doesNotMatch(serialized, /secret/);
    assert.doesNotMatch(serialized, /Basic [A-Za-z0-9+/=]+/);
  });

  it('redacts phone numbers echoed by upstream error messages', async () => {
    const extraLogs: unknown[] = [];
    const service = new HttpClientRegistrationService(
      {
        baseUrl: 'http://crm.test',
        username: 'bot',
        password: 'secret',
        timeoutMs: 1_000,
        maxRetries: 0,
        fetchImpl: async () =>
          Response.json({ message: 'Phone +998901234567 was not found' }, { status: 404 }),
      },
      {
        ...logger,
        extra: (_message, ...args) => {
          extraLogs.push(args);
        },
      },
    );

    await assert.rejects(
      service.registerByPhone('+998901234567'),
      (error: unknown) => error instanceof RegistrationError && error.code === 'not_found',
    );

    const serialized = JSON.stringify(extraLogs);
    assert.match(serialized, /\+998\*{5}4567/);
    assert.doesNotMatch(serialized, /901234567/);
  });
});
