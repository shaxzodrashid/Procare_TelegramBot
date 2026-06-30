import type { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.createTable('deployment_history', (table) => {
    table.bigIncrements('id').primary();
    table.timestamp('stopped_at', { useTz: true }).nullable();
    table.timestamp('started_at', { useTz: true }).nullable();
    table.specificType('shutdown_period', 'interval').nullable();
    table.integer('shutdown_period_seconds').nullable();
    table.string('git_commit_sha', 40).nullable();
    table.text('git_commit_message').nullable();
    table.string('status', 32).notNullable().defaultTo('started');
    table.text('note').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['stopped_at'], 'deployment_history_stopped_at_index');
    table.index(['started_at'], 'deployment_history_started_at_index');
    table.index(['status'], 'deployment_history_status_index');
  });
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('deployment_history');
};
