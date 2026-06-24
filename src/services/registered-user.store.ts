import type { Knex } from 'knex';

import type {
  RegisteredClientRecord,
  RegisteredEmployeeRecord,
  RegisteredUserMessageTarget,
  RegisteredUserSettingsUpdate,
  RegisteredTelegramUserRecord,
  UserRegistrationState,
} from '../types/registered-user.js';

export interface RegisteredUserStore {
  saveClient(record: RegisteredClientRecord): Promise<void>;
  saveEmployee(record: RegisteredEmployeeRecord): Promise<void>;
  updateSettings(update: RegisteredUserSettingsUpdate): Promise<void>;
  findByPhoneNumber(phoneNumber: string): Promise<RegisteredUserMessageTarget | null>;
  findByTelegramId(telegramId: string): Promise<UserRegistrationState | null>;
  searchClients(query: string): Promise<UserRegistrationState[]>;
}

type ReturnedUserId = { id?: unknown } | string | number;
type UserMessageTargetRow = {
  id: string | number;
  telegram_id: string | number;
  phone_number: string;
  is_blocked: boolean;
};

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

  async findByPhoneNumber(phoneNumber: string): Promise<RegisteredUserMessageTarget | null> {
    const row = (await this.database('users')
      .select('id', 'telegram_id', 'phone_number', 'is_blocked')
      .where({ phone_number: phoneNumber })
      .first()) as UserMessageTargetRow | undefined;

    if (!row) return null;

    return {
      id: String(row.id),
      telegram_id: String(row.telegram_id),
      phone_number: row.phone_number,
      is_blocked: row.is_blocked,
    };
  }

  async findByTelegramId(telegramId: string): Promise<UserRegistrationState | null> {
    const userRow = await this.database('users').where({ telegram_id: telegramId }).first();

    if (!userRow) return null;

    const locale = userRow.language_code === 'ru' ? 'ru' : 'uz';
    const result: UserRegistrationState = {
      user: {
        id: String(userRow.id),
        telegram_id: String(userRow.telegram_id),
        telegram_username: userRow.telegram_username,
        first_name: userRow.first_name || '',
        last_name: userRow.last_name,
        phone_number: userRow.phone_number || '',
        locale,
      },
    };

    const employeeRow = await this.database('employees').where({ user_id: userRow.id }).first();

    if (employeeRow) {
      result.employee = {
        crm_admin_id: employeeRow.crm_admin_id,
        status: employeeRow.status,
        is_active: Boolean(employeeRow.is_active),
        created_at:
          employeeRow.created_at instanceof Date
            ? employeeRow.created_at.toISOString()
            : String(employeeRow.created_at),
        updated_at:
          employeeRow.updated_at instanceof Date
            ? employeeRow.updated_at.toISOString()
            : String(employeeRow.updated_at),
      };
      return result;
    }

    const clientRow = await this.database('clients').where({ user_id: userRow.id }).first();

    if (clientRow) {
      result.client = {
        crm_client_id: clientRow.crm_client_id,
        customer_code: clientRow.customer_code,
        status: clientRow.status,
        is_active: Boolean(clientRow.is_active),
      };
      return result;
    }

    return result;
  }

  async searchClients(query: string): Promise<UserRegistrationState[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const userRows = await this.database('users')
      .join('clients', 'users.id', 'clients.user_id')
      .select({
        id: 'users.id',
        telegram_id: 'users.telegram_id',
        telegram_username: 'users.telegram_username',
        first_name: 'users.first_name',
        last_name: 'users.last_name',
        phone_number: 'users.phone_number',
        language_code: 'users.language_code',
        crm_client_id: 'clients.crm_client_id',
        customer_code: 'clients.customer_code',
        client_status: 'clients.status',
        client_is_active: 'clients.is_active',
      })
      .where((qb) => {
        qb.whereILike('users.first_name', `%${trimmed}%`)
          .orWhereILike('users.last_name', `%${trimmed}%`)
          .orWhereILike('users.telegram_username', `%${trimmed}%`)
          .orWhere('users.phone_number', 'like', `%${trimmed}%`);
      })
      .limit(50);

    return userRows.map((row) => {
      const locale = row.language_code === 'ru' ? 'ru' : 'uz';
      return {
        user: {
          id: String(row.id),
          telegram_id: String(row.telegram_id),
          telegram_username: row.telegram_username,
          first_name: row.first_name || '',
          last_name: row.last_name,
          phone_number: row.phone_number || '',
          locale,
        },
        client: {
          crm_client_id: row.crm_client_id,
          customer_code: row.customer_code,
          status: row.client_status,
          is_active: Boolean(row.client_is_active),
        },
      };
    });
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
