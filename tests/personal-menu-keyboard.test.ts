import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  personalMenuKeyboard,
  repairOrderDetailKeyboard,
  repairOrdersKeyboard,
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

  it('builds indexed order callbacks with pagination and refresh controls', () => {
    const keyboard = repairOrdersKeyboard(
      ['1024', '1025'],
      { limit: 10, offset: 10, has_more: true },
      'uz',
    );

    assert.deepEqual(
      keyboard.inline_keyboard.flat().map((button) => ({
        text: button.text,
        callback_data: 'callback_data' in button ? button.callback_data : undefined,
      })),
      [
        { text: '🧾 #1024', callback_data: 'ro:v:10:0' },
        { text: '🧾 #1025', callback_data: 'ro:v:10:1' },
        { text: '‹', callback_data: 'ro:p:0' },
        { text: '›', callback_data: 'ro:p:20' },
        { text: '🔄 Yangilash', callback_data: 'ro:p:10' },
      ],
    );
  });

  it('adds a safe map action to the detail controls', () => {
    const keyboard = repairOrderDetailKeyboard('ru', {
      mapUrl: 'https://maps.example.test/branch',
    });

    assert.equal(keyboard.inline_keyboard[1]?.[0]?.text, '📍 Открыть на карте');
  });
});
