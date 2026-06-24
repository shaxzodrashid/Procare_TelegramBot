import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildRepairDescription,
  formatCategoryPage,
  formatClientRepairOrderDetail,
  formatClientRepairOrderList,
  formatRepairRequestSummary,
} from '../src/bot/formatters.js';
import { categoryKeyboard } from '../src/bot/keyboards.js';
import type { RepairRequestDraft } from '../src/bot/context.js';
import type { PhoneCategory } from '../src/types/repair-order.js';

const category = (index: number): PhoneCategory => ({
  id: `category-${index}`,
  name_uz: `Model ${index}`,
  name_ru: `Модель ${index}`,
  name_en: `Model ${index}`,
  telegram_sticker: null,
  phone_os_type_id: 'os-id',
  parent_id: null,
  sort: index,
  has_children: false,
  has_problems: true,
});

describe('repair request presentation', () => {
  it('shows ten phone categories per page and uses their numbered order as buttons', () => {
    const categories = Array.from({ length: 12 }, (_, index) => category(index + 1));

    const text = formatCategoryPage(categories, 1, 'uz');
    const keyboard = categoryKeyboard(categories.length, 1, 'uz');

    assert.equal(text, '11. Model 11\n12. Model 12');
    assert.deepEqual(
      keyboard.inline_keyboard.flat().map((button) => button.text),
      ['11', '12', '‹', '⬅️ Orqaga'],
    );
  });

  it('builds a localized description and complete confirmation summary', () => {
    const selectedCategory = category(2);
    const draft: RepairRequestDraft = {
      osTypes: [],
      selectedOs: {
        id: 'os-id',
        name_uz: 'Android',
        name_ru: 'Android',
        name_en: 'Android',
        sort: 1,
      },
      categoryPath: [category(1)],
      categories: [selectedCategory],
      categoryPage: 0,
      selectedCategory,
      problems: [
        {
          id: 'problem-1',
          name_uz: 'Ekran',
          name_ru: 'Экран',
          name_en: 'Screen',
          parent_id: null,
          price: '100',
          cost: '150',
          estimated_minutes: 60,
          warranty_period: 3,
          sort: 1,
        },
      ],
      selectedProblemIds: ['problem-1'],
      note: 'Shisha singan',
      submitting: false,
    };

    assert.equal(buildRepairDescription(draft, 'uz'), 'Muammolar: Ekran\nIzoh: Shisha singan');
    assert.match(
      formatRepairRequestSummary(
        {
          phoneNumber: '+998901234567',
          firstName: 'Ali',
          lastName: 'Valiyev',
          username: 'ali',
        },
        draft,
        'uz',
      ),
      /Model 1 → Model 2/,
    );
  });
});

