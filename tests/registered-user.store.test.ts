/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Knex } from 'knex';

import { PostgresRegisteredUserStore } from '../src/services/registered-user.store.js';

interface QueryCall {
  table: string;
  action: string;
  payload?: unknown;
}

const createDatabaseDouble = (
  userId: string,
  now: Date,
  firstRow?: Record<string, unknown> | null,
) => {
  const calls: QueryCall[] = [];
  let transactionStarted = false;

  const database = Object.assign(
    (table: string) => {
      const query = {
        insert(payload: Record<string, unknown>) {
          calls.push({ table, action: 'insert', payload });
          return this;
        },
        select(...columns: string[]) {
          calls.push({ table, action: 'select', payload: columns });
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
        leftJoin(joinTable: string, firstColumn: string, secondColumn: string) {
          calls.push({
            table,
            action: 'leftJoin',
            payload: { joinTable, firstColumn, secondColumn },
          });
          return this;
        },
        orderBy(column: string, direction: string) {
          calls.push({ table, action: 'orderBy', payload: { column, direction } });
          return this;
        },
        delete() {
          calls.push({ table, action: 'delete' });
          return Promise.resolve(1);
        },
        update(payload: Record<string, unknown>) {
          calls.push({ table, action: 'update', payload });
          return Promise.resolve(1);
        },
        first() {
          calls.push({ table, action: 'first' });
          return Promise.resolve(firstRow ?? undefined);
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
    assert.equal((userInsert?.payload as Record<string, unknown>).is_blocked, false);
    assert.equal((userMerge?.payload as Record<string, unknown>).last_decline_reason, null);
    assert.equal((userMerge?.payload as Record<string, unknown>).is_blocked, false);
    assert.equal('should_restart' in (userMerge?.payload as Record<string, unknown>), false);
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

  it('updates local Telegram user settings by Telegram ID', async () => {
    const now = new Date('2026-06-17T10:00:00.000Z');
    const { database, calls } = createDatabaseDouble('44', now);
    const store = new PostgresRegisteredUserStore(database);

    await store.updateSettings({
      telegram_id: '1003',
      telegram_username: 'vali',
      first_name: 'Vali',
      last_name: 'Karimov',
      locale: 'ru',
    });

    const where = calls.find((call) => call.table === 'users' && call.action === 'where');
    const update = calls.find((call) => call.table === 'users' && call.action === 'update');

    assert.deepEqual(where?.payload, { telegram_id: '1003' });
    assert.deepEqual(update?.payload, {
      telegram_username: 'vali',
      first_name: 'Vali',
      last_name: 'Karimov',
      language_code: 'ru',
      updated_at: now,
    });
  });

  it('finds a local Telegram message target by phone number', async () => {
    const now = new Date('2026-06-17T10:00:00.000Z');
    const { database, calls } = createDatabaseDouble('44', now, {
      id: 45,
      telegram_id: 1004,
      telegram_username: 'ali',
      first_name: 'Ali',
      last_name: 'Valiyev',
      phone_number: '+998901234567',
      language_code: 'ru',
      is_blocked: false,
      crm_client_id: 1234,
    });
    const store = new PostgresRegisteredUserStore(database);

    const user = await store.findByPhoneNumber('+998901234567');

    assert.deepEqual(user, {
      id: '45',
      telegram_id: '1004',
      telegram_username: 'ali',
      first_name: 'Ali',
      last_name: 'Valiyev',
      phone_number: '+998901234567',
      locale: 'ru',
      is_blocked: false,
      crm_client_id: '1234',
    });
    assert.deepEqual(
      calls.find((call) => call.table === 'users' && call.action === 'select')?.payload,
      [
        'users.id',
        'users.telegram_id',
        'users.telegram_username',
        'users.first_name',
        'users.last_name',
        'users.phone_number',
        'users.language_code',
        'users.is_blocked',
        'clients.crm_client_id',
      ],
    );
    assert.deepEqual(
      calls.find((call) => call.table === 'users' && call.action === 'leftJoin')?.payload,
      {
        joinTable: 'clients',
        firstColumn: 'users.id',
        secondColumn: 'clients.user_id',
      },
    );
    assert.deepEqual(
      calls.find((call) => call.table === 'users' && call.action === 'where')?.payload,
      { 'users.phone_number': '+998901234567' },
    );
  });

  it('finds an active Telegram client by authoritative CRM client ID', async () => {
    const now = new Date('2026-07-17T12:00:00.000Z');
    const { database, calls } = createDatabaseDouble('44', now, {
      id: 46,
      telegram_id: 1005,
      telegram_username: 'customer',
      first_name: 'Customer',
      last_name: null,
      phone_number: '+998331234567',
      language_code: 'uz',
      is_blocked: false,
      crm_client_id: 'client-8193',
    });
    const store = new PostgresRegisteredUserStore(database);

    const user = await store.findClientByCrmClientId('client-8193');

    assert.equal(user?.phone_number, '+998331234567');
    assert.equal(user?.crm_client_id, 'client-8193');
    assert.deepEqual(
      calls.find((call) => call.table === 'users' && call.action === 'where')?.payload,
      { 'clients.crm_client_id': 'client-8193', 'clients.is_active': true },
    );
    assert.deepEqual(
      calls.find((call) => call.table === 'users' && call.action === 'orderBy')?.payload,
      { column: 'clients.updated_at', direction: 'desc' },
    );
  });

  it('finds user registration state for client by telegram_id', async () => {
    const database = ((table: string) => {
      return {
        where() {
          return {
            async first() {
              if (table === 'users') {
                return {
                  id: 12,
                  telegram_id: 1005,
                  telegram_username: 'ali',
                  first_name: 'Ali',
                  last_name: 'Valiyev',
                  phone_number: '+998901234567',
                  language_code: 'uz',
                  should_restart: true,
                };
              }
              if (table === 'clients') {
                return {
                  crm_client_id: 'client-12',
                  customer_code: 'C-12',
                  status: 'Open',
                  is_active: 1,
                };
              }
              return null;
            },
          };
        },
      };
    }) as unknown as Knex;

    const store = new PostgresRegisteredUserStore(database);
    const result = await store.findByTelegramId('1005');
    assert.deepEqual(result, {
      user: {
        id: '12',
        telegram_id: '1005',
        telegram_username: 'ali',
        first_name: 'Ali',
        last_name: 'Valiyev',
        phone_number: '+998901234567',
        locale: 'uz',
        should_restart: true,
      },
      client: {
        crm_client_id: 'client-12',
        customer_code: 'C-12',
        status: 'Open',
        is_active: true,
      },
    });
  });

  it('finds user registration state for employee by telegram_id', async () => {
    const database = ((table: string) => {
      return {
        where() {
          return {
            async first() {
              if (table === 'users') {
                return {
                  id: 13,
                  telegram_id: 1006,
                  telegram_username: 'vali',
                  first_name: 'Vali',
                  last_name: null,
                  phone_number: '+998901111111',
                  language_code: 'ru',
                  should_restart: false,
                };
              }
              if (table === 'clients') {
                return null;
              }
              if (table === 'employees') {
                return {
                  crm_admin_id: 'admin-13',
                  status: 'Open',
                  is_active: 1,
                  created_at: new Date('2026-06-17T10:00:00.000Z'),
                  updated_at: new Date('2026-06-17T10:00:00.000Z'),
                };
              }
              return null;
            },
          };
        },
      };
    }) as unknown as Knex;

    const store = new PostgresRegisteredUserStore(database);
    const result = await store.findByTelegramId('1006');
    assert.deepEqual(result, {
      user: {
        id: '13',
        telegram_id: '1006',
        telegram_username: 'vali',
        first_name: 'Vali',
        last_name: null,
        phone_number: '+998901111111',
        locale: 'ru',
        should_restart: false,
      },
      employee: {
        crm_admin_id: 'admin-13',
        status: 'Open',
        is_active: true,
        created_at: '2026-06-17T10:00:00.000Z',
        updated_at: '2026-06-17T10:00:00.000Z',
      },
    });
  });

  it('prefers employee registration state when both role rows exist', async () => {
    const database = ((table: string) => {
      return {
        where() {
          return {
            async first() {
              if (table === 'users') {
                return {
                  id: 14,
                  telegram_id: 1007,
                  telegram_username: 'employee',
                  first_name: 'Employee',
                  last_name: null,
                  phone_number: '+998901222222',
                  language_code: 'ru',
                };
              }
              if (table === 'employees') {
                return {
                  crm_admin_id: 'admin-14',
                  status: 'Open',
                  is_active: 1,
                  created_at: new Date('2026-06-17T10:00:00.000Z'),
                  updated_at: new Date('2026-06-17T10:00:00.000Z'),
                };
              }
              if (table === 'clients') {
                return {
                  crm_client_id: 'client-14',
                  customer_code: null,
                  status: 'Open',
                  is_active: 1,
                };
              }
              return null;
            },
          };
        },
      };
    }) as unknown as Knex;

    const store = new PostgresRegisteredUserStore(database);
    const result = await store.findByTelegramId('1007');

    assert.equal(result?.employee?.crm_admin_id, 'admin-14');
    assert.equal(result?.client, undefined);
  });

  it('returns null when telegram_id is not registered', async () => {
    const database = (() => {
      return {
        where() {
          return {
            async first() {
              return null;
            },
          };
        },
      };
    }) as unknown as Knex;

    const store = new PostgresRegisteredUserStore(database);
    const result = await store.findByTelegramId('9999');
    assert.equal(result, null);
  });

  it('clears the restart requirement by Telegram ID', async () => {
    const now = new Date('2026-07-13T10:00:00.000Z');
    const { database, calls } = createDatabaseDouble('15', now);
    const store = new PostgresRegisteredUserStore(database);

    await store.clearRestartRequired('1008');

    assert.deepEqual(calls.find((call) => call.action === 'where')?.payload, {
      telegram_id: '1008',
    });
    assert.deepEqual(calls.find((call) => call.action === 'update')?.payload, {
      should_restart: false,
      updated_at: now,
    });
  });

  it('finds active employee Telegram targets by CRM admin IDs', async () => {
    let selectedTable = '';
    let joinArgs: unknown[] = [];
    let selectColumns: unknown;
    let whereInArgs: unknown[] = [];
    let andWhereArgs: unknown[] = [];

    const rows = [
      {
        id: 301,
        telegram_id: 800301,
        crm_admin_id: 'admin-301',
        language_code: 'ru',
        is_blocked: false,
      },
    ];
    const database = ((table: string) => {
      selectedTable = table;
      return {
        join(...args: unknown[]) {
          joinArgs = args;
          return this;
        },
        select(columns: unknown) {
          selectColumns = columns;
          return this;
        },
        whereIn(...args: unknown[]) {
          whereInArgs = args;
          return this;
        },
        andWhere(...args: unknown[]) {
          andWhereArgs = args;
          return Promise.resolve(rows);
        },
      };
    }) as unknown as Knex;

    const store = new PostgresRegisteredUserStore(database);
    const targets = await store.findActiveEmployeesByCrmAdminIds([
      'admin-301',
      'admin-301',
      '',
      ' admin-302 ',
    ]);

    assert.equal(selectedTable, 'employees');
    assert.deepEqual(joinArgs, ['users', 'employees.user_id', 'users.id']);
    assert.deepEqual(selectColumns, {
      id: 'users.id',
      telegram_id: 'users.telegram_id',
      crm_admin_id: 'employees.crm_admin_id',
      language_code: 'users.language_code',
      is_blocked: 'users.is_blocked',
    });
    assert.deepEqual(whereInArgs, ['employees.crm_admin_id', ['admin-301', 'admin-302']]);
    assert.deepEqual(andWhereArgs, ['employees.is_active', true]);
    assert.deepEqual(targets, [
      {
        id: '301',
        telegram_id: '800301',
        crm_admin_id: 'admin-301',
        locale: 'ru',
        is_blocked: false,
      },
    ]);
  });

  it('lists message targets using a stable user ID cursor', async () => {
    const rows = [
      {
        id: 501,
        telegram_id: 900501,
        telegram_username: null,
        first_name: 'Broadcast',
        last_name: null,
        phone_number: '+998901234567',
        language_code: 'ru',
        is_blocked: false,
      },
    ];
    const calls: QueryCall[] = [];
    const database = ((table: string) => {
      assert.equal(table, 'users');
      const query = {
        select(...columns: string[]) {
          calls.push({ table, action: 'select', payload: columns });
          return this;
        },
        orderBy(...args: unknown[]) {
          calls.push({ table, action: 'orderBy', payload: args });
          return this;
        },
        limit(value: number) {
          calls.push({ table, action: 'limit', payload: value });
          return this;
        },
        where(...args: unknown[]) {
          calls.push({ table, action: 'where', payload: args });
          return this;
        },
        andWhere(...args: unknown[]) {
          calls.push({ table, action: 'andWhere', payload: args });
          return this;
        },
        then(resolve: (value: unknown) => void) {
          resolve(rows);
        },
      };
      return query;
    }) as unknown as Knex;

    const store = new PostgresRegisteredUserStore(database);
    const targets = await store.listMessageTargets({
      afterId: '500',
      limit: 100,
      includeBlocked: false,
    });

    assert.deepEqual(calls.find((call) => call.action === 'where')?.payload, ['id', '>', '500']);
    assert.deepEqual(calls.find((call) => call.action === 'andWhere')?.payload, [
      'is_blocked',
      false,
    ]);
    assert.deepEqual(calls.find((call) => call.action === 'orderBy')?.payload, ['id', 'asc']);
    assert.equal(calls.find((call) => call.action === 'limit')?.payload, 100);
    assert.deepEqual(targets, [
      {
        id: '501',
        telegram_id: '900501',
        telegram_username: null,
        first_name: 'Broadcast',
        last_name: null,
        phone_number: '+998901234567',
        locale: 'ru',
        is_blocked: false,
      },
    ]);
  });

  it('searches clients using name, username, or phone number', async () => {
    let selectColumns: unknown;
    let limitValue: number | undefined;
    let filterQuery: string | undefined;

    const database = ((table: string) => {
      assert.equal(table, 'users');
      return {
        join(otherTable: string, leftCol: string, rightCol: string) {
          assert.equal(otherTable, 'clients');
          assert.equal(leftCol, 'users.id');
          assert.equal(rightCol, 'clients.user_id');
          return this;
        },
        select(columns: unknown) {
          selectColumns = columns;
          return this;
        },
        where(callback: (qb: any) => void) {
          const qb = {
            whereILike(col: string, val: string) {
              if (col === 'users.first_name') filterQuery = val;
              return this;
            },
            orWhereILike(col: string, val: string) {
              return this;
            },
            orWhere(col: string, op: string, val: string) {
              return this;
            },
          };
          callback(qb);
          return this;
        },
        limit(val: number) {
          limitValue = val;
          return Promise.resolve([
            {
              id: 101,
              telegram_id: 2001,
              telegram_username: 'search_username',
              first_name: 'SearchName',
              last_name: 'SearchLastName',
              phone_number: '+998901234567',
              language_code: 'ru',
              should_restart: false,
              crm_client_id: 'crm-101',
              customer_code: 'CC-101',
              client_status: 'Active',
              client_is_active: 1,
            },
          ]);
        },
      };
    }) as unknown as Knex;

    const store = new PostgresRegisteredUserStore(database);
    const results = await store.searchClients('SearchName');

    assert.equal(limitValue, 50);
    assert.equal(filterQuery, '%SearchName%');
    assert.deepEqual(selectColumns, {
      id: 'users.id',
      telegram_id: 'users.telegram_id',
      telegram_username: 'users.telegram_username',
      first_name: 'users.first_name',
      last_name: 'users.last_name',
      phone_number: 'users.phone_number',
      language_code: 'users.language_code',
      should_restart: 'users.should_restart',
      crm_client_id: 'clients.crm_client_id',
      customer_code: 'clients.customer_code',
      client_status: 'clients.status',
      client_is_active: 'clients.is_active',
    });

    assert.equal(results.length, 1);
    assert.deepEqual(results[0], {
      user: {
        id: '101',
        telegram_id: '2001',
        telegram_username: 'search_username',
        first_name: 'SearchName',
        last_name: 'SearchLastName',
        phone_number: '+998901234567',
        locale: 'ru',
        should_restart: false,
      },
      client: {
        crm_client_id: 'crm-101',
        customer_code: 'CC-101',
        status: 'Active',
        is_active: true,
      },
    });
  });
});
