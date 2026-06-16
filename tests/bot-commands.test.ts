import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { canRegisterWithManualPhone, localizedBotCommands } from '../src/bot/create-bot.js';
import type { BotSession } from '../src/bot/context.js';

describe('bot command metadata', () => {
  it('builds localized Telegram menu commands', () => {
    assert.deepEqual(
      localizedBotCommands('uz').map((command) => command.command),
      ['start', 'help', 'logout'],
    );
    assert.deepEqual(
      localizedBotCommands('ru').map((command) => command.description),
      ['Начать или перезапустить бота', 'Получить помощь', 'Выйти из системы'],
    );
  });
});

describe('manual phone registration gate', () => {
  it('allows typed phone numbers only while awaiting phone in development mode', () => {
    const session: BotSession = { locale: 'uz', stage: 'awaiting_phone' };

    assert.equal(canRegisterWithManualPhone(session, true), true);
    assert.equal(canRegisterWithManualPhone(session, false), false);
  });

  it('does not allow typed phone numbers for registered sessions', () => {
    const session: BotSession = {
      locale: 'uz',
      stage: 'awaiting_phone',
      client: {
        id: 'client-1',
        customer_code: null,
        first_name: 'Ali',
        last_name: null,
        phone_number1: '+998901234567',
        phone_number2: null,
        phone_verified: true,
        passport_series: null,
        birth_date: null,
        id_card_number: null,
        language: null,
        telegram_chat_id: null,
        telegram_username: null,
        source: 'crm',
        status: 'active',
        is_active: true,
        created_at: '2026-06-15T10:00:00.000Z',
        updated_at: '2026-06-15T10:00:00.000Z',
        created_by: null,
        repair_orders: [],
      },
    };

    assert.equal(canRegisterWithManualPhone(session, true), false);
  });
});
