import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { createApiClient, resolveApiBaseUrl } from '../api/client';
import { clearSession, readSession, writeSession } from './sessionStorage';

const AuthContext = createContext(null);

const apiBaseUrl = resolveApiBaseUrl({
  platform: Platform.OS,
  override: process.env.EXPO_PUBLIC_API_URL,
  hostUri: Constants.expoConfig?.hostUri,
});

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [demoMode, setDemoMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [startupError, setStartupError] = useState('');

  useEffect(() => {
    let mounted = true;
    readSession()
      .then((stored) => {
        if (mounted && stored?.accessToken) setSession(stored);
      })
      .catch((error) => {
        if (mounted) setStartupError(error.message);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, []);

  const signOut = useCallback(async () => {
    await clearSession();
    setSession(null);
    setDemoMode(false);
  }, []);

  const api = useMemo(() => createApiClient({
    baseUrl: apiBaseUrl,
    onUnauthorized: signOut,
  }), [signOut]);

  const signIn = useCallback(async (credentials, register = false) => {
    const result = register
      ? await api.register(credentials)
      : await api.login(credentials);
    if (typeof result.accessToken !== 'string' || !result.accessToken || !result.user || !result.business) {
      throw new Error('Server ne mukammal sign-in response nahi diya.');
    }
    const nextSession = {
      accessToken: result.accessToken,
      user: result.user,
      business: result.business,
    };
    await writeSession(nextSession);
    setSession(nextSession);
    setDemoMode(false);
  }, [api]);

  const value = useMemo(() => ({
    session,
    demoMode,
    loading,
    startupError,
    apiBaseUrl,
    api,
    signIn,
    signOut,
    continueDemo: () => setDemoMode(true),
    switchToAccount: () => setDemoMode(false),
  }), [session, demoMode, loading, startupError, api, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
