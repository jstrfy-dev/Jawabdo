# PostgreSQL production operations

PostgreSQL is the sole production database. The API and worker run from `server/production-index.js` and use only `DATABASE_URL`. Production web and mobile builds must use the same deployed API origin via `EXPO_PUBLIC_API_URL`; they do not connect to PostgreSQL directly.

## Local PostgreSQL

1. Create a local PostgreSQL database without deleting or reusing the JawabDo MySQL database.
2. Copy `.env.example` to `.env` only if `.env` does not already exist. Preserve existing settings and secrets.
3. For local development, set `NODE_ENV=development`, `DATABASE_URL` to the local PostgreSQL connection, `DATABASE_SSL=false`, and strong independent `JWT_SECRET` and `ENCRYPTION_KEY` values.
4. Apply the tracked migrations with `npm run db:migrate`, then start the API with `npm run server:dev`.
5. Verify `http://localhost:3000/health` and `http://localhost:3000/api/config/public`. The public configuration reports `databaseDriver: postgres` and never returns connection credentials.

The Expo app defaults to localhost for web and iOS, and the Expo host address / `10.0.2.2` fallback on Android development. A physical Android device needs the computer's LAN API URL in `EXPO_PUBLIC_API_URL` and a private-network firewall rule.

## Production roles and configuration

Use the hosting provider's managed PostgreSQL 15+ (or newer supported version), private networking where available, and TLS certificate verification. Configure:

- `NODE_ENV=production`
- `DATABASE_URL`: PostgreSQL connection for the API/worker using a dedicated least-privilege runtime role.
- `DATABASE_SSL=true`
- `JWT_SECRET` and `ENCRYPTION_KEY` in the API host's secret store.
- `CORS_ORIGINS`: comma-separated HTTPS origins of the production web client.
- `MIGRATION_DATABASE_URL`: a separate migration role used only by the deployment migration job.
- `EXPO_PUBLIC_API_URL`: the same deployed HTTPS API origin for web and mobile builds; this is public configuration, not a secret.

Do not use a provider's `postgres`/admin account for the running API. The API performs a startup check and refuses superuser or `BYPASSRLS` roles, missing migration records, missing/unenforced tenant RLS policies, and a missing validated booking exclusion constraint. These checks are additional protection, not a substitute for staging tests and provider permission review.

The migration role needs DDL privileges on the JawabDo schema and permission to install `btree_gist` (or the provider must pre-install it). The runtime role needs only the table DML operations required by the API/worker, schema `USAGE`, connection access, and `SELECT` on `jawabdo_schema_migrations`; it must have neither superuser nor `BYPASSRLS`. Set default table privileges for the migration role so future additive tables receive the intended runtime grants. Confirm actual privileges with the provider's role inspection tools before launch.

Run migrations as a separate, reviewed deployment step:

```powershell
$env:NODE_ENV = 'production'
# Supply DATABASE_URL, MIGRATION_DATABASE_URL, and DATABASE_SSL=true
# from a deployment secret store; do not paste secrets into chat or commit them.
npm run db:migrate
```

`MIGRATION_DATABASE_URL` must use a different PostgreSQL role from `DATABASE_URL`; production migration execution refuses matching usernames, local DB hosts, or missing TLS. The API does not auto-run migrations on startup. Migration files are sorted and checked for sequential unique versions, applied under an advisory lock, and tracked in `jawabdo_schema_migrations`. The runner rejects ledger entries whose migration files are absent. Migrations 001–004 are the current schema baseline; no migration was added in this step.

After migrations, deploy `npm run server:start`. Its readiness check verifies that all current migration versions are recorded, all required core tables exist, required business tables have forced RLS and policies, the runtime role cannot bypass RLS, and confirmed bookings have their exclusion constraint. Never expose either database URL to Expo or a browser.

## Schema and booking invariants

Migration `001_multi_tenant_core.sql` defines users, businesses, memberships, services, FAQs, WhatsApp connections, customers, conversations, messages, bookings, reminders, webhooks, and signup sessions. Business-owned records carry `business_id`; composite foreign keys tie conversations/messages/bookings to records in the same business. Tenant RLS is enabled and forced on business data, with transaction-local user/business context from verified JWT claims and additional application membership/role checks. The account table remains a global identity lookup and is not a tenant-owned record.

Bookings store UTC instants in `starts_at`/`ends_at` (`timestamptz`) plus the business IANA `timezone`; duration is derived from the selected active service. The current product flow creates confirmed bookings only after the authenticated caller asserts customer confirmation. Same-business, same-staff confirmed overlaps are rejected by a GiST exclusion constraint and serialized application transactions; cancelled bookings no longer occupy the slot. This endpoint assertion is not proof of customer consent. Business rules for pending reservations, staff-specific opening hours, and customer-side consent evidence remain product decisions to validate.

Unit tests simulate database queries. To run real PostgreSQL integration tests, provision a dedicated, pre-migrated, disposable database whose name contains `test`, separate from `DATABASE_URL`, and with a non-production runtime role/schema. The migration role must apply the schema first; never run `npm run db:migrate` while `DATABASE_URL` still points at a non-test database. For a local setup, set `DATABASE_URL` in the migration process to the test-only migration-role URL, then run:

