const assert = require('node:assert/strict');
const { after, before, describe, it } = require('node:test');
const { createMysqlServer } = require('./mysql-api');
const { hashPassword, signToken } = require('./security');

const JWT_SECRET = 'unit-test-mysql-jwt-secret-with-more-than-thirty-two-bytes';
const BUSINESS_ID = '00000000-0000-4000-8000-000000000002';
const USER_ID = '00000000-0000-4000-8000-000000000001';

function fakePool(passwordHash) {
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql, parameters) {
      if (sql.includes('business_memberships')) {
        if (sql.includes('SELECT membership.business_id')) return [[{ business_id: BUSINESS_ID }], []];
        if (sql.includes('SELECT business_id FROM business_memberships')) return [[{ business_id: BUSINESS_ID }], []];
        return parameters[0] === BUSINESS_ID && parameters[1] === USER_ID
          ? [[{ role: 'owner' }], []]
          : [[], []];
      }
      return [[], []];
    },
  };
  return {
    async query(sql) {
      if (sql.includes('SELECT password_hash')) return [[{ password_hash: passwordHash }], []];
      return [[{ ready: 1 }], []];
    },
    async execute(sql) {
      if (sql.includes('SELECT password_hash')) return [[{ password_hash: passwordHash }], []];
      return [[], []];
    },
    async getConnection() {
      return connection;
    },
  };
}

function memoryAuthPool() {
  const users = [];
  const businesses = [];
  const memberships = [];
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql, parameters) {
      if (sql.startsWith('INSERT INTO app_users')) {
        if (users.some((user) => user.email === parameters[1])) {
          const error = new Error('duplicate');
          error.code = 'ER_DUP_ENTRY';
          throw error;
        }
        users.push({ id: parameters[0], email: parameters[1], password_hash: parameters[2], email_verified_at: new Date() });
      } else if (sql.startsWith('INSERT INTO businesses')) {
        businesses.push({ id: parameters[0], name: parameters[1] });
      } else if (sql.startsWith('INSERT INTO business_memberships')) {
        memberships.push({ business_id: parameters[0], user_id: parameters[1] });
      }
      return [[], []];
    },
  };
  return {
    async query() { return [[{ ready: 1 }], []]; },
    async execute(sql, parameters) {
      if (sql.includes('SELECT id,email,password_hash FROM app_users')) {
        const user = users.find((entry) => entry.email === parameters[0] && entry.email_verified_at);
        return [user ? [user] : [], []];
      }
      if (sql.includes('SELECT b.id,b.name FROM business_memberships')) {
        const membership = memberships.find((entry) => entry.user_id === parameters[0]);
        const business = businesses.find((entry) => entry.id === membership?.business_id);
        return [business ? [business] : [], []];
      }
      return [[], []];
    },
    async getConnection() { return connection; },
    users,
    businesses,
    memberships,
  };
}

describe('MySQL API runtime', () => {
  let server;
  let baseUrl;

  before(async () => {
    const config = {
      jwtSecret: JWT_SECRET,
      nodeEnv: 'test',
      corsOrigins: [],
    };
    server = createMysqlServer(config, fakePool(await hashPassword('test-password-123')), { logger: { error() {} } });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  describe('MySQL account registration and login', () => {
    let server;
    let baseUrl;
    let pool;

    before(async () => {
      pool = memoryAuthPool();
      server = createMysqlServer({
        jwtSecret: JWT_SECRET,
        nodeEnv: 'development',
        corsOrigins: ['http://localhost:8081'],
      }, pool, { logger: { error() {} } });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      baseUrl = `http://127.0.0.1:${server.address().port}`;
    });

    after(async () => {
      if (server?.listening) {
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      }
    });

    it('creates one account and returns a usable login session', async () => {
      const details = {
        email: ' New.Owner@Example.com ',
        password: 'long-test-password-123',
        businessName: 'My Test Shop',
        category: 'retail',
      };
      const registration = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(details),
      });
      const created = await registration.json();
      assert.equal(registration.status, 201);
      assert.equal(created.user.email, 'new.owner@example.com');
      assert.equal(created.business.name, details.businessName);
      assert.equal(typeof created.accessToken, 'string');
      assert.equal(pool.users.length, 1);
      assert.equal(pool.businesses.length, 1);
      assert.equal(pool.memberships.length, 1);

      const login = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: details.email, password: details.password }),
      });
      const loggedIn = await login.json();
      assert.equal(login.status, 200);
      assert.equal(loggedIn.user.id, created.user.id);
      assert.equal(loggedIn.business.id, created.business.id);
    });

    it('rejects malformed signup data, duplicate email, and invalid login credentials', async () => {
      const invalidSignup = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'not-an-email', password: 'short', businessName: '' }),
      });
      assert.equal(invalidSignup.status, 400);
      assert.equal((await invalidSignup.json()).code, 'invalid_input');

      const invalidEmailLogin = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'not-an-email', password: 'valid-long-password' }),
      });
      assert.equal(invalidEmailLogin.status, 400);
      assert.equal((await invalidEmailLogin.json()).code, 'invalid_input');

      const duplicateSignup = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'new.owner@example.com',
          password: 'long-test-password-123',
          businessName: 'Duplicate Shop',
        }),
      });
      assert.equal(duplicateSignup.status, 409);
      assert.equal((await duplicateSignup.json()).code, 'account_exists');
      assert.equal(pool.users.length, 1);

      const failedLogin = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'new.owner@example.com', password: 'incorrect-password' }),
      });
      assert.equal(failedLogin.status, 401);
      assert.equal((await failedLogin.json()).code, 'invalid_credentials');

      const oversizedPassword = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'new.owner@example.com', password: 'x'.repeat(129) }),
      });
      assert.equal(oversizedPassword.status, 400);
      assert.equal((await oversizedPassword.json()).code, 'invalid_input');
    });

    it('permits only configured browser origins and reports allowed preflight headers', async () => {
      const response = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'OPTIONS',
        headers: {
          origin: 'http://localhost:8081',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type',
        },
      });
      assert.equal(response.status, 204);
      assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:8081');

      const denied = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'OPTIONS',
        headers: { origin: 'https://untrusted.example' },
      });
      assert.equal(denied.status, 403);
    });
  });

  after(async () => {
    if (server?.listening) {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('reports API and database status without exposing connection details', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok', api: 'ok', database: 'ok' });
  });

  it('requires authentication and a matching business membership for protected routes', async () => {
    const unauthorized = await fetch(`${baseUrl}/api/customers`);
    assert.equal(unauthorized.status, 401);
    assert.equal((await unauthorized.json()).code, 'unauthorized');

    const token = signToken({ sub: USER_ID, businessId: '00000000-0000-4000-8000-000000000099' }, JWT_SECRET);
    const denied = await fetch(`${baseUrl}/api/customers`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).code, 'business_access_denied');
  });

  it('does not report WhatsApp as connected in the MySQL runtime', async () => {
    const token = signToken({ sub: USER_ID, businessId: BUSINESS_ID }, JWT_SECRET);
    const response = await fetch(`${baseUrl}/api/whatsapp/connection`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).connection, { status: 'not_connected', integrationConfigured: false });
  });

  it('blocks account deletion while the account belongs to a shared business', async () => {
    const token = signToken({ sub: USER_ID, businessId: BUSINESS_ID }, JWT_SECRET);
    const response = await fetch(`${baseUrl}/api/account`, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ confirmation: 'DELETE MY ACCOUNT', password: 'test-password-123' }),
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'business_has_members');
  });
});
