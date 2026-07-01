import type { Knex } from 'knex';

const TABLE_NAME = 'repair_order_status_names';

const OBSOLETE_COLUMNS = [
  'branch_id',
  'customer_code',
  'sort',
  'can_user_view',
  'is_active',
  'customer_progress_type',
  'total_repair_orders',
] as const;

export const up = async (knex: Knex): Promise<void> => {
  const hasCrmSortOrder = await knex.schema.hasColumn(TABLE_NAME, 'crm_sort_order');
  if (!hasCrmSortOrder) {
    await knex.schema.alterTable(TABLE_NAME, (table) => {
      table.integer('crm_sort_order').notNullable().defaultTo(0);
    });
  }

  const existingColumns = await Promise.all(
    OBSOLETE_COLUMNS.map(async (column) => ({
      column,
      exists: await knex.schema.hasColumn(TABLE_NAME, column),
    })),
  );
  const columnsToDrop = existingColumns.filter(({ exists }) => exists).map(({ column }) => column);

  if (columnsToDrop.length === 0) return;

  await knex.schema.alterTable(TABLE_NAME, (table) => {
    table.dropColumns(...columnsToDrop);
  });
};

export const down = async (knex: Knex): Promise<void> => {
  const hasBranchId = await knex.schema.hasColumn(TABLE_NAME, 'branch_id');
  const hasCrmSortOrder = await knex.schema.hasColumn(TABLE_NAME, 'crm_sort_order');

  if (hasCrmSortOrder) {
    await knex.schema.alterTable(TABLE_NAME, (table) => {
      table.dropColumn('crm_sort_order');
    });
  }

  if (hasBranchId) return;

  await knex.schema.alterTable(TABLE_NAME, (table) => {
    table.uuid('branch_id').nullable();
    table.string('customer_code', 120).nullable();
    table.integer('sort').nullable();
    table.boolean('can_user_view').notNullable().defaultTo(false);
    table.boolean('is_active').notNullable().defaultTo(false);
    table.string('customer_progress_type', 32).nullable();
    table.integer('total_repair_orders').notNullable().defaultTo(0);
  });
};
