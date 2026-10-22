const assert = require('node:assert/strict');
const { after, before, describe, it } = require('node:test');
const { createApiHandler } = require('./api');
const { createWhatsAppServer } = require('./app');
const { hashPassword, signToken } = require('./security');

const USER_ID = '00000000-0000-4000-8000-000000000001';
const BUSINESS_ID = '00000000-0000-4000-8000-000000000002';
const CONVERSATION_ID = '00000000-0000-4000-8000-000000000003';
const JWT_SECRET = 'unit-test-jwt-secret-not-a-real-credential';

function fakePool(passwordHash) {
  const users = [{ id: USER_ID, email: 'owner@example.com', password_hash: passwordHash }];
  const businesses = [{ id: BUSINESS_ID, name: 'Test shop' }];
  const memberships = [{ user_id: USER_ID, business_id: BUSINESS_ID, role: 'owner' }];
  return {
    async connect() {
      const context = {};
      let snapshot;
      return {
        async query(sql, parameters = []) {
          const normalizedSql = sql.trimStart();
          if (normalizedSql === 'BEGIN') {
            snapshot = {
              users: [...users],
              businesses: [...businesses],
              memberships: [...memberships],
            };
            return { rowCount: 0, rows: [] };
          }
          if (normalizedSql === 'COMMIT') {
            snapshot = null;
            return { rowCount: 0, rows: [] };
          }
          if (normalizedSql === 'ROLLBACK') {
            if (snapshot) {
              users.splice(0, users.length, ...snapshot.users);
              businesses.splice(0, businesses.length, ...snapshot.businesses);
              memberships.splice(0, memberships.length, ...snapshot.memberships);
            }
            return { rowCount: 0, rows: [] };
          }
          if (normalizedSql.startsWith('SELECT set_config(')) {
            const name = normalizedSql.includes('app.current_user_id') ? 'userId' : 'businessId';
            context[name] = parameters[0];
            return { rowCount: 1, rows: [{ set_config: parameters[0] }] };
          }
          if (normalizedSql.startsWith('INSERT INTO app_users')) {
            if (users.some((user) => user.email.toLowerCase() === parameters[1].toLowerCase())) {
              const error = new Error('duplicate email');
              error.code = '23505';
              throw error;
            }
            users.push({ id: parameters[0], email: parameters[1], password_hash: parameters[2] });
            return { rowCount: 1, rows: [] };
          }
          if (normalizedSql.startsWith('INSERT INTO businesses')) {
            businesses.push({ id: parameters[0], name: parameters[1] });
            return { rowCount: 1, rows: [] };
          }
          if (normalizedSql.startsWith('INSERT INTO business_memberships')) {
            memberships.push({ business_id: parameters[0], user_id: parameters[1], role: parameters[2] });
            return { rowCount: 1, rows: [] };
          }
          if (normalizedSql.startsWith('SELECT role FROM business_memberships')) {
            const allowed = context.userId === parameters[1]
              && context.businessId === parameters[0];
            const membership = allowed && memberships.find((entry) => (
              entry.user_id === parameters[1] && entry.business_id === parameters[0]
            ));
            return { rowCount: membership ? 1 : 0, rows: membership ? [{ role: membership.role }] : [] };
          }
          if (normalizedSql.startsWith('SELECT id,direction,sender,body')) {
            return { rowCount: 1, rows: [{ id: 'message-id', direction: 'inbound', sender: 'customer', body: 'Test message' }] };
          }
          if (normalizedSql.startsWith('SELECT business_id FROM business_memberships')) {
            const matches = memberships.filter((entry) => entry.user_id === parameters[0]);
            return { rowCount: matches.length, rows: matches.map((entry) => ({ business_id: entry.business_id })) };
          }
          if (normalizedSql.startsWith('SELECT id, name FROM businesses')) {
            const business = context.businessId === parameters[0]
              ? businesses.find((entry) => entry.id === parameters[0])
              : null;
            return { rowCount: business ? 1 : 0, rows: business ? [business] : [] };
          }
          if (normalizedSql.startsWith('SELECT membership.business_id')) {
            return { rowCount: 1, rows: [{ business_id: BUSINESS_ID }] };
          }
          return { rowCount: 0, rows: [] };
        },
        release() {},
      };
    },
    async query(sql, parameters = []) {
      if (sql.includes('SELECT id, email, password_hash FROM app_users')) {
        const user = users.find((entry) => entry.email.toLowerCase() === parameters[0].toLowerCase());
        return { rowCount: user ? 1 : 0, rows: user ? [user] : [] };
      }
      if (sql.startsWith('SELECT password_hash')) {
        const user = users.find((entry) => entry.id === parameters[0]);
        return { rowCount: user ? 1 : 0, rows: user ? [{ password_hash: user.password_hash }] : [] };
      }
      return { rowCount: 0, rows: [] };
    },
  };
}

