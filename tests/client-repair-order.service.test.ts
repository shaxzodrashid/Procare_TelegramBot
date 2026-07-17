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
  final_problems: [
    {
      id: '55555555-5555-4555-8555-555555555555',
      problem_category_id: '66666666-6666-4666-8666-666666666666',
      name_uz: 'Displey almashtirish',
      name_ru: 'Замена дисплея',
      name_en: 'Display replacement',
      warranty_period: 6,
      price: '250000.00',
      estimated_minutes: 45,
      is_done: true,
      workflow_status: 'finished',
      parts: [
        {
          id: '77777777-7777-4777-8777-777777777777',
          repair_part_id: '88888888-8888-4888-8888-888888888888',
          part_name_uz: 'OLED ekran',
          part_name_ru: 'OLED экран',
          part_name_en: 'OLED screen',
          quantity: 1,
          part_price: '100000.00',
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
  initial_problems_approval: { status: 'pending', requires_action: true, note: null },
} as const;

describe('HttpClientRepairOrderService', () => {
  it('submits an approval once with Basic Auth and validates the 201 response', async () => {
    let requestedUrl = '';
    let requestedBody = '';
    let authorization = '';
    let calls = 0;
    const service = new HttpClientRepairOrderService(
      {
        baseUrl: 'http://crm.test',
        username: 'bot',
        password: 'secret',
        timeoutMs: 1_000,
        maxRetries: 2,
        fetchImpl: async (input, init) => {
          calls += 1;
          requestedUrl = String(input);
          requestedBody = String(init?.body);
          authorization = new Headers(init?.headers).get('authorization') ?? '';
          return Response.json(
            {
              result: 'approved',
              repair_order_id: detail.id,
              status_id: '99999999-9999-4999-8999-999999999999',
            },
            { status: 201 },
          );
        },
      },
      logger,
    );

    const result = await service.submitRepairOrderApproval(detail.id, { result: 'approved' });

    assert.equal(calls, 1);
    assert.equal(
      requestedUrl,
      `http://crm.test/api/v1/telegram/repair-orders/${detail.id}/approval`,
    );
    assert.deepEqual(JSON.parse(requestedBody), { result: 'approved' });
    assert.equal(authorization, `Basic ${Buffer.from('bot:secret').toString('base64')}`);
    assert.equal(result.result, 'approved');
  });

  it('trims a rejection note and never retries the non-idempotent approval endpoint', async () => {
    let calls = 0;
    const service = new HttpClientRepairOrderService(
      {
        baseUrl: 'http://crm.test',
        username: 'bot',
        password: 'secret',
        timeoutMs: 1_000,
        maxRetries: 2,
        fetchImpl: async (_input, init) => {
          calls += 1;
          if (calls === 1) {
            assert.deepEqual(JSON.parse(String(init?.body)), {
              result: 'rejected',
              note: 'Use an original display.',
            });
          }
          throw new Error('network unavailable');
        },
        sleep: async () => assert.fail('approval must not retry'),
      },
      logger,
    );

    await assert.rejects(
      service.submitRepairOrderApproval(detail.id, {
        result: 'rejected',
        note: '  Use an original display.  ',
      }),
      (error: unknown) => error instanceof ClientRepairOrderError && error.code === 'unavailable',
    );
    assert.equal(calls, 1);
  });

  it('rejects a blank rejection note before making a request', async () => {
    const service = new HttpClientRepairOrderService(
      {
        baseUrl: 'http://crm.test',
        username: 'bot',
        password: 'secret',
        timeoutMs: 1_000,
        maxRetries: 0,
        fetchImpl: async () => assert.fail('request must not be sent'),
      },
      logger,
    );

    await assert.rejects(
      service.submitRepairOrderApproval(detail.id, { result: 'rejected', note: '   ' }),
      (error: unknown) =>
        error instanceof ClientRepairOrderError && error.code === 'invalid_request',
    );
  });

  it('preserves CRM error locations for approval concurrency handling', async () => {
    const service = new HttpClientRepairOrderService(
      {
        baseUrl: 'http://crm.test',
        username: 'bot',
        password: 'secret',
        timeoutMs: 1_000,
        maxRetries: 0,
        fetchImpl: async () =>
          Response.json(
            {
              message: 'Repair order is not awaiting customer approval',
              location: 'telegram_initial_problems_approval_not_pending',
            },
            { status: 400 },
          ),
      },
      logger,
    );

    await assert.rejects(
      service.submitRepairOrderApproval(detail.id, { result: 'approved' }),
      (error: unknown) =>
        error instanceof ClientRepairOrderError &&
        error.code === 'invalid_request' &&
        error.location === 'telegram_initial_problems_approval_not_pending',
    );
  });

  it('submits ratings with the UUID query and safely retries a transient failure', async () => {
    const delays: number[] = [];
    let calls = 0;
    const service = new HttpClientRepairOrderService(
      {
        baseUrl: 'http://crm.test',
        username: 'bot',
        password: 'secret',
        timeoutMs: 1_000,
        maxRetries: 2,
        fetchImpl: async (input, init) => {
          calls += 1;
          assert.equal(
            String(input),
            `http://crm.test/api/v1/telegram/repair-orders/rating?repair_order_id=${detail.id}`,
          );
          assert.deepEqual(JSON.parse(String(init?.body)), { grade: 5 });
          if (calls === 1) {
            return Response.json({ message: 'maintenance' }, { status: 503 });
          }
          return Response.json({
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            repair_order_id: detail.id,
            source: 'Telegram',
            grade: 5,
            notes: null,
            created_at: '2026-07-14T08:00:00.000Z',
            updated_at: '2026-07-14T08:00:00.000Z',
          });
        },
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
      logger,
    );

    const result = await service.submitRepairOrderRating(detail.id, { grade: 5 });

    assert.equal(result.grade, 5);
    assert.equal(calls, 2);
    assert.deepEqual(delays, [250]);
  });

  it('rejects malformed rating responses', async () => {
    const service = new HttpClientRepairOrderService(
      {
        baseUrl: 'http://crm.test',
        username: 'bot',
        password: 'secret',
        timeoutMs: 1_000,
        maxRetries: 0,
        fetchImpl: async () =>
          Response.json({
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            repair_order_id: detail.id,
            source: 'Telegram',
            grade: 6,
            notes: null,
            created_at: '2026-07-14T08:00:00.000Z',
            updated_at: '2026-07-14T08:00:00.000Z',
          }),
      },
      logger,
    );

    await assert.rejects(
      service.submitRepairOrderRating(detail.id, { grade: 5 }),
      (error: unknown) =>
        error instanceof ClientRepairOrderError && error.code === 'invalid_response',
    );
  });

  it('rejects rating grades above five before making a request', async () => {
    let calls = 0;
    const service = new HttpClientRepairOrderService(
      {
        baseUrl: 'http://crm.test',
        username: 'bot',
        password: 'secret',
        timeoutMs: 1_000,
        maxRetries: 0,
        fetchImpl: async () => {
          calls += 1;
          throw new Error('should not request CRM');
        },
      },
      logger,
    );

    await assert.rejects(
      service.submitRepairOrderRating(detail.id, { grade: 6 as never }),
      (error: unknown) =>
        error instanceof ClientRepairOrderError &&
        error.code === 'invalid_request' &&
        error.message === 'grade must be an integer from 1 to 5',
    );
    assert.equal(calls, 0);
  });

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
    assert.equal(result.final_problems?.[0]?.warranty_period, 6);
    assert.equal(result.final_problems?.[0]?.parts[0]?.part_name_en, 'OLED screen');
    assert.equal(result.status_history[0]?.progress_type, 'linear');
  });

  it('rejects malformed customer approval state in repair-order detail', async () => {
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
            initial_problems_approval: {
              status: 'pending',
              requires_action: 'yes',
              note: null,
            },
          }),
      },
      logger,
    );

    await assert.rejects(
      service.getClientRepairOrder('client-id', detail.order_number),
      (error: unknown) =>
        error instanceof ClientRepairOrderError && error.code === 'invalid_response',
    );
  });

  it('treats a missing final_problems field as an empty rollout-safe detail state', async () => {
    const detailWithoutFinalProblems: Record<string, unknown> = { ...detail };
    delete detailWithoutFinalProblems.final_problems;
    detailWithoutFinalProblems.initial_problems_approval = {
      status: 'none',
      requires_action: false,
      note: null,
    };
    const service = new HttpClientRepairOrderService(
      {
        baseUrl: 'http://crm.test',
        username: 'bot',
        password: 'secret',
        timeoutMs: 1_000,
        maxRetries: 0,
        fetchImpl: async () => Response.json(detailWithoutFinalProblems),
      },
      logger,
    );

    const result = await service.getClientRepairOrder('client-id', '8225');

    assert.equal(result.order_number, '1024');
    assert.equal(result.final_problems, undefined);
    assert.equal(result.initial_problems_approval.status, 'none');
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

  it('rejects malformed final problem part metadata', async () => {
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
            final_problems: [
              {
                ...detail.final_problems[0],
                parts: [{ ...detail.final_problems[0]?.parts[0], quantity: 0 }],
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

  it('rejects malformed final problem warranty metadata', async () => {
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
            final_problems: [
              {
                ...detail.final_problems[0],
                warranty_period: -1,
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
