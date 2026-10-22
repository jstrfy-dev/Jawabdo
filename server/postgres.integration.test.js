const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { createServer } = require('node:http');
const { after, before, describe, it } = require('node:test');
const { Pool } = require('pg');
const { createApiHandler } = require('./api');
const { withTransaction } = require('./db');
const { assertProductionDatabaseReady } = require('./production-readiness');
const { signToken } = require('./security');

const testDatabaseUrl = process.env.JAWABDO_TEST_DATABASE_URL;
const integrationEnabled = process.env.JAWABDO_PG_INTEGRATION === '1';

function validateDedicatedTestDatabase() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('PostgreSQL integration tests cannot run with NODE_ENV=production.');
  }
  const target = new URL(testDatabaseUrl);
  if (!['postgres:', 'postgresql:'].includes(target.protocol)) {
    throw new Error('JAWABDO_TEST_DATABASE_URL must use PostgreSQL.');
  }
  const databaseName = decodeURIComponent(target.pathname.slice(1)).toLowerCase();
  if (!databaseName.includes('test')) {
    throw new Error('JAWABDO_TEST_DATABASE_URL database name must include "test".');
  }
  if (process.env.DATABASE_URL) {
    const configured = new URL(process.env.DATABASE_URL);
    if (target.host === configured.host && target.pathname === configured.pathname) {
      throw new Error('JAWABDO_TEST_DATABASE_URL must not point to the configured application database.');
    }
  }
  return target;
}

