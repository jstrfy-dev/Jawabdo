import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Button } from '../ui/kit';
import { useTheme, useSetTheme } from '../ui/theme';
import { useAuth } from '../auth/AuthContext';
import { useCloudData } from '../auth/CloudDataContext';

export default function SettingsScreen({ navigation }) {
  const t = useTheme();
  const setTheme = useSetTheme();
  const { session, demoMode, switchToAccount, signOut } = useAuth();
  const cloud = useCloudData();
  const whatsappConnected = cloud.connection?.status === 'connected';
  const s = styles(t);
  const plans = [
    { name: 'Starter', price: 'Rs. 3,000 / month', detail: 'Features aur limits abhi confirm karna baqi' },
    { name: 'Pro', price: 'Rs. 7,000 / month', detail: 'Features aur limits abhi confirm karna baqi' },
  ];
  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        <Text style={s.eyebrow}>AAPKA ACCOUNT</Text>
        <Text style={s.title}>Settings</Text>
        <Text style={s.subtitle}>{session ? 'Business data authenticated backend se load hota hai. Demo mode alag aur local hai.' : 'Demo data local hai; sign in karke backend business account use karein.'}</Text>

        <View style={s.card}>
          <Text style={s.cardTitle}>{session ? 'Cloud account' : 'Account aur cloud data'}</Text>
          <Text style={s.muted}>
            {session ? `Signed in: ${session.user.email}. Cloud profile/services/FAQs backend se load hote hain.` : 'Sign in karne par backend business profile, services, FAQs aur WhatsApp status manage kar sakte hain.'}
          </Text>
          {session ? (
            <>
              <Button label="Cloud business profile kholen" icon="cloud-outline" variant="ghost" onPress={() => navigation.navigate('CloudBusiness')} />
              <Button label="Cloud account se sign out" variant="ghost" onPress={() => { void signOut(); }} />
            </>
          ) : demoMode ? (
            <Button label="Cloud account sign in kholen" icon="log-in-outline" variant="ghost" onPress={switchToAccount} />
          ) : null}
        </View>

        <View style={s.card}>
          <View style={s.row}>
            <View style={[s.icon, { backgroundColor: t.accentSoft }]}><Ionicons name="logo-whatsapp" size={20} color={t.accent} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>WhatsApp Business</Text>
              <Text style={s.muted}>{whatsappConnected ? `Connected · ${cloud.connection.display_phone_number || 'server reported'}` : 'Connected nahi · live WhatsApp integration zaroori hai'}</Text>
            </View>
            <View style={s.badge}><Text style={s.badgeText}>SETUP REQUIRED</Text></View>
          </View>
          <Text style={s.body}>{whatsappConnected
            ? 'Backend WhatsApp connection ko connected report karta hai. Is screen se manual messages send nahi hote; server integration customer traffic handle karti hai.'
            : cloud.databaseDriver === 'mysql'
              ? 'MySQL backend mein official Meta WhatsApp integration configured nahi. Is liye real WhatsApp connected nahi, aur yahan se customer messages ya reminders nahi bheje jaate.'
              : 'Backend mein real WhatsApp connection configured nahi. Customer messages ya reminders send nahi kiye ja rahe.'}</Text>
          <Button label="Setup guide dekhein" variant="ghost" onPress={() => navigation.navigate('Guide')} />
        </View>

        {!session && <View style={s.card}>
          <Text style={s.cardTitle}>Plan aur billing</Text>
          <Text style={s.muted}>14 din ka trial offer · abhi start nahi hua, payment provider connected nahi</Text>
          {plans.map((plan) => (
            <View key={plan.name} style={s.plan}>
              <View style={{ flex: 1 }}>
                <Text style={s.planName}>{plan.name}</Text>
                <Text style={s.muted}>{plan.detail}</Text>
              </View>
              <Text style={s.price}>{plan.price}</Text>
            </View>
          ))}
          <Text style={s.note}>Yeh sirf dikhaye gaye plan rates hain. Features/limits abhi confirm karna baqi hain. Koi subscription ya payment activate/verify nahi hui.</Text>
        </View>}

        <View style={s.card}>
          <Text style={s.cardTitle}>Zubaan aur display</Text>
          <Text style={s.muted}>Customer reply ki zubaan Assistant settings mein badlein.</Text>
          <Button label="Business profile aur hours edit karein" icon="storefront-outline" variant="ghost" onPress={() => navigation.navigate(session ? 'CloudBusiness' : 'Onboarding')} />
          <Pressable onPress={() => setTheme(t.dark ? 'paper' : 'forest')} style={s.settingRow} accessibilityRole="button">
            <Ionicons name={t.dark ? 'sunny-outline' : 'moon-outline'} size={19} color={t.accent} />
            <Text style={s.settingText}>{t.dark ? 'Light theme lagayein' : 'Dark theme lagayein'}</Text>
            <Ionicons name="chevron-forward" size={17} color={t.textMuted} />
          </Pressable>
          <View style={s.settingRow}>
            <Ionicons name="notifications-outline" size={19} color={t.accent} />
            <View style={{ flex: 1 }}>
              <Text style={s.settingText}>Notifications</Text>
              <Text style={s.muted}>Push notifications abhi configured nahi.</Text>
            </View>
          </View>
          <View style={s.settingRow}>
            <Ionicons name="people-outline" size={19} color={t.accent} />
            <View style={{ flex: 1 }}>
              <Text style={s.settingText}>Team aur access</Text>
              <Text style={s.muted}>{session ? 'Current signed-in account cloud business profile manage kar sakta hai.' : 'Cloud account sign-in Settings ke upar maujood hai.'}</Text>
            </View>
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Privacy aur data</Text>
          <Text style={s.body}>{session ? 'Business records configured backend database mein store hote hain. Production customer traffic se pehle consent, retention, privacy policy aur account deletion workflows ko review karein.' : 'Demo records is device ke local storage mein rehte hain. Sign in ke baghair koi live business data load nahi hota.'}</Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = (t) => StyleSheet.create({
  content: { paddingBottom: 36 },
  eyebrow: { color: t.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.3, marginTop: 8 },
  title: { color: t.text, fontSize: 28, fontWeight: '800', marginTop: 5 },
  subtitle: { color: t.textMuted, fontSize: 14, lineHeight: 21, marginTop: 5, marginBottom: 16 },
  card: { backgroundColor: t.surface, borderRadius: 18, padding: 17, marginBottom: 13, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border },
  row: { flexDirection: 'row', alignItems: 'center' },
  icon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  cardTitle: { color: t.text, fontSize: 17, fontWeight: '700' },
  muted: { color: t.textMuted, fontSize: 12, lineHeight: 18, marginTop: 3 },
  badge: { backgroundColor: t.warning + '22', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 },
  badgeText: { color: t.warning, fontSize: 9, fontWeight: '800' },
  body: { color: t.textMuted, fontSize: 13, lineHeight: 20, marginTop: 12 },
  plan: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border },
  planName: { color: t.text, fontSize: 15, fontWeight: '700' },
  price: { color: t.accent, fontSize: 13, fontWeight: '700', marginLeft: 8 },
  note: { color: t.warning, fontSize: 12, lineHeight: 18, marginTop: 12 },
  settingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border, marginTop: 6 },
  settingText: { color: t.text, fontSize: 14, fontWeight: '600', marginHorizontal: 10, flex: 1 },
});
