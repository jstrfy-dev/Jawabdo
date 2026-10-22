const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const { listMigrations, applyMigrations, getMigrationConnectionString } = require('./migrate');

describe('PostgreSQL migration management', () => {
  it('uses separate production migration/runtime roles for the same TLS database', () => {
    const env = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://runtime@db.example.test:5432/jawabdo',
      MIGRATION_DATABASE_URL: 'postgresql://migrator@db.example.test:5432/jawabdo',
      DATABASE_SSL: 'true',
    };
    assert.equal(getMigrationConnectionString(env), env.MIGRATION_DATABASE_URL);
    assert.throws(
      () => getMigrationConnectionString({ ...env, MIGRATION_DATABASE_URL: env.DATABASE_URL }),
      /separate PostgreSQL role/,
    );
    assert.throws(
      () => getMigrationConnectionString({ ...env, MIGRATION_DATABASE_URL: 'postgresql://migrator@db.example.test:5432/other' }),
      /same PostgreSQL database/,
    );
    assert.throws(
      () => getMigrationConnectionString({ ...env, DATABASE_SSL: 'false' }),
      /DATABASE_SSL=true/,
    );
    assert.throws(
      () => getMigrationConnectionString({ ...env, MIGRATION_DATABASE_URL: 'postgresql://migrator@localhost:5432/jawabdo' }),
      /deployed PostgreSQL host/,
    );
  });

  it('orders the checked-in migrations by numeric version', async () => {
    assert.deepEqual(await listMigrations(path.join(__dirname, 'migrations')), [
      '001_multi_tenant_core.sql',
      '002_reminder_delivery.sql',
      '003_webhook_delivery_status.sql',
      '004_customer_notes_tags.sql',
    ]);
  });

  it('rejects empty, duplicate-version, and gapped migration sequences', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jawabdo-migrations-'));
    try {
      await assert.rejects(listMigrations(directory), /No PostgreSQL migration files/);
      await fs.writeFile(path.join(directory, '001_initial.sql'), 'SELECT 1;');
      await fs.writeFile(path.join(directory, '003_gap.sql'), 'SELECT 1;');
      await assert.rejects(listMigrations(directory), /numbered sequentially/);
      await fs.writeFile(path.join(directory, '001_duplicate.sql'), 'SELECT 1;');
      await assert.rejects(listMigrations(directory), /version numbers must be unique/);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('records each migration once and rejects ledger entries without a matching file', async () => {
    const migrations = new Set();
    const executedFiles = [];
    const queries = [];
    const client = {
      async query(sql, parameters = []) {
        queries.push(sql);
        if (sql.startsWith('SELECT migration_name FROM')) {
          return { rows: [...migrations].map((migration_name) => ({ migration_name })) };
        }
        if (sql.startsWith('SELECT 1 FROM jawabdo_schema_migrations')) {
          return { rowCount: migrations.has(parameters[0]) ? 1 : 0 };
        }
        if (sql.startsWith('INSERT INTO jawabdo_schema_migrations')) {
          migrations.add(parameters[0]);
          return { rowCount: 1 };
        }
        if (sql.startsWith('CREATE EXTENSION')
          || (sql.startsWith('CREATE TABLE') && !sql.includes('jawabdo_schema_migrations'))
          || sql.startsWith('ALTER TABLE')
          || sql.startsWith('CREATE INDEX')
          || sql.startsWith('DO $$')) {
          executedFiles.push(sql);
        }
        return { rows: [], rowCount: 0 };
      },
    };
    const logger = { info() {} };
    const directory = path.join(__dirname, 'migrations');

    await applyMigrations(client, directory, logger);
    assert.equal(migrations.size, 4);
    const initialExecutionCount = executedFiles.length;
    await applyMigrations(client, directory, logger);
    assert.equal(executedFiles.length, initialExecutionCount);

    migrations.add('999_removed.sql');
    await assert.rejects(applyMigrations(client, directory, logger), /missing from this code release/);
    assert.ok(queries.some((query) => query.includes('pg_advisory_xact_lock')));
  });

  it('keeps tenant constraints additive and includes booking overlap protection', async () => {
    const core = await fs.readFile(path.join(__dirname, 'migrations', '001_multi_tenant_core.sql'), 'utf8');
    const delivery = await fs.readFile(path.join(__dirname, 'migrations', '003_webhook_delivery_status.sql'), 'utf8');
    const customer = await fs.readFile(path.join(__dirname, 'migrations', '004_customer_notes_tags.sql'), 'utf8');
    assert.doesNotMatch(`${core}\n${delivery}\n${customer}`, /\bDROP\s+TABLE\b|\bTRUNCATE\b/i);
    assert.match(core, /EXCLUDE USING gist/i);
    assert.match(core, /CHECK \(ends_at > starts_at\)/i);
    assert.match(core, /FOREIGN KEY \(business_id, customer_id\)/i);
    assert.match(core, /FORCE ROW LEVEL SECURITY/i);
    assert.match(delivery, /FORCE ROW LEVEL SECURITY/i);
    assert.match(customer, /ADD COLUMN IF NOT EXISTS/i);
  });
});
