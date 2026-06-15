import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HttpRepairOrderService, RepairOrderError } from '../src/services/repair-order.service.js';
import type { Logger } from '../src/utils/logger.js';

const logger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  table: () => undefined,
};

const osType = {
  id: 'os-id',
  name_uz: 'iOS',
  name_ru: 'iOS',
  name_en: 'iOS',
  sort: 1,
};

describe('HttpRepairOrderService', () => {
  it('loads child categories with the selected parent id', async () => {
    let requestedUrl = '';
    const service = new HttpRepairOrderService(
      {
        baseUrl: 'http://crm.test',
        timeoutMs: 1_000,
        maxRetries: 0,
        fetchImpl: async (input) => {
          requestedUrl = String(input);
          return Response.json([]);
        },
      },
      logger,
    );

    await service.getPhoneCategories('os-id', 'parent-id');

    assert.equal(
      requestedUrl,
      'http://crm.test/api/v1/calculator/phone-categories/os-id?parent_id=parent-id',
    );
  });

  it('submits the exact public repair order payload and does not retry creation', async () => {
    let attempts = 0;
    let body = '';
    const service = new HttpRepairOrderService(
      {
        baseUrl: 'http://crm.test',
        timeoutMs: 1_000,
        maxRetries: 3,
        fetchImpl: async (_input, init) => {
          attempts += 1;
          body = String(init?.body);
          return Response.json({ message: 'Maintenance' }, { status: 503 });
        },
        sleep: async () => undefined,
      },
      logger,
    );

    const input = {
      name: 'Ali Valiyev',
      phone_number: '+998901234567',
      phone_category: 'category-id',
      description: 'Muammolar: Ekran',
    };

    await assert.rejects(
      service.createOpenRepairOrder(input),
      (error: unknown) => error instanceof RepairOrderError && error.code === 'maintenance',
    );
    assert.equal(attempts, 1);
    assert.deepEqual(JSON.parse(body), input);
  });

  it('retries a catalog read after maintenance', async () => {
    let attempts = 0;
    const service = new HttpRepairOrderService(
      {
        baseUrl: 'http://crm.test',
        timeoutMs: 1_000,
        maxRetries: 1,
        fetchImpl: async () => {
          attempts += 1;
          return attempts === 1
            ? Response.json({ message: 'Maintenance' }, { status: 503 })
            : Response.json([osType]);
        },
        sleep: async () => undefined,
      },
      logger,
    );

    const result = await service.getOsTypes();

    assert.equal(attempts, 2);
    assert.deepEqual(result, [osType]);
  });
});
