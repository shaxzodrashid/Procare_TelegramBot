import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Knex } from 'knex';

import { PostgresSupportMessageStore } from '../src/services/support-message.store.js';

describe('PostgresSupportMessageStore', () => {
  it('finds reply targets by CRM comment ID and Telegram user', async () => {
    let selectedColumns: string[] | undefined;
    let wherePayload: Record<string, unknown> | undefined;

    const database = ((table: string) => {
      assert.equal(table, 'support_messages');
      return {
        select(...columns: string[]) {
          selectedColumns = columns;
          return this;
        },
        where(payload: Record<string, unknown>) {
          wherePayload = payload;
          return this;
        },
        first() {
          return Promise.resolve({
            id: '42',
            telegram_id: '777',
            telegram_chat_id: '777',
            telegram_message_id: 123,
            repair_order_id: '11111111-1111-4111-8111-111111111111',
            order_number: '123456',
            crm_client_id: '999',
          });
        },
      };
    }) as unknown as Knex;
    const store = new PostgresSupportMessageStore(database);

    const result = await store.findReplyTargetByCrmCommentId(
      '22222222-2222-4222-8222-222222222222',
      '777',
    );

    assert.deepEqual(selectedColumns, [
      'id',
      'telegram_id',
      'telegram_chat_id',
      'telegram_message_id',
      'repair_order_id',
      'order_number',
      'crm_client_id',
    ]);
    assert.deepEqual(wherePayload, {
      crm_comment_id: '22222222-2222-4222-8222-222222222222',
      telegram_id: '777',
    });
    assert.deepEqual(result, {
      id: '42',
      telegram_id: '777',
      telegram_chat_id: '777',
      telegram_message_id: 123,
      repair_order_id: '11111111-1111-4111-8111-111111111111',
      order_number: '123456',
      crm_client_id: '999',
    });
  });

  it('stores support message mappings by Telegram chat and message ID', async () => {
    const now = new Date('2026-06-24T10:02:00.000Z');
    let selectedUserTable: string | undefined;
    let inserted: Record<string, unknown> | undefined;
    let conflictColumns: string[] | undefined;
    let merged: Record<string, unknown> | undefined;

    const database = Object.assign(
      (table: string) => {
        if (table === 'users') {
          selectedUserTable = table;
          return {
            select() {
              return this;
            },
            where(payload: Record<string, unknown>) {
              assert.deepEqual(payload, { telegram_id: '777' });
              return this;
            },
            first() {
              return Promise.resolve({ id: '42' });
            },
          };
        }

        assert.equal(table, 'support_messages');
        return {
          insert(payload: Record<string, unknown>) {
            inserted = payload;
            return this;
          },
          onConflict(columns: string[]) {
            conflictColumns = columns;
            return this;
          },
          merge(payload: Record<string, unknown>) {
            merged = payload;
            return Promise.resolve();
          },
        };
      },
      {
        fn: { now: () => now },
        transaction: async <T>(callback: (trx: Knex) => Promise<T>) =>
          callback(database as unknown as Knex),
      },
    ) as unknown as Knex;
    const store = new PostgresSupportMessageStore(database);

    await store.save({
      crm_comment_id: '22222222-2222-4222-8222-222222222222',
      crm_client_id: 'client-1',
      repair_order_id: '11111111-1111-4111-8111-111111111111',
      order_number: '1024',
      telegram_id: '777',
      telegram_chat_id: '777',
      telegram_message_id: 123,
      telegram_message_date: new Date('2026-06-24T10:00:00.000Z'),
      sender_type: 'client',
      direction: 'inbound',
      content_type: 'text',
      text: 'Salom',
      photo_count: 0,
    });

    assert.equal(selectedUserTable, 'users');
    assert.deepEqual(conflictColumns, ['telegram_chat_id', 'telegram_message_id']);
    assert.equal(inserted?.user_id, '42');
    assert.equal(inserted?.crm_comment_id, '22222222-2222-4222-8222-222222222222');
    assert.equal(inserted?.telegram_chat_id, '777');
    assert.equal(inserted?.telegram_message_id, 123);
    assert.equal(inserted?.sender_type, 'client');
    assert.equal(inserted?.direction, 'inbound');
    assert.equal(inserted?.content_type, 'text');
    assert.equal(merged?.updated_at, now);
  });
});
