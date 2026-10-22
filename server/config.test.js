const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { readMysqlConfig, readProductionConfig } = require('./config');

function validEnvironment(overrides = {}) {
  return {
    DATABASE_URL: 'postgresql://localhost:5432/jawabdo',
    JWT_SECRET: 'unit-test-jwt-secret-with-at-least-thirty-two-bytes',
    ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
    NODE_ENV: 'test',
    ...overrides,
  };
}

function productionEnvironment(overrides = {}) {
  return validEnvironment({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://jawabdo_runtime@db.example.test:5432/jawabdo',
    DATABASE_SSL: 'true',
    CORS_ORIGINS: 'https://app.example.test',
    ...overrides,
  });
}

describe('production server configuration', () => {
  it('accepts valid server-only keys and leaves Meta integration explicitly unset', () => {
    const config = readProductionConfig(validEnvironment());
    assert.equal(config.databaseUrl, 'postgresql://localhost:5432/jawabdo');
    assert.equal(config.metaAppSecret, '');
    assert.equal(config.appSecret, '');
    assert.equal(config.emailVerificationConfigured, false);
    assert.deepEqual(config.corsOrigins, ['http://localhost:8081', 'http://127.0.0.1:8081']);
  });

  describe('XAMPP MySQL configuration', () => {
    it('uses local XAMPP defaults and accepts an empty root password', () => {
      const config = readMysqlConfig({
        JWT_SECRET: 'unit-test-jwt-secret-with-at-least-thirty-two-bytes',
        NODE_ENV: 'development',
      });
      assert.equal(config.databaseHost, '127.0.0.1');
      assert.equal(config.databasePort, 3306);
      assert.equal(config.databaseName, 'jawabdo');
      assert.equal(config.databaseUser, 'root');
      assert.equal(config.databasePassword, '');
      assert.deepEqual(config.corsOrigins, ['http://localhost:8081', 'http://127.0.0.1:8081']);
    });

    it('keeps local browser origins available in development alongside configured origins', () => {
      const config = readMysqlConfig({
        JWT_SECRET: 'unit-test-jwt-secret-with-at-least-thirty-two-bytes',
        NODE_ENV: 'development',
        CORS_ORIGINS: 'https://your-app-domain.example,http://localhost:8081',
      });
      assert.deepEqual(config.corsOrigins, [
        'https://your-app-domain.example',
        'http://localhost:8081',
        'http://127.0.0.1:8081',
      ]);
    });

    it('uses explicit MySQL environment values and validates ports and JWT secret', () => {
      const config = readMysqlConfig({
        JWT_SECRET: 'unit-test-jwt-secret-with-at-least-thirty-two-bytes',
        MYSQL_HOST: 'db.local',
        MYSQL_PORT: '3307',
        MYSQL_DATABASE: 'custom_db',
        MYSQL_USER: 'jawabdo',
        MYSQL_PASSWORD: 'local-only',
      });
      assert.equal(config.databaseHost, 'db.local');
      assert.equal(config.databasePort, 3307);
      assert.equal(config.databaseName, 'custom_db');
      assert.equal(config.databaseUser, 'jawabdo');
      assert.equal(config.databasePassword, 'local-only');
      assert.throws(() => readMysqlConfig({ JWT_SECRET: 'weak', MYSQL_PORT: '70000' }), /JWT_SECRET/);
      assert.throws(() => readMysqlConfig({
        JWT_SECRET: 'unit-test-jwt-secret-with-at-least-thirty-two-bytes',
        MYSQL_PORT: '70000',
      }), /MYSQL_PORT/);
    });
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
      () => readProductionConfig(productionEnvironment({
        PUBLIC_BASE_URL: 'http://example.test',
      })),
      /HTTPS/,
    );
  });

  it('does not add local development origins to production CORS configuration', () => {
    const config = readProductionConfig(productionEnvironment());
    assert.deepEqual(config.corsOrigins, ['https://app.example.test']);
  });

  it('requires TLS, a non-local database host, and browser origins in production', () => {
    assert.throws(
      () => readProductionConfig(productionEnvironment({
        DATABASE_SSL: 'false',
      })),
      /DATABASE_SSL=true/,
    );
    assert.throws(
      () => readProductionConfig(productionEnvironment({
        DATABASE_URL: 'postgresql://localhost:5432/jawabdo',
      })),
      /deployed PostgreSQL host/,
    );
    assert.throws(
      () => readProductionConfig(productionEnvironment({ CORS_ORIGINS: '' })),
      /HTTPS browser origin/,
    );
  });

  it('prevents starting the MySQL runtime in production', () => {
    assert.throws(
      () => readMysqlConfig({
        NODE_ENV: 'production',
        JWT_SECRET: 'unit-test-jwt-secret-with-at-least-thirty-two-bytes',
      }),
      /MySQL runtime is development-only/,
    );
  });
});
