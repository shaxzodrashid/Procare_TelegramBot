import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  HttpRepairOrderStatusService,
  RepairOrderStatusError,
} from '../src/services/repair-order-status.service.js';
import type { CrmRepairOrderStatus } from '../src/types/repair-order-status.js';
import type { Logger } from '../src/utils/logger.js';

const logger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  extra: () => undefined,
  table: () => undefined,
};

const status = (overrides: Partial<CrmRepairOrderStatus> = {}): CrmRepairOrderStatus => ({
  id: '11111111-1111-4111-8111-111111111111',
  name_uz: "O'ylab ko'radi",
  name_ru: 'Думает',
  name_en: 'Thinking',
  bg_color: '#ffffff',
  color: '#000000',
  sort: 1,
  can_user_view: true,
  is_active: true,
  type: 'Open',
  is_protected: false,
  can_add_payment: true,
  suppress_is_taken_from_mother: false,
  customer_code: 'AWAITING_APPROVAL',
  customer_progress_type: 'linear',
  customer_step: 2,
  customer_total_steps: 7,
  customer_message_uz: null,
  customer_message_ru: null,
  customer_message_en: null,
  status: 'Open',
  branch_id: '22222222-2222-4222-8222-222222222222',
  created_by: null,
  created_at: '2026-06-30T12:00:00.000Z',
  updated_at: '2026-06-30T12:00:00.000Z',
  permissions: {
    can_add: true,
    can_view: true,
    can_update: true,
    can_delete: true,
    can_payment_add: true,
    can_payment_cancel: true,
    can_assign_admin: true,
    can_notification: true,
    can_notification_bot: true,
    can_change_active: true,
    can_change_status: true,
    can_view_initial_problems: true,
    can_change_initial_problems: true,
    can_view_final_problems: true,
    can_change_final_problems: true,
    can_comment: true,
    can_pickup_manage: true,
    can_delivery_manage: true,
    can_view_payments: true,
    can_view_history: true,
    cannot_continue_without_service_form: false,
    cannot_continue_from_mother_branch: false,
    cannot_continue_without_final_problems: false,
    cannot_continue_without_final_problems_done: false,
  },
  transitions: ['33333333-3333-4333-8333-333333333333'],
  metrics: { total_repair_orders: 12 },
  ...overrides,
});

describe('HttpRepairOrderStatusService', () => {
  it('fetches CRM statuses with Basic Auth, branch ID, and live meta/data shape', async () => {
    const calls: Array<{ url: string; authorization: string | null }> = [];
    const service = new HttpRepairOrderStatusService(
      {
        baseUrl: 'https://crm.example.test',
        username: 'bot',
        password: 'secret',
        branchId: '22222222-2222-4222-8222-222222222222',
        timeoutMs: 1000,
        maxRetries: 0,
        async fetchImpl(url, init) {
          calls.push({
            url: String(url),
            authorization: new Headers(init?.headers).get('authorization'),
          });
          return Response.json({
            meta: { total: 1, limit: 50, offset: 0 },
            data: [status()],
          });
        },
      },
      logger,
    );

    const result = await service.listStatuses();

    assert.equal(
      calls[0]?.url,
      'https://crm.example.test/api/v1/external/repair-order-statuses?branch_id=22222222-2222-4222-8222-222222222222&limit=50&offset=0',
    );
    assert.equal(calls[0]?.authorization, 'Basic Ym90OnNlY3JldA==');
    assert.equal(result.statuses[0]?.customer_code, 'AWAITING_APPROVAL');
    assert.equal(result.pagination.total, 1);
  });

  it('rejects malformed customer progress data', async () => {
    const service = new HttpRepairOrderStatusService(
      {
        baseUrl: 'https://crm.example.test',
        username: 'bot',
        password: 'secret',
        branchId: '22222222-2222-4222-8222-222222222222',
        timeoutMs: 1000,
        maxRetries: 0,
        async fetchImpl() {
          return Response.json({
            meta: { total: 1, limit: 50, offset: 0 },
            data: [status({ customer_step: 8, customer_total_steps: 7 })],
          });
        },
      },
      logger,
    );

    await assert.rejects(
      () => service.listStatuses(),
      (error: unknown) =>
        error instanceof RepairOrderStatusError && error.code === 'invalid_response',
    );
  });
});