describe('PostgreSQL database integration', { skip: !integrationEnabled }, () => {
  let pool;
  let server;
  let baseUrl;
  let jwtSecret;
  let businessA;
  let businessB;
  let userA;
  let userB;
  let registeredBusinessId;
  let registeredUserId;
  let serviceA;
  let serviceB;
  let customerB;
  let tokenA;

  async function createBooking({ startsAt, staffKey = 'integration-staff', customerPhone = '15550000001' }) {
    return fetch(`${baseUrl}/api/bookings`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tokenA}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        customerPhone,
        customerName: 'Postgres Integration Customer',
        serviceId: serviceA,
        startsAt,
        customerConfirmed: true,
        staffKey,
      }),
    });
  }

  before(async () => {
    if (!testDatabaseUrl) throw new Error('Set JAWABDO_TEST_DATABASE_URL to a dedicated pre-migrated test database.');
    validateDedicatedTestDatabase();
    pool = new Pool({
      connectionString: testDatabaseUrl,
      ssl: process.env.JAWABDO_TEST_DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false,
      max: 6,
      connectionTimeoutMillis: 5000,
    });
    await pool.query('SELECT 1');
    await assertProductionDatabaseReady(pool);

    jwtSecret = randomBytes(48).toString('base64url');
    userA = randomUUID();
    userB = randomUUID();
    businessA = randomUUID();
    businessB = randomUUID();
    serviceA = randomUUID();
    serviceB = randomUUID();
    customerB = randomUUID();

    const openingHours = JSON.stringify(Array.from({ length: 7 }, (_, dayOfWeek) => ({
      dayOfWeek,
      closed: false,
      open: '00:00',
      close: '23:59',
    })));
    await withTransaction(pool, async (client) => {
      await client.query(
        "SELECT set_config('app.current_user_id',$1,true),set_config('app.current_business_id',$2,true)",
        [userA, businessA],
      );
      await client.query(
        "INSERT INTO app_users(id,email,password_hash,email_verified_at) VALUES($1,$2,'integration-test',now())",
        [userA, `${userA}@integration.test`],
      );
      await client.query(
        "INSERT INTO businesses(id,name,timezone,opening_hours) VALUES($1,'Integration business A','UTC',$2::jsonb)",
        [businessA, openingHours],
      );
      await client.query(
        "INSERT INTO business_memberships(business_id,user_id,role) VALUES($1,$2,'owner')",
        [businessA, userA],
      );
      await client.query(
        "INSERT INTO services(id,business_id,name,duration_minutes) VALUES($1,$2,'Integration service A',30)",
        [serviceA, businessA],
      );

      await client.query(
        "SELECT set_config('app.current_user_id',$1,true),set_config('app.current_business_id',$2,true)",
        [userB, businessB],
      );
      await client.query(
        "INSERT INTO app_users(id,email,password_hash,email_verified_at) VALUES($1,$2,'integration-test',now())",
        [userB, `${userB}@integration.test`],
      );
      await client.query(
        "INSERT INTO businesses(id,name,timezone,opening_hours) VALUES($1,'Integration business B','UTC',$2::jsonb)",
        [businessB, openingHours],
      );
      await client.query(
        "INSERT INTO business_memberships(business_id,user_id,role) VALUES($1,$2,'owner')",
        [businessB, userB],
      );
      await client.query(
        "INSERT INTO services(id,business_id,name,duration_minutes) VALUES($1,$2,'Integration service B',30)",
        [serviceB, businessB],
      );
      const customer = await client.query(
        "INSERT INTO customers(business_id,whatsapp_user_id,display_name,phone_number) VALUES($1,$2,'Business B customer',$2) RETURNING id",
        [businessB, `${userB.slice(0, 12)}55500001`],
      );
      customerB = customer.rows[0].id;
    });

    tokenA = signToken({ sub: userA, businessId: businessA }, jwtSecret);
    const config = {
      jwtSecret,
      nodeEnv: 'test',
      corsOrigins: [],
      encryptionKey: randomBytes(32),
      metaAppId: '',
      metaAppSecret: '',
      embeddedSignupConfigId: '',
      apiVersion: '',
      verifyToken: '',
    };
    const handleApi = createApiHandler(config, pool, { logger: { info() {}, error() {} } });
    server = createServer(async (request, response) => {
      const handled = await handleApi(request, response, new URL(request.url || '/', 'http://localhost'));
      if (!handled) {
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'Not found.' }));
      }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server?.listening) {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    if (pool) {
      try {
        if ([businessA, businessB, registeredBusinessId, userA, userB, registeredUserId].some(Boolean)) {
          await withTransaction(pool, async (client) => {
            await client.query(
              'DELETE FROM businesses WHERE id=ANY($1::uuid[])',
              [[businessA, businessB, registeredBusinessId].filter(Boolean)],
            );
            await client.query(
              'DELETE FROM app_users WHERE id=ANY($1::uuid[])',
              [[userA, userB, registeredUserId].filter(Boolean)],
            );
          }, { worker: true });
        }
      } finally {
        await pool.end();
      }
    }
  });

  it('registers, persists, logs in, and restores authorized business context', async () => {
    const email = `pg-${randomUUID()}@integration.test`;
    const password = randomBytes(24).toString('base64url');
    const signupResponse = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, businessName: 'Integration signup business' }),
    });
    assert.equal(signupResponse.status, 201);
    const signup = await signupResponse.json();
    registeredUserId = signup.user.id;
    registeredBusinessId = signup.business.id;

    const storedAccount = await pool.query(
      'SELECT password_hash <> $2 AS password_is_hashed FROM app_users WHERE id=$1 AND email=$3',
      [registeredUserId, password, email],
    );
    assert.equal(storedAccount.rowCount, 1);
    assert.equal(storedAccount.rows[0].password_is_hashed, true);

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(loginResponse.status, 200);
    const login = await loginResponse.json();

    const sessionResponse = await fetch(`${baseUrl}/api/me`, {
      headers: { authorization: `Bearer ${login.accessToken}` },
    });
    assert.equal(sessionResponse.status, 200);
    const session = await sessionResponse.json();
    assert.equal(session.user.id, registeredUserId);
    assert.equal(session.business.id, registeredBusinessId);

    const servicesResponse = await fetch(`${baseUrl}/api/services`, {
      headers: { authorization: `Bearer ${login.accessToken}` },
    });
    assert.equal(servicesResponse.status, 200);
    assert.deepEqual((await servicesResponse.json()).services, []);

    const rejectedLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: `${password}wrong` }),
    });
    assert.equal(rejectedLogin.status, 401);
  });

  it('matches the live migration ledger to the checked-in migration sequence', async () => {
    const { listMigrations } = require('./migrate');
    const expected = await listMigrations();
    const ledger = await pool.query(
      'SELECT migration_name FROM jawabdo_schema_migrations ORDER BY migration_name',
    );
    assert.deepEqual(ledger.rows.map((row) => row.migration_name), expected);
    await assertProductionDatabaseReady(pool);
  });

  it('prevents overlaps, releases cancelled slots, and serializes simultaneous bookings', async () => {
    const slot = new Date(Date.now() + 48 * 60 * 60 * 1000);
    slot.setUTCHours(10, 0, 0, 0);
    const first = await createBooking({ startsAt: slot.toISOString(), staffKey: 'integration-overlap' });
    assert.equal(first.status, 201);
    const firstBooking = (await first.json()).booking;

    const overlap = await createBooking({
      startsAt: new Date(slot.getTime() + 15 * 60 * 1000).toISOString(),
      staffKey: 'integration-overlap',
      customerPhone: '15550000002',
    });
    assert.equal(overlap.status, 409);
    assert.equal((await overlap.json()).code, 'booking_conflict');

    const cancelled = await fetch(`${baseUrl}/api/bookings/${firstBooking.id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    });
    assert.equal(cancelled.status, 200);
    const afterCancellation = await createBooking({
      startsAt: slot.toISOString(),
      staffKey: 'integration-overlap',
      customerPhone: '15550000003',
    });
    assert.equal(afterCancellation.status, 201);

    const concurrentSlot = new Date(slot.getTime() + 60 * 60 * 1000).toISOString();
    const concurrent = await Promise.all([
      createBooking({ startsAt: concurrentSlot, staffKey: 'integration-concurrent', customerPhone: '15550000004' }),
      createBooking({ startsAt: concurrentSlot, staffKey: 'integration-concurrent', customerPhone: '15550000005' }),
    ]);
    assert.deepEqual(concurrent.map((response) => response.status).sort(), [201, 409]);
  });

  it('rejects invalid appointment times and rolls back failed booking side effects', async () => {
    const invalid = await createBooking({ startsAt: '2099-01-01T10:00:00' });
    assert.equal(invalid.status, 400);

    const slot = new Date(Date.now() + 72 * 60 * 60 * 1000);
    slot.setUTCHours(11, 0, 0, 0);
    const first = await createBooking({ startsAt: slot.toISOString(), staffKey: 'integration-rollback' });
    assert.equal(first.status, 201);
    const failedPhone = '15550000006';
    const conflict = await createBooking({
      startsAt: new Date(slot.getTime() + 10 * 60 * 1000).toISOString(),
      staffKey: 'integration-rollback',
      customerPhone: failedPhone,
    });
    assert.equal(conflict.status, 409);

    const customerResult = await withTransaction(pool, async (client) => client.query(
      'SELECT id FROM customers WHERE business_id=$1 AND phone_number=$2',
      [businessA, failedPhone],
    ), { userId: userA, businessId: businessA });
    assert.equal(customerResult.rowCount, 0);

    const rollbackServiceId = randomUUID();
    await assert.rejects(withTransaction(pool, async (client) => {
      await client.query(
        "INSERT INTO services(id,business_id,name,duration_minutes) VALUES($1,$2,'Rollback test service',30)",
        [rollbackServiceId, businessA],
      );
      throw new Error('intentional integration rollback');
    }, { userId: userA, businessId: businessA }), /intentional integration rollback/);

    const rolledBackService = await withTransaction(pool, async (client) => client.query(
      'SELECT id FROM services WHERE business_id=$1 AND id=$2',
      [businessA, rollbackServiceId],
    ), { userId: userA, businessId: businessA });
    assert.equal(rolledBackService.rowCount, 0);
  });

  it('does not expose another business customer through the authenticated API', async () => {
    const response = await fetch(`${baseUrl}/api/customers/${customerB}`, {
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).code, 'customer_not_found');

    const customerWrite = await fetch(`${baseUrl}/api/customers/${customerB}`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${tokenA}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ notes: 'unauthorized change', tags: ['unauthorized'] }),
    });
    assert.equal(customerWrite.status, 404);

    const serviceDelete = await fetch(`${baseUrl}/api/services/${serviceB}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(serviceDelete.status, 404);

    const businessBRecords = await withTransaction(pool, async (client) => {
      const customer = await client.query(
        'SELECT notes,tags FROM customers WHERE business_id=$1 AND id=$2',
        [businessB, customerB],
      );
      const service = await client.query(
        'SELECT active FROM services WHERE business_id=$1 AND id=$2',
        [businessB, serviceB],
      );
      return { customer: customer.rows[0], service: service.rows[0] };
    }, { userId: userB, businessId: businessB });
    assert.equal(businessBRecords.customer.notes, '');
    assert.deepEqual(businessBRecords.customer.tags, []);
    assert.equal(businessBRecords.service.active, true);
  });
});