describe('backend API route handling', () => {
  let server;
  let baseUrl;

  before(async () => {
    const config = {
      jwtSecret: JWT_SECRET,
      encryptionKey: Buffer.alloc(32, 1),
      nodeEnv: 'development',
      metaAppId: '',
      embeddedSignupConfigId: '',
      apiVersion: '',
      metaAppSecret: '',
      verifyToken: '',
      corsOrigins: ['http://localhost:8081', 'http://127.0.0.1:8081'],
    };
    const apiHandler = createApiHandler(config, fakePool(await hashPassword('test-password-123')), {
      logger: { info() {}, error() {} },
    });
    server = createWhatsAppServer({ ...config, appSecret: '' }, { apiHandler });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server?.listening) {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('serves public config without a session', async () => {
    const response = await fetch(`${baseUrl}/api/config/public`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      metaEmbeddedSignupReady: false,
      metaAppId: null,
      embeddedSignupConfigId: null,
      graphApiVersion: null,
      signupVersion: 'v4',
      databaseDriver: 'postgres',
    });
  });

  it('returns a structured unauthorized response without a session', async () => {
    const response = await fetch(`${baseUrl}/api/business`);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, 'unauthorized');
  });

  it('logs in through RLS by setting the authorized business context before reading it', async () => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'OWNER@example.com', password: 'test-password-123' }),
    });
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.equal(payload.user.id, USER_ID);
    assert.equal(payload.business.id, BUSINESS_ID);
    assert.equal(typeof payload.accessToken, 'string');
  });

  it('registers PostgreSQL accounts once and allows login while rejecting invalid credentials', async () => {
    const details = {
      email: ' New.Postgres@Example.com ',
      password: 'postgres-test-password-123',
      businessName: 'Postgres Test Shop',
    };
    const registration = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(details),
    });
    const created = await registration.json();
    assert.equal(registration.status, 201, JSON.stringify(created));
    assert.equal(created.user.email, 'new.postgres@example.com');

    const duplicate = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...details, email: 'new.postgres@example.com' }),
    });
    assert.equal(duplicate.status, 409);
    assert.equal((await duplicate.json()).code, 'account_exists');

    const invalidLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: details.email, password: 'incorrect-password' }),
    });
    assert.equal(invalidLogin.status, 401);
    assert.equal((await invalidLogin.json()).code, 'invalid_credentials');

    const validLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: details.email, password: details.password }),
    });
    const loggedIn = await validLogin.json();
    assert.equal(validLogin.status, 200, JSON.stringify(loggedIn));
    assert.equal(loggedIn.user.id, created.user.id);
    assert.equal(loggedIn.business.id, created.business.id);
  });

  it('denies cross-business access for customer, booking, service, FAQ, conversation, and message routes', async () => {
    const foreignBusinessId = '00000000-0000-4000-8000-000000000099';
    const token = signToken({ sub: USER_ID, businessId: foreignBusinessId }, JWT_SECRET);
    const routes = [
      { path: '/api/business', method: 'GET' },
      { path: '/api/business', method: 'PUT', body: { name: 'Other shop' } },
      { path: '/api/customers', method: 'GET' },
      { path: '/api/customers/00000000-0000-4000-8000-000000000003', method: 'GET' },
      { path: '/api/customers/00000000-0000-4000-8000-000000000003', method: 'PUT', body: { notes: 'cross tenant' } },
      { path: '/api/bookings', method: 'GET' },
      {
        path: '/api/bookings',
        method: 'POST',
        body: {
          customerPhone: '15551234567',
          customerName: 'Test Customer',
          serviceId: '00000000-0000-4000-8000-000000000004',
          startsAt: '2099-01-01T10:00:00+00:00',
          customerConfirmed: true,
        },
      },
      { path: '/api/bookings/00000000-0000-4000-8000-000000000003', method: 'PATCH', body: { status: 'cancelled' } },
      { path: '/api/services', method: 'GET' },
      { path: '/api/services', method: 'POST', body: { name: 'Other service', durationMinutes: 30 } },
      { path: '/api/services/00000000-0000-4000-8000-000000000003', method: 'DELETE' },
      { path: '/api/faqs', method: 'GET' },
      { path: '/api/faqs', method: 'POST', body: { question: 'Question?', answer: 'Answer.' } },
      { path: '/api/conversations', method: 'GET' },
      { path: '/api/conversations/00000000-0000-4000-8000-000000000003/messages', method: 'GET' },
      { path: '/api/conversations/00000000-0000-4000-8000-000000000003', method: 'PATCH', body: { state: 'closed' } },
    ];
    for (const route of routes) {
      const response = await fetch(`${baseUrl}${route.path}`, {
        method: route.method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(route.body ? { 'content-type': 'application/json' } : {}),
        },
        ...(route.body ? { body: JSON.stringify(route.body) } : {}),
      });
      assert.equal(response.status, 403, `${route.method} ${route.path}`);
      assert.equal((await response.json()).code, 'business_access_denied', `${route.method} ${route.path}`);
    }
  });

  it('allows local browser preflight for API PATCH requests', async () => {
    const response = await fetch(`${baseUrl}/api/business`, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:8081',
        'access-control-request-method': 'PATCH',
      },
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:8081');
    assert.match(response.headers.get('access-control-allow-methods'), /\bPATCH\b/);
  });

  it('handles authenticated conversation routes inside safe API error handling', async () => {
    const token = signToken({ sub: USER_ID, businessId: BUSINESS_ID }, JWT_SECRET);
    const response = await fetch(`${baseUrl}/api/conversations/${CONVERSATION_ID}/messages`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.deepEqual(payload, {
      messages: [{ id: 'message-id', direction: 'inbound', sender: 'customer', body: 'Test message' }],
    });
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
