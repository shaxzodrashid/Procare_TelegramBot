/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createBot } from '../src/bot/create-bot.js';
import type { BotDependencies } from '../src/bot/create-bot.js';
import type { CustomerRepairOrderDetail } from '../src/types/client-repair-order.js';
import type { Logger } from '../src/utils/logger.js';

const logger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  extra: () => undefined,
  table: () => undefined,
};

const repairOrderUuid = '11111111-1111-4111-8111-111111111111';

const detail: CustomerRepairOrderDetail = {
  id: repairOrderUuid,
  order_number: '1024',
  assigned_admins: [],
  final_problems: [],
  device: { brand: 'Apple', model: 'iPhone 14 Pro', imei_last4: '5678' },
  status: {
    code: 'IN_REPAIR',
    name_uz: 'Ta’mirlash jarayonida',
    name_ru: 'В процессе ремонта',
    name_en: 'In repair',
    progress_type: 'linear',
    step: 4,
    total_steps: 7,
    updated_at: '2026-06-18T10:00:00.000Z',
    customer_message_uz: null,
    customer_message_ru: null,
    customer_message_en: null,
  },
  created_at: '2026-06-14T11:20:00.000Z',
  estimated_ready_at: null,
  updated_at: '2026-06-18T10:00:00.000Z',
  problem_summary: { uz: 'Ekran', ru: 'Экран', en: 'Screen' },
  service_summary: { uz: 'Displey almashtirish', ru: 'Замена дисплея', en: 'Display replacement' },
  pricing: {
    currency: 'UZS',
    estimated_total: null,
    final_total: '350000.00',
    paid_amount: '100000.00',
    remaining_amount: '250000.00',
    payment_status: 'partial',
    payments: [],
  },
  branch: {
    name_uz: 'Chilonzor filiali',
    name_ru: 'Чиланзарский филиал',
    name_en: 'Chilanzar branch',
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
};

const createDependencies = (): BotDependencies => ({
  registrationService: {} as any,
  repairOrderService: {} as any,
  clientRepairOrderService: {
    async listClientRepairOrders() {
      throw new Error('not used');
    },
    async getClientRepairOrder(clientId: string, orderReference: string) {
      assert.equal(clientId, 'client-201');
      assert.equal(orderReference, repairOrderUuid);
      return detail;
    },
    async registerClientSupportComment() {
      throw new Error('not used');
    },
  },
  unknownClientStore: {} as any,
  registeredUserStore: {
    async findByTelegramId(telegramId: string) {
      if (telegramId !== '700201') return null;
      return {
        user: {
          id: '201',
          telegram_id: '700201',
          telegram_username: 'ali',
          first_name: 'Ali',
          last_name: 'Valiyev',
          phone_number: '+998901234567',
          locale: 'uz' as const,
        },
        client: {
          crm_client_id: 'client-201',
          customer_code: 'CC-201',
          status: 'Active',
          is_active: true,
        },
      };
    },
  } as any,
  messageTemplateStore: {} as any,
  supportMessageStore: {} as any,
  logger,
  allowManualPhoneEntry: true,
  richMessagesEnabled: false,
});

const createTestBot = () => {
  const bot = createBot('fake-token', createDependencies());
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
        message_id: payload.message_id ?? 777,
        date: Math.floor(Date.now() / 1000),
        chat: { id: Number(payload.chat_id ?? 700201), type: 'private' },
        text: payload.text,
      },
    } as any;
  });

  return { bot, apiCalls };
};

const callbackUpdate = (data: string, text: string, entities?: unknown[]) => ({
  update_id: Math.floor(Math.random() * 1_000_000),
  callback_query: {
    id: `callback-${data}`,
    from: { id: 700201, is_bot: false, first_name: 'Ali' },
    chat_instance: 'chat-instance',
    data,
    message: {
      message_id: 777,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 700201, type: 'private' as const, first_name: 'Ali' },
      from: { id: 99999, is_bot: true, first_name: 'TestBot' },
      text,
      entities,
      reply_markup: {
        inline_keyboard: [[{ text: 'Open order', callback_data: `dm:ro:o:${repairOrderUuid}` }]],
      },
    },
  },
});

describe('direct message inline repair-order buttons', () => {
  it('edits the API message to repair-order detail and restores it on back', async () => {
    const { bot, apiCalls } = createTestBot();

    await bot.handleUpdate(
      callbackUpdate(`dm:ro:o:${repairOrderUuid}`, 'Original API message', [
        { type: 'bold', offset: 0, length: 8 },
      ]) as any,
    );

    const detailEdit = apiCalls.find((call) => call.method === 'editMessageText');
    assert.ok(detailEdit);
    assert.equal(detailEdit.payload.chat_id, 700201);
    assert.equal(detailEdit.payload.message_id, 777);
    assert.equal(detailEdit.payload.parse_mode, 'HTML');
    assert.match(detailEdit.payload.text, /iPhone 14 Pro/);
    assert.deepEqual(
      detailEdit.payload.reply_markup.inline_keyboard[0].map(
        (button: { callback_data?: string }) => button.callback_data,
      ),
      [`dm:ro:r:${repairOrderUuid}`, `dm:ro:b:${repairOrderUuid}`],
    );

    apiCalls.length = 0;
    await bot.handleUpdate(
      callbackUpdate(`dm:ro:b:${repairOrderUuid}`, detailEdit.payload.text) as any,
    );

    const backEdit = apiCalls.find((call) => call.method === 'editMessageText');
    assert.ok(backEdit);
    assert.equal(backEdit.payload.text, 'Original API message');
    assert.deepEqual(backEdit.payload.entities, [{ type: 'bold', offset: 0, length: 8 }]);
    assert.equal(
      backEdit.payload.reply_markup.inline_keyboard[0][0].callback_data,
      `dm:ro:o:${repairOrderUuid}`,
    );
  });
});
