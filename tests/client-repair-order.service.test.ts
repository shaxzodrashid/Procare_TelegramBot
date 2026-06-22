import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ClientRepairOrderError,
  HttpClientRepairOrderService,
} from '../src/services/client-repair-order.service.js';
import type { Logger } from '../src/utils/logger.js';

const logger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  extra: () => undefined,
  table: () => undefined,
};

const status = {
  code: 'IN_REPAIR',
  name_uz: 'Ta’mirlash jarayonida',
  name_ru: 'В процессе ремонта',
  name_en: 'In repair',
  progress_type: 'linear',
  step: 4,
  total_steps: 7,
  updated_at: '2026-06-18T10:00:00.000Z',
} as const;

const listItem = {
  order_number: '1024',
  device: { brand: 'Apple', model: 'iPhone 14 Pro' },
  status,
  created_at: '2026-06-14T11:20:00.000Z',
  estimated_ready_at: null,
  pricing: {
    currency: 'UZS',
    final_total: '350000.00',
    payment_status: 'partial',
  },
} as const;

const detail = {
  ...listItem,
  updated_at: '2026-06-18T10:00:00.000Z',
  device: { ...listItem.device, imei_last4: '5678' },
  status: {
    ...status,
    customer_message_uz: 'Qurilmangiz ta’mirlanmoqda',
    customer_message_ru: 'Ваше устройство ремонтируется',
    customer_message_en: 'Your device is being repaired',
  },
  problem_summary: {
    uz: 'Displey shikastlangan',
    ru: 'Повреждён дисплей',
    en: 'Damaged display',
  },
  service_summary: {
    uz: 'Displeyni almashtirish',
    ru: 'Замена дисплея',
    en: 'Display replacement',
  },
  pricing: {
    ...listItem.pricing,
    estimated_total: null,
    paid_amount: '100000.00',
    remaining_amount: '250000.00',
    payments: [
      {
        amount: '100000.00',
        currency: 'UZS',
        method: 'Cash',
        paid_at: '2026-06-18T09:00:00.000Z',
      },
    ],
  },
  branch: {
    name_uz: 'Chilonzor filiali',
    name_ru: 'Чиланзарский филиал',
    name_en: 'Chilanzar branch',
    address_uz: 'Bunyodkor ko‘chasi, 12',
    address_ru: 'ул. Бунёдкор, 12',
    address_en: '12 Bunyodkor Street',
    telephone: '+998712000000',
    working_hours: { start: '09:00', end: '20:00' },
    map_url: 'https://maps.example.test/branch',
  },
  completed_at: null,
  picked_up_at: null,
  warranty: { period_months: 3, warranty_until: null },
  status_history: [
    {
      code: 'DIAGNOSIS',
      name_uz: 'Diagnostika',
      name_ru: 'Диагностика',
      name_en: 'Diagnosis',
      progress_type: 'linear',
      step: 2,
      total_steps: 7,
      changed_at: '2026-06-15T08:00:00.000Z',
    },
  ],
} as const;

