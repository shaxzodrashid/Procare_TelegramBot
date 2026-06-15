import { extname, join } from 'node:path';

import knex, { type Knex } from 'knex';

import type { AppConfig } from '../config/index.js';

export const createDatabase = (config: AppConfig['database']): Knex =>
  knex({
    client: 'pg',
    connection: {
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.name,
      ssl: config.ssl ? { rejectUnauthorized: false } : false,
    },
    pool: {
      min: config.poolMin,
      max: config.poolMax,
    },
    acquireConnectionTimeout: config.acquireTimeoutMs,
  });

export const migrateDatabase = async (database: Knex): Promise<void> => {
  const migrationsDirectory = join(__dirname, 'migrations');
  const extension = extname(__filename);

  await database.migrate.latest({
    directory: migrationsDirectory,
    extension: extension.slice(1),
    tableName: 'knex_migrations',
  });
};
