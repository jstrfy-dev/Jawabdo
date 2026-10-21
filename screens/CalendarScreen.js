import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Chip, Button, EmptyState } from '../ui/kit';
import { useTheme } from '../ui/theme';
import { useStore } from '../store/store';
import { useAuth } from '../auth/AuthContext';
import { useCloudData } from '../auth/CloudDataContext';

const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const toDate = (value) => {
  const result = value ? new Date(value) : null;
  return result && !Number.isNaN(result.getTime()) ? result : null;
};
const getWeek = (today) => {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
  return Array.from({ length: 7 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
};
const isActive = (booking) => !['cancelled', 'completed'].includes(String(booking.status || '').toLowerCase());

export default function CalendarScreen({ navigation }) {
  const t = useTheme();
  const store = useStore();
  const { session } = useAuth();
  const cloud = useCloudData();
  const live = Boolean(session);
  const bookings = live ? cloud.bookings : store.bookings;
  const updateBookingStatus = store.updateBookingStatus;
  const moveBooking = store.moveBooking;
  const dataMode = live ? 'cloud' : store.dataMode;
  const today = useMemo(() => new Date(), []);
  const week = useMemo(() => getWeek(today), [today]);
  const [day, setDay] = useState(() => dateKey(today));
  const [staff, setStaff] = useState('All staff');
  const [view, setView] = useState('List');
  const [message, setMessage] = useState('');
  const dayBookings = useMemo(() => (bookings || []).filter((booking) => {
    const date = toDate(booking.at);
    return date && dateKey(date) === day && (staff === 'All staff' || booking.staff === staff);
  }).sort((a, b) => new Date(a.at) - new Date(b.at)), [bookings, day, staff]);
  const pending = dayBookings.filter((booking) => String(booking.status).toLowerCase() === 'pending');
  const s = styles(t);

  const moveToNextDay = (booking) => {
    const current = toDate(booking.at);
    if (!current) {
      setMessage('Is booking ka waqt durust nahi; pehle details check karein.');
      return;
    }
    const next = new Date(current);
    next.setDate(next.getDate() + 1);
    const conflict = (bookings || []).some((other) => {
      const otherDate = toDate(other.at);
      return other.id !== booking.id && isActive(other) && otherDate
        && otherDate.getTime() === next.getTime();
    });
    if (conflict) {
      setMessage('Agley din yeh exact waqt pehle se booked hai. Doosra waqt chunein.');
      return;
    }
    moveBooking(booking.id, next.toISOString());
    setMessage('Demo booking agley din ke isi waqt par move ho gayi.');
  };

  const confirm = (booking) => {
    if (live) {
      cloud.updateBookingStatus(booking.id, 'confirmed')
        .then(() => setMessage('Appointment server par confirm ho gayi.'))
        .catch((error) => setMessage(error.message));
    } else {
      updateBookingStatus(booking.id, 'Confirmed');
      setMessage('Booking demo list mein confirm mark ho gayi.');
    }
  };
  const cancel = (booking) => {
    if (live) {
      cloud.updateBookingStatus(booking.id, 'cancelled')
        .then(() => setMessage('Appointment server par cancel ho gayi.'))
        .catch((error) => setMessage(error.message));
    } else {
      updateBookingStatus(booking.id, 'Cancelled');
      setMessage('Booking demo list mein cancel mark ho gayi.');
    }
  };

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        <View style={s.head}>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>Bookings</Text>
            <Text style={s.caption}>Calendar aur appointment list</Text>
          </View>
          <Pressable onPress={() => navigation.navigate(live ? 'CloudBusiness' : 'Onboarding')} style={s.add} accessibilityLabel="Edit opening hours">
            <Ionicons name="time-outline" size={20} color={t.onAccent} />
          </Pressable>
        </View>

        <View style={s.notice}>
          <Ionicons name="information-circle-outline" size={17} color={t.warning} />
          <Text style={s.noticeText}>{live ? 'Live appointments backend database se load hoti hain. Rescheduling aur WhatsApp reminders abhi configure nahi hain.' : dataMode === 'demo' ? 'Sample bookings — approvals aur rescheduling sirf is device ke demo data par hain.' : 'Local bookings — server par sync ya double-booking protection configured nahi.'}</Text>
        </View>
        {live && cloud.loading ? <Text style={s.caption}>Appointments load ho rahi hain...</Text> : null}
        {live && cloud.error ? <><Text style={[s.message, { color: t.danger }]}>{cloud.error}</Text><Button label="Dobara load karein" variant="ghost" onPress={() => cloud.refresh()} /></> : null}

        <View style={s.week}>
          {week.map((date) => {
            const selected = dateKey(date) === day;
            const todayDate = dateKey(date) === dateKey(today);
            return (
              <Pressable key={dateKey(date)} onPress={() => { setDay(dateKey(date)); setMessage(''); }} style={[s.day, selected && s.daySelected]}>
                <Text style={[s.dayLabel, selected && { color: t.onAccent }]}>{date.toLocaleDateString(undefined, { weekday: 'short' })}</Text>
                <Text style={[s.dayNumber, selected && { color: t.onAccent }]}>{date.getDate()}</Text>
                <Text style={[s.today, selected && { color: t.onAccent }]}>{todayDate ? 'today' : ' '}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={s.listHead}>
          <View style={{ flex: 1 }}>
            <Text style={s.sectionTitle}>{(toDate(day + 'T12:00:00') || today).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}</Text>
            <Text style={s.caption}>{dayBookings.length} appointment{dayBookings.length === 1 ? '' : 's'}</Text>
          </View>
          <Pressable onPress={() => setView((current) => current === 'List' ? 'Timeline' : 'List')} accessibilityRole="button" style={s.viewToggle}>
            <Ionicons name={view === 'List' ? 'list-outline' : 'time-outline'} size={16} color={t.accent} />
            <Text style={s.toggleText}>{view === 'List' ? 'Timeline' : 'List'}</Text>
          </Pressable>
        </View>

        <View style={s.staffRow}>
          {(live ? ['All staff'] : ['All staff', 'Sara', 'Noor']).map((name) => <Chip key={name} label={name} active={staff === name} onPress={() => setStaff(name)} />)}
        </View>

        {!!message && <Text style={s.message}>{message}</Text>}
        {dayBookings.length === 0 && live && (cloud.loading || cloud.error) ? null : dayBookings.length === 0 ? (
          <EmptyState icon="sunny-outline" title="Is din koi booking nahi" body="Naya customer aaye to uski request yahan nazar aayegi." />
        ) : dayBookings.map((booking) => {
          const time = toDate(booking.at);
          const status = String(booking.status || 'Pending');
          const lowerStatus = status.toLowerCase();
          return (
            <View key={booking.id} style={[s.booking, view === 'Timeline' && s.timelineBooking, lowerStatus === 'cancelled' && { opacity: 0.65 }]}>
              <View style={s.timeCol}>
                <Text style={s.time}>{time ? time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'}</Text>
                <View style={[s.statusDot, { backgroundColor: lowerStatus === 'confirmed' ? t.accent : lowerStatus === 'pending' ? t.warning : t.textMuted }]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.customer} numberOfLines={1}>{booking.customer || 'Walk-in'}</Text>
                <Text style={s.service} numberOfLines={1}>{booking.service || 'Service not set'} · Rs {Number(booking.amount || 0).toLocaleString('en-PK')}</Text>
                <Text style={s.service}>{booking.staff || 'Team not set'} · {status}</Text>
                {lowerStatus !== 'cancelled' && lowerStatus !== 'completed' && (
                  <View style={s.actions}>
                    {lowerStatus === 'pending' && <Pressable onPress={() => confirm(booking)} style={s.action}><Text style={s.actionText}>Confirm</Text></Pressable>}
                    {!live && <Pressable onPress={() => moveToNextDay(booking)} style={s.action}><Text style={s.actionText}>+1 din move</Text></Pressable>}
                    <Pressable onPress={() => cancel(booking)} style={[s.action, { borderColor: t.danger }]}><Text style={[s.actionText, { color: t.danger }]}>Cancel</Text></Pressable>
                  </View>
                )}
              </View>
            </View>
          );
        })}

        <View style={s.footer}>
          <Text style={s.footerTitle}>{pending.length ? `${pending.length} request${pending.length === 1 ? '' : 's'} aapki approval ka intezar kar rahi hain` : 'Aap sab se updated hain'}</Text>
          <Text style={s.caption}>{live ? 'Appointments aur booking conflicts server par verify hote hain. WhatsApp reminders abhi off hain.' : 'Real calendar sync aur safe booking conflicts ke liye shared backend zaroori hai.'}</Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = (t) => StyleSheet.create({
  content: { paddingBottom: 30 },
  head: { flexDirection: 'row', alignItems: 'center', paddingTop: 8, paddingBottom: 12 },
  title: { color: t.text, fontSize: 25, fontWeight: '800' },
  caption: { color: t.textMuted, fontSize: 12, lineHeight: 18, marginTop: 3 },
  add: { width: 40, height: 40, borderRadius: 20, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' },
  notice: { flexDirection: 'row', alignItems: 'center', padding: 11, borderRadius: 13, backgroundColor: t.warning + '18', marginBottom: 14 },
  noticeText: { flex: 1, color: t.text, fontSize: 12, lineHeight: 18, marginLeft: 7 },
  week: { flexDirection: 'row', marginBottom: 16 },
  day: { flex: 1, alignItems: 'center', paddingVertical: 8, marginHorizontal: 2, borderRadius: 13, backgroundColor: t.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border },
  daySelected: { backgroundColor: t.accent, borderColor: t.accent },
  dayLabel: { color: t.textMuted, fontSize: 10, fontWeight: '700' },
  dayNumber: { color: t.text, fontSize: 16, fontWeight: '800', marginTop: 3 },
  today: { color: t.textMuted, fontSize: 8, marginTop: 2 },
  listHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  sectionTitle: { color: t.text, fontSize: 17, fontWeight: '700' },
  viewToggle: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 11, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: t.border },
  toggleText: { color: t.accent, fontSize: 12, fontWeight: '700', marginLeft: 5 },
  staffRow: { flexDirection: 'row', marginBottom: 10 },
  message: { color: t.accent, fontSize: 12, lineHeight: 18, marginVertical: 6 },
  booking: { flexDirection: 'row', backgroundColor: t.surface, borderRadius: 16, padding: 14, marginBottom: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border },
  timelineBooking: { borderLeftWidth: 3, borderLeftColor: t.accent, borderTopLeftRadius: 5, borderBottomLeftRadius: 5 },
  timeCol: { width: 76, alignItems: 'flex-start' },
  time: { color: t.text, fontSize: 13, fontWeight: '700' },
  statusDot: { width: 7, height: 7, borderRadius: 4, marginTop: 8 },
  customer: { color: t.text, fontSize: 15, fontWeight: '700' },
  service: { color: t.textMuted, fontSize: 12, marginTop: 3 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  action: { borderWidth: 1, borderColor: t.accent, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, marginRight: 6, marginTop: 4 },
  actionText: { color: t.accent, fontSize: 11, fontWeight: '700' },
  footer: { backgroundColor: t.accentSoft, borderRadius: 15, padding: 14, marginTop: 6 },
  footerTitle: { color: t.text, fontSize: 14, fontWeight: '700' },
});