describe('client repair-order presentation', () => {
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

  const listOrder = {
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

  it('shows localized status names, progress, order number, and price in list cards', () => {
    const formatted = formatClientRepairOrderList(
      {
        orders: [listOrder],
        pagination: { limit: 10, offset: 0, total: 1, has_more: false },
      },
      'uz',
    );

    assert.match(formatted.fallbackHtml, /Ta’mirlash jarayonida/);
    assert.match(formatted.fallbackHtml, /#1024/);
    assert.match(formatted.richHtml, /●●●●○○○ 4\/7/);
    assert.doesNotMatch(formatted.fallbackHtml, /IN_REPAIR/);
  });

  it('falls back to the stable status code when all localized names are absent', () => {
    const formatted = formatClientRepairOrderList(
      {
        orders: [
          {
            ...listOrder,
            status: { ...status, name_uz: null, name_ru: null, name_en: null },
          },
        ],
        pagination: { limit: 10, offset: 0, total: 1, has_more: false },
      },
      'ru',
    );

    assert.match(formatted.fallbackHtml, /IN_REPAIR/);
  });

  it('renders customer-safe detail fields without exposing a full IMEI', () => {
    const formatted = formatClientRepairOrderDetail(
      {
        ...listOrder,
        id: '11111111-1111-4111-8111-111111111111',
        updated_at: '2026-06-18T10:00:00.000Z',
        device: { ...listOrder.device, imei_last4: '5678' },
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
          ...listOrder.pricing,
          estimated_total: null,
          paid_amount: '100000.00',
          remaining_amount: '250000.00',
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
          working_hours: { start: '09:00', end: '18:00' },
          map_url: null,
        },
        completed_at: null,
        picked_up_at: null,
        warranty: { period_months: 3, warranty_until: null },
        documents: {
          checklist_url: 'https://crm.test/documents/checklist/1024',
          warranty_document_url: null,
          offer_url: null,
        },
        status_history: [],
      },
      'uz',
    );

    assert.match(formatted.fallbackHtml, /Qurilmangiz ta’mirlanmoqda/);
    assert.match(formatted.fallbackHtml, /📱 Apple iPhone 14 Pro/);
    assert.match(formatted.fallbackHtml, /── Ta’mirlash ──/);
    assert.match(formatted.fallbackHtml, /•••• 5678/);
    assert.match(formatted.fallbackHtml, /3 oy/);
    assert.match(formatted.fallbackHtml, /09:00–18:00/);
    assert.match(formatted.fallbackHtml, /Ta’mirlash summasi:<\/b> 350[^\d]*000/);
    assert.doesNotMatch(formatted.fallbackHtml, /To‘lov|To‘lanmagan|Taxminiy|To‘langan|Qoldiq/);
    assert.doesNotMatch(formatted.fallbackHtml, /\d{15}/);
  });

  it('does not render status history in order details', () => {
    const formatted = formatClientRepairOrderDetail(
      {
        ...listOrder,
        id: '11111111-1111-4111-8111-111111111111',
        updated_at: '2026-06-18T10:00:00.000Z',
        device: { ...listOrder.device, imei_last4: null },
        status: {
          ...status,
          customer_message_uz: null,
          customer_message_ru: null,
          customer_message_en: null,
        },
        pricing: {
          ...listOrder.pricing,
          estimated_total: null,
          paid_amount: '0',
          remaining_amount: '350000.00',
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
        documents: {
          checklist_url: null,
          warranty_document_url: null,
          offer_url: null,
        },
        status_history: [
          {
            code: 'RECEIVED',
            name_uz: 'Qabul qilindi',
            name_ru: 'Принят',
            name_en: 'Received',
            progress_type: 'linear',
            step: 1,
            total_steps: 7,
            changed_at: '2026-06-14T11:20:00.000Z',
          },
        ],
      },
      'uz',
    );

    assert.doesNotMatch(formatted.fallbackHtml, /Holatlar tarixi|RECEIVED/);
    assert.doesNotMatch(formatted.richHtml, /Holatlar tarixi|RECEIVED/);
  });

  it('shows only the final repair total when payment rows are present', () => {
    const formatted = formatClientRepairOrderDetail(
      {
        ...listOrder,
        id: '11111111-1111-4111-8111-111111111111',
        updated_at: '2026-06-18T10:00:00.000Z',
        device: { ...listOrder.device, imei_last4: null },
        status: {
          ...status,
          customer_message_uz: null,
          customer_message_ru: null,
          customer_message_en: null,
        },
        pricing: {
          ...listOrder.pricing,
          estimated_total: null,
          paid_amount: '100000.00',
          remaining_amount: '250000.00',
          payments: [
            {
              amount: '100000.00',
              currency: 'UZS',
              method: 'card',
              paid_at: '2026-06-18T09:00:00.000Z',
            },
          ],
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
        documents: {
          checklist_url: null,
          warranty_document_url: null,
          offer_url: null,
        },
        status_history: [],
      },
      'ru',
    );

    assert.match(formatted.fallbackHtml, /Стоимость ремонта:<\/b> 350[^\d]*000/);
    assert.doesNotMatch(
      formatted.fallbackHtml,
      /Оплата|История платежей|Частично оплачено|Предварительно|Остаток|card/,
    );
    assert.doesNotMatch(formatted.fallbackHtml, /Неисправность: —/);
  });
});
