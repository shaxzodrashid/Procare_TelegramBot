/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createBot } from '../src/bot/create-bot.js';
import type { BotDependencies } from '../src/bot/create-bot.js';
import type {
  CustomerRepairOrderDetail,
  CustomerRepairOrderListItem,
} from '../src/types/client-repair-order.js';
import type { Logger } from '../src/utils/logger.js';

const logger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  extra: () => undefined,
  table: () => undefined,
};

const listOrder: CustomerRepairOrderListItem = {
  order_number: '9749',
  device: { brand: 'Apple', model: 'iPhone 16 Pro' },
  status: {
    code: 'NEW',
    name_uz: 'Yangi buyurtma (lead)',
    name_ru: 'Новый заказ (lead)',
    name_en: 'New order (lead)',
    progress_type: 'linear',
    step: 1,
    total_steps: 7,
    updated_at: '2026-06-22T12:38:00.000Z',
  },
  created_at: '2026-06-22T12:38:00.000Z',
  estimated_ready_at: null,
  pricing: {
    currency: 'UZS',
    final_total: '0.00',
    payment_status: 'unpaid',
  },
};

const detailOrder: CustomerRepairOrderDetail = {
  ...listOrder,
  id: '11111111-1111-4111-8111-111111111111',
  updated_at: '2026-06-22T12:38:00.000Z',
  assigned_admins: [],
  device: { ...listOrder.device, imei_last4: null },
  status: {
    ...listOrder.status,
    customer_message_uz: 'Buyurtmangiz qabul qilindi.',
    customer_message_ru: 'Ваш заказ принят.',
    customer_message_en: 'Your order has been accepted.',
  },
  pricing: {
    currency: 'UZS',
    estimated_total: null,
    final_total: '0.00',
    paid_amount: '0.00',
    remaining_amount: '0.00',
    payment_status: 'unpaid',
    payments: [],
  },
  branch: {
    name_uz: 'Malika Filiali',
    name_ru: 'Филиал Малика',
    name_en: 'Malika Branch',
    address_uz: 'Malika B41 Dokon',
    address_ru: 'Малика B41',
    address_en: 'Malika B41',
    telephone: '+998948333335',
    working_hours: { start: '10:00', end: '20:00' },
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
      return {
        orders: [listOrder],
        pagination: { limit: 10, offset: 0, total: 1, has_more: false },
      };
    },
    async getClientRepairOrder(clientId: string, orderNumber: string) {
      assert.equal(clientId, 'client-201');
      assert.equal(orderNumber, '9749');
      return detailOrder;
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
        message_id: payload.message_id ?? 501,
        date: Math.floor(Date.now() / 1000),
        chat: { id: Number(payload.chat_id), type: 'private' },
        text: payload.text,
      },
    } as any;
  });

  return { bot, apiCalls };
};

const clientMessage = (updateId: number, text: string) =>
  ({
    update_id: updateId,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 700201, type: 'private', first_name: 'Ali' },
      from: { id: 700201, is_bot: false, first_name: 'Ali' },
      text,
    },
  }) as any;

const orderCallback = (updateId: number, data: string, text: string) =>
  ({
    update_id: updateId,
    callback_query: {
      id: `q${updateId}`,
      from: { id: 700201, is_bot: false, first_name: 'Ali' },
      chat_instance: 'instance_1',
      data,
      message: {
        message_id: 501,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 700201, type: 'private', first_name: 'Ali' },
        from: { id: 99999, is_bot: true, first_name: 'TestBot' },
        text,
      },
    },
  }) as any;

describe('client repair-order navigation', () => {
  it('edits the order window for list loading, detail, and back navigation', async () => {
    const { bot, apiCalls } = createTestBot();

    await bot.handleUpdate(clientMessage(1, '📦 Mening buyurtmalarim'));

    const loadingSend = apiCalls.find((call) => call.method === 'sendMessage');
    assert.ok(loadingSend);
    assert.match(String(loadingSend.payload.text), /Buyurtmalaringiz/);

    const listEdit = apiCalls.find((call) => call.method === 'editMessageText');
    assert.ok(listEdit);
    assert.equal(listEdit.payload.message_id, 501);
    assert.match(String(listEdit.payload.text), /Buyurtmalarim/);
    assert.equal(
      apiCalls.some((call) => call.method === 'deleteMessage'),
      false,
    );

    apiCalls.length = 0;
    await bot.handleUpdate(orderCallback(2, 'ro:v:0:0', listEdit.payload.text));

    const detailEdit = apiCalls.find((call) => call.method === 'editMessageText');
    assert.ok(detailEdit);
    assert.equal(detailEdit.payload.message_id, 501);
    assert.match(String(detailEdit.payload.text), /Buyurtma #9749/);
    assert.equal(
      apiCalls.some((call) => call.method === 'sendMessage'),
      false,
    );

    apiCalls.length = 0;
    await bot.handleUpdate(orderCallback(3, 'ro:b', detailEdit.payload.text));

    const backEdit = apiCalls.find((call) => call.method === 'editMessageText');
    assert.ok(backEdit);
    assert.equal(backEdit.payload.message_id, 501);
    assert.match(String(backEdit.payload.text), /Buyurtmalarim/);
    assert.equal(
      apiCalls.some((call) => call.method === 'sendMessage'),
      false,
    );
  });
});
