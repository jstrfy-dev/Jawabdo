const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { ApiError, createApiClient, resolveApiBaseUrl } = require('./client');

describe('API base URL selection', () => {
  it('uses an explicit origin when configured', () => {
    assert.equal(
      resolveApiBaseUrl({ platform: 'android', override: 'https://api.example.test/' }),
      'https://api.example.test',
    );
  });

  it('uses Expo LAN host for Android, emulator bridge fallback, and localhost for web', () => {
    assert.equal(resolveApiBaseUrl({ platform: 'android', hostUri: '192.168.1.20:8081' }), 'http://192.168.1.20:3000');
    assert.equal(resolveApiBaseUrl({ platform: 'android', hostUri: 'exp://192.168.1.20:8081' }), 'http://192.168.1.20:3000');
    assert.equal(resolveApiBaseUrl({ platform: 'android' }), 'http://10.0.2.2:3000');
    assert.equal(resolveApiBaseUrl({ platform: 'web' }), 'http://localhost:3000');
  });

  it('rejects non-origin or non-HTTP API overrides', () => {
    assert.throws(() => resolveApiBaseUrl({ platform: 'web', override: 'file:///tmp/api' }), /HTTP\(S\)/);
    assert.throws(() => resolveApiBaseUrl({ platform: 'web', override: 'http://localhost:3000/api' }), /origin/);
    assert.throws(() => resolveApiBaseUrl({ platform: 'web', override: 'https://user:pass@api.example.test' }), /origin/);
  });

  it('requires the same configured deployed HTTPS API origin in production', () => {
    assert.equal(
      resolveApiBaseUrl({ platform: 'web', override: 'https://api.example.test', production: true }),
      'https://api.example.test',
    );
    assert.equal(
      resolveApiBaseUrl({ platform: 'android', override: 'https://api.example.test', production: true }),
      'https://api.example.test',
    );
    assert.throws(() => resolveApiBaseUrl({ platform: 'web', production: true }), /Production builds require/);
    assert.throws(
      () => resolveApiBaseUrl({ platform: 'android', override: 'http://api.example.test', production: true }),
      /deployed HTTPS API/,
    );
    assert.throws(
      () => resolveApiBaseUrl({ platform: 'web', override: 'https://localhost:3000', production: true }),
      /deployed HTTPS API/,
    );
  });
});

describe('reusable JSON API client', () => {
  it('sends JSON and bearer authorization and parses a successful response', async () => {
    let request;
    const api = createApiClient({
      baseUrl: 'http://localhost:3000',
      fetchImpl: async (url, options) => {
        request = { url, options };
        return { ok: true, status: 200, json: async () => ({ business: { name: 'Test shop' } }) };
      },
    });
    const result = await api.updateBusiness('session-token', { name: 'Test shop' });
    assert.equal(request.url, 'http://localhost:3000/api/business');
    assert.equal(request.options.method, 'PUT');
    assert.equal(request.options.headers.authorization, 'Bearer session-token');
    assert.equal(request.options.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(request.options.body), { name: 'Test shop' });
    assert.deepEqual(result, { business: { name: 'Test shop' } });
  });

  it('exposes safe server errors and awaits unauthorized session cleanup', async () => {
    let cleared = false;
    const api = createApiClient({
      baseUrl: 'http://localhost:3000',
      onUnauthorized: async () => { cleared = true; },
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Sign in to continue.', code: 'unauthorized' }),
      }),
    });
    await assert.rejects(
      () => api.me('expired-token'),
      (error) => error instanceof ApiError && error.status === 401 && error.code === 'unauthorized',
    );
    assert.equal(cleared, true);
  });

  it('reports network errors without returning fake success data', async () => {
    const api = createApiClient({
      baseUrl: 'http://localhost:3000',
      fetchImpl: async () => { throw new Error('socket detail'); },
    });
    await assert.rejects(
      () => api.publicConfig(),
      (error) => error instanceof ApiError
        && error.code === 'network_error'
        && /port 3000/.test(error.message)
        && /CORS/.test(error.message),
    );
  });

  it('preserves readable server errors for failed signup and login', async () => {
    const api = createApiClient({
      baseUrl: 'http://localhost:3000',
      fetchImpl: async (url) => ({
        ok: false,
        status: url.endsWith('/register') ? 409 : 401,
        json: async () => url.endsWith('/register')
          ? { error: 'An account with this email already exists.', code: 'account_exists' }
          : { error: 'Email or password is incorrect.', code: 'invalid_credentials' },
      }),
    });
    await assert.rejects(
      () => api.register({ email: 'owner@example.com', password: 'long-test-password', businessName: 'Shop' }),
      (error) => error instanceof ApiError && error.status === 409 && error.code === 'account_exists',
    );
    await assert.rejects(
      () => api.login({ email: 'owner@example.com', password: 'wrong-password' }),
      (error) => error instanceof ApiError && error.status === 401 && error.code === 'invalid_credentials',
    );
  });
});
