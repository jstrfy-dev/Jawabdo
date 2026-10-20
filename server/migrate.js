const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL before running database migrations.');
  const databaseUrl = new URL(process.env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
    throw new Error('DATABASE_URL must use PostgreSQL.');
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: String(process.env.DATABASE_SSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: true } : false,
    max: 1,
    connectionTimeoutMillis: 5000,
  });

  try {
    const client = await pool.connect();
    try {
      await client.query(
        `CREATE TABLE IF NOT EXISTS jawabdo_schema_migrations (
          migration_name text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )`,
      );
      const directory = path.join(__dirname, 'migrations');
      const migrations = (await fs.readdir(directory))
        .filter((name) => /^\d+_[a-z0-9_]+\.sql$/i.test(name))
        .sort();
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
            console.info(JSON.stringify({ event: 'database_migration_applied', migration: migrationName }));
          }
          await client.query('COMMIT');
        } catch (error) {
          try { await client.query('ROLLBACK'); } catch {}
          throw error;
        }
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ event: 'database_migration_failed', message: error.message }));
  process.exitCode = 1;
});
