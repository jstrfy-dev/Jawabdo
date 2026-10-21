import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Button, EmptyState } from '../ui/kit';
import { useTheme } from '../ui/theme';
import { useStore } from '../store/store';
import { useAuth } from '../auth/AuthContext';
import { useCloudData } from '../auth/CloudDataContext';

export default function CustomersListScreen({ navigation }) {
  const t = useTheme();
  const store = useStore();
  const { session } = useAuth();
  const cloud = useCloudData();
  const live = Boolean(session);
  const customers = live ? cloud.customers : store.customers;
  const dataMode = live ? 'cloud' : store.dataMode;
  const [query, setQuery] = useState('');
  const list = useMemo(() => (customers || []).filter((customer) => (
    `${customer.name} ${customer.phone || ''} ${(customer.tags || []).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase())
  )), [customers, query]);
  const s = styles(t);

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        <Text style={s.eyebrow}>RISHTAY, SIRF RECORDS NAHI</Text>
        <Text style={s.title}>Customers</Text>
        <Text style={s.subtitle}>{live ? 'Business ke server par saved customer records.' : dataMode === 'demo' ? 'Sample customer profiles — live contacts nahi.' : 'Is device par saved customer profiles.'}</Text>
        {live && cloud.loading ? <Text style={s.subtitle}>Customers load ho rahe hain...</Text> : null}
        {live && cloud.error ? <><Text style={[s.subtitle, { color: t.danger }]}>{cloud.error}</Text><Button label="Dobara load karein" variant="ghost" onPress={() => cloud.refresh()} /></> : null}
        <View style={s.search}>
          <Ionicons name="search-outline" size={18} color={t.textMuted} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Naam, phone ya tag dhoondein" placeholderTextColor={t.textMuted} style={s.searchInput} />
        </View>
        {list.length === 0 && live && (cloud.loading || cloud.error) ? null : list.length === 0 ? (
          <EmptyState icon="people-outline" title={query ? 'Koi customer nahi mila' : 'Abhi customer nahi hain'} body={query ? 'Naam ya tag dobara check karein.' : 'WhatsApp se opt-in ke baad customer profiles yahan aa sakti hain.'} />
        ) : list.map((customer) => (
          <Pressable key={customer.id} onPress={() => navigation.navigate('Customers', { customerId: customer.id })} style={({ pressed }) => [s.customer, pressed && { opacity: 0.75 }]}>
            <View style={s.avatar}>
              <Text style={s.initials}>{customer.name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.name} numberOfLines={1}>{customer.name}</Text>
              <Text style={s.phone} numberOfLines={1}>{customer.phone || 'Phone number nahi'}</Text>
              <View style={s.tags}>
                {(customer.tags || []).slice(0, 2).map((tag) => <Text key={tag} style={s.tag}>{tag}</Text>)}
              </View>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={s.visits}>{customer.visits || 0} visits</Text>
              <Ionicons name="chevron-forward" size={17} color={t.textMuted} style={{ marginTop: 6 }} />
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = (t) => StyleSheet.create({
  content: { paddingBottom: 30 },
  eyebrow: { color: t.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.1, marginTop: 8 },
  title: { color: t.text, fontSize: 27, fontWeight: '800', marginTop: 4 },
  subtitle: { color: t.textMuted, fontSize: 13, lineHeight: 19, marginTop: 4, marginBottom: 14 },
  search: { flexDirection: 'row', alignItems: 'center', minHeight: 46, backgroundColor: t.surface, borderRadius: 13, paddingHorizontal: 12, marginBottom: 14, borderWidth: 1, borderColor: t.border },
  searchInput: { flex: 1, color: t.text, fontSize: 14, marginLeft: 8 },
  customer: { flexDirection: 'row', alignItems: 'center', backgroundColor: t.surface, borderRadius: 16, padding: 13, marginBottom: 9, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: t.accentSoft, marginRight: 11 },
  initials: { color: t.accent, fontSize: 13, fontWeight: '800' },
  name: { color: t.text, fontSize: 14, fontWeight: '700' },
  phone: { color: t.textMuted, fontSize: 11, marginTop: 2 },
  tags: { flexDirection: 'row', marginTop: 5 },
  tag: { color: t.accent, backgroundColor: t.accentSoft, fontSize: 9, fontWeight: '700', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999, marginRight: 5 },
  visits: { color: t.textMuted, fontSize: 10, fontWeight: '600' },
});
