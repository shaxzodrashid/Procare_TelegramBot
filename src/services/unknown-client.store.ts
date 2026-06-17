import type { Knex } from 'knex';

import type { UnknownClientRecord } from '../types/unknown-client.js';

export interface UnknownClientStore {
  save(record: UnknownClientRecord): Promise<void>;
  deleteByTelegramId(telegramId: string): Promise<void>;
}

export class PostgresUnknownClientStore implements UnknownClientStore {
  constructor(private readonly database: Knex) {}

  async save(record: UnknownClientRecord): Promise<void> {
    await this.database('users')
      .insert({
        telegram_id: record.telegram_id,
        telegram_username: record.telegram_username,
        first_name: record.first_name,
        last_name: record.last_name,
        phone_number: record.phone_number,
        language_code: record.locale,
        is_blocked: false,
        last_decline_reason: record.reason,
        declined_at: new Date(record.saved_at),
      })
      .onConflict('telegram_id')
      .merge({
        telegram_username: record.telegram_username,
        first_name: record.first_name,
        last_name: record.last_name,
        phone_number: record.phone_number,
        language_code: record.locale,
        is_blocked: false,
        last_decline_reason: record.reason,
        declined_at: new Date(record.saved_at),
        updated_at: this.database.fn.now(),
      });
  }

  async deleteByTelegramId(telegramId: string): Promise<void> {
    await this.database('users').where({ telegram_id: telegramId }).delete();
  }
}
