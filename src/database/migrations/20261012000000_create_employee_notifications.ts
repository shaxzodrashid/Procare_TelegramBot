import type { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.createTable('employee_notification_types', (table) => {
    table.string('key', 32).primary();
    table.string('name_uz', 120).notNullable();
    table.string('name_ru', 120).notNullable();
    table.boolean('is_active').notNullable().defaultTo(true);
    table.boolean('default_enabled').notNullable().defaultTo(true);
    table.jsonb('message_template').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('employee_notification_preferences', (table) => {
    // CRM account identity intentionally applies to every linked Telegram user.
    table.string('crm_admin_id', 255).notNullable();
    table
      .string('type_key', 32)
      .notNullable()
      .references('key')
      .inTable('employee_notification_types');
    table.boolean('enabled').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['crm_admin_id', 'type_key']);
  });
  await knex('employee_notification_types').insert({
    key: 'support_comment',
    name_uz: 'Mijoz xabarlari',
    name_ru: 'Сообщения клиентов',
    is_active: true,
    default_enabled: true,
    message_template: {
      parseMode: 'HTML',
      localizedMessages: {
        uz: '💬 Buyurtma #{{number}} bo‘yicha yangi mijoz xabari bor.\nID: <code>{{id}}</code>\n\nIltimos, CRM’da tekshiring.',
        ru: '💬 По заказу #{{number}} есть новое сообщение от клиента.\nID: <code>{{id}}</code>\n\nПожалуйста, проверьте в CRM.',
      },
    },
  });
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('employee_notification_preferences');
  await knex.schema.dropTableIfExists('employee_notification_types');
};
