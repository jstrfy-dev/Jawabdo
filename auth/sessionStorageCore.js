const SESSION_KEY = 'jawabdo.session.v1';

function createSessionStorage({ platform, browserStorage, secureStore }) {
  function getBrowserStorage() {
    const storage = typeof browserStorage === 'function' ? browserStorage() : browserStorage;
    if (!storage) throw new Error('Secure browser session storage is unavailable.');
    return storage;
  }

  return {
    async readSession() {
      try {
        const value = platform === 'web'
          ? getBrowserStorage().getItem(SESSION_KEY)
          : await secureStore.getItemAsync(SESSION_KEY);
        return value ? JSON.parse(value) : null;
      } catch (error) {
        throw new Error(`Saved sign-in session could not be read: ${error.message}`);
      }
    },

    async writeSession(session) {
      try {
        const value = JSON.stringify(session);
        if (platform === 'web') {
          getBrowserStorage().setItem(SESSION_KEY, value);
          return;
        }
        await secureStore.setItemAsync(SESSION_KEY, value, {
          keychainAccessible: secureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        });
      } catch (error) {
        throw new Error(`Sign-in session could not be stored securely: ${error.message}`);
      }
    },

    async clearSession() {
      try {
        if (platform === 'web') {
          getBrowserStorage().removeItem(SESSION_KEY);
          return;
        }
        await secureStore.deleteItemAsync(SESSION_KEY);
      } catch (error) {
        throw new Error(`Sign-in session could not be cleared: ${error.message}`);
      }
    },
  };
}

module.exports = { createSessionStorage };
