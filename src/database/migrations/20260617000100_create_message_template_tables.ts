import type { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.createTable('message_templates', (table) => {
    table.bigIncrements('id').primary();
    table.string('template_key', 120).notNullable().unique();
    table
      .enu(
        'template_type',
        ['warranty', 'offerta', 'checklist', 'problem_start', 'problem_finished'],
        {
          useNative: true,
          enumName: 'message_template_type',
        },
      )
      .notNullable();
    table.string('title', 255).notNullable();
    table.text('content_uz').notNullable();
    table.text('content_ru').notNullable();
    table.string('channel', 50).notNullable().defaultTo('telegram_bot');
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['template_type'], 'message_templates_template_type_index');
    table.index(['is_active'], 'message_templates_is_active_index');
  });

  await knex.schema.createTable('message_dispatch_logs', (table) => {
    table.bigIncrements('id').primary();
    table.bigInteger('user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    table
      .bigInteger('template_id')
      .nullable()
      .references('id')
      .inTable('message_templates')
      .onDelete('SET NULL');
    table.string('dispatch_type', 50).notNullable();
    table.string('status', 50).notNullable();
    table.text('error_message').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['user_id'], 'message_dispatch_logs_user_id_index');
    table.index(['dispatch_type'], 'message_dispatch_logs_dispatch_type_index');
  });
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('message_dispatch_logs');
  await knex.schema.dropTableIfExists('message_templates');
  await knex.schema.raw('DROP TYPE IF EXISTS message_template_type');
};
