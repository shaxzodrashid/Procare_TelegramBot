import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Knex } from 'knex';

import { PostgresUnknownClientStore } from '../src/services/unknown-client.store.js';

describe('PostgresUnknownClientStore', () => {
  it('upserts declined unknown clients by Telegram user ID', async () => {
    const now = new Date('2026-06-15T10:02:00.000Z');
    let tableName: string | undefined;
    let inserted: Record<string, unknown> | undefined;
    let conflictColumn: string | undefined;
    let merged: Record<string, unknown> | undefined;

    const query = {
      insert(payload: Record<string, unknown>) {
        inserted = payload;
        return this;
      },
      onConflict(column: string) {
        conflictColumn = column;
        return this;
      },
      merge(payload: Record<string, unknown>) {
        merged = payload;
        return Promise.resolve();
      },
    };
    const database = Object.assign(
      (table: string) => {
        tableName = table;
        return query;
      },
      { fn: { now: () => now } },
    ) as unknown as Knex;
    const store = new PostgresUnknownClientStore(database);

    await store.save({
      telegram_user_id: '1',
      telegram_chat_id: '10',
      telegram_username: 'ali',
      first_name: 'Ali',
      last_name: 'Valiyev',
      phone_number: '+998901234567',
      locale: 'uz',
      reason: 'declined_offer',
      saved_at: '2026-06-15T10:00:00.000Z',
    });

    assert.equal(tableName, 'users');
    assert.equal(conflictColumn, 'telegram_id');
    assert.equal(inserted?.telegram_id, '1');
    assert.equal(inserted?.last_decline_reason, 'declined_offer');
    assert.deepEqual(inserted?.declined_at, new Date('2026-06-15T10:00:00.000Z'));
    assert.equal(merged?.updated_at, now);
  });
});
