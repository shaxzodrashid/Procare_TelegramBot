/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  down as rollbackCleanupUsers,
  up as cleanupUsers,
} from '../src/database/migrations/20260615001000_remove_unused_user_columns.js';
import { up as restoreUsersIsBlocked } from '../src/database/migrations/20260701000300_restore_users_is_blocked_after_cleanup.js';
import {
  down as removeUsersShouldRestart,
  up as addUsersShouldRestart,
} from '../src/database/migrations/20260713000000_add_users_should_restart.js';

describe('user table migrations', () => {
  it('keeps the active blocked-user flag during unused-column cleanup', async () => {
    const droppedColumns: string[] = [];
    const checkedColumns: string[] = [];
    const knex = {
      schema: {
        hasColumn: async (_table: string, column: string) => {
          checkedColumns.push(column);
          return true;
        },
        alterTable: async (_table: string, callback: (table: any) => void) => {
          callback({
            dropColumns: (...columns: string[]) => {
              droppedColumns.push(...columns);
            },
          });
        },
      },
    };

    await cleanupUsers(knex as any);

    assert.ok(!checkedColumns.includes('is_blocked'));
    assert.ok(!droppedColumns.includes('is_blocked'));
    assert.ok(droppedColumns.includes('is_admin'));
  });

  it('does not recreate users.is_blocked when rolling back unused-column cleanup', async () => {
    const addedColumns: string[] = [];
    const knex = {
      schema: {
        alterTable: async (_table: string, callback: (table: any) => void) => {
          callback({
            bigInteger: (column: string) => {
              addedColumns.push(column);
              return { nullable: () => undefined };
            },
            string: (column: string) => {
              addedColumns.push(column);
              return { nullable: () => undefined };
            },
            boolean: (column: string) => {
              addedColumns.push(column);
              return {
                notNullable() {
                  return this;
                },
                defaultTo() {
                  return this;
                },
              };
            },
          });
        },
      },
    };

    await rollbackCleanupUsers(knex as any);

    assert.ok(!addedColumns.includes('is_blocked'));
    assert.ok(addedColumns.includes('is_admin'));
  });

  it('restores users.is_blocked when an already-applied cleanup removed it', async () => {
    let addedColumn: string | undefined;
    let defaultValue: boolean | undefined;
    const knex = {
      schema: {
        hasColumn: async () => false,
        alterTable: async (_table: string, callback: (table: any) => void) => {
          callback({
            boolean: (column: string) => {
              addedColumn = column;
              return {
                notNullable() {
                  return this;
                },
                defaultTo(value: boolean) {
                  defaultValue = value;
                  return this;
                },
              };
            },
          });
        },
      },
    };

    await restoreUsersIsBlocked(knex as any);

    assert.equal(addedColumn, 'is_blocked');
    assert.equal(defaultValue, false);
  });

  it('adds and removes the durable users.should_restart flag', async () => {
    const addedColumns: string[] = [];
    const droppedColumns: string[] = [];
    let defaultValue: boolean | undefined;
    const knex = {
      schema: {
        alterTable: async (_table: string, callback: (table: any) => void) => {
          callback({
            boolean: (column: string) => {
              addedColumns.push(column);
              return {
                notNullable() {
                  return this;
                },
                defaultTo(value: boolean) {
                  defaultValue = value;
                  return this;
                },
              };
            },
            dropColumn: (column: string) => droppedColumns.push(column),
          });
        },
      },
    };

    await addUsersShouldRestart(knex as any);
    await removeUsersShouldRestart(knex as any);

    assert.deepEqual(addedColumns, ['should_restart']);
    assert.equal(defaultValue, false);
    assert.deepEqual(droppedColumns, ['should_restart']);
  });
});
