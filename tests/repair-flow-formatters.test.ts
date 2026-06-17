import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildRepairDescription,
  formatCategoryPage,
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
