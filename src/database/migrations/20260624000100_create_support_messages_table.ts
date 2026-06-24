import type { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.createTable('support_messages', (table) => {
    table.bigIncrements('id').primary();
    table.string('crm_comment_id', 64).notNullable();
    table.string('crm_client_id', 64).notNullable();
    table.uuid('repair_order_id').notNullable();
    table.string('order_number', 64).notNullable();
    table.bigInteger('user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    table.bigInteger('telegram_id').notNullable();
    table.bigInteger('telegram_chat_id').notNullable();
    table.integer('telegram_message_id').notNullable();
    table.timestamp('telegram_message_date', { useTz: true }).nullable();
    table
      .enu('sender_type', ['client', 'employee'], {
        useNative: true,
        enumName: 'support_message_sender_type',
      })
      .notNullable();
    table
      .enu('direction', ['inbound', 'outbound'], {
        useNative: true,
        enumName: 'support_message_direction',
      })
      .notNullable();
    table
      .enu('content_type', ['text', 'photo'], {
        useNative: true,
        enumName: 'support_message_content_type',
      })
      .notNullable();
    table.text('text').nullable();
    table.integer('photo_count').notNullable().defaultTo(0);
    table
      .bigInteger('reply_to_support_message_id')
      .nullable()
      .references('id')
      .inTable('support_messages')
      .onDelete('SET NULL');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(['telegram_chat_id', 'telegram_message_id'], 'support_messages_telegram_unique');
    table.index(['crm_comment_id'], 'support_messages_crm_comment_id_index');
    table.index(['repair_order_id'], 'support_messages_repair_order_id_index');
    table.index(['crm_client_id'], 'support_messages_crm_client_id_index');
    table.index(['user_id'], 'support_messages_user_id_index');
    table.index(['reply_to_support_message_id'], 'support_messages_reply_to_index');
  });
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('support_messages');
  await knex.schema.raw('DROP TYPE IF EXISTS support_message_content_type');
  await knex.schema.raw('DROP TYPE IF EXISTS support_message_direction');
  await knex.schema.raw('DROP TYPE IF EXISTS support_message_sender_type');
};
