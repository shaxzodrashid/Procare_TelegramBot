import type { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.raw(
    "ALTER TYPE support_message_content_type ADD VALUE IF NOT EXISTS 'document'",
  );
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.raw(
    "UPDATE support_messages SET content_type = 'text' WHERE content_type = 'document'",
  );
  await knex.schema.raw(
    'ALTER TYPE support_message_content_type RENAME TO support_message_content_type_old',
  );
  await knex.schema.raw("CREATE TYPE support_message_content_type AS ENUM ('text', 'photo')");
  await knex.schema.raw(`
    ALTER TABLE support_messages
    ALTER COLUMN content_type TYPE support_message_content_type
    USING content_type::text::support_message_content_type
  `);
  await knex.schema.raw('DROP TYPE support_message_content_type_old');
};
