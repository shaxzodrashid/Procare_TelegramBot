import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  API_ENDPOINTS,
  isApiErrorEnvelope,
  PostgresApiErrorLocalizationStore,
  validateApiErrorLocalizationInput,
} from '../src/services/api-error-localization.service.js';

describe('API error localization service', () => {
  it('registers the outbound endpoints used by the bot', () => {
    assert.ok(API_ENDPOINTS.some((endpoint) => endpoint.path === '/api/v1/users/register-client'));
    assert.ok(
      API_ENDPOINTS.some(
        (endpoint) => endpoint.path === '/api/v1/repair-orders/register-comment/{repairOrderId}',
      ),
    );
    assert.ok(API_ENDPOINTS.some((endpoint) => endpoint.path === '/api/v1/repair-orders/open'));
  });

  it('validates endpoint-specific location localization input', () => {
    assert.deepEqual(
      validateApiErrorLocalizationInput({
        endpoint_key: 'client_registration',
        location: 'phone_number.invalid_format',
        message_uz: 'Telefon raqami noto‘g‘ri.',
        message_ru: 'Неверный формат номера телефона.',
      }),
      [],
    );

    const issues = validateApiErrorLocalizationInput({
      endpoint_key: 'missing_endpoint',
      location: 'bad space',
      message_uz: 'x',
      message_ru: '',
    });
    assert.ok(issues.includes('endpoint_key is not registered'));
    assert.ok(issues.some((issue) => issue.startsWith('location must be')));
    assert.ok(issues.includes('message_uz must be 2-1000 characters'));
    assert.ok(issues.includes('message_ru must be 2-1000 characters'));
  });

  it('recognizes upstream error envelopes with optional location', () => {
    assert.equal(
      isApiErrorEnvelope({
        statusCode: 400,
        message: 'Invalid phone number format',
        error: 'ValidationError',
        timestamp: '2026-06-30T06:05:31.054Z',
        location: 'phone_number',
        path: '/api/v1/auth/admin/login',
      }),
      true,
    );
    assert.equal(isApiErrorEnvelope({ statusCode: '400', location: 'phone_number' }), false);
  });

  it('resolves a localized message by endpoint and upstream location', async () => {
    const database = ((table: string) => {
      assert.equal(table, 'api_error_localizations');
      return {
        where(filter: Record<string, unknown>) {
          assert.deepEqual(filter, {
            endpoint_key: 'client_registration',
            location: 'phone_number',
          });
          return this;
        },
        async first() {
          return {
            id: 1,
            endpoint_key: 'client_registration',
            location: 'phone_number',
            message_uz: 'Telefon raqamini tekshiring.',
            message_ru: 'Проверьте номер телефона.',
            created_at: new Date('2026-06-30T00:00:00.000Z'),
            updated_at: new Date('2026-06-30T00:00:00.000Z'),
          };
        },
      };
    }) as never;
    const store = new PostgresApiErrorLocalizationStore(database);

    const result = await store.resolveEnvelope(
      'client_registration',
      {
        statusCode: 400,
        message: 'Invalid phone number format',
        error: 'ValidationError',
        timestamp: '2026-06-30T06:05:31.054Z',
        location: 'phone_number',
        path: '/api/v1/users/register-client',
      },
      'ru',
    );

    assert.deepEqual(result, {
      endpoint_key: 'client_registration',
      location: 'phone_number',
      locale: 'ru',
      message: 'Проверьте номер телефона.',
    });
  });
});
