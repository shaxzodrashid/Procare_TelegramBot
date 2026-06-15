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
  table: () => undefined,
};

const profile = {
  id: 'client-id',
  phone_number1: '+998901234567',
  repair_orders: [],
};

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
          return Response.json(profile);
        },
      },
      logger,
    );

    const result = await service.registerByPhone('90 123 45 67');

    assert.equal(result.id, 'client-id');
    assert.deepEqual(JSON.parse(requestBody), { phone_number: '+998901234567' });
    assert.equal(authorization, `Basic ${Buffer.from('bot:secret').toString('base64')}`);
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
});
