import { readdir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

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

interface RuntimeMigration {
  path: string;
  storedName: string;
}

const createStableMigrationSource = (
  migrationsDirectory: string,
  runtimeExtension: string,
): Knex.MigrationSource<RuntimeMigration> => ({
  async getMigrations() {
    const files = await readdir(migrationsDirectory);
    return files
      .filter((file) => extname(file) === `.${runtimeExtension}`)
      .sort()
      .map((file) => ({
        path: join(migrationsDirectory, file),
        storedName: `${basename(file, extname(file))}.ts`,
      }));
  },

  getMigrationName(migration) {
    return migration.storedName;
  },

  async getMigration(migration) {
    return (await import(pathToFileURL(migration.path).href)) as Knex.Migration;
  },
});

export const migrateDatabase = async (database: Knex): Promise<void> => {
  const migrationsDirectory = join(__dirname, 'migrations');
  const extension = extname(__filename);

  const hasTable = await database.schema.hasTable('knex_migrations');
  if (hasTable) {
    await database('knex_migrations')
      .where('name', 'like', '%.js')
      .update({
        name: database.raw("replace(name, '.js', '.ts')"),
      });
  }

  await database.migrate.latest({
    tableName: 'knex_migrations',
    migrationSource: createStableMigrationSource(migrationsDirectory, extension.slice(1)),
  });
};
