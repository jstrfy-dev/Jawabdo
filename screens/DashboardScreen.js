import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, RingProgress, Button } from '../ui/kit';
import { useTheme } from '../ui/theme';
import { useStore } from '../store/store';
 
const DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
 
export default function DashboardScreen({ navigation }) {
  const t = useTheme();
  const { ready, business, bookings, customers, threads, dataMode, storageError } = useStore();
 
  const today = new Date();
  const dayLabel = DAYS[today.getDay()] + ', TODAY';
 
  const todays = useMemo(() => {
    if (!ready) return [];
    const list = Array.isArray(bookings) ? bookings : [];
    return list.filter((b) => {
      const d = b && b.at ? new Date(b.at) : null;
      return d && d.toDateString() === today.toDateString();
    });
  }, [ready, bookings]);
 
  const isStatus = (b, key) => String((b && b.status) || '').toLowerCase() === key;
  const confirmed = todays.filter((b) => isStatus(b, 'confirmed')).length;
  const pending = todays.filter((b) => isStatus(b, 'pending')).length;
  const slots = Number((business && business.slotsPerDay) || 10);
  const filled = Math.min(slots, confirmed + pending);
  const ratio = slots > 0 ? Math.min(1, filled / slots) : 0;
 
  const revenue = todays.filter((b) => ['confirmed', 'pending'].includes(String(b.status || '').toLowerCase()))
    .reduce((n, b) => n + (Number(b.amount) || 0), 0);
  const revenueLabel = 'Rs ' + revenue.toLocaleString('en-PK');
  const waiting = (threads || []).filter((thread) => thread.state === 'Flagged').length;
 
  const timeOf = (iso) => {
    const d = iso ? new Date(iso) : null;
    if (!d || isNaN(d.getTime())) return '--:--';
    let h = d.getHours();
    const m = d.getMinutes();
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return h + ':' + (m < 10 ? '0' + m : m) + ' ' + ap;
  };
 
  const s = styles(t);
 
  const statusColor = (st) => {
    const k = String(st || '').toLowerCase();
    return k === 'confirmed' ? t.accent : k === 'pending' ? t.warning : t.textMuted;
  };
  const statusLabel = (st) => {
    const k = String(st || '').toLowerCase();
    return k === 'confirmed' ? 'Confirmed' : k === 'pending' ? 'Pending' : 'Cancelled';
  };
 
  return (
    <Screen>
      <View style={s.head}>
        <View style={{ flex: 1 }}>
          <Text style={s.eyebrow}>{dayLabel}</Text>
          <Text style={s.title} numberOfLines={2}>Assalam-o-Alaikum! Aaj aapke business ka kya haal hai?</Text>
          <Text style={s.sub} numberOfLines={1}>{(business && business.name ? business.name : 'Glow Salon') + ', ' + (business && business.area ? business.area : 'Gulberg')}</Text>
        </View>
        <Pressable
          onPress={() => navigation.navigate('Calendar')}
          style={({ pressed }) => [s.add, pressed && { opacity: 0.7 }]}
          accessibilityLabel="Open calendar"
        >
          <Ionicons name="add" size={22} color={t.onAccent} />
        </Pressable>
      </View>

      <View style={s.demoBanner}>
        <Ionicons name="information-circle-outline" size={18} color={t.warning} />
        <Text style={s.demoText}>{dataMode === 'demo' ? 'Demo mode: yeh sample records hain, live business data nahi.' : 'Local mode: yeh data isi device par save hai.'}</Text>
      </View>
      {!!storageError && <Text style={s.errorText}>{storageError}</Text>}

      <View style={s.hero}>
        <View style={{ flex: 1 }}>
          <Text style={s.heroLabel}>TODAY'S BOOKINGS</Text>
          <Text style={s.heroNumber}>{filled}</Text>
          <Text style={s.heroSub}>{confirmed + ' confirmed · ' + pending + ' pending'}</Text>
        </View>
        <View style={s.ringWrap}>
          <RingProgress value={ratio} size={108} stroke={9} color={t.accent} track={t.surfaceAlt} />
          <View style={s.ringText}>
            <Text style={s.ringNumber}>{Math.round(ratio * 100) + '%'}</Text>
            <Text style={s.ringLabel}>filled</Text>
          </View>
        </View>
      </View>
 
      <View style={s.tiles}>
        <Pressable onPress={() => navigation.navigate('Inbox')} style={({ pressed }) => [s.tile, pressed && { opacity: 0.7 }]}>
          <Text style={s.tileLabel}>NEEDS A REPLY</Text>
          <Text style={s.tileValue}>{waiting}</Text>
          <Text style={s.metricHelp}>Chats waiting for you</Text>
        </Pressable>
        <Pressable onPress={() => navigation.navigate('Calendar')} style={({ pressed }) => [s.tile, pressed && { opacity: 0.7 }]}>
          <Text style={s.tileLabel}>ESTIMATED TODAY</Text>
          <Text style={s.tileValue}>{revenueLabel}</Text>
          <Text style={s.metricHelp}>Pending + confirmed booking value</Text>
        </Pressable>
      </View>

      <View style={s.tiles}>
        <View style={[s.tile, { flex: 1 }]}>
          <Text style={s.tileLabel}>PENDING REQUESTS</Text>
          <Text style={s.tileValue}>{pending}</Text>
          <Text style={s.metricHelp}>Aapki approval ka intezar</Text>
        </View>
        <View style={[s.tile, { flex: 1, marginRight: 0 }]}>
          <Text style={s.tileLabel}>CUSTOMERS</Text>
          <Text style={s.tileValue}>{(customers || []).length}</Text>
          <Text style={s.metricHelp}>Saved customer profiles</Text>
        </View>
      </View>

      <Text style={s.sectionLabel}>QUICK ACTIONS · ZAROORI KAAM</Text>
      <View style={s.actions}>
        <Button label="Bookings dekhein" icon="calendar-outline" variant="ghost" onPress={() => navigation.navigate('Calendar')} />
        <Button label="Inbox kholen" icon="chatbubbles-outline" variant="ghost" onPress={() => navigation.navigate('Inbox')} />
        <Button label="Service add / edit karein" icon="pricetag-outline" variant="ghost" onPress={() => navigation.navigate('Assistant')} />
        <Button label="Customers dekhein" icon="people-outline" variant="ghost" onPress={() => navigation.navigate('CustomerList')} />
        <Button label="WhatsApp setup" icon="logo-whatsapp" variant="ghost" onPress={() => navigation.navigate('Settings')} />
      </View>
 
      <Text style={s.sectionLabel}>TODAY</Text>
      {todays.length === 0 ? (
        <View style={s.emptyCard}>
          <View style={s.emptyIcon}><Ionicons name="calendar-outline" size={22} color={t.accent} /></View>
          <Text style={s.emptyTitle}>No bookings today</Text>
          <Text style={s.emptyBody}>Jab booking request aayegi, uska waqt aur status yahan dekhein.</Text>
        </View>
      ) : (
        todays.slice(0, 3).map((b, i) => (
          <Pressable
            key={b.id || String(i)}
            onPress={() => navigation.navigate('Calendar')}
            style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
          >
            <Text style={s.rowTime}>{timeOf(b.at)}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.rowName} numberOfLines={1}>{b.customer || 'Walk-in'}</Text>
              <Text style={s.rowService} numberOfLines={1}>{b.service || 'Service'}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={s.rowPrice}>{'Rs ' + (Number(b.amount) || 0).toLocaleString()}</Text>
              <View style={[s.pill, { backgroundColor: statusColor(b.status) + '22' }]}>
                <Text style={[s.pillText, { color: statusColor(b.status) }]}>{statusLabel(b.status)}</Text>
              </View>
            </View>
          </Pressable>
        ))
      )}
 
      <View style={s.alert}>
        <View style={s.alertIcon}><Ionicons name="shield-checkmark" size={18} color={t.accent} /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.alertTitle}>Naye hain? Pehle setup guide dekhein</Text>
          <Text style={s.alertSub}>Business, services aur FAQs ko apne data se tayyar karein.</Text>
        </View>
        <Pressable onPress={() => navigation.navigate('Guide')} accessibilityLabel="How JawabDo works">
          <Ionicons name="chevron-forward" size={19} color={t.accent} />
        </Pressable>
      </View>
    </Screen>
  );
}
 
