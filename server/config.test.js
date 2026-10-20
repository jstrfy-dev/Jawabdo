const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { readProductionConfig } = require('./config');

function validEnvironment(overrides = {}) {
  return {
    DATABASE_URL: 'postgresql://localhost:5432/jawabdo',
    JWT_SECRET: 'unit-test-jwt-secret-with-at-least-thirty-two-bytes',
    ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
    NODE_ENV: 'test',
    ...overrides,
  };
}

describe('production server configuration', () => {
  it('accepts valid server-only keys and leaves Meta integration explicitly unset', () => {
    const config = readProductionConfig(validEnvironment());
    assert.equal(config.databaseUrl, 'postgresql://localhost:5432/jawabdo');
    assert.equal(config.metaAppSecret, '');
    assert.equal(config.appSecret, '');
    assert.equal(config.emailVerificationConfigured, false);
  });

  it('rejects partial Meta configuration and weak encryption keys', () => {
    assert.throws(
      () => readProductionConfig(validEnvironment({ META_APP_ID: '123' })),
      /Configure META_APP_ID/,
    );
    assert.throws(
      () => readProductionConfig(validEnvironment({ ENCRYPTION_KEY: Buffer.alloc(31).toString('base64') })),
      /32-byte value/,
    );
  });

  it('requires HTTPS public URLs in production', () => {
    assert.throws(
      () => readProductionConfig(validEnvironment({
        NODE_ENV: 'production',
        PUBLIC_BASE_URL: 'http://example.test',
      })),
      /HTTPS/,
    );
  });
});
