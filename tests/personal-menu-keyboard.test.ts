import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { personalMenuKeyboard } from '../src/bot/keyboards.js';

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

    assert.deepEqual(keyboardLabels(keyboard), [['🧾 Buyurtmalarim'], ['🇷🇺 Русский']]);
  });

  it('shows the employee menu for admins', () => {
    const keyboard = personalMenuKeyboard({
      locale: 'ru',
      admin: { id: 'admin-1' },
    });

    assert.deepEqual(keyboardLabels(keyboard), [['🇺🇿 O‘zbekcha']]);
  });

  it('keeps client actions when client data is present with admin data', () => {
    const keyboard = personalMenuKeyboard({
      locale: 'ru',
      client: { account_type: 'client' },
      admin: { id: 'admin-1' },
    });

    assert.deepEqual(keyboardLabels(keyboard), [['🧾 Мои заказы'], ['🇺🇿 O‘zbekcha']]);
  });
});
