import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Button } from '../ui/kit';
import { useTheme } from '../ui/theme';
import { useStore } from '../store/store';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const defaultHours = () => DAYS.map((day) => ({ day, open: '10:00', close: '20:00', closed: false }));

export default function OnboardingScreen({ navigation }) {
  const t = useTheme();
  const { business, saveBusiness, dataMode } = useStore();
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [address, setAddress] = useState('');
  const [hours, setHours] = useState(defaultHours);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const s = styles(t);

  useEffect(() => {
    if (!business) return;
    setName(business.name || '');
    setType(business.type || '');
    setAddress(business.address || business.area || '');
    setHours(Array.isArray(business.hours) && business.hours.length ? business.hours : defaultHours());
  }, [business]);

  const updateHour = (day, key, value) => setHours((current) => current.map((item) => item.day === day ? { ...item, [key]: value } : item));
  const save = async () => {
    if (!name.trim()) {
      setNotice('Business ka naam likhna zaroori hai.');
      return;
    }
    setSaving(true);
    saveBusiness({ ...(business || {}), name: name.trim(), type: type.trim(), address: address.trim(), area: address.trim(), hours, onboardingStep: 1 });
    setNotice('Tabdeeliyan isi device par save ho rahi hain. Agar save mein masla aaye to upar banner nazar aayega.');
    setSaving(false);
  };

  return (
    <Screen>
      <View style={s.content}>
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <Text style={s.eyebrow}>ASAN SETUP · 1/3</Text>
            <Text style={s.title}>Apne business se milwayein</Text>
            <Text style={s.caption}>Aaram se karein — aapki progress isi device par save rahegi.</Text>
          </View>
          <Pressable onPress={() => navigation.goBack()} style={s.close} accessibilityLabel="Close setup">
            <Ionicons name="close" size={19} color={t.text} />
          </Pressable>
        </View>
        <View style={s.progressTrack}><View style={s.progressFill} /></View>
        <Text style={s.sectionTitle}>Business details</Text>
        <Text style={s.label}>Business ka naam *</Text>
        <TextInput value={name} onChangeText={setName} placeholder="Misal: Noor Salon" placeholderTextColor={t.textMuted} style={s.input} />
        <Text style={s.label}>Business type</Text>
        <TextInput value={type} onChangeText={setType} placeholder="Salon, boutique, clinic..." placeholderTextColor={t.textMuted} style={s.input} />
        <Text style={s.label}>Address / area</Text>
        <TextInput value={address} onChangeText={setAddress} placeholder="Shehar aur ilaqa" placeholderTextColor={t.textMuted} style={s.input} />

        <View style={s.hoursHeader}>
          <View style={{ flex: 1 }}>
            <Text style={s.sectionTitle}>Opening hours</Text>
            <Text style={s.caption}>Customer ko kab aana mumkin hai, yahan batayein.</Text>
          </View>
          <Ionicons name="time-outline" size={20} color={t.accent} />
        </View>
        <View style={s.hoursCard}>
          {hours.map((item, index) => (
            <View key={item.day} style={[s.hourRow, index > 0 && s.hourLine]}>
              <Text style={s.day}>{item.day}</Text>
              {item.closed ? (
                <Text style={s.closedText}>Band</Text>
              ) : (
                <>
                  <TextInput value={item.open || ''} onChangeText={(value) => updateHour(item.day, 'open', value)} placeholder="10:00" placeholderTextColor={t.textMuted} style={s.timeInput} />
                  <Text style={s.to}>se</Text>
                  <TextInput value={item.close || ''} onChangeText={(value) => updateHour(item.day, 'close', value)} placeholder="20:00" placeholderTextColor={t.textMuted} style={s.timeInput} />
                </>
              )}
              <Pressable onPress={() => updateHour(item.day, 'closed', !item.closed)} style={[s.dayToggle, item.closed && s.dayToggleOn]}>
                <Text style={[s.dayToggleText, item.closed && { color: t.onAccent }]}>{item.closed ? 'Band' : 'Open'}</Text>
              </Pressable>
            </View>
          ))}
        </View>

        <View style={s.nextCard}>
          <Text style={s.sectionTitle}>Agla qadam</Text>
          <Text style={s.caption}>Services, prices aur FAQs assistant settings mein update karein.</Text>
          <Button label="Services aur FAQs set karein" icon="arrow-forward" variant="ghost" onPress={() => navigation.navigate('Assistant')} />
          <Button label="WhatsApp status dekhein" icon="logo-whatsapp" variant="ghost" onPress={() => navigation.navigate('Settings')} />
        </View>

        <View style={s.footer}>
          {!!notice && <Text style={s.notice}>{notice}</Text>}
          <Button label={saving ? 'Save ho raha hai...' : 'Progress save karein'} icon="checkmark-circle-outline" onPress={save} disabled={saving} />
          <Text style={s.footerNote}>{dataMode === 'demo' ? 'Demo data isi device par save hota hai — live account abhi connect nahi.' : 'Data abhi isi device par save hota hai.'}</Text>
        </View>
      </View>
    </Screen>
  );
}

const styles = (t) => StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 28 },
  header: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 },
  eyebrow: { color: t.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  title: { color: t.text, fontSize: 24, lineHeight: 31, fontWeight: '800', marginTop: 5 },
  caption: { color: t.textMuted, fontSize: 13, lineHeight: 19, marginTop: 4 },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surface, marginLeft: 8 },
  progressTrack: { height: 7, borderRadius: 6, backgroundColor: t.surfaceAlt, marginBottom: 20, overflow: 'hidden' },
  progressFill: { height: '100%', width: '34%', backgroundColor: t.accent, borderRadius: 6 },
  sectionTitle: { color: t.text, fontSize: 17, fontWeight: '700' },
  label: { color: t.textMuted, fontSize: 12, fontWeight: '600', marginTop: 12, marginBottom: 5 },
  input: { minHeight: 45, borderRadius: 12, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, paddingHorizontal: 12, color: t.text, fontSize: 14 },
  hoursHeader: { flexDirection: 'row', alignItems: 'center', marginTop: 24, marginBottom: 10 },
  hoursCard: { backgroundColor: t.surface, borderRadius: 16, paddingHorizontal: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border },
  hourRow: { flexDirection: 'row', alignItems: 'center', minHeight: 53 },
  hourLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border },
  day: { width: 38, color: t.text, fontSize: 12, fontWeight: '700' },
  timeInput: { width: 60, height: 34, borderRadius: 9, backgroundColor: t.bg, textAlign: 'center', color: t.text, fontSize: 12 },
  to: { color: t.textMuted, fontSize: 11, marginHorizontal: 5 },
  closedText: { flex: 1, color: t.textMuted, fontSize: 12 },
  dayToggle: { borderRadius: 999, backgroundColor: t.accentSoft, paddingHorizontal: 9, paddingVertical: 6, marginLeft: 'auto' },
  dayToggleOn: { backgroundColor: t.accent },
  dayToggleText: { color: t.accent, fontSize: 10, fontWeight: '700' },
  nextCard: { backgroundColor: t.surface, borderRadius: 16, padding: 15, marginTop: 18, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border },
  footer: { marginTop: 12 },
  notice: { color: t.accent, fontSize: 12, lineHeight: 18, marginBottom: 5 },
  footerNote: { color: t.textMuted, textAlign: 'center', fontSize: 11, lineHeight: 16, marginTop: 5 },
});
