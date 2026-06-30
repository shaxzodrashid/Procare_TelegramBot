/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createBot, type BotDependencies } from '../src/bot/create-bot.js';
import { applyStatusNameOverridesToDetail } from '../src/bot/handlers/repair-orders.js';
import { formatClientRepairOrderDetail } from '../src/bot/formatters.js';
import type { CustomerRepairOrderDetail } from '../src/types/client-repair-order.js';
import type {
  CrmRepairOrderStatus,
  RepairOrderStatusNameRecord,
  RepairOrderStatusNameUpdate,
} from '../src/types/repair-order-status.js';
import type { Logger } from '../src/utils/logger.js';

const logger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  extra: () => undefined,
  table: () => undefined,
};

const crmStatus = (): CrmRepairOrderStatus =>
  ({
    id: '11111111-1111-4111-8111-111111111111',
    name_uz: "O'ylab ko'radi",
    name_ru: 'Думает',
    name_en: 'Thinking',
    bg_color: '#ffffff',
    color: '#000000',
    sort: 3,
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
    transitions: [],
    metrics: { total_repair_orders: 4 },
  }) as CrmRepairOrderStatus;

const toRecord = (status: CrmRepairOrderStatus): RepairOrderStatusNameRecord => ({
  id: '1',
  crm_status_id: status.id,
  branch_id: status.branch_id,
  customer_code: status.customer_code,
  crm_name_uz: status.name_uz,
  crm_name_ru: status.name_ru,
  crm_name_en: status.name_en,
  sort: status.sort,
  can_user_view: status.can_user_view,
  is_active: status.is_active,
  customer_progress_type: status.customer_progress_type,
  total_repair_orders: status.metrics.total_repair_orders,
  display_name_uz: null,
  display_name_ru: null,
});

const createDependencies = (): BotDependencies & { statuses: RepairOrderStatusNameRecord[] } => {
  const statuses: RepairOrderStatusNameRecord[] = [];
  return {
    registrationService: {} as any,
    repairOrderService: {} as any,
    clientRepairOrderService: {} as any,
    unknownClientStore: {} as any,
    supportMessageStore: {} as any,
    registeredUserStore: {
      async findByTelegramId(telegramId: string) {
        if (telegramId !== '800100') return null;
        return {
          user: {
            id: '100',
            telegram_id: '800100',
            telegram_username: 'employee',
            first_name: 'Admin',
            last_name: 'User',
            phone_number: '+998901234567',
            locale: 'uz',
          },
          employee: {
            crm_admin_id: 'crm-admin-1',
            status: 'Open',
            is_active: true,
            created_at: '2026-06-30T00:00:00.000Z',
            updated_at: '2026-06-30T00:00:00.000Z',
          },
        };
      },
    } as any,
    messageTemplateStore: {} as any,
    repairOrderStatusService: {
      async listStatuses() {
        return {
          statuses: [crmStatus()],
          pagination: { total: 1, limit: 100, offset: 0 },
        };
      },
    },
    repairOrderStatusNameStore: {
      async upsertFromCrm(items: CrmRepairOrderStatus[]) {
        items.forEach((item) => {
          const existing = statuses.find((row) => row.crm_status_id === item.id);
          const next = toRecord(item);
          if (existing) Object.assign(existing, next, { id: existing.id });
          else statuses.push(next);
        });
      },
      async listStatuses() {
        return statuses;
      },
      async findById(id: string) {
        return statuses.find((status) => status.id === id) ?? null;
      },
      async updateDisplayNames(id: string, update: Partial<RepairOrderStatusNameUpdate>) {
        const status = statuses.find((item) => item.id === id);
        if (!status) return null;
        Object.assign(status, update);
        return status;
      },
      async findDisplayNamesByCustomerCodes(customerCodes: string[]) {
        const result = new Map<string, RepairOrderStatusNameUpdate>();
        statuses.forEach((status) => {
          if (status.customer_code && customerCodes.includes(status.customer_code)) {
            result.set(status.customer_code, {
              display_name_uz: status.display_name_uz,
              display_name_ru: status.display_name_ru,
            });
          }
        });
        return result;
      },
    },
    logger,
    allowManualPhoneEntry: true,
    richMessagesEnabled: false,
    statuses,
  };
};

const createTestBot = (deps: BotDependencies) => {
  const bot = createBot('fake-token', deps);
  const apiCalls: Array<{ method: string; payload: any }> = [];

  bot.botInfo = {
    id: 99999,
    is_bot: true,
    first_name: 'TestBot',
    username: 'test_bot',
  } as any;

  bot.api.config.use(async (_prev, method, payload: any) => {
    apiCalls.push({ method, payload });
    if (method === 'answerCallbackQuery') return { ok: true, result: true } as any;
    return {
      ok: true,
      result: {
        message_id: 12345,
        date: Math.floor(Date.now() / 1000),
        chat: { id: Number(payload.chat_id), type: 'private' },
      },
    } as any;
  });

  return { bot, apiCalls };
};

