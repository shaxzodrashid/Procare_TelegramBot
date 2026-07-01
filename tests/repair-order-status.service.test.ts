import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Knex } from 'knex';

import {
  HttpRepairOrderStatusService,
  PostgresRepairOrderStatusNameStore,
  RepairOrderStatusError,
} from '../src/services/repair-order-status.service.js';
import type { CrmRepairOrderStatus } from '../src/types/repair-order-status.js';
import type { Logger } from '../src/utils/logger.js';

const logger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  extra: () => undefined,
  table: () => undefined,
};

const status = (overrides: Partial<CrmRepairOrderStatus> = {}): CrmRepairOrderStatus => ({
  id: '11111111-1111-4111-8111-111111111111',
  name_uz: "O'ylab ko'radi",
  name_ru: 'Думает',
  name_en: 'Thinking',
  ...overrides,
});

describe('HttpRepairOrderStatusService', () => {
  it('fetches branchless CRM status summaries with Basic Auth', async () => {
    const calls: Array<{ url: string; authorization: string | null }> = [];
    const service = new HttpRepairOrderStatusService(
      {
        baseUrl: 'https://crm.example.test',
        username: 'bot',
        password: 'secret',
        timeoutMs: 1000,
        maxRetries: 0,
        async fetchImpl(url, init) {
          calls.push({
            url: String(url),
            authorization: new Headers(init?.headers).get('authorization'),
          });
          return Response.json([status()]);
        },
      },
      logger,
    );

    const result = await service.listStatuses();

    assert.equal(calls[0]?.url, 'https://crm.example.test/api/v1/external/repair-order-statuses');
    assert.equal(calls[0]?.authorization, 'Basic Ym90OnNlY3JldA==');
    assert.equal(result.statuses[0]?.name_en, 'Thinking');
  });

  it('rejects non-array responses from the old paginated contract', async () => {
    const service = new HttpRepairOrderStatusService(
      {
        baseUrl: 'https://crm.example.test',
        username: 'bot',
        password: 'secret',
        timeoutMs: 1000,
        maxRetries: 0,
        async fetchImpl() {
          return Response.json({
            meta: { total: 1, limit: 50, offset: 0 },
            data: [status()],
          });
        },
      },
      logger,
    );

    await assert.rejects(
      () => service.listStatuses(),
      (error: unknown) =>
        error instanceof RepairOrderStatusError && error.code === 'invalid_response',
    );
  });
});

describe('PostgresRepairOrderStatusNameStore', () => {
  it('ignores customer status codes when loading CRM status display names', async () => {
    let queryStarted = false;
    const database = (() => {
      queryStarted = true;
      return {};
    }) as unknown as Knex;
    const store = new PostgresRepairOrderStatusNameStore(database);

    const result = await store.findDisplayNamesByStatusIds(['NEW', 'IN_REPAIR', '']);

    assert.equal(result.size, 0);
    assert.equal(queryStarted, false);
  });

  it('loads CRM status display names only for UUID status ids', async () => {
    let whereInColumn = '';
    let whereInValues: string[] = [];
    const database = ((tableName: string) => {
      assert.equal(tableName, 'repair_order_status_names');
      return {
        select(...columns: string[]) {
          assert.deepEqual(columns, ['crm_status_id', 'display_name_uz', 'display_name_ru']);
          return this;
        },
        whereIn(column: string, values: string[]) {
          whereInColumn = column;
          whereInValues = values;
          return Promise.resolve([
            {
              crm_status_id: values[0],
              display_name_uz: 'Javobingiz kutilmoqda',
              display_name_ru: 'Ожидаем ваш ответ',
            },
          ]);
        },
      };
    }) as unknown as Knex;
    const store = new PostgresRepairOrderStatusNameStore(database);

    const result = await store.findDisplayNamesByStatusIds([
      'NEW',
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111111',
    ]);

    assert.equal(whereInColumn, 'crm_status_id');
    assert.deepEqual(whereInValues, ['11111111-1111-4111-8111-111111111111']);
    assert.equal(
      result.get('11111111-1111-4111-8111-111111111111')?.display_name_uz,
      'Javobingiz kutilmoqda',
    );
  });
});
