import assert from 'node:assert/strict';
import { it } from 'node:test';
import knex, { type Knex } from 'knex';

import {
  up,
  down,
} from '../src/database/migrations/20261012000000_create_employee_notifications.js';
import { t } from '../src/bot/messages.js';
import type { EmployeeNotificationType } from '../src/types/employee-notification.js';

it('creates account-scoped notification tables, seeds the existing support alert, and rolls back dependencies first', async () => {
  const compiler = knex({ client: 'pg' });
  const statements: string[] = [];
  const created: string[] = [];
  const dropped: string[] = [];
  let seed: EmployeeNotificationType | undefined;
  const database = Object.assign(
    (table: string) => ({
      async insert(row: EmployeeNotificationType) {
        assert.equal(table, 'employee_notification_types');
        seed = row;
      },
    }),
    {
      fn: compiler.fn,
      schema: {
        async createTable(table: string, callback: (builder: Knex.CreateTableBuilder) => void) {
          created.push(table);
          statements.push(
            ...compiler.schema
              .createTable(table, callback)
              .toSQL()
              .map((query) => query.sql),
          );
        },
        async dropTableIfExists(table: string) {
          dropped.push(table);
        },
      },
    },
  ) as unknown as Knex;
  try {
    await up(database);
    assert.deepEqual(created, ['employee_notification_types', 'employee_notification_preferences']);
    const sql = statements.join('\n');
    assert.match(sql, /"message_template" jsonb not null/);
    assert.match(sql, /primary key \("crm_admin_id", "type_key"\)/);
    assert.match(
      sql,
      /foreign key \("type_key"\) references "employee_notification_types" \("key"\)/,
    );
    assert.equal(seed?.key, 'support_comment');
    assert.equal(seed?.is_active, true);
    assert.equal(seed?.default_enabled, true);
    assert.equal(seed?.message_template.localizedMessages?.uz, t('uz', 'supportAdminNotification'));
    assert.equal(seed?.message_template.localizedMessages?.ru, t('ru', 'supportAdminNotification'));
    await down(database);
    assert.deepEqual(dropped, ['employee_notification_preferences', 'employee_notification_types']);
  } finally {
    await compiler.destroy();
  }
});
