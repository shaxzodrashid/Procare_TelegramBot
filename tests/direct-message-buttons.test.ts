/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createBot } from '../src/bot/create-bot.js';
import type { BotDependencies } from '../src/bot/create-bot.js';
import { ClientRepairOrderError } from '../src/services/client-repair-order.service.js';
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
  initial_problems_approval: { status: 'pending', requires_action: true, note: null },
};

const createDependencies = (
  order: CustomerRepairOrderDetail = detail,
): BotDependencies & { approvals: any[]; ratings: any[] } => {
  const approvals: any[] = [];
  const ratings: any[] = [];
  return {
    registrationService: {} as any,
    repairOrderService: {} as any,
    clientRepairOrderService: {
      async listClientRepairOrders() {
        throw new Error('not used');
      },
      async getClientRepairOrder(clientId: string, orderReference: string) {
        assert.equal(clientId, 'client-201');
        assert.equal(orderReference, repairOrderUuid);
        return order;
      },
      async registerClientSupportComment() {
        throw new Error('not used');
      },
      async submitRepairOrderApproval(_repairOrderId: string, request: any) {
        approvals.push(request);
        return {
          result: request.result,
          repair_order_id: repairOrderUuid,
          status_id: '99999999-9999-4999-8999-999999999999',
        };
      },
      async submitRepairOrderRating(_repairOrderId: string, request: any) {
        ratings.push(request);
        return {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          repair_order_id: repairOrderUuid,
          source: 'Telegram' as const,
          grade: request.grade,
          notes: null,
          created_at: '2026-07-14T08:00:00.000Z',
          updated_at: '2026-07-14T08:00:00.000Z',
        };
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
    approvals,
    ratings,
  };
};

const createTestBot = (dependencies = createDependencies()) => {
  const bot = createBot('fake-token', dependencies);
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

  return { bot, apiCalls, dependencies };
};

const callbackUpdate = (
  data: string,
  text: string,
  entities?: unknown[],
  inlineKeyboard: any[][] = [[{ text: 'Open order', callback_data: `dm:ro:o:${repairOrderUuid}` }]],
) => ({
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
        inline_keyboard: inlineKeyboard,
      },
    },
  },
});

const textUpdate = (text: string) => ({
  update_id: Math.floor(Math.random() * 1_000_000),
  message: {
    message_id: 888,
    date: Math.floor(Date.now() / 1000),
    chat: { id: 700201, type: 'private' as const, first_name: 'Ali' },
    from: { id: 700201, is_bot: false, first_name: 'Ali' },
    text,
  },
});

