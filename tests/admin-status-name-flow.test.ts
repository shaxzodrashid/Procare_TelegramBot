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

const crmStatus = (overrides: Partial<CrmRepairOrderStatus> = {}): CrmRepairOrderStatus =>
  ({
    id: '11111111-1111-4111-8111-111111111111',
    name_uz: "O'ylab ko'radi",
    name_ru: 'Думает',
    name_en: 'Thinking',
    ...overrides,
  }) as CrmRepairOrderStatus;

const toRecord = (status: CrmRepairOrderStatus, index = 0): RepairOrderStatusNameRecord => ({
  id: String(index + 1),
  crm_status_id: status.id,
  crm_sort_order: index,
  crm_name_uz: status.name_uz,
  crm_name_ru: status.name_ru,
  crm_name_en: status.name_en,
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
          statuses: [
            crmStatus({
              id: '22222222-2222-4222-8222-222222222222',
              name_uz: 'Z yakuniy status',
              name_ru: 'Z статус',
              name_en: 'Z status',
            }),
            crmStatus({
              id: '11111111-1111-4111-8111-111111111111',
              name_uz: "O'ylab ko'radi",
              name_ru: 'Думает',
              name_en: 'Thinking',
            }),
          ],
        };
      },
    },
    repairOrderStatusNameStore: {
      async upsertFromCrm(items: CrmRepairOrderStatus[]) {
        items.forEach((item, index) => {
          const existing = statuses.find((row) => row.crm_status_id === item.id);
          const next = toRecord(item, index);
          if (existing) Object.assign(existing, next, { id: existing.id });
          else statuses.push(next);
        });
      },
      async listStatuses() {
        return [...statuses].sort((left, right) => left.crm_sort_order - right.crm_sort_order);
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
      async findDisplayNamesByStatusIds(statusIds: string[]) {
        const result = new Map<string, RepairOrderStatusNameUpdate>();
        statuses.forEach((status) => {
          if (statusIds.includes(status.crm_status_id)) {
            result.set(status.crm_status_id, {
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
      code: '11111111-1111-4111-8111-111111111111',
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
  }) as unknown as CustomerRepairOrderDetail;

describe('admin repair-order status names', () => {
  it('lets an employee sync statuses and set a customer-facing Uzbek name', async () => {
    const deps = createDependencies();
    const { bot, apiCalls } = createTestBot(deps);

    await bot.handleUpdate(adminMessage(1, '/start'));
    apiCalls.length = 0;

    await bot.handleUpdate(adminMessage(2, '🏷 Status nomlari'));

    const listCall = apiCalls.find((call) => call.method === 'sendMessage');
    assert.ok(listCall);
    assert.match(String(listCall.payload.text), /1\. <b>Z yakuniy status<\/b>/);
    assert.match(String(listCall.payload.text), /2\. <b>O'ylab ko'radi<\/b>/);
    assert.deepEqual(
      listCall.payload.reply_markup.inline_keyboard[0].map((button: any) => button.text),
      ['1', '2'],
    );
    assert.equal(listCall.payload.reply_markup.inline_keyboard[0][0].callback_data, 'st:v:1');

    apiCalls.length = 0;
    await bot.handleUpdate(adminCallback(3, 'st:v:2'));
    const detailCall = apiCalls.find((call) => call.method === 'editMessageText');
    assert.ok(detailCall);
    assert.match(
      String(detailCall.payload.text),
      /CRM ID: <code>11111111-1111-4111-8111-111111111111<\/code>/,
    );

    apiCalls.length = 0;
    await bot.handleUpdate(adminCallback(4, 'st:e:2:uz'));
    assert.ok(
      apiCalls.some((call) => String(call.payload.text).includes('o‘zbekcha status nomini')),
    );

    apiCalls.length = 0;
    await bot.handleUpdate(adminMessage(5, 'Javobingiz kutilmoqda'));

    assert.equal(deps.statuses[1]?.display_name_uz, 'Javobingiz kutilmoqda');
    assert.ok(apiCalls.some((call) => String(call.payload.text).includes('Status nomi saqlandi')));
  });

  it('edits the existing status list message when refreshing CRM data', async () => {
    const deps = createDependencies();
    const { bot, apiCalls } = createTestBot(deps);

    await bot.handleUpdate(adminMessage(1, '/start'));
    await bot.handleUpdate(adminMessage(2, '🏷 Status nomlari'));

    apiCalls.length = 0;
    await bot.handleUpdate(adminCallback(3, 'st:refresh'));

    assert.ok(apiCalls.some((call) => call.method === 'editMessageText'));
    assert.ok(!apiCalls.some((call) => call.method === 'sendMessage'));
  });

  it('uses saved status names in client-facing repair-order details when status ids match', async () => {
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
