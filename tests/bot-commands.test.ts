import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canRegisterWithManualPhone,
  localizedBotCommands,
  parseSettingsName,
  registrationAccountKind,
} from '../src/bot/create-bot.js';
import type { BotSession } from '../src/bot/context.js';

describe('bot command metadata', () => {
  it('builds localized Telegram menu commands', () => {
    assert.deepEqual(
      localizedBotCommands('uz').map((command) => command.command),
      ['start', 'help', 'logout'],
    );
    assert.deepEqual(
      localizedBotCommands('ru').map((command) => command.description),
      ['✨ Начать или перезапустить Procare', '💬 Получить помощь', '👋 Выйти из системы'],
    );
  });
});

describe('settings name parsing', () => {
  it('normalizes whitespace and splits first and last name', () => {
    assert.deepEqual(parseSettingsName('  Ali   Valiyev  '), {
      firstName: 'Ali',
      lastName: 'Valiyev',
      fullName: 'Ali Valiyev',
    });
  });

  it('allows a single display name', () => {
    assert.deepEqual(parseSettingsName('Ali'), {
      firstName: 'Ali',
      lastName: null,
      fullName: 'Ali',
    });
  });

  it('rejects empty, punctuation-only, and overlong names', () => {
    assert.equal(parseSettingsName(' '), null);
    assert.equal(parseSettingsName('---'), null);
    assert.equal(parseSettingsName('A'.repeat(121)), null);
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
        account_type: 'client',
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
        is_admin: false,
        admin: null,
        created_at: '2026-06-15T10:00:00.000Z',
        updated_at: '2026-06-15T10:00:00.000Z',
        created_by: null,
        repair_orders: [],
      },
    };

    assert.equal(canRegisterWithManualPhone(session, true), false);
  });

  it('does not allow typed phone numbers for admin sessions', () => {
    const session: BotSession = {
      locale: 'uz',
      stage: 'awaiting_phone',
      admin: {
        id: 'admin-1',
        first_name: 'Ali',
        last_name: null,
        phone_number: '+998901234567',
        phone_verified: true,
        language: 'uz',
        status: 'Open',
        is_active: true,
        created_at: '2026-06-15T10:00:00.000Z',
        updated_at: '2026-06-15T10:00:00.000Z',
      },
    };

    assert.equal(canRegisterWithManualPhone(session, true), false);
  });
});

describe('registration account classification', () => {
  it('treats is_admin registration responses as employees', () => {
    assert.equal(
      registrationAccountKind({
        account_type: 'admin',
        is_admin: true,
        admin: {
          id: 'admin-1',
          first_name: 'Ali',
          last_name: null,
          phone_number: '+998901234567',
          phone_verified: true,
          language: 'uz',
          status: 'Open',
          is_active: true,
          created_at: '2026-06-15T10:00:00.000Z',
          updated_at: '2026-06-15T10:00:00.000Z',
        },
      }),
      'employee',
    );
  });
});