const adminMessage = (updateId: number, text: string) =>
  ({
    update_id: updateId,
    message: {
      message_id: updateId,
      date: Date.now() / 1000,
      chat: { id: 800100, type: 'private', first_name: 'Admin' },
      from: { id: 800100, is_bot: false, first_name: 'Admin' },
      text,
    },
  }) as any;

const adminCallback = (updateId: number, data: string) =>
  ({
    update_id: updateId,
    callback_query: {
      id: `q${updateId}`,
      from: { id: 800100, is_bot: false, first_name: 'Admin' },
      chat_instance: 'instance_1',
      data,
      message: {
        message_id: updateId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 800100, type: 'private', first_name: 'TestBot' },
        from: { id: 99999, is_bot: true, first_name: 'TestBot' },
        text: 'source',
      },
    },
  }) as any;

const detailOrder = (): CustomerRepairOrderDetail =>
  ({
    id: '44444444-4444-4444-8444-444444444444',
    order_number: '1024',
    device: { brand: 'Apple', model: 'iPhone 15', imei_last4: null },
    status: {
      code: 'AWAITING_APPROVAL',
      name_uz: "O'ylab ko'radi",
      name_ru: 'Думает',
      name_en: 'Thinking',
      progress_type: 'linear',
      step: 2,
      total_steps: 7,
      updated_at: '2026-06-30T12:00:00.000Z',
      customer_message_uz: null,
      customer_message_ru: null,
      customer_message_en: null,
    },
    created_at: '2026-06-30T12:00:00.000Z',
    updated_at: '2026-06-30T12:00:00.000Z',
    estimated_ready_at: null,
    assigned_admins: [],
    pricing: {
      currency: 'UZS',
      final_total: null,
      payment_status: 'unpaid',
      estimated_total: null,
      paid_amount: '0',
      remaining_amount: '0',
      payments: [],
    },
    branch: {
      name_uz: 'Chilonzor',
      name_ru: 'Чиланзар',
      name_en: 'Chilanzar',
      address_uz: null,
      address_ru: null,
      address_en: null,
      telephone: null,
      working_hours: { start: null, end: null },
      map_url: null,
    },
    completed_at: null,
    picked_up_at: null,
    warranty: { period_months: null, warranty_until: null },
    documents: { checklist_url: null, warranty_document_url: null, offer_url: null },
    status_history: [],
  }) as CustomerRepairOrderDetail;

describe('admin repair-order status names', () => {
  it('lets an employee sync statuses and set a customer-facing Uzbek name', async () => {
    const deps = createDependencies();
    const { bot, apiCalls } = createTestBot(deps);

    await bot.handleUpdate(adminMessage(1, '/start'));
    apiCalls.length = 0;

    await bot.handleUpdate(adminMessage(2, '🏷 Status nomlari'));

    const listCall = apiCalls.find((call) => call.method === 'sendMessage');
    assert.ok(listCall);
    assert.match(String(listCall.payload.text), /O'ylab ko'radi/);
    assert.equal(listCall.payload.reply_markup.inline_keyboard[0][0].callback_data, 'st:v:1');

    apiCalls.length = 0;
    await bot.handleUpdate(adminCallback(3, 'st:v:1'));
    const detailCall = apiCalls.find((call) => call.method === 'editMessageText');
    assert.ok(detailCall);
    assert.match(String(detailCall.payload.text), /Customer code: <code>AWAITING_APPROVAL<\/code>/);

    apiCalls.length = 0;
    await bot.handleUpdate(adminCallback(4, 'st:e:1:uz'));
    assert.ok(
      apiCalls.some((call) => String(call.payload.text).includes('o‘zbekcha status nomini')),
    );

    apiCalls.length = 0;
    await bot.handleUpdate(adminMessage(5, 'Javobingiz kutilmoqda'));

    assert.equal(deps.statuses[0]?.display_name_uz, 'Javobingiz kutilmoqda');
    assert.ok(apiCalls.some((call) => String(call.payload.text).includes('Status nomi saqlandi')));
  });

  it('uses saved status names in client-facing repair-order details', async () => {
    const deps = createDependencies();
    deps.statuses.push({
      ...toRecord(crmStatus()),
      display_name_uz: 'Javobingiz kutilmoqda',
      display_name_ru: 'Ожидаем ваш ответ',
    });

    const displayedOrder = await applyStatusNameOverridesToDetail(detailOrder(), deps);
    const formatted = formatClientRepairOrderDetail(displayedOrder, 'uz');

    assert.match(formatted.fallbackHtml, /Javobingiz kutilmoqda/);
    assert.doesNotMatch(formatted.fallbackHtml, /O&#39;ylab ko&#39;radi|O'ylab ko'radi/);
  });
});
