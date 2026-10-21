import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Button } from '../ui/kit';
import { useTheme } from '../ui/theme';
import { useAuth } from '../auth/AuthContext';

const DAYS = [
  { dayOfWeek: 1, label: 'Monday' },
  { dayOfWeek: 2, label: 'Tuesday' },
  { dayOfWeek: 3, label: 'Wednesday' },
  { dayOfWeek: 4, label: 'Thursday' },
  { dayOfWeek: 5, label: 'Friday' },
  { dayOfWeek: 6, label: 'Saturday' },
  { dayOfWeek: 0, label: 'Sunday' },
];

function blankHours() {
  return DAYS.map(({ dayOfWeek }) => ({ dayOfWeek, closed: true, open: '10:00', close: '20:00' }));
}

function toEditorHours(value) {
  const defaults = blankHours();
  if (!Array.isArray(value)) return defaults;
  return defaults.map((day) => {
    const saved = value.find((entry) => entry.dayOfWeek === day.dayOfWeek);
    return saved ? { ...day, ...saved } : day;
  });
}

export default function CloudBusinessScreen() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { session, api } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [business, setBusiness] = useState(null);
  const [hours, setHours] = useState(blankHours);
  const [services, setServices] = useState([]);
  const [faqs, setFaqs] = useState([]);
  const [connection, setConnection] = useState(null);
  const [serviceName, setServiceName] = useState('');
  const [serviceDescription, setServiceDescription] = useState('');
  const [servicePrice, setServicePrice] = useState('');
  const [serviceDuration, setServiceDuration] = useState('30');
  const [faqQuestion, setFaqQuestion] = useState('');
  const [faqAnswer, setFaqAnswer] = useState('');

  const load = useCallback(async () => {
    if (!session?.accessToken) return;
    setError('');
    try {
      const [profile, serviceList, faqList, whatsapp] = await Promise.all([
        api.getBusiness(session.accessToken),
        api.getServices(session.accessToken),
        api.getFaqs(session.accessToken),
        api.getWhatsAppConnection(session.accessToken),
      ]);
      setBusiness(profile.business);
      setHours(toEditorHours(profile.business?.opening_hours));
      setServices(serviceList.services);
      setFaqs(faqList.faqs);
      setConnection(whatsapp.connection);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [api, session?.accessToken]);

  useEffect(() => { void load(); }, [load]);

  const updateField = (key, value) => setBusiness((current) => ({ ...(current || {}), [key]: value }));
  const updateHours = (dayOfWeek, patch) => {
    setHours((current) => current.map((day) => day.dayOfWeek === dayOfWeek ? { ...day, ...patch } : day));
  };

  async function saveBusiness() {
    if (!business?.name?.trim()) {
      setError('Business ka naam zaroori hai.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result = await api.updateBusiness(session.accessToken, {
        name: business.name.trim(),
        category: business.category || '',
        address: business.address || '',
        timezone: business.timezone || 'Asia/Karachi',
        language: business.language || 'roman',
        ownerName: business.owner_name || '',
        ownerPhone: business.owner_phone || '',
        ownerWhatsappOptIn: business.owner_whatsapp_opt_in === true,
        openingHours: hours.map(({ dayOfWeek, closed, open, close }) => (
          closed ? { dayOfWeek, closed: true } : { dayOfWeek, closed: false, open, close }
        )),
        policies: business.policies || {},
      });
      setBusiness(result.business);
      setHours(toEditorHours(result.business?.opening_hours));
      setNotice('Cloud business profile server par save ho gaya.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function addService() {
    const duration = Number(serviceDuration);
    if (!serviceName.trim() || !Number.isInteger(duration) || duration < 5 || duration > 1440) {
      setError('Service name dein aur duration 5 se 1440 minutes ho.');
      return;
    }
    if (servicePrice.trim() && (!/^\d+(?:\.\d{1,2})?$/.test(servicePrice.trim()) || !Number.isSafeInteger(Math.round(Number(servicePrice) * 100)))) {
      setError('Price PKR mein number ho, maximum 2 decimal places ke saath.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await api.createService(session.accessToken, {
        name: serviceName.trim(),
        description: serviceDescription.trim(),
        priceMinor: servicePrice.trim() ? Math.round(Number(servicePrice) * 100) : null,
        currency: 'PKR',
        durationMinutes: duration,
      });
      setServices((current) => [...current, response.service].sort((a, b) => a.name.localeCompare(b.name)));
      setServiceName('');
      setServiceDescription('');
      setServicePrice('');
      setNotice('Service server par save ho gayi.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function deactivateService(id) {
    setError('');
    try {
      await api.deactivateService(session.accessToken, id);
      setServices((current) => current.filter((service) => service.id !== id));
      setNotice('Service deactivate ho gayi.');
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function addFaq() {
    if (!faqQuestion.trim() || !faqAnswer.trim()) {
      setError('FAQ ka sawal aur jawab dono zaroori hain.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await api.createFaq(session.accessToken, {
        question: faqQuestion.trim(),
        answer: faqAnswer.trim(),
      });
      setFaqs((current) => [...current, response.faq]);
      setFaqQuestion('');
      setFaqAnswer('');
      setNotice('Verified FAQ server par save ho gaya.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  const statusLabel = useMemo(() => {
    const labels = {
      not_connected: 'Not connected',
      connecting: 'Connecting',
      connected: 'Connected',
      needs_attention: 'Needs attention',
      disconnected: 'Disconnected',
    };
    return labels[connection?.status] || 'Status unavailable';
  }, [connection?.status]);

  if (loading) {
    return <Screen><View style={styles.center}><ActivityIndicator size="large" color={theme.accent} /><Text style={styles.muted}>Cloud profile load ho raha hai...</Text></View></Screen>;
  }

  if (!business) {
    return (
      <Screen>
        <View style={styles.content}>
          <Text style={styles.title}>Cloud business setup</Text>
          <Text accessibilityRole="alert" style={styles.error}>{error || 'Business profile load nahi ho saka.'}</Text>
          <Button label="Dobara koshish karein" onPress={() => { setLoading(true); void load(); }} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>SERVER-SAVED BUSINESS</Text>
        <Text style={styles.title}>Business setup</Text>
        <Text style={styles.muted}>Business profile, services aur FAQs authenticated business ke backend par save hote hain. Dashboard, inbox, calendar aur customer records bhi server se load hote hain.</Text>

        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {notice ? <Text accessibilityRole="status" style={styles.success}>{notice}</Text> : null}

        <View style={styles.card}>
          <Text style={styles.section}>Business profile</Text>
          <Field label="Business name *" value={business.name} onChangeText={(value) => updateField('name', value)} styles={styles} theme={theme} />
          <Field label="Category" value={business.category} onChangeText={(value) => updateField('category', value)} styles={styles} theme={theme} />
          <Field label="Address" value={business.address} onChangeText={(value) => updateField('address', value)} styles={styles} theme={theme} />
          <Field label="Timezone (IANA)" value={business.timezone || 'Asia/Karachi'} onChangeText={(value) => updateField('timezone', value)} styles={styles} theme={theme} />
          <Text style={styles.label}>Reply language</Text>
          <View style={styles.choiceRow}>
            {['roman', 'en', 'ur'].map((language) => (
              <Pressable key={language} onPress={() => updateField('language', language)} style={[styles.choice, business.language === language && styles.choiceSelected]}>
                <Text style={[styles.choiceText, business.language === language && styles.choiceTextSelected]}>{language === 'roman' ? 'Roman Urdu' : language === 'en' ? 'English' : 'Urdu'}</Text>
              </Pressable>
            ))}
          </View>
          <Field label="Owner name" value={business.owner_name} onChangeText={(value) => updateField('owner_name', value)} styles={styles} theme={theme} />
          <Field label="Owner phone (international digits)" value={business.owner_phone} onChangeText={(value) => updateField('owner_phone', value)} keyboardType="phone-pad" styles={styles} theme={theme} />
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Owner WhatsApp reminder opt-in</Text>
            <Switch value={business.owner_whatsapp_opt_in === true} onValueChange={(value) => updateField('owner_whatsapp_opt_in', value)} />
          </View>
          <Text style={styles.caption}>Is switch ko tabhi on karein jab owner ne WhatsApp reminders ke liye consent diya ho.</Text>

          <Text style={[styles.section, { marginTop: 18 }]}>Opening hours</Text>
          {hours.map((day) => {
            const label = DAYS.find((item) => item.dayOfWeek === day.dayOfWeek)?.label;
            return (
              <View key={day.dayOfWeek} style={styles.dayRow}>
                <Text style={styles.dayName}>{label}</Text>
                <Switch value={!day.closed} onValueChange={(open) => updateHours(day.dayOfWeek, { closed: !open })} />
                {day.closed ? <Text style={styles.muted}>Closed</Text> : (
                  <View style={styles.timePair}>
                    <TextInput accessibilityLabel={`${label} opens`} value={day.open} onChangeText={(open) => updateHours(day.dayOfWeek, { open })} placeholder="10:00" placeholderTextColor={theme.textMuted} style={styles.timeInput} />
                    <Text style={styles.muted}>to</Text>
                    <TextInput accessibilityLabel={`${label} closes`} value={day.close} onChangeText={(close) => updateHours(day.dayOfWeek, { close })} placeholder="20:00" placeholderTextColor={theme.textMuted} style={styles.timeInput} />
                  </View>
                )}
              </View>
            );
          })}
          <Button label={saving ? 'Saving...' : 'Save business profile'} onPress={saveBusiness} disabled={saving} />
        </View>

        <View style={styles.card}>
          <Text style={styles.section}>Services and prices</Text>
          {services.filter((service) => service.active).map((service) => (
            <View key={service.id} style={styles.itemRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle}>{service.name}</Text>
                <Text style={styles.muted}>{service.price_minor === null ? 'Price not set · handoff required' : `${service.currency} ${(Number(service.price_minor) / 100).toFixed(2).replace(/\.00$/, '')}`} · {service.duration_minutes} min</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={`Deactivate ${service.name}`} onPress={() => void deactivateService(service.id)}>
                <Ionicons name="trash-outline" size={19} color={theme.warning} />
              </Pressable>
            </View>
          ))}
          <Field label="Service name" value={serviceName} onChangeText={setServiceName} styles={styles} theme={theme} />
          <Field label="Description" value={serviceDescription} onChangeText={setServiceDescription} styles={styles} theme={theme} />
          <Field label="Price in PKR (blank means not set)" value={servicePrice} onChangeText={setServicePrice} keyboardType="decimal-pad" styles={styles} theme={theme} />
          <Field label="Duration in minutes" value={serviceDuration} onChangeText={setServiceDuration} keyboardType="number-pad" styles={styles} theme={theme} />
          <Button label="Add cloud service" variant="ghost" onPress={() => void addService()} disabled={saving} />
        </View>

        <View style={styles.card}>
          <Text style={styles.section}>Verified FAQs</Text>
          {faqs.map((faq) => (
            <View key={faq.id} style={styles.faqRow}>
              <Text style={styles.itemTitle}>{faq.question}</Text>
              <Text style={styles.muted}>{faq.answer}</Text>
              <Text style={styles.verified}>{faq.verified_at ? 'Verified' : 'Not verified'}</Text>
            </View>
          ))}
          <Field label="FAQ question" value={faqQuestion} onChangeText={setFaqQuestion} styles={styles} theme={theme} />
          <Field label="Verified answer" value={faqAnswer} onChangeText={setFaqAnswer} multiline styles={styles} theme={theme} />
          <Button label="Add verified FAQ" variant="ghost" onPress={() => void addFaq()} disabled={saving} />
        </View>

        <View style={styles.card}>
          <Text style={styles.section}>WhatsApp connection</Text>
          <Text style={styles.itemTitle}>{statusLabel}</Text>
          {connection?.display_phone_number ? <Text style={styles.muted}>{connection.display_phone_number}</Text> : null}
          {connection?.last_error_code ? <Text style={styles.error}>Issue: {connection.last_error_code}</Text> : null}
          <Text style={styles.caption}>Official Meta Embedded Signup client flow abhi app mein available nahi. Connection ko yahan fake/set nahi kiya ja sakta.</Text>
          <Button label="Refresh connection status" variant="ghost" onPress={() => { setLoading(true); void load(); }} />
        </View>
      </ScrollView>
    </Screen>
  );
}

function Field({ label, value, onChangeText, keyboardType, multiline, styles, theme }) {
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value == null ? '' : String(value)}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        multiline={multiline}
        placeholderTextColor={theme.textMuted}
        style={[styles.input, multiline && styles.multiline]}
      />
    </>
  );
}

const makeStyles = (t) => StyleSheet.create({
  content: { paddingVertical: 18, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  eyebrow: { color: t.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  title: { color: t.text, fontSize: 25, fontWeight: '800', marginTop: 5, marginBottom: 6 },
  muted: { color: t.textMuted, fontSize: 12, lineHeight: 18 },
  caption: { color: t.textMuted, fontSize: 11, lineHeight: 17, marginTop: 6, marginBottom: 8 },
  card: { backgroundColor: t.surface, borderRadius: 17, padding: 15, marginTop: 13, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border },
  section: { color: t.text, fontSize: 17, fontWeight: '700', marginBottom: 6 },
  label: { color: t.textMuted, fontSize: 12, fontWeight: '600', marginTop: 10, marginBottom: 5 },
  input: { minHeight: 43, borderWidth: 1, borderColor: t.border, borderRadius: 10, paddingHorizontal: 11, color: t.text, backgroundColor: t.bg },
  multiline: { minHeight: 80, textAlignVertical: 'top', paddingTop: 10 },
  error: { color: '#B42318', fontSize: 13, lineHeight: 19, marginTop: 10 },
  success: { color: t.accent, fontSize: 13, lineHeight: 19, marginTop: 10 },
  choiceRow: { flexDirection: 'row', marginTop: 4 },
  choice: { borderWidth: 1, borderColor: t.border, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 999, marginRight: 7 },
  choiceSelected: { backgroundColor: t.accent, borderColor: t.accent },
  choiceText: { color: t.textMuted, fontSize: 11, fontWeight: '600' },
  choiceTextSelected: { color: t.onAccent },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 13 },
  switchLabel: { flex: 1, color: t.text, fontSize: 12, fontWeight: '600' },
  dayRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.border },
  dayName: { width: 84, color: t.text, fontSize: 12, fontWeight: '600' },
  timePair: { flexDirection: 'row', alignItems: 'center', flex: 1, justifyContent: 'space-between' },
  timeInput: { width: 68, height: 36, textAlign: 'center', borderWidth: 1, borderColor: t.border, borderRadius: 8, color: t.text, backgroundColor: t.bg },
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.border },
  itemTitle: { color: t.text, fontSize: 13, fontWeight: '700' },
  faqRow: { paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.border },
  verified: { color: t.accent, fontSize: 10, fontWeight: '700', marginTop: 3 },
});
