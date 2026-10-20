import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const SESSION_KEY = 'jawabdo.session.v1';

export async function readSession() {
  try {
    if (Platform.OS === 'web') {
      const value = globalThis.sessionStorage?.getItem(SESSION_KEY);
      return value ? JSON.parse(value) : null;
    }
    const value = await SecureStore.getItemAsync(SESSION_KEY);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    throw new Error(`Saved sign-in session could not be read: ${error.message}`);
  }
}

export async function writeSession(session) {
  try {
    const value = JSON.stringify(session);
    if (Platform.OS === 'web') {
      if (!globalThis.sessionStorage) throw new Error('Secure browser session storage is unavailable.');
      globalThis.sessionStorage.setItem(SESSION_KEY, value);
      return;
    }
    await SecureStore.setItemAsync(SESSION_KEY, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch (error) {
    throw new Error(`Sign-in session could not be stored securely: ${error.message}`);
  }
}

export async function clearSession() {
  try {
    if (Platform.OS === 'web') {
      globalThis.sessionStorage?.removeItem(SESSION_KEY);
      return;
    }
    await SecureStore.deleteItemAsync(SESSION_KEY);
  } catch (error) {
    throw new Error(`Sign-in session could not be cleared: ${error.message}`);
  }
}
