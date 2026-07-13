import type { Knex } from 'knex';

const TABLE_NAME = 'users';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.alterTable(TABLE_NAME, (table) => {
    table.boolean('should_restart').notNullable().defaultTo(false);
  });
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.alterTable(TABLE_NAME, (table) => {
    table.dropColumn('should_restart');
  });
};
