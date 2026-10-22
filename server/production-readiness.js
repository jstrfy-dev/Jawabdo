const REQUIRED_MIGRATIONS = [
  '001_multi_tenant_core.sql',
  '002_reminder_delivery.sql',
  '003_webhook_delivery_status.sql',
  '004_customer_notes_tags.sql',
];

const REQUIRED_RLS_TABLES = [
  'businesses',
  'business_memberships',
  'services',
  'business_faqs',
  'whatsapp_connections',
  'customers',
  'conversations',
  'messages',
  'bookings',
  'reminder_jobs',
  'webhook_events',
  'whatsapp_delivery_statuses',
  'signup_sessions',
];
const REQUIRED_TABLES = ['app_users', ...REQUIRED_RLS_TABLES];

async function assertProductionDatabaseReady(pool) {
  const roleResult = await pool.query(
    'SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user',
  );
  const role = roleResult.rows[0];
  if (!role || role.rolsuper || role.rolbypassrls) {
    throw new Error('PostgreSQL runtime account must be a non-superuser role without BYPASSRLS.');
  }

  const migrationResult = await pool.query(
    'SELECT migration_name FROM jawabdo_schema_migrations',
  );
  const appliedMigrations = new Set(migrationResult.rows.map((row) => row.migration_name));
  const missingMigrations = REQUIRED_MIGRATIONS.filter((migration) => !appliedMigrations.has(migration));
  if (missingMigrations.length) {
    throw new Error(`PostgreSQL schema migrations are incomplete: ${missingMigrations.join(', ')}.`);
  }

  const tableResult = await pool.query(
    `SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,
       EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid) AS has_policy
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname=current_schema() AND c.relname=ANY($1::text[]) AND c.relkind='r'`,
    [REQUIRED_TABLES],
  );
  const relations = new Map(tableResult.rows.map((row) => [row.relname, row]));
  const missingTables = REQUIRED_TABLES.filter((table) => !relations.has(table));
  if (missingTables.length) {
    throw new Error(`PostgreSQL schema tables are missing: ${missingTables.join(', ')}.`);
  }
  const unsafeTables = REQUIRED_RLS_TABLES.filter((table) => {
    const relation = relations.get(table);
    return !relation || !relation.relrowsecurity || !relation.relforcerowsecurity || !relation.has_policy;
  });
  if (unsafeTables.length) {
    throw new Error(`PostgreSQL tenant RLS is missing or incomplete for: ${unsafeTables.join(', ')}.`);
  }

  const bookingConstraint = await pool.query(
    `SELECT 1 FROM pg_constraint c
     JOIN pg_class r ON r.oid=c.conrelid
     JOIN pg_namespace n ON n.oid=r.relnamespace
     WHERE n.nspname=current_schema() AND r.relname='bookings'
       AND c.contype='x' AND c.convalidated`,
  );
  if (!bookingConstraint.rowCount) {
    throw new Error('PostgreSQL confirmed-booking overlap constraint is missing.');
  }
}

module.exports = {
  REQUIRED_MIGRATIONS,
  REQUIRED_RLS_TABLES,
  REQUIRED_TABLES,
  assertProductionDatabaseReady,
};
