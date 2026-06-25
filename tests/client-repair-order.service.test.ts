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
  id: '11111111-1111-4111-8111-111111111111',
  updated_at: '2026-06-18T10:00:00.000Z',
  assigned_admins: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      first_name: 'John',
      last_name: 'Doe',
      phone_number: '+998901234567',
      roles: [
        {
          id: '44444444-4444-4444-8444-444444444444',
          name: 'Master',
          type: 'Master',
        },
      ],
    },
  ],
  device: { ...listItem.device, imei_last4: '5678' },
  status: {
    ...status,
    customer_message_uz: 'Qurilmangiz ta’mirlanmoqda',
    customer_message_ru: 'Ваше устройство ремонтируется',
    customer_message_en: 'Your device is being repaired',
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
  documents: {
    checklist_url: 'https://crm.test/documents/checklist/1024',
    warranty_document_url: null,
    offer_url: 'https://crm.test/documents/offer/1024',
  },
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
    assert.equal(result.id, '11111111-1111-4111-8111-111111111111');
    assert.equal(result.branch.working_hours.start, '09:00');
    assert.equal(result.warranty.period_months, 3);
    assert.equal(result.documents.checklist_url, 'https://crm.test/documents/checklist/1024');
    assert.equal(result.assigned_admins[0]?.roles[0]?.type, 'Master');
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

  it('rejects malformed document metadata', async () => {
    const service = new HttpClientRepairOrderService(
      {
        baseUrl: 'http://crm.test',
        username: 'bot',
        password: 'secret',
        timeoutMs: 1_000,
        maxRetries: 0,
        fetchImpl: async () =>
          Response.json({
            ...detail,
            documents: {
              ...detail.documents,
              checklist_url: 1024,
            },
          }),
      },
      logger,
    );

    await assert.rejects(
      service.getClientRepairOrder('client-id', '1024'),
      (error: unknown) =>
        error instanceof ClientRepairOrderError && error.code === 'invalid_response',
    );
  });

  it('rejects malformed assigned-admin role metadata', async () => {
    const service = new HttpClientRepairOrderService(
      {
        baseUrl: 'http://crm.test',
        username: 'bot',
        password: 'secret',
        timeoutMs: 1_000,
        maxRetries: 0,
        fetchImpl: async () =>
          Response.json({
            ...detail,
            assigned_admins: [
              {
                ...detail.assigned_admins[0],
                roles: [{ id: '44444444-4444-4444-8444-444444444444', name: '', type: 'Master' }],
              },
            ],
          }),
      },
      logger,
    );

    await assert.rejects(
      service.getClientRepairOrder('client-id', '1024'),
      (error: unknown) =>
        error instanceof ClientRepairOrderError && error.code === 'invalid_response',
    );
  });

  it('posts a support comment as multipart form data without retrying', async () => {
    let attempts = 0;
    let requestedUrl = '';
    let authorization = '';
    let method = '';
    let bodyIsForm = false;
    const service = new HttpClientRepairOrderService(
      {
        baseUrl: 'http://crm.test',
        username: 'bot',
        password: 'secret',
        timeoutMs: 1_000,
        maxRetries: 2,
        fetchImpl: async (input, init) => {
          attempts += 1;
          requestedUrl = String(input);
          method = init?.method ?? '';
          authorization = new Headers(init?.headers).get('authorization') ?? '';
          bodyIsForm = init?.body instanceof FormData;
          return Response.json({
            comment: {
              item_type: 'message',
              id: '22222222-2222-4222-8222-222222222222',
              comment_type: 'support',
              author_type: 'user',
              direction: 'inbound',
              text: 'Salom',
              author: {
                id: '33333333-3333-4333-8333-333333333333',
                display_name: 'Ali Valiyev',
                phone_number: '+998901234567',
              },
              reply: null,
              photos: [],
              is_editable: false,
              is_deletable: false,
              is_edited: false,
              is_read: false,
              created_at: '2026-06-24T07:14:04.000Z',
              updated_at: '2026-06-24T07:14:04.000Z',
            },
            created: true,
          });
        },
      },
      logger,
    );

    const result = await service.registerClientSupportComment(
      '11111111-1111-4111-8111-111111111111',
      { text: ' Salom ' },
    );

    assert.equal(attempts, 1);
    assert.equal(
      requestedUrl,
      'http://crm.test/api/v1/repair-orders/register-comment/11111111-1111-4111-8111-111111111111',
    );
    assert.equal(method, 'POST');
    assert.equal(authorization, `Basic ${Buffer.from('bot:secret').toString('base64')}`);
    assert.equal(bodyIsForm, true);
    assert.equal(result.created, true);
    assert.equal(result.comment.id, '22222222-2222-4222-8222-222222222222');
  });

  it('does not retry failed support comment submissions', async () => {
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
          return Response.json({ message: 'Maintenance' }, { status: 503 });
        },
      },
      logger,
    );

    await assert.rejects(
      service.registerClientSupportComment('11111111-1111-4111-8111-111111111111', {
        text: 'Salom',
      }),
      (error: unknown) => error instanceof ClientRepairOrderError && error.code === 'maintenance',
    );
    assert.equal(attempts, 1);
  });

  it('rejects unsupported support photo mime types before making a request', async () => {
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
          return Response.json({ created: true });
        },
      },
      logger,
    );

    await assert.rejects(
      service.registerClientSupportComment('11111111-1111-4111-8111-111111111111', {
        photos: [
          {
            fileName: 'telegram-photo.jpg',
            mimeType: 'application/octet-stream' as never,
            data: new Uint8Array([1, 2, 3]),
          },
        ],
      }),
      (error: unknown) =>
        error instanceof ClientRepairOrderError &&
        error.code === 'invalid_request' &&
        error.message === 'only JPEG, PNG, and WebP photos are allowed',
    );
    assert.equal(attempts, 0);
  });
});
