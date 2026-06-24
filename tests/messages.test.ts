import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { t } from '../src/bot/messages.js';

describe('localized bot messages', () => {
  it('does not expose role wording to registered clients', () => {
    assert.equal(
      t('uz', 'registered', { name: 'Shaxzod' }),
      '✅ Shaxzod, profilingiz topildi.\n\nMenyudan buyurtmalaringiz va profil sozlamalarini boshqarishingiz mumkin.',
    );
    assert.equal(
      t('ru', 'registered', { name: 'Шахзод' }),
      '✅ Шахзод, ваш профиль найден.\n\nВ меню доступны ваши заказы и настройки профиля.',
    );
    assert.equal(
      t('uz', 'clientHelp'),
      'Menyudan buyurtmalaringizni ko‘rishingiz va profil sozlamalarini yangilashingiz mumkin.',
    );
    assert.equal(
      t('ru', 'clientHelp'),
      'В меню можно смотреть свои заказы и обновлять настройки профиля.',
    );
  });
});
