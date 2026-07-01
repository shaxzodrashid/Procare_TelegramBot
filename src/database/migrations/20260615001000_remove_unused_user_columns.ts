import type { Knex } from 'knex';

const TABLE_NAME = 'users';

const UNUSED_COLUMNS = [
  'telegram_chat_id',
  'sap_card_code',
  'is_admin',
  'is_support_banned',
  'is_logged_out',
  'jshshir',
  'passport_series',
] as const;

export const up = async (knex: Knex): Promise<void> => {
  const existingColumns = await Promise.all(
    UNUSED_COLUMNS.map(async (column) => ({
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
  await knex.schema.alterTable(TABLE_NAME, (table) => {
    table.bigInteger('telegram_chat_id').nullable();
    table.string('sap_card_code', 255).nullable();
    table.boolean('is_admin').notNullable().defaultTo(false);
    table.boolean('is_support_banned').notNullable().defaultTo(false);
    table.boolean('is_logged_out').notNullable().defaultTo(false);
    table.string('jshshir', 14).nullable();
    table.string('passport_series', 9).nullable();
  });
};
