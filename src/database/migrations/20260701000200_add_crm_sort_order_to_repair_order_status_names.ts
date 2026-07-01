import type { Knex } from 'knex';

const TABLE_NAME = 'repair_order_status_names';
const COLUMN_NAME = 'crm_sort_order';

export const up = async (knex: Knex): Promise<void> => {
  const hasColumn = await knex.schema.hasColumn(TABLE_NAME, COLUMN_NAME);
  if (hasColumn) return;

  await knex.schema.alterTable(TABLE_NAME, (table) => {
    table.integer(COLUMN_NAME).notNullable().defaultTo(0);
  });
};

export const down = async (knex: Knex): Promise<void> => {
  const hasColumn = await knex.schema.hasColumn(TABLE_NAME, COLUMN_NAME);
  if (!hasColumn) return;

  await knex.schema.alterTable(TABLE_NAME, (table) => {
    table.dropColumn(COLUMN_NAME);
  });
};
