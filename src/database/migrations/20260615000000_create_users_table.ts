import type { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.createTable('users', (table) => {
    table.bigIncrements('id').primary();
    table.bigInteger('telegram_id').notNullable().unique();
    table.string('telegram_username', 255).nullable();
    table.string('first_name', 255).nullable();
    table.string('last_name', 255).nullable();
    table.string('phone_number', 20).nullable();
    table.string('language_code', 10).notNullable().defaultTo('uz');
    table.string('last_decline_reason', 32).nullable();
    table.timestamp('declined_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['phone_number'], 'users_phone_number_index');
  });
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('users');
};
