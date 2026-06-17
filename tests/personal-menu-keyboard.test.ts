import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  personalMenuKeyboard,
  settingsKeyboard,
  settingsLanguageKeyboard,
  settingsPhoneKeyboard,
} from '../src/bot/keyboards.js';

const keyboardLabels = (keyboard: ReturnType<typeof personalMenuKeyboard>): string[][] =>
  keyboard.keyboard.map((row) =>
    row.map((button) => (typeof button === 'string' ? button : button.text)),
  );

describe('personal menu keyboard', () => {
  it('shows repair orders and language options for clients', () => {
    const keyboard = personalMenuKeyboard({
      locale: 'uz',
      client: { account_type: 'client' },
    });

    assert.deepEqual(keyboardLabels(keyboard), [['🧾 Buyurtmalarim'], ['⚙️ Sozlamalar']]);
  });

  it('shows the employee menu for admins', () => {
    const keyboard = personalMenuKeyboard({
      locale: 'ru',
      admin: { id: 'admin-1' },
    });

    assert.deepEqual(keyboardLabels(keyboard), [['🧩 Шаблоны сообщений'], ['⚙️ Настройки']]);
  });

  it('keeps client actions when client data is present with admin data', () => {
    const keyboard = personalMenuKeyboard({
      locale: 'ru',
      client: { account_type: 'client' },
      admin: { id: 'admin-1' },
    });

    assert.deepEqual(keyboardLabels(keyboard), [['🧾 Мои заказы'], ['⚙️ Настройки']]);
  });

  it('shows professional settings sections', () => {
    const keyboard = settingsKeyboard('uz');

    assert.deepEqual(keyboardLabels(keyboard), [
      ['👤 Ism', '📱 Telefon raqami'],
      ['🌐 Til'],
      ['⬅️ Menyuga qaytish'],
    ]);
  });

  it('uses contact ownership control for settings phone updates', () => {
    const keyboard = settingsPhoneKeyboard('ru');

    assert.deepEqual(keyboardLabels(keyboard), [
      ['📱 Поделиться номером'],
      ['⬅️ Вернуться в меню'],
    ]);
  });

  it('offers both language choices inside settings', () => {
    const keyboard = settingsLanguageKeyboard('ru');

    assert.deepEqual(keyboardLabels(keyboard), [
      ['🇺🇿 O‘zbekcha', '🇷🇺 Русский'],
      ['⬅️ Вернуться в меню'],
    ]);
  });
});
