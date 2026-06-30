import type { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.createTable('repair_order_status_names', (table) => {
    table.bigIncrements('id').primary();
    table.uuid('crm_status_id').notNullable().unique();
    table.uuid('branch_id').notNullable();
    table.string('customer_code', 120).nullable();
    table.string('crm_name_uz', 255).notNullable();
    table.string('crm_name_ru', 255).notNullable();
    table.string('crm_name_en', 255).notNullable();
    table.integer('sort').notNullable();
    table.boolean('can_user_view').notNullable().defaultTo(false);
    table.boolean('is_active').notNullable().defaultTo(false);
    table.string('customer_progress_type', 32).nullable();
    table.integer('total_repair_orders').notNullable().defaultTo(0);
    table.string('display_name_uz', 255).nullable();
    table.string('display_name_ru', 255).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['customer_code'], 'repair_order_status_names_customer_code_index');
    table.index(['branch_id', 'sort'], 'repair_order_status_names_branch_sort_index');
  });
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('repair_order_status_names');
};
