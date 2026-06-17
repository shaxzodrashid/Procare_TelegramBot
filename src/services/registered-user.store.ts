import type { Knex } from 'knex';

import type {
  RegisteredClientRecord,
  RegisteredEmployeeRecord,
  RegisteredUserSettingsUpdate,
  RegisteredTelegramUserRecord,
} from '../types/registered-user.js';

export interface RegisteredUserStore {
  saveClient(record: RegisteredClientRecord): Promise<void>;
  saveEmployee(record: RegisteredEmployeeRecord): Promise<void>;
  updateSettings(update: RegisteredUserSettingsUpdate): Promise<void>;
}

type ReturnedUserId = { id?: unknown } | string | number;

const parseReturnedUserId = (rows: ReturnedUserId[]): string => {
  const first = rows[0];
  const id = typeof first === 'object' && first !== null ? first.id : first;
  if (typeof id === 'string' || typeof id === 'number') return String(id);
  throw new Error('Database did not return a user ID');
};

export class PostgresRegisteredUserStore implements RegisteredUserStore {
  constructor(private readonly database: Knex) {}

  async saveClient(record: RegisteredClientRecord): Promise<void> {
    await this.database.transaction(async (trx) => {
      const userId = await this.upsertUser(trx, record);

      await trx('clients')
        .insert({
          user_id: userId,
          crm_client_id: record.crm_client_id,
          customer_code: record.customer_code,
          status: record.status,
          is_active: record.is_active,
        })
        .onConflict('user_id')
        .merge({
          crm_client_id: record.crm_client_id,
          customer_code: record.customer_code,
          status: record.status,
          is_active: record.is_active,
          updated_at: trx.fn.now(),
        });

      await trx('employees').where({ user_id: userId }).delete();
    });
  }

  async saveEmployee(record: RegisteredEmployeeRecord): Promise<void> {
    await this.database.transaction(async (trx) => {
      const userId = await this.upsertUser(trx, record);

      await trx('employees')
        .insert({
          user_id: userId,
          crm_admin_id: record.crm_admin_id,
          status: record.status,
          is_active: record.is_active,
        })
        .onConflict('user_id')
        .merge({
          crm_admin_id: record.crm_admin_id,
          status: record.status,
          is_active: record.is_active,
          updated_at: trx.fn.now(),
        });

      await trx('clients').where({ user_id: userId }).delete();
    });
  }

  async updateSettings(update: RegisteredUserSettingsUpdate): Promise<void> {
    const payload: Record<string, unknown> = {
      updated_at: this.database.fn.now(),
    };

    if ('telegram_username' in update) payload.telegram_username = update.telegram_username;
    if ('first_name' in update) payload.first_name = update.first_name;
    if ('last_name' in update) payload.last_name = update.last_name;
    if ('locale' in update) payload.language_code = update.locale;

    await this.database('users').where({ telegram_id: update.telegram_id }).update(payload);
  }

  private async upsertUser(
    database: Knex.Transaction,
    record: RegisteredTelegramUserRecord,
  ): Promise<string> {
    const rows = (await database('users')
      .insert({
        telegram_id: record.telegram_id,
        telegram_username: record.telegram_username,
        first_name: record.first_name,
        last_name: record.last_name,
        phone_number: record.phone_number,
        language_code: record.locale,
        is_blocked: false,
        last_decline_reason: null,
        declined_at: null,
      })
      .onConflict('telegram_id')
      .merge({
        telegram_username: record.telegram_username,
        first_name: record.first_name,
        last_name: record.last_name,
        phone_number: record.phone_number,
        language_code: record.locale,
        is_blocked: false,
        last_decline_reason: null,
        declined_at: null,
        updated_at: database.fn.now(),
      })
      .returning('id')) as ReturnedUserId[];

    return parseReturnedUserId(rows);
  }
}
