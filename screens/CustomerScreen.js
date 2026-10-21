import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Button, Chip, EmptyState } from '../ui/kit';
import { useTheme } from '../ui/theme';
import { useStore } from '../store/store';
import { useAuth } from '../auth/AuthContext';
import { useCloudData } from '../auth/CloudDataContext';

const TAG_OPTIONS = ['VIP', 'Bridal', 'Prefers Urdu', 'Follow-up'];

export default function CustomersScreen({ navigation, route }) {
  const t = useTheme();
  const store = useStore();
  const { session } = useAuth();
  const cloud = useCloudData();
  const live = Boolean(session);
  const { addCustomerNote, setCustomerTags } = store;
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState('');
  const [cloudProfile, setCloudProfile] = useState(null);
  const [cloudLoading, setCloudLoading] = useState(false);
  const customerId = route.params?.customerId;
  const localCustomer = (store.customers || []).find((item) => item.id === customerId);
  const customer = live ? (cloudProfile?.customer || cloud.customers.find((item) => item.id === customerId)) : localCustomer;
  const history = live
    ? (cloudProfile?.bookings || [])
    : (store.bookings || []).filter((booking) => booking.customerId === customer?.id).sort((a, b) => new Date(b.at) - new Date(a.at));
  const s = styles(t);

  useEffect(() => {
    if (!live || !customerId) return undefined;
    let active = true;
    setCloudLoading(true);
    cloud.getCustomer(customerId)
      .then((profile) => { if (active) setCloudProfile(profile); })
      .catch((error) => { if (active) setNotice(error.message); })
      .finally(() => { if (active) setCloudLoading(false); });
    return () => { active = false; };
  }, [live, customerId, cloud.getCustomer]);

  useEffect(() => {
    setNote(customer?.notes || '');
  }, [customer?.id, customer?.notes]);

  if (live && cloudLoading && !customer) {
    return <Screen><EmptyState icon="hourglass-outline" title="Customer load ho raha hai" body="Server se profile hasil ki ja rahi hai." /></Screen>;
  }

  if (live && cloud.error && !customer) {
    return <Screen><EmptyState icon="cloud-offline-outline" title="Customer data load nahi hua" body={cloud.error} actionLabel="Dobara koshish karein" onAction={() => cloud.getCustomer(customerId).then(setCloudProfile).catch((error) => setNotice(error.message))} /></Screen>;
  }

  if (!customer) {
    return (
      <Screen>
        <EmptyState icon="person-outline" title="Customer nahi mila" body="Inbox ya customer list se customer dobara kholen." actionLabel="Wapas jayein" onAction={() => navigation.goBack()} />
      </Screen>
    );
  }

  const toggleTag = (tag) => {
    const current = customer.tags || [];
    const tags = current.includes(tag) ? current.filter((value) => value !== tag) : [...current, tag];
    if (live) {
      cloud.updateCustomer(customer.id, { notes: customer.notes || '', tags })
        .then((result) => setCloudProfile((profile) => profile ? { ...profile, customer: { ...profile.customer, ...result } } : profile))
        .catch((error) => setNotice(error.message));
    } else {
      setCustomerTags(customer.id, tags);
    }
  };
  const saveNote = () => {
    if (live) {
      cloud.updateCustomer(customer.id, { notes: note.trim(), tags: customer.tags || [] })
        .then((result) => {
          setCloudProfile((profile) => profile ? { ...profile, customer: { ...profile.customer, ...result } } : profile);
          setNotice('Customer note server par save ho gaya.');
        })
        .catch((error) => setNotice(error.message));
    } else {
      addCustomerNote(customer.id, note.trim());
      setNotice('Note isi device par save ho gaya.');
    }
  };
  const lastVisit = customer.lastVisit ? new Date(customer.lastVisit).toLocaleDateString() : 'Maloom nahi';

  return (
    <Screen>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.head}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={s.back} accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={22} color={t.text} />
          </Pressable>
          <View style={{ flex: 1, marginLeft: 9 }}>
            <Text style={s.title}>Customer profile</Text>
            <Text style={s.caption}>{live ? 'Server business record' : store.dataMode === 'demo' ? 'Sample customer · demo mode' : 'Is device ka customer record'}</Text>
          </View>
        </View>
        <View style={s.card}>
          <View style={s.identity}>
            <View style={s.avatar}><Text style={s.avatarText}>{customer.name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</Text></View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={s.name}>{customer.name}</Text>
              <Text style={s.caption}>{customer.visits || history.length} visits · last {lastVisit}</Text>
            </View>
            <View style={[s.payment, customer.payment === 'Paid' ? { backgroundColor: t.accentSoft } : { backgroundColor: t.warning + '20' }]}>
              <Text style={[s.paymentText, { color: customer.payment === 'Paid' ? t.accent : t.warning }]}>{customer.payment || 'Payment unknown'}</Text>
            </View>
          </View>
          <View style={s.phoneRow}>
            <Ionicons name="call-outline" size={16} color={t.textMuted} />
            <Text style={s.phone}>{customer.phone || 'Phone number nahi di gayi'}</Text>
          </View>
          <View style={s.stats}>
            <View style={s.stat}><Text style={s.statLabel}>TOTAL SPENT</Text><Text style={s.statValue}>Rs {Number(customer.spent || 0).toLocaleString('en-PK')}</Text></View>
            <View style={[s.stat, { marginLeft: 10 }]}><Text style={s.statLabel}>VISITS</Text><Text style={s.statValue}>{customer.visits || history.length}</Text></View>
          </View>
        </View>

        <Text style={s.section}>Visit history</Text>
        {history.length === 0 ? (
          <View style={s.card}><Text style={s.caption}>Is customer ki booking history abhi nahi hai.</Text></View>
        ) : history.map((booking) => (
          <View key={booking.id} style={s.historyRow}>
            <View style={s.historyIcon}><Ionicons name="calendar-outline" size={17} color={t.accent} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.historyTitle}>{booking.service || 'Service'}</Text>
              <Text style={s.caption}>{new Date(booking.at).toLocaleDateString()} · {booking.status}</Text>
            </View>
            <Text style={s.historyPrice}>Rs {Number(booking.amount || 0).toLocaleString('en-PK')}</Text>
          </View>
        ))}

        <Text style={s.section}>Tags aur owner notes</Text>
        <View style={s.tags}>
          {TAG_OPTIONS.map((tag) => <Chip key={tag} label={tag} active={(customer.tags || []).includes(tag)} onPress={() => toggleTag(tag)} />)}
        </View>
        <TextInput value={note} onChangeText={(value) => { setNote(value); setNotice(''); }} placeholder="Customer ke liye note likhein..." placeholderTextColor={t.textMuted} style={s.noteInput} multiline />
        <Button label="Note save karein" icon="save-outline" variant="ghost" onPress={saveNote} />
        {!!notice && <Text style={s.notice}>{notice}</Text>}
        <View style={s.paymentNote}>
          <Ionicons name="card-outline" size={17} color={t.warning} />
          <Text style={s.paymentNoteText}>Payment provider configured nahi, is liye yahan se payment link nahi bheja gaya.</Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = (t) => StyleSheet.create({
  content: { paddingBottom: 32 },
  head: { flexDirection: 'row', alignItems: 'center', paddingTop: 8, paddingBottom: 14 },
  back: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surface },
  title: { fontSize: 22, fontWeight: '800', color: t.text },
  caption: { fontSize: 12, lineHeight: 18, color: t.textMuted, marginTop: 3 },
  card: { backgroundColor: t.surface, borderRadius: 18, padding: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border },
  identity: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: t.onAccent, fontSize: 18, fontWeight: '800' },
  name: { color: t.text, fontSize: 17, fontWeight: '800' },
  payment: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, marginLeft: 5 },
  paymentText: { fontSize: 10, fontWeight: '700' },
  phoneRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  phone: { color: t.textMuted, fontSize: 14, marginLeft: 8 },
  stats: { flexDirection: 'row', marginTop: 15 },
  stat: { flex: 1, backgroundColor: t.bg, borderRadius: 12, padding: 12 },
  statLabel: { color: t.textMuted, fontSize: 9, fontWeight: '800', letterSpacing: 0.7 },
  statValue: { color: t.text, fontSize: 17, fontWeight: '800', marginTop: 5 },
  section: { color: t.textMuted, fontSize: 11, fontWeight: '800', letterSpacing: 1, marginTop: 22, marginBottom: 10 },
  historyRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: t.surface, borderRadius: 14, padding: 12, marginBottom: 8 },
  historyIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: t.accentSoft, marginRight: 10 },
  historyTitle: { color: t.text, fontSize: 14, fontWeight: '700' },
  historyPrice: { color: t.text, fontSize: 12, fontWeight: '700', marginLeft: 5 },
  tags: { flexDirection: 'row', flexWrap: 'wrap' },
  noteInput: { minHeight: 86, textAlignVertical: 'top', color: t.text, fontSize: 14, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, borderRadius: 14, padding: 12, marginTop: 7 },
  notice: { color: t.accent, fontSize: 12, marginVertical: 4 },
  paymentNote: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 13, backgroundColor: t.warning + '18', marginTop: 16 },
  paymentNoteText: { flex: 1, color: t.textMuted, fontSize: 12, lineHeight: 18, marginLeft: 8 },
});
