const assert = require('node:assert/strict');
const { after, before, describe, it } = require('node:test');
const { createApiHandler } = require('./api');
const { createWhatsAppServer } = require('./app');
const { signToken } = require('./security');

const USER_ID = '00000000-0000-4000-8000-000000000001';
const BUSINESS_ID = '00000000-0000-4000-8000-000000000002';
const CONVERSATION_ID = '00000000-0000-4000-8000-000000000003';
const JWT_SECRET = 'unit-test-jwt-secret-not-a-real-credential';

function fakePool() {
  return {
    async connect() {
      return {
        async query(sql) {
          const normalizedSql = sql.trimStart();
          if (normalizedSql.startsWith('SELECT role FROM business_memberships')) {
            return { rowCount: 1, rows: [{ role: 'owner' }] };
          }
          if (normalizedSql.startsWith('SELECT id,direction,sender,body')) {
            return { rowCount: 1, rows: [{ id: 'message-id', direction: 'inbound', sender: 'customer', body: 'Test message' }] };
          }
          return { rowCount: 0, rows: [] };
        },
        release() {},
      };
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
      corsOrigins: [],
    };
    const apiHandler = createApiHandler(config, fakePool(), {
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
});
