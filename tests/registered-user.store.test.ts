import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Knex } from 'knex';

import { PostgresRegisteredUserStore } from '../src/services/registered-user.store.js';

interface QueryCall {
  table: string;
  action: string;
  payload?: unknown;
}

const createDatabaseDouble = (userId: string, now: Date) => {
  const calls: QueryCall[] = [];
  let transactionStarted = false;

  const database = Object.assign(
    (table: string) => {
      const query = {
        insert(payload: Record<string, unknown>) {
          calls.push({ table, action: 'insert', payload });
          return this;
        },
        onConflict(column: string) {
          calls.push({ table, action: 'onConflict', payload: column });
          return this;
        },
        merge(payload: Record<string, unknown>) {
          calls.push({ table, action: 'merge', payload });
          return this;
        },
        returning(column: string) {
          calls.push({ table, action: 'returning', payload: column });
          return Promise.resolve([{ id: userId }]);
        },
        where(payload: Record<string, unknown>) {
          calls.push({ table, action: 'where', payload });
          return this;
        },
        delete() {
          calls.push({ table, action: 'delete' });
          return Promise.resolve(1);
        },
      };
      return query;
    },
    {
      fn: { now: () => now },
      transaction: async <T>(callback: (trx: Knex.Transaction) => Promise<T>) => {
        transactionStarted = true;
        return callback(database as unknown as Knex.Transaction);
      },
    },
  ) as unknown as Knex;

  return {
    database,
    calls,
    transactionStarted: () => transactionStarted,
  };
};

describe('PostgresRegisteredUserStore', () => {
  it('upserts a Telegram user and client role by local user ID', async () => {
    const now = new Date('2026-06-17T10:00:00.000Z');
    const { database, calls, transactionStarted } = createDatabaseDouble('42', now);
    const store = new PostgresRegisteredUserStore(database);

    await store.saveClient({
      telegram_id: '1001',
      telegram_username: 'ali',
      first_name: 'Ali',
      last_name: 'Valiyev',
      phone_number: '+998901234567',
      locale: 'uz',
      crm_client_id: 'client-1',
      customer_code: 'C-1',
      status: 'Open',
      is_active: true,
    });

    const userInsert = calls.find((call) => call.table === 'users' && call.action === 'insert');
    const userMerge = calls.find((call) => call.table === 'users' && call.action === 'merge');
    const clientInsert = calls.find((call) => call.table === 'clients' && call.action === 'insert');
    const employeeDelete = calls.find(
      (call) => call.table === 'employees' && call.action === 'delete',
    );

    assert.equal(transactionStarted(), true);
    assert.equal((userInsert?.payload as Record<string, unknown>).telegram_id, '1001');
    assert.equal((userInsert?.payload as Record<string, unknown>).phone_number, '+998901234567');
    assert.equal((userMerge?.payload as Record<string, unknown>).last_decline_reason, null);
    assert.equal((userMerge?.payload as Record<string, unknown>).declined_at, null);
    assert.equal((clientInsert?.payload as Record<string, unknown>).user_id, '42');
    assert.equal((clientInsert?.payload as Record<string, unknown>).crm_client_id, 'client-1');
    assert.equal(employeeDelete?.action, 'delete');
  });

  it('upserts a Telegram user and employee role by local user ID', async () => {
    const now = new Date('2026-06-17T10:00:00.000Z');
    const { database, calls } = createDatabaseDouble('43', now);
    const store = new PostgresRegisteredUserStore(database);

    await store.saveEmployee({
      telegram_id: '1002',
      telegram_username: null,
      first_name: 'Vali',
      last_name: null,
      phone_number: '+998901111111',
      locale: 'ru',
      crm_admin_id: 'admin-1',
      status: 'Open',
      is_active: true,
    });

    const employeeInsert = calls.find(
      (call) => call.table === 'employees' && call.action === 'insert',
    );
    const clientDelete = calls.find((call) => call.table === 'clients' && call.action === 'delete');
    const roleConflict = calls.find(
      (call) => call.table === 'employees' && call.action === 'onConflict',
    );

    assert.equal((employeeInsert?.payload as Record<string, unknown>).user_id, '43');
    assert.equal((employeeInsert?.payload as Record<string, unknown>).crm_admin_id, 'admin-1');
    assert.equal(roleConflict?.payload, 'user_id');
    assert.equal(clientDelete?.action, 'delete');
  });
});