describe('HttpClientRepairOrderService', () => {
  it('authenticates and requests a paginated client-owned list', async () => {
    let requestedUrl = '';
    let authorization = '';
    const service = new HttpClientRepairOrderService(
      {
        baseUrl: 'http://crm.test',
        username: 'bot',
        password: 'secret',
        timeoutMs: 1_000,
        maxRetries: 0,
        fetchImpl: async (input, init) => {
          requestedUrl = String(input);
          authorization = new Headers(init?.headers).get('authorization') ?? '';
          return Response.json({
            orders: [listItem],
            pagination: { limit: 10, offset: 20, total: 21, has_more: false },
          });
        },
      },
      logger,
    );

    const result = await service.listClientRepairOrders('client/id', { limit: 10, offset: 20 });

    assert.equal(
      requestedUrl,
      'http://crm.test/api/v1/telegram/clients/client%2Fid/repair-orders?limit=10&offset=20',
    );
    assert.equal(authorization, `Basic ${Buffer.from('bot:secret').toString('base64')}`);
    assert.equal(result.orders[0]?.status.name_uz, 'Ta’mirlash jarayonida');
  });

  it('loads a client-owned order detail with encoded identifiers', async () => {
    let requestedUrl = '';
    const service = new HttpClientRepairOrderService(
      {
        baseUrl: 'http://crm.test',
        username: 'bot',
        password: 'secret',
        timeoutMs: 1_000,
        maxRetries: 0,
        fetchImpl: async (input) => {
          requestedUrl = String(input);
          return Response.json(detail);
        },
      },
      logger,
    );

    const result = await service.getClientRepairOrder('client-id', 'RO/1024');

    assert.equal(
      requestedUrl,
      'http://crm.test/api/v1/telegram/clients/client-id/repair-orders/RO%2F1024',
    );
    assert.equal(result.device.imei_last4, '5678');
    assert.equal(result.problem_summary.uz, 'Displey shikastlangan');
    assert.equal(result.branch.working_hours.start, '09:00');
    assert.equal(result.warranty.period_months, 3);
    assert.equal(result.status_history[0]?.progress_type, 'linear');
  });

  it('rejects invalid pagination before making a request', async () => {
    let attempts = 0;
    const service = new HttpClientRepairOrderService(
      {
        baseUrl: 'http://crm.test',
        username: 'bot',
        password: 'secret',
        timeoutMs: 1_000,
        maxRetries: 0,
        fetchImpl: async () => {
          attempts += 1;
          return Response.json({});
        },
      },
      logger,
    );

    assert.throws(
      () => service.listClientRepairOrders('client-id', { limit: 51 }),
      (error: unknown) =>
        error instanceof ClientRepairOrderError && error.code === 'invalid_request',
    );
    assert.equal(attempts, 0);
  });

  it('maps hidden or foreign orders to not_found without retrying', async () => {
    let attempts = 0;
    const service = new HttpClientRepairOrderService(
      {
        baseUrl: 'http://crm.test',
        username: 'bot',
        password: 'secret',
        timeoutMs: 1_000,
        maxRetries: 2,
        fetchImpl: async () => {
          attempts += 1;
          return Response.json({ message: 'Not found' }, { status: 404 });
        },
      },
      logger,
    );

    await assert.rejects(
      service.getClientRepairOrder('client-id', '1024'),
      (error: unknown) => error instanceof ClientRepairOrderError && error.code === 'not_found',
    );
    assert.equal(attempts, 1);
  });

  it('retries maintenance responses with bounded backoff', async () => {
    let attempts = 0;
    const delays: number[] = [];
    const service = new HttpClientRepairOrderService(
      {
        baseUrl: 'http://crm.test',
        username: 'bot',
        password: 'secret',
        timeoutMs: 1_000,
        maxRetries: 1,
        fetchImpl: async () => {
          attempts += 1;
          return attempts === 1
            ? Response.json({ message: 'Maintenance' }, { status: 503 })
            : Response.json({
                orders: [],
                pagination: { limit: 10, offset: 0, total: 0, has_more: false },
              });
        },
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
      logger,
    );

    await service.listClientRepairOrders('client-id');

    assert.equal(attempts, 2);
    assert.deepEqual(delays, [250]);
  });

  it('rejects malformed progress and money values', async () => {
    const service = new HttpClientRepairOrderService(
      {
        baseUrl: 'http://crm.test',
        username: 'bot',
        password: 'secret',
        timeoutMs: 1_000,
        maxRetries: 0,
        fetchImpl: async () =>
          Response.json({
            orders: [
              {
                ...listItem,
                status: { ...status, step: 8, total_steps: 7 },
                pricing: { ...listItem.pricing, final_total: 350000 },
              },
            ],
            pagination: { limit: 10, offset: 0, total: 1, has_more: false },
          }),
      },
      logger,
    );

    await assert.rejects(
      service.listClientRepairOrders('client-id'),
      (error: unknown) =>
        error instanceof ClientRepairOrderError && error.code === 'invalid_response',
    );
  });
});
