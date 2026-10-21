const assert = require('node:assert/strict');
const { after, before, describe, it } = require('node:test');
const { createMysqlServer } = require('./mysql-api');
const { signToken } = require('./security');

const JWT_SECRET = 'unit-test-mysql-jwt-secret-with-more-than-thirty-two-bytes';
const BUSINESS_ID = '00000000-0000-4000-8000-000000000002';
const USER_ID = '00000000-0000-4000-8000-000000000001';

function fakePool() {
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql, parameters) {
      if (sql.includes('business_memberships')) {
        return parameters[0] === BUSINESS_ID && parameters[1] === USER_ID
          ? [[{ role: 'owner' }], []]
          : [[], []];
      }
      return [[], []];
    },
  };
  return {
    async query() {
      return [[{ ready: 1 }], []];
    },
    async getConnection() {
      return connection;
    },
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
    server = createMysqlServer(config, fakePool(), { logger: { error() {} } });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
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
});
