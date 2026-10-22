const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { createSessionStorage } = require('./sessionStorageCore');

const session = {
  accessToken: 'unit-test-access-token',
  user: { id: 'user-id', email: 'owner@example.com' },
  business: { id: 'business-id', name: 'Test shop' },
};

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

describe('session persistence', () => {
  it('restores browser sessions after a page refresh and removes them on logout', async () => {
    const browserStorage = memoryStorage();
    const firstPage = createSessionStorage({ platform: 'web', browserStorage });
    await firstPage.writeSession(session);

    const refreshedPage = createSessionStorage({ platform: 'web', browserStorage });
    assert.deepEqual(await refreshedPage.readSession(), session);
    await refreshedPage.clearSession();
    assert.equal(await firstPage.readSession(), null);
  });

  it('restores native sessions from secure storage and clears them on logout', async () => {
    const values = new Map();
    const secureStore = {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only',
      async getItemAsync(key) { return values.get(key) || null; },
      async setItemAsync(key, value, options) {
        assert.deepEqual(options, { keychainAccessible: 'device-only' });
        values.set(key, value);
      },
      async deleteItemAsync(key) { values.delete(key); },
    };
    const firstLaunch = createSessionStorage({ platform: 'android', secureStore });
    await firstLaunch.writeSession(session);

    const reopenedApp = createSessionStorage({ platform: 'android', secureStore });
    assert.deepEqual(await reopenedApp.readSession(), session);
    await reopenedApp.clearSession();
    assert.equal(await firstLaunch.readSession(), null);
  });

  it('reports unavailable browser storage instead of silently losing session data', async () => {
    const storage = createSessionStorage({ platform: 'web', browserStorage: null });
    await assert.rejects(storage.writeSession(session), /could not be stored securely/);
    await assert.rejects(storage.clearSession(), /could not be cleared/);
  });
});
