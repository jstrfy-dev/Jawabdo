const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const {
  decryptSecret,
  encryptSecret,
  hashPassword,
  signToken,
  verifyPassword,
  verifyToken,
} = require('./security');

describe('server security primitives', () => {
  it('rejects invalid, modified, and expired access tokens', () => {
    const secret = 'unit-test-secret-that-is-not-a-credential';
    const token = signToken({ sub: 'user-1', businessId: 'business-1' }, secret, 100);
    assert.equal(verifyToken(token, secret, 101).sub, 'user-1');
    assert.equal(verifyToken(token, 'different-secret', 101), null);
    assert.equal(verifyToken(`${token.slice(0, -2)}xx`, secret, 101), null);
    assert.equal(verifyToken(token, secret, 3701), null);
    assert.equal(verifyToken('not-a-token', secret), null);
  });

  it('hashes passwords and rejects wrong passwords', async () => {
    const hash = await hashPassword('correct horse battery staple');
    assert.equal(await verifyPassword('correct horse battery staple', hash), true);
    assert.equal(await verifyPassword('wrong password', hash), false);
    assert.equal(await verifyPassword('anything', 'invalid'), false);
  });

  it('encrypts Meta credentials with authenticated encryption', () => {
    const key = Buffer.alloc(32, 7);
    const encrypted = encryptSecret('test-token-not-a-real-credential', key);
    assert.equal(decryptSecret(encrypted, key), 'test-token-not-a-real-credential');
    assert.throws(() => decryptSecret(encrypted, Buffer.alloc(32, 8)));
    assert.throws(() => decryptSecret('invalid', key));
  });
});
