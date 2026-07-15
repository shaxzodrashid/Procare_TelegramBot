/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createBot } from '../src/bot/create-bot.js';
import type { BotDependencies } from '../src/bot/create-bot.js';
import { t } from '../src/bot/messages.js';
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

const detail: CustomerRepairOrderDetail = {
  id: '11111111-1111-4111-8111-111111111111',
  order_number: '1024',
  assigned_admins: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      first_name: 'Master',
      last_name: 'One',
      phone_number: '+998901111111',
      roles: [{ id: '44444444-4444-4444-8444-444444444444', name: 'Master', type: 'Master' }],
    },
  ],
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
  problem_summary: { uz: null, ru: null, en: null },
  service_summary: { uz: null, ru: null, en: null },
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
  initial_problems_approval: { status: 'approved', requires_action: false, note: null },
};

const createDependencies = (): BotDependencies & {
  dispatches: any[];
  supportSaves: any[];
  supportRequests: any[];
  listCalls: any[];
} => {
  const dispatches: any[] = [];
  const supportSaves: any[] = [];
  const supportRequests: any[] = [];
  const listCalls: any[] = [];

  return {
    registrationService: {} as any,
    repairOrderService: {} as any,
    clientRepairOrderService: {
      async listClientRepairOrders(...args: any[]) {
        listCalls.push(args);
        return {
          orders: [
            {
              order_number: detail.order_number,
              device: { brand: detail.device.brand, model: detail.device.model },
              status: detail.status,
              created_at: detail.created_at,
              estimated_ready_at: detail.estimated_ready_at,
              pricing: {
                currency: detail.pricing.currency,
                final_total: detail.pricing.final_total,
                payment_status: detail.pricing.payment_status,
              },
            },
          ],
          pagination: { limit: 10, offset: 0, total: 1, has_more: false },
        };
      },
      async getClientRepairOrder() {
        return detail;
      },
      async registerClientSupportComment(repairOrderId: string, request: any) {
        supportRequests.push({ repairOrderId, request });
        return {
          created: true,
          comment: {
            item_type: 'message',
            id: '22222222-2222-4222-8222-222222222222',
            comment_type: 'support',
            author_type: 'user',
            direction: 'inbound',
            text: 'Screen is broken',
            author: {
              id: '55555555-5555-4555-8555-555555555555',
              display_name: 'Ali Valiyev',
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
        };
      },
      async submitRepairOrderApproval() {
        throw new Error('not used');
      },
      async submitRepairOrderRating() {
        throw new Error('not used');
      },
    },
    unknownClientStore: {} as any,
    registeredUserStore: {} as any,
    messageTemplateStore: {
      async logDispatch(record: any) {
        dispatches.push(record);
      },
      async setUserBlocked() {
        return undefined;
      },
    } as any,
    supportMessageStore: {
      async save(record: any) {
        supportSaves.push(record);
      },
    } as any,
    logger,
    allowManualPhoneEntry: true,
    richMessagesEnabled: false,
    dispatches,
    supportSaves,
    supportRequests,
    listCalls,
  };
};

describe('support admin notification flow', () => {
  it('notifies assigned admins without revealing the client support message', async () => {
    const deps = createDependencies();
    const registeredUserStore = {
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
      async findActiveEmployeesByCrmAdminIds(crmAdminIds: string[]) {
        assert.deepEqual(crmAdminIds, ['33333333-3333-4333-8333-333333333333']);
        return [
          {
            id: '301',
            telegram_id: '800301',
            crm_admin_id: '33333333-3333-4333-8333-333333333333',
            locale: 'uz' as const,
            is_blocked: false,
          },
        ];
      },
    };
    deps.registeredUserStore = registeredUserStore as any;
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
      if (method === 'deleteMessage') return { ok: true, result: true } as any;
      return {
        ok: true,
        result: {
          message_id: 1000 + apiCalls.length,
          date: Math.floor(Date.now() / 1000),
          chat: { id: Number(payload.chat_id), type: 'private' },
          text: payload.text,
        },
      } as any;
    });

    const clientMessage = {
      message_id: 10,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 700201, type: 'private' as const, first_name: 'Ali' },
      from: { id: 700201, is_bot: false, first_name: 'Ali' },
    };

    await bot.handleUpdate({
      update_id: 1,
      message: { ...clientMessage, text: '📦 Mening buyurtmalarim' },
    } as any);
    await bot.handleUpdate({
      update_id: 2,
      callback_query: {
        id: 'q2',
        from: clientMessage.from,
        chat_instance: 'instance_1',
        data: 'ro:v:0:0',
        message: clientMessage,
      },
    } as any);
    await bot.handleUpdate({
      update_id: 3,
      callback_query: {
        id: 'q3',
        from: clientMessage.from,
        chat_instance: 'instance_1',
        data: 'ro:s',
        message: clientMessage,
      },
    } as any);
    await bot.handleUpdate({
      update_id: 4,
      message: { ...clientMessage, message_id: 11, text: 'Screen is broken' },
    } as any);

    const adminNotification = apiCalls.find(
      (call) => call.method === 'sendMessage' && String(call.payload.chat_id) === '800301',
    );
    assert.ok(adminNotification);
    assert.match(adminNotification.payload.text, /#1024/);
    assert.match(adminNotification.payload.text, /11111111-1111-4111-8111-111111111111/);
    assert.match(adminNotification.payload.text, /CRM/);
    assert.equal(adminNotification.payload.parse_mode, 'HTML');
    assert.equal(adminNotification.payload.text.includes('Screen is broken'), false);
    assert.equal(adminNotification.payload.text.includes('Ali Valiyev'), false);
    assert.equal(adminNotification.payload.text.includes('+998901234567'), false);

    const notificationDispatch = deps.dispatches.find(
      (dispatch) => dispatch.dispatch_type === 'support_comment_admin_notification',
    );
    assert.ok(notificationDispatch);
    assert.equal(notificationDispatch.status, 'sent');
    assert.equal(notificationDispatch.user_id, '301');
  });

  it('keeps support chat active and routes menu labels to CRM until the client ends it', async () => {
    const deps = createDependencies();
    deps.registeredUserStore = {
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
      async findActiveEmployeesByCrmAdminIds() {
        return [];
      },
    } as any;
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
      if (method === 'deleteMessage') return { ok: true, result: true } as any;
      return {
        ok: true,
        result: {
          message_id: 1000 + apiCalls.length,
          date: Math.floor(Date.now() / 1000),
          chat: { id: Number(payload.chat_id), type: 'private' },
          text: payload.text,
        },
      } as any;
    });

    const baseMessage = {
      message_id: 10,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 700201, type: 'private' as const, first_name: 'Ali' },
      from: { id: 700201, is_bot: false, first_name: 'Ali' },
    };

    await bot.handleUpdate({
      update_id: 1,
      message: { ...baseMessage, text: '📦 Mening buyurtmalarim' },
    } as any);
    await bot.handleUpdate({
      update_id: 2,
      callback_query: {
        id: 'q2',
        from: baseMessage.from,
        chat_instance: 'instance_1',
        data: 'ro:v:0:0',
        message: baseMessage,
      },
    } as any);
    await bot.handleUpdate({
      update_id: 3,
      callback_query: {
        id: 'q3',
        from: baseMessage.from,
        chat_instance: 'instance_1',
        data: 'ro:s',
        message: baseMessage,
      },
    } as any);

    await bot.handleUpdate({
      update_id: 4,
      message: { ...baseMessage, message_id: 11, text: 'First support message' },
    } as any);
    await bot.handleUpdate({
      update_id: 5,
      message: { ...baseMessage, message_id: 12, text: '📦 Mening buyurtmalarim' },
    } as any);

    assert.equal(deps.supportRequests.length, 2);
    assert.equal(deps.supportRequests[0].repairOrderId, detail.id);
    assert.equal(deps.supportRequests[0].request.text, 'First support message');
    assert.equal(deps.supportRequests[1].request.text, '📦 Mening buyurtmalarim');
    assert.equal(deps.listCalls.length, 1);

    const supportReactions = apiCalls.filter(
      (call) => call.method === 'setMessageReaction' && call.payload.reaction?.[0]?.emoji === '👍',
    );
    assert.equal(supportReactions.length, 2);

    const keyboardMessage = apiCalls.find(
      (call) => call.method === 'sendMessage' && call.payload.reply_markup?.keyboard,
    );
    assert.ok(keyboardMessage);
    assert.deepEqual(keyboardMessage.payload.reply_markup.keyboard, [
      [{ text: t('uz', 'supportEndChat') }],
    ]);

    await bot.handleUpdate({
      update_id: 6,
      message: { ...baseMessage, message_id: 13, text: t('uz', 'supportEndChat') },
    } as any);
    await bot.handleUpdate({
      update_id: 7,
      message: { ...baseMessage, message_id: 14, text: '📦 Mening buyurtmalarim' },
    } as any);

    assert.equal(deps.supportRequests.length, 2);
    assert.equal(deps.listCalls.length, 2);
  });

  it('activates the exact stored order thread when an inactive client replies to a CRM message', async () => {
    const deps = createDependencies();
    deps.registeredUserStore = {
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
      async findActiveEmployeesByCrmAdminIds() {
        return [];
      },
    } as any;
    deps.supportMessageStore = {
      async findByTelegramMessageId(messageId: number, chatId: string) {
        assert.equal(messageId, 500);
        assert.equal(chatId, '700201');
        return {
          crm_comment_id: '22222222-2222-4222-8222-222222222222',
          crm_client_id: 'client-201',
          repair_order_id: detail.id,
          order_number: detail.order_number,
          user_id: '201',
          telegram_id: '700201',
          telegram_chat_id: '700201',
          telegram_message_id: 500,
          telegram_message_date: new Date('2026-07-15T08:00:00.000Z'),
          sender_type: 'employee' as const,
          direction: 'outbound' as const,
          content_type: 'text' as const,
          text: 'CRM asked for clarification',
          photo_count: 0,
          reply_to_support_message_id: null,
        };
      },
      async findReplyTargetByCrmCommentId() {
        return {
          id: '501',
          telegram_id: '700201',
          telegram_chat_id: '700201',
          telegram_message_id: 500,
          repair_order_id: detail.id,
          order_number: detail.order_number,
          crm_client_id: 'client-201',
        };
      },
      async save(record: any) {
        deps.supportSaves.push(record);
      },
    };

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
      return {
        ok: true,
        result: {
          message_id: 1000 + apiCalls.length,
          date: Math.floor(Date.now() / 1000),
          chat: { id: Number(payload.chat_id), type: 'private' },
          text: payload.text,
        },
      } as any;
    });

    const baseMessage = {
      date: Math.floor(Date.now() / 1000),
      chat: { id: 700201, type: 'private' as const, first_name: 'Ali' },
      from: { id: 700201, is_bot: false, first_name: 'Ali' },
    };
    await bot.handleUpdate({
      update_id: 90,
      message: {
        ...baseMessage,
        message_id: 501,
        text: 'Here are the requested details',
        reply_to_message: {
          ...baseMessage,
          message_id: 500,
          from: { id: 99999, is_bot: true, first_name: 'TestBot' },
          text: 'CRM asked for clarification',
        },
      },
    } as any);

    assert.equal(deps.supportRequests.length, 1);
    assert.deepEqual(deps.supportRequests[0], {
      repairOrderId: detail.id,
      request: {
        text: 'Here are the requested details',
        photos: [],
        replyTargetType: 'comment',
        replyTargetId: '22222222-2222-4222-8222-222222222222',
      },
    });
    assert.ok(
      apiCalls.some(
        (call) =>
          call.method === 'sendMessage' &&
          call.payload.text.includes('Javobingiz #1024 buyurtma suhbatiga yuborildi'),
      ),
    );

    await bot.handleUpdate({
      update_id: 91,
      message: { ...baseMessage, message_id: 502, text: 'One more detail' },
    } as any);
    assert.equal(deps.supportRequests.length, 2);
    assert.equal(deps.supportRequests[1].request.text, 'One more detail');
  });
});
