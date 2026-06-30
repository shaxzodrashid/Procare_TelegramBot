import type { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.createTable('api_error_localizations', (table) => {
    table.bigIncrements('id').primary();
    table.string('endpoint_key', 120).notNullable();
    table.string('location', 120).notNullable();
    table.text('message_uz').notNullable();
    table.text('message_ru').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(['endpoint_key', 'location'], 'api_error_localizations_endpoint_location_unique');
    table.index(['endpoint_key'], 'api_error_localizations_endpoint_key_index');
  });
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('api_error_localizations');
};
