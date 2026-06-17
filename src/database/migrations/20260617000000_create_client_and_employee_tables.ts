import type { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.createTable('clients', (table) => {
    table.bigIncrements('id').primary();
    table.bigInteger('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('crm_client_id', 255).notNullable();
    table.string('customer_code', 255).nullable();
    table.string('status', 64).notNullable();
    table.boolean('is_active').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(['user_id'], 'clients_user_id_unique');
    table.index(['crm_client_id'], 'clients_crm_client_id_index');
  });

  await knex.schema.createTable('employees', (table) => {
    table.bigIncrements('id').primary();
    table.bigInteger('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('crm_admin_id', 255).notNullable();
    table.string('status', 64).notNullable();
    table.boolean('is_active').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(['user_id'], 'employees_user_id_unique');
    table.index(['crm_admin_id'], 'employees_crm_admin_id_index');
  });
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('employees');
  await knex.schema.dropTableIfExists('clients');
};