describe('direct message inline repair-order buttons', () => {
  it('sends developers the full CRM not-found report before showing the safe order message', async () => {
    const dependencies = createDependencies();
    dependencies.developerTelegramIds = new Set(['990001', '990002']);
    dependencies.clientRepairOrderService.getClientRepairOrder = async () => {
      throw new ClientRepairOrderError(
        'not_found',
        'Repair order is hidden from this client',
        404,
        'telegram_client_repair_order_not_found',
      );
    };
    const { bot, apiCalls } = createTestBot(dependencies);

    await bot.handleUpdate(
      callbackUpdate(`dm:ro:o:${repairOrderUuid}`, 'Original API message') as any,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));

    const userReply = apiCalls.find(
      (call) => call.method === 'sendMessage' && String(call.payload.chat_id) === '700201',
    );
    assert.ok(userReply);
    assert.match(userReply.payload.text, /buyurtma topilmadi/i);

    for (const developerTelegramId of dependencies.developerTelegramIds) {
      const report = apiCalls
        .filter(
          (call) =>
            call.method === 'sendMessage' && String(call.payload.chat_id) === developerTelegramId,
        )
        .map((call) => String(call.payload.text))
        .join('\n');
      assert.match(report, /DEVELOPER ERROR REPORT/);
      assert.match(
        report,
        /Direct-message repair order was not found or is not visible to the client/,
      );
      assert.match(report, /ClientRepairOrderError/);
      assert.match(report, /Repair order is hidden from this client/);
      assert.match(report, /"code": "not_found"/);
      assert.match(report, /"status": 404/);
      assert.match(report, /telegram_client_repair_order_not_found/);
      assert.match(report, new RegExp(repairOrderUuid));
      assert.match(report, /"client_id": "client-201"/);
      assert.match(report, /"update_id":/);
    }
  });

  it('edits the API message to repair-order detail and restores it on back', async () => {
    const { bot, apiCalls } = createTestBot();
    const originalKeyboard = [
      [{ text: 'Open order', callback_data: `dm:ro:o:${repairOrderUuid}` }],
      [{ text: 'CRM', url: 'https://crm.example.test/orders/1024' }],
    ];

    await bot.handleUpdate(
      callbackUpdate(
        `dm:ro:o:${repairOrderUuid}`,
        'Original API message',
        [{ type: 'bold', offset: 0, length: 8 }],
        originalKeyboard,
      ) as any,
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
    assert.deepEqual(backEdit.payload.reply_markup.inline_keyboard, originalKeyboard);
  });

  it('opens a localized approval action before showing the decision controls and supports Back', async () => {
    const { bot, apiCalls, dependencies } = createTestBot();
    const originalKeyboard = [
      [{ text: 'Approve order', callback_data: `dm:ap:o:${repairOrderUuid}` }],
      [{ text: 'Details', callback_data: `dm:ro:o:${repairOrderUuid}` }],
    ];

    await bot.handleUpdate(
      callbackUpdate(
        `dm:ap:o:${repairOrderUuid}`,
        'Template message',
        undefined,
        originalKeyboard,
      ) as any,
    );

    assert.equal(dependencies.approvals.length, 0);
    const chooser = apiCalls.find((call) => call.method === 'editMessageReplyMarkup');
    assert.ok(chooser);
    assert.deepEqual(
      chooser.payload.reply_markup.inline_keyboard[0].map(
        (button: { callback_data: string }) => button.callback_data,
      ),
      [`dm:ap:r:${repairOrderUuid}`, `dm:ap:a:${repairOrderUuid}`],
    );
    assert.deepEqual(
      chooser.payload.reply_markup.inline_keyboard[0].map(
        (button: { style: string }) => button.style,
      ),
      ['danger', 'success'],
    );

    apiCalls.length = 0;
    await bot.handleUpdate(
      callbackUpdate(
        `dm:ap:b:${repairOrderUuid}`,
        'Template message',
        undefined,
        chooser.payload.reply_markup.inline_keyboard,
      ) as any,
    );
    const restored = apiCalls.find((call) => call.method === 'editMessageText');
    assert.ok(restored);
    assert.equal(restored.payload.text, 'Template message');
    assert.deepEqual(restored.payload.reply_markup.inline_keyboard, originalKeyboard);
  });

  it('opens a localized rating action and removes the complete original action keyboard after rating', async () => {
    const { bot, apiCalls, dependencies } = createTestBot();
    const originalKeyboard = [
      [{ text: 'Rate service', callback_data: `dm:rt:o:${repairOrderUuid}` }],
      [{ text: 'Details', callback_data: `dm:ro:o:${repairOrderUuid}` }],
    ];

    await bot.handleUpdate(
      callbackUpdate(
        `dm:rt:o:${repairOrderUuid}`,
        'Completed service',
        undefined,
        originalKeyboard,
      ) as any,
    );
    const chooser = apiCalls.find((call) => call.method === 'editMessageReplyMarkup');
    assert.ok(chooser);
    assert.equal(chooser.payload.reply_markup.inline_keyboard.length, 3);
    assert.equal(
      chooser.payload.reply_markup.inline_keyboard[1][4].callback_data,
      `dm:rt:10:${repairOrderUuid}`,
    );

    apiCalls.length = 0;
    await bot.handleUpdate(
      callbackUpdate(
        `dm:rt:10:${repairOrderUuid}`,
        'Completed service',
        undefined,
        chooser.payload.reply_markup.inline_keyboard,
      ) as any,
    );

    assert.deepEqual(dependencies.ratings, [{ grade: 10 }]);
    const completed = apiCalls.find((call) => call.method === 'editMessageText');
    assert.ok(completed);
    assert.equal(completed.payload.text, 'Completed service');
    assert.deepEqual(completed.payload.reply_markup.inline_keyboard, []);
  });

  it('requires confirmation before sending a non-idempotent approval', async () => {
    const { bot, apiCalls, dependencies } = createTestBot();
    const approvalKeyboard = [
      [
        { text: 'Reject', callback_data: `dm:ap:r:${repairOrderUuid}` },
        { text: 'Approve', callback_data: `dm:ap:a:${repairOrderUuid}` },
      ],
    ];

    await bot.handleUpdate(
      callbackUpdate(
        `dm:ap:a:${repairOrderUuid}`,
        'Please approve this order',
        undefined,
        approvalKeyboard,
      ) as any,
    );
    assert.equal(dependencies.approvals.length, 0);
    const confirmation = apiCalls.find((call) => call.method === 'editMessageText');
    assert.ok(confirmation);
    assert.match(confirmation.payload.text, /#1024/);
    assert.equal(
      confirmation.payload.reply_markup.inline_keyboard[0][1].callback_data,
      `dm:ap:ca:${repairOrderUuid}`,
    );

    apiCalls.length = 0;
    await bot.handleUpdate(
      callbackUpdate(
        `dm:ap:ca:${repairOrderUuid}`,
        confirmation.payload.text,
        undefined,
        confirmation.payload.reply_markup.inline_keyboard,
      ) as any,
    );

    assert.deepEqual(dependencies.approvals, [{ result: 'approved' }]);
    const completed = apiCalls.find((call) => call.method === 'editMessageText');
    assert.ok(completed);
    assert.equal(completed.payload.text, 'Please approve this order');
    assert.deepEqual(completed.payload.reply_markup.inline_keyboard, []);
    assert.ok(
      apiCalls.some(
        (call) => call.method === 'sendMessage' && /tasdiqlandi/.test(call.payload.text),
      ),
    );
  });

  it('requires and confirms a trimmed rejection explanation', async () => {
    const { bot, apiCalls, dependencies } = createTestBot();
    const approvalKeyboard = [
      [
        { text: 'Reject', callback_data: `dm:ap:r:${repairOrderUuid}` },
        { text: 'Approve', callback_data: `dm:ap:a:${repairOrderUuid}` },
      ],
    ];

    await bot.handleUpdate(
      callbackUpdate(
        `dm:ap:r:${repairOrderUuid}`,
        'Please review this order',
        undefined,
        approvalKeyboard,
      ) as any,
    );
    assert.ok(
      apiCalls.some((call) => call.method === 'sendMessage' && /nega/.test(call.payload.text)),
    );

    apiCalls.length = 0;
    await bot.handleUpdate(textUpdate('  Please use an original display.  ') as any);
    const review = apiCalls.find((call) => call.method === 'editMessageText');
    assert.ok(review);
    assert.match(review.payload.text, /Please use an original display\./);
    assert.equal(dependencies.approvals.length, 0);

    apiCalls.length = 0;
    await bot.handleUpdate(
      callbackUpdate(
        `dm:ap:cr:${repairOrderUuid}`,
        review.payload.text,
        undefined,
        review.payload.reply_markup.inline_keyboard,
      ) as any,
    );

    assert.deepEqual(dependencies.approvals, [
      { result: 'rejected', note: 'Please use an original display.' },
    ]);
    const completed = apiCalls.find((call) => call.method === 'editMessageText');
    assert.ok(completed);
    assert.equal(completed.payload.text, 'Please review this order');
    assert.deepEqual(completed.payload.reply_markup.inline_keyboard, []);
  });

  it('cancels approval safely and restores the exact original keyboard', async () => {
    const { bot, apiCalls, dependencies } = createTestBot();
    const approvalKeyboard = [
      [
        { text: 'Reject', callback_data: `dm:ap:r:${repairOrderUuid}` },
        { text: 'Approve', callback_data: `dm:ap:a:${repairOrderUuid}` },
      ],
      [{ text: 'Details', callback_data: `dm:ro:o:${repairOrderUuid}` }],
    ];

    await bot.handleUpdate(
      callbackUpdate(
        `dm:ap:a:${repairOrderUuid}`,
        'Please decide',
        undefined,
        approvalKeyboard,
      ) as any,
    );
    apiCalls.length = 0;
    await bot.handleUpdate(callbackUpdate(`dm:ap:b:${repairOrderUuid}`, 'Confirmation') as any);

    assert.equal(dependencies.approvals.length, 0);
    const restored = apiCalls.find((call) => call.method === 'editMessageText');
    assert.ok(restored);
    assert.equal(restored.payload.text, 'Please decide');
    assert.deepEqual(restored.payload.reply_markup.inline_keyboard, approvalKeyboard);
  });

  it('removes stale approval controls when CRM no longer requires action', async () => {
    const noLongerPending: CustomerRepairOrderDetail = {
      ...detail,
      initial_problems_approval: { status: 'approved', requires_action: false, note: null },
    };
    const dependencies = createDependencies(noLongerPending);
    const { bot, apiCalls } = createTestBot(dependencies);

    await bot.handleUpdate(
      callbackUpdate(`dm:ap:a:${repairOrderUuid}`, 'Please decide', undefined, [
        [{ text: 'Approve', callback_data: `dm:ap:a:${repairOrderUuid}` }],
      ]) as any,
    );

    assert.equal(dependencies.approvals.length, 0);
    const completed = apiCalls.find((call) => call.method === 'editMessageText');
    assert.ok(completed);
    assert.deepEqual(completed.payload.reply_markup.inline_keyboard, []);
    assert.ok(
      apiCalls.some(
        (call) =>
          call.method === 'sendMessage' && /endi tasdiqlashni kutmayapti/.test(call.payload.text),
      ),
    );
  });

  it('submits a rating only after re-authorizing the repair order and removes the controls', async () => {
    const { bot, apiCalls, dependencies } = createTestBot();
    await bot.handleUpdate(
      callbackUpdate(`dm:rt:10:${repairOrderUuid}`, 'Rate our service', undefined, [
        [1, 2, 3, 4, 5].map((grade) => ({
          text: String(grade),
          callback_data: `dm:rt:${grade}:${repairOrderUuid}`,
        })),
        [6, 7, 8, 9, 10].map((grade) => ({
          text: String(grade),
          callback_data: `dm:rt:${grade}:${repairOrderUuid}`,
        })),
      ]) as any,
    );

    assert.deepEqual(dependencies.ratings, [{ grade: 10 }]);
    const keyboardEdit = apiCalls.find((call) => call.method === 'editMessageReplyMarkup');
    assert.ok(keyboardEdit);
    assert.deepEqual(keyboardEdit.payload.reply_markup.inline_keyboard, []);
    assert.ok(
      apiCalls.some((call) => call.method === 'sendMessage' && /10\/10/.test(call.payload.text)),
    );
  });
});
