import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Screen } from '../ui/kit';
import { useTheme } from '../ui/theme';
import { useAuth } from '../auth/AuthContext';

export default function AuthScreen() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { apiBaseUrl, signIn, continueDemo, startupError } = useAuth();
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(startupError);

  async function submit() {
    setError('');
    if (!email.trim() || !password) {
      setError('Email aur password dono darj karein.');
      return;
    }
    if (register && (!businessName.trim() || password.length < 12)) {
      setError('Business name dein; password kam az kam 12 characters ka ho.');
      return;
    }
    setBusy(true);
    try {
      await signIn(
        register
          ? { email: email.trim(), password, businessName: businessName.trim(), category: category.trim() }
          : { email: email.trim(), password },
        register,
      );
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>JAWABDO CLOUD</Text>
        <Text style={styles.title}>{register ? 'Account banayein' : 'Sign in karein'}</Text>
        <Text style={styles.body}>Backend account cloud business data ke liye hai. Purana local demo alag chala sakte hain.</Text>
        <View style={styles.card}>
          <Text style={styles.label}>Email</Text>
          <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" placeholder="name@example.com" placeholderTextColor={theme.textMuted} style={styles.input} />
          <Text style={styles.label}>Password</Text>
          <TextInput value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete={register ? 'new-password' : 'current-password'} placeholder={register ? 'Kam az kam 12 characters' : 'Password'} placeholderTextColor={theme.textMuted} style={styles.input} />
          {register ? (
            <>
              <Text style={styles.label}>Business name</Text>
              <TextInput value={businessName} onChangeText={setBusinessName} placeholder="Business ka naam" placeholderTextColor={theme.textMuted} style={styles.input} />
              <Text style={styles.label}>Category (optional)</Text>
              <TextInput value={category} onChangeText={setCategory} placeholder="Salon, clinic..." placeholderTextColor={theme.textMuted} style={styles.input} />
              <Text style={styles.warning}>Email verification backend par abhi implement nahi. Production mein registration disabled ho sakti hai; test account sirf apne local development server par banayein.</Text>
            </>
          ) : null}
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          {busy ? <ActivityIndicator color={theme.accent} /> : null}
          <Button label={busy ? 'Rabta ho raha hai...' : register ? 'Development account banayein' : 'Sign in'} onPress={submit} disabled={busy} />
          <Button label={register ? 'Pehle se account hai? Sign in' : 'Naya account banayein'} variant="ghost" onPress={() => { setError(''); setRegister(!register); }} disabled={busy} />
          <Text style={styles.endpoint}>API: {apiBaseUrl}</Text>
        </View>
        <Button label="Local demo continue karein" variant="ghost" onPress={continueDemo} />
        <Text style={styles.caption}>Demo mode local sample data hai; cloud account ya live WhatsApp connection nahi.</Text>
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (t) => StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', paddingVertical: 28 },
  eyebrow: { color: t.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: t.text, fontSize: 28, fontWeight: '800', marginTop: 6 },
  body: { color: t.textMuted, fontSize: 14, lineHeight: 21, marginTop: 7, marginBottom: 18 },
  card: { backgroundColor: t.surface, borderRadius: 18, padding: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border },
  label: { color: t.text, fontSize: 13, fontWeight: '700', marginTop: 10, marginBottom: 5 },
  input: { minHeight: 46, borderRadius: 11, borderWidth: 1, borderColor: t.border, paddingHorizontal: 12, color: t.text, backgroundColor: t.bg },
  error: { color: t.danger || '#B42318', fontSize: 13, lineHeight: 19, marginVertical: 10 },
  warning: { color: t.warning, fontSize: 12, lineHeight: 18, marginTop: 10 },
  endpoint: { color: t.textMuted, fontSize: 10, marginTop: 14, textAlign: 'center' },
  caption: { color: t.textMuted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 8 },
});
