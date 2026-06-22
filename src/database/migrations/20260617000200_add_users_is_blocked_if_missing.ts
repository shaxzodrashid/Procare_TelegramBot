import type { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  const hasIsBlocked = await knex.schema.hasColumn('users', 'is_blocked');

  if (!hasIsBlocked) {
    await knex.schema.alterTable('users', (table) => {
      table.boolean('is_blocked').notNullable().defaultTo(false);
    });
  }
};

export const down = async (): Promise<void> => {
  return;
};
