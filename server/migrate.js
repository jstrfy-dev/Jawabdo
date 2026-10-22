const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const { isLocalDatabaseHost } = require('./config');

const MIGRATION_PATTERN = /^(\d+)_([a-z0-9_]+)\.sql$/i;

async function listMigrations(directory = path.join(__dirname, 'migrations')) {
  const filenames = (await fs.readdir(directory))
    .filter((name) => MIGRATION_PATTERN.test(name))
    .sort((left, right) => {
      const leftVersion = Number(left.match(MIGRATION_PATTERN)[1]);
      const rightVersion = Number(right.match(MIGRATION_PATTERN)[1]);
      return leftVersion - rightVersion || left.localeCompare(right);
    });
  if (!filenames.length) throw new Error('No PostgreSQL migration files were found.');
  const versions = filenames.map((name) => Number(name.match(MIGRATION_PATTERN)[1]));
  if (versions.some((version, index) => index > 0 && version === versions[index - 1])) {
    throw new Error('PostgreSQL migration version numbers must be unique.');
  }
  if (versions.some((version, index) => version !== index + 1)) {
    throw new Error('PostgreSQL migrations must be numbered sequentially starting at 001.');
  }
  return filenames;
}

async function applyMigrations(client, directory, logger = console) {
  const migrations = await listMigrations(directory);
  await client.query(
    `CREATE TABLE IF NOT EXISTS jawabdo_schema_migrations (
      migration_name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`,
  );
  const appliedResult = await client.query('SELECT migration_name FROM jawabdo_schema_migrations');
  const knownMigrations = new Set(migrations);
  const unknownMigrations = appliedResult.rows
    .map((row) => row.migration_name)
    .filter((name) => !knownMigrations.has(name));
  if (unknownMigrations.length) {
    throw new Error(`Database has migration records missing from this code release: ${unknownMigrations.join(', ')}.`);
  }

  for (const migrationName of migrations) {
    await client.query('BEGIN');
    try {
      await client.query('SELECT pg_advisory_xact_lock(74192026)');
      const existing = await client.query(
        'SELECT 1 FROM jawabdo_schema_migrations WHERE migration_name=$1',
        [migrationName],
      );
      if (!existing.rowCount) {
        const migration = await fs.readFile(path.join(directory, migrationName), 'utf8');
        await client.query(migration);
        await client.query(
          'INSERT INTO jawabdo_schema_migrations(migration_name) VALUES($1)',
          [migrationName],
        );
        logger.info(JSON.stringify({ event: 'database_migration_applied', migration: migrationName }));
      }
      await client.query('COMMIT');
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `Migration ${migrationName} failed and rollback also failed.`,
        );
      }
      throw error;
    }
  }
}

function getMigrationConnectionString(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const connectionString = production
    ? env.MIGRATION_DATABASE_URL
    : env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(production
      ? 'Set MIGRATION_DATABASE_URL to the separate PostgreSQL migration account before running production migrations.'
      : 'Set DATABASE_URL before running database migrations.');
  }
  const databaseUrl = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
    throw new Error('Migration database URL must use PostgreSQL.');
  }
  if (production) {
    if (!env.DATABASE_URL) {
      throw new Error('Set DATABASE_URL to the separate PostgreSQL runtime account when running production migrations.');
    }
    const runtimeUrl = new URL(env.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(runtimeUrl.protocol)) {
      throw new Error('DATABASE_URL must use PostgreSQL.');
    }
    if (!databaseUrl.username || databaseUrl.username === runtimeUrl.username) {
      throw new Error('MIGRATION_DATABASE_URL must use a separate PostgreSQL role from DATABASE_URL.');
    }
    if (String(env.DATABASE_SSL || '').toLowerCase() !== 'true') {
      throw new Error('DATABASE_SSL=true is required for production migrations.');
    }
    if (isLocalDatabaseHost(databaseUrl.hostname) || isLocalDatabaseHost(runtimeUrl.hostname)) {
      throw new Error('Production DATABASE_URL must use the deployed PostgreSQL host, not a local address.');
    }
    if (databaseUrl.host !== runtimeUrl.host || databaseUrl.pathname !== runtimeUrl.pathname) {
      throw new Error('MIGRATION_DATABASE_URL and DATABASE_URL must target the same PostgreSQL database.');
    }
  }
  return connectionString;
}

async function main() {
  const connectionString = getMigrationConnectionString();
  const pool = new Pool({
    connectionString,
    ssl: String(process.env.DATABASE_SSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: true } : false,
    max: 1,
    connectionTimeoutMillis: 5000,
  });

  try {
    const client = await pool.connect();
    try {
      await applyMigrations(client, path.join(__dirname, 'migrations'));
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ event: 'database_migration_failed', message: error.message }));
    process.exitCode = 1;
  });
}

module.exports = { listMigrations, applyMigrations, getMigrationConnectionString };
