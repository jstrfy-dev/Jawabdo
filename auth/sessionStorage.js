import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
const { createSessionStorage } = require('./sessionStorageCore');

const storage = createSessionStorage({
  platform: Platform.OS,
  browserStorage: () => globalThis.sessionStorage,
  secureStore: SecureStore,
});

export const readSession = storage.readSession;
export const writeSession = storage.writeSession;
export const clearSession = storage.clearSession;