```powershell
$migrationUrlLine = Select-String -Path .env -Pattern '^JAWABDO_TEST_MIGRATION_DATABASE_URL='
$env:DATABASE_URL = $migrationUrlLine.Line.Substring('JAWABDO_TEST_MIGRATION_DATABASE_URL='.Length)
npm run db:migrate
```

Set the integration-test runtime URL and explicitly opt in:

```powershell
$runtimeUrlLine = Select-String -Path .env -Pattern '^JAWABDO_TEST_RUNTIME_DATABASE_URL='
$env:JAWABDO_TEST_DATABASE_URL = $runtimeUrlLine.Line.Substring('JAWABDO_TEST_RUNTIME_DATABASE_URL='.Length)
$env:JAWABDO_PG_INTEGRATION = '1'
npm test
```

Set `JAWABDO_TEST_DATABASE_SSL=true` if the test provider requires TLS. The suite checks the migration ledger and production schema invariants, then tests API signup/login and business session context, cross-business customer reads/writes and service deletion, overlapping and concurrent bookings, and rollback. It creates uniquely identified fixture users/businesses and deletes only those fixtures in cleanup; it does not reset the database. Its dedicated database URL must not target the configured application database. Never point it at production or the only copy of user data. If `JAWABDO_PG_INTEGRATION=1` is set without a test URL, the suite fails explicitly rather than silently skipping.

## Backup, restore, and recovery

Use the hosting provider's encrypted automated backups and point-in-time recovery (PITR) when available. Configure retention, backup region, encryption key ownership, alerting, and access control according to the business's approved recovery point objective (RPO) and recovery time objective (RTO). Restrict restores and exports to designated operators; do not store backup files, credentials, or encryption keys in this repository.

For an additional operator-managed logical backup, use PostgreSQL client tools against a protected `pg_service.conf` service definition and OS-protected `pgpass.conf` (Windows ACLs restricted to the operator/service account). Keep passwords out of command-line connection strings and command history:

```powershell
$env:PGSERVICEFILE = '<protected path>\pg_service.conf'
$env:PGPASSFILE = '<protected path>\pgpass.conf'
$env:PGSERVICE = 'jawabdo-backup'
pg_dump --format=custom --no-owner --no-acl --file '<encrypted private backup location>\jawabdo.dump' 'service=jawabdo-backup'
pg_restore --list '<encrypted private backup location>\jawabdo.dump'
```

The service definition must use the provider's TLS verification options; the passfile must be protected with Windows ACLs and excluded from source control. Encrypt and transfer the resulting dump using the provider/organization's approved encrypted storage. Store the recovery key separately from the backup.

At least once before launch, and on the operational schedule thereafter:

1. Restore a recent backup or PITR point into a new isolated non-production database using the provider's supported restore workflow. Do not restore over production.
2. Confirm migration ledger versions, required table counts, representative business/customer/booking/message counts, and application startup readiness. Compare anonymized counts/IDs; avoid exporting message text unnecessarily.
3. Test login and tenant separation with separate test businesses, then perform a controlled booking/cancellation smoke test.
4. Record restore duration, selected recovery point, integrity checks, operator, and any data loss against RPO. Remove the isolated restored copy through the provider's approved process after sign-off.

No PostgreSQL backup or restore was performed as part of this code change. Hosting-provider backup, encryption, retention, PITR, and restore workflows still require configuration and an observed successful restore test.

## MySQL local development and eventual data migration

The XAMPP MySQL runtime remains available for local development only. Production MySQL startup is rejected when `NODE_ENV=production`; the production API requires PostgreSQL. PostgreSQL and MySQL are separate databases. The application does not copy accounts or business data between them.

Do not retire the MySQL implementation until local developers have deliberately moved to PostgreSQL or no longer require it. If existing MySQL accounts/data must move, first make a separately reviewed migration project:

1. Inventory MySQL row counts, business/user memberships, email uniqueness, status values, IDs, timestamps/time zones, JSON fields, orphaned references, and any discrepancies. Identify source owners and obtain a maintenance window.
2. Take provider/XAMPP-managed, verified backups of both databases. Do not edit or reset either database during assessment.
3. Design an explicit field-by-field mapping for users, businesses, memberships, services/prices, FAQs, customers, conversations/messages, and appointments. Preserve stable UUIDs where safe; resolve normalized-email duplicates and constraint conflicts before loading.
4. Confirm password-hash compatibility (both current runtimes use the same scrypt encoding) and account/session handling. Existing tokens remain tied to the signing secret and business IDs; plan a controlled re-login if signing keys or IDs change.
5. Build a one-time importer separately, first run it against disposable staging copies, and reconcile per-table counts, foreign keys, tenant ownership, timestamps, and booking overlap constraints. Require a reviewed cutover/rollback plan and explicit approval before any production import.
6. Switch all clients to the PostgreSQL API only after reconciliation and sign-off. Keep the source MySQL backup read-only through the agreed retention period; never auto-import on app startup.

`server/mysql-api.js`, `server/mysql-db.js`, `server/mysql-index.js`, `server/check-mysql.js`, `server/mysql-api.test.js`, `database/jawabdo.sql`, the `mysql:start`/`mysql:check` scripts, and `mysql2` remain needed for local MySQL support. Only after an explicit decision to stop supporting local XAMPP should their callers, documentation, tests, schema, and dependency be retired together. No retirement or data migration was performed here.
