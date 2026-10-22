const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const {
  REQUIRED_MIGRATIONS,
  REQUIRED_RLS_TABLES,
  REQUIRED_TABLES,
  assertProductionDatabaseReady,
} = require('./production-readiness');

function readyPool(overrides = {}) {
  const role = { rolsuper: false, rolbypassrls: false, ...overrides.role };
  const migrations = overrides.migrations || REQUIRED_MIGRATIONS;
  const rlsRows = overrides.rlsRows || REQUIRED_TABLES.map((relname) => ({
    relname,
    relrowsecurity: true,
    relforcerowsecurity: true,
    has_policy: true,
  }));
  return {
    async query(sql) {
      if (sql.includes('FROM pg_roles')) return { rows: overrides.roles ? [] : [role] };
      if (sql.includes('jawabdo_schema_migrations')) {
        return { rows: migrations.map((migration_name) => ({ migration_name })) };
      }
      if (sql.includes('FROM pg_class')) return { rows: rlsRows };
      if (sql.includes('FROM pg_constraint')) return { rowCount: overrides.bookingConstraint === false ? 0 : 1, rows: [] };
      throw new Error(`Unexpected readiness query: ${sql}`);
    },
  };
}

describe('PostgreSQL production readiness', () => {
  it('requires all released migrations and forced RLS policies', async () => {
    await assert.doesNotReject(assertProductionDatabaseReady(readyPool()));
    await assert.rejects(
      assertProductionDatabaseReady(readyPool({ migrations: REQUIRED_MIGRATIONS.slice(0, -1) })),
      /schema migrations are incomplete/,
    );
    await assert.rejects(
      assertProductionDatabaseReady(readyPool({
        rlsRows: REQUIRED_TABLES.map((relname) => ({
          relname,
          relrowsecurity: relname !== 'businesses',
          relforcerowsecurity: true,
          has_policy: true,
        })),
      })),
      /tenant RLS is missing or incomplete/,
    );
    await assert.rejects(
      assertProductionDatabaseReady(readyPool({ bookingConstraint: false })),
      /booking overlap constraint is missing/,
    );
  });

  it('rejects superuser and BYPASSRLS runtime roles', async () => {
    await assert.rejects(
      assertProductionDatabaseReady(readyPool({ role: { rolsuper: true } })),
      /non-superuser role/,
    );
    await assert.rejects(
      assertProductionDatabaseReady(readyPool({ role: { rolbypassrls: true } })),
      /non-superuser role/,
    );
    await assert.rejects(
      assertProductionDatabaseReady(readyPool({ roles: true })),
      /non-superuser role/,
    );
  });
});
