import type { Knex } from 'knex';

export const config = {
  transaction: false,
};

export const up = async (knex: Knex): Promise<void> => {
  await knex.raw("ALTER TYPE message_template_type ADD VALUE IF NOT EXISTS 'problem_start'");
  await knex.raw("ALTER TYPE message_template_type ADD VALUE IF NOT EXISTS 'problem_finished'");
};

export const down = async (): Promise<void> => {
  // PostgreSQL does not support removing values from an enum type.
};