const styles = (t) => StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start', paddingTop: 8, paddingBottom: 16 },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1.4, color: t.accent, marginBottom: 6 },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '800', color: t.text },
  sub: { fontSize: 14, lineHeight: 20, color: t.textMuted, marginTop: 2 },
  demoBanner: { flexDirection: 'row', alignItems: 'center', padding: 11, borderRadius: 13, backgroundColor: t.warning + '18', marginBottom: 14 },
  demoText: { flex: 1, color: t.text, fontSize: 12, lineHeight: 18, marginLeft: 7 },
  errorText: { color: t.danger, fontSize: 12, lineHeight: 18, marginBottom: 10 },
  add: { width: 36, height: 36, borderRadius: 18, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', marginTop: 12, marginLeft: 10 },
  hero: { backgroundColor: t.surface, borderRadius: 24, padding: 20, marginBottom: 16, flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: t.border },
  heroLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1.4, color: t.accent, marginBottom: 6 },
  heroNumber: { fontSize: 36, lineHeight: 40, fontWeight: '800', color: t.text, fontVariant: ['tabular-nums'] },
  heroSub: { fontSize: 13, color: t.textMuted, marginTop: 4 },
  ringWrap: { width: 108, height: 108, alignItems: 'center', justifyContent: 'center', marginLeft: 12 },
  ringText: { position: 'absolute', alignItems: 'center' },
  ringNumber: { fontSize: 20, fontWeight: '800', color: t.text },
  ringLabel: { fontSize: 11, color: t.textMuted, marginTop: 2 },
  tiles: { flexDirection: 'row', marginBottom: 12 },
  tile: { flex: 1, backgroundColor: t.surface, borderRadius: 16, padding: 14, marginRight: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border },
  tileLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, color: t.textMuted, marginBottom: 8 },
  tileValue: { fontSize: 20, fontWeight: '800', color: t.text, fontVariant: ['tabular-nums'] },
  metricHelp: { fontSize: 11, color: t.textMuted, lineHeight: 16, marginTop: 5 },
  actions: { marginBottom: 18 },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1.4, color: t.textMuted, marginBottom: 12 },
  row: { backgroundColor: t.surface, borderRadius: 16, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: t.border },
  rowTime: { fontSize: 14, fontWeight: '700', color: t.text, width: 52, fontVariant: ['tabular-nums'] },
  rowName: { fontSize: 15, fontWeight: '700', color: t.text },
  rowService: { fontSize: 13, color: t.textMuted, marginTop: 2 },
  rowPrice: { fontSize: 14, fontWeight: '700', color: t.text, marginBottom: 4, fontVariant: ['tabular-nums'] },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillText: { fontSize: 11, fontWeight: '700' },
  emptyCard: { backgroundColor: t.surface, borderRadius: 16, padding: 24, alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: t.border },
  emptyIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: t.surfaceAlt, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: t.text, marginBottom: 4 },
  emptyBody: { fontSize: 13, color: t.textMuted, textAlign: 'center' },
  alert: { flexDirection: 'row', alignItems: 'center', backgroundColor: t.accentSoft, borderRadius: 16, padding: 14, marginTop: 14 },
  alertIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  alertTitle: { fontSize: 15, fontWeight: '700', color: t.text },
  alertSub: { fontSize: 13, lineHeight: 19, color: t.textMuted, marginTop: 2 },
});