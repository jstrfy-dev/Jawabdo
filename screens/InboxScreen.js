import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Chip, Button, EmptyState } from '../ui/kit';
import { useTheme } from '../ui/theme';
import { useStore } from '../store/store';
import { useAuth } from '../auth/AuthContext';
import { useCloudData } from '../auth/CloudDataContext';
 
const FILTERS = ['All', 'Needs owner', 'AI replied', 'Owner replied'];
 
export default function InboxScreen({ navigation }) {
  const t = useTheme();
  const store = useStore();
  const { session } = useAuth();
  const cloud = useCloudData();
  const live = Boolean(session);
  const threads = live ? cloud.conversations : store.threads;
  const dataMode = live ? 'cloud' : store.dataMode;
  const filters = live ? ['All', 'Needs owner', 'Owner handling', 'Open'] : FILTERS;
  const flagForOwner = store.flagForOwner;
  const updateBookingStatus = store.updateBookingStatus;
  const [filter, setFilter] = useState('All');
 
  const list = useMemo(() => {
    const all = threads || [];
    if (filter === 'AI replied') return all.filter((th) => th.state === 'AI replied');
    if (filter === 'Needs owner') return all.filter((th) => th.state === 'Flagged');
    if (filter === 'Open') return all.filter((th) => th.state === 'Open');
    if (filter === 'Owner handling') return all.filter((th) => th.state === 'Owner handling');
    if (filter === 'Owner replied') return all.filter((th) => th.state === 'Owner replied' || th.state === 'Owner handling');
    return all;
  }, [threads, filter]);
 
  const needReply = (threads || []).filter((th) => th.state === 'Flagged').length;
  const hero = list[0];
  const rest = list.slice(1);
  const s = styles(t);
 
  const initials = (name) => (name || '').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
 
  const badge = (state) =>
    state === 'Flagged'
      ? { label: 'Needs owner', color: t.warning, icon: 'alert-circle' }
      : state === 'Closed'
        ? { label: 'Closed', color: t.textMuted, icon: 'checkmark-circle-outline' }
      : state === 'Owner handling' || state === 'Owner replied'
        ? { label: 'Owner replying', color: t.accent, icon: 'person' }
        : { label: live ? 'Open' : 'AI sample', color: t.accent, icon: live ? 'chatbubble-outline' : 'sparkles' };
 
  const act = (thread, action) => {
    if (!thread) return;
    if (thread.bookingId) updateBookingStatus(thread.bookingId, action);
    if (action === 'Confirmed') flagForOwner(thread.id);
  };
 
  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={s.head}>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>Inbox</Text>
            <Text style={s.caption}>{needReply > 0 ? needReply + ' need your reply' : 'Aapke customer chats'}</Text>
          </View>
          <Pressable onPress={() => navigation.navigate('Settings')} accessibilityLabel="WhatsApp connection status" style={s.connection}>
            <View style={[s.offlineDot, live && cloud.connection?.status === 'connected' && { backgroundColor: t.accent }]} />
            <Text style={s.connectionText}>{live ? (cloud.connection?.status === 'connected' ? 'Connected' : 'Not connected') : 'Demo'}</Text>
          </Pressable>
        </View>

        <View style={s.notice}>
          <Ionicons name="information-circle-outline" size={17} color={t.warning} />
          <Text style={s.noticeText}>{live
            ? cloud.connection?.status === 'connected'
              ? 'Server par receive hui conversations yahan dikhengi. Is app se manual replies send nahi hote.'
              : `WhatsApp connected nahi. ${cloud.databaseDriver === 'mysql' ? 'MySQL runtime mein integration configure nahi hai.' : 'Backend connection set up nahi hai.'}`
            : dataMode === 'demo' ? 'Yeh sample chats hain. WhatsApp connected nahi; replies sirf local demo mein rehte hain.' : 'WhatsApp connected nahi. Messages yahan send nahi honge.'}</Text>
        </View>
        {live && cloud.loading ? <Text style={s.noticeText}>Conversations load ho rahi hain...</Text> : null}
        {live && cloud.error ? <><Text style={[s.noticeText, { color: t.danger }]}>{cloud.error}</Text><Button label="Dobara load karein" variant="ghost" onPress={() => cloud.refresh()} /></> : null}
        <View style={s.chips}>
          {filters.map((f) => (
            <Chip key={f} label={f} active={filter === f} onPress={() => setFilter(f)} />
          ))}
        </View>
 
        {list.length === 0 && live && (cloud.loading || cloud.error) ? null : list.length === 0 ? (
          <EmptyState
            icon="chatbubbles-outline"
            title="No conversations here"
            line={live
              ? 'Is MySQL runtime mein WhatsApp integration configure nahi; koi live customer message receive ya send nahi ho raha.'
              : filter === 'All' ? 'Abhi chat nahi hai. WhatsApp connect hone ke baad customer chats yahan dikhengi.' : 'Is filter mein koi chat nahi.'}
          />
        ) : (
          <>
            <View style={s.hero}>
              <View style={s.heroTop}>
                <View style={s.avatar}>
                  <Text style={s.avatarText}>{initials(hero.name)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.name} numberOfLines={1}>{hero.name}</Text>
                  <Text style={s.time}>{new Date(hero.at).toLocaleString()}</Text>
                </View>
                <View style={[s.badge, { backgroundColor: badge(hero.state).color + '22' }]}>
                  <Ionicons name={badge(hero.state).icon} size={12} color={badge(hero.state).color} />
                  <Text style={[s.badgeText, { color: badge(hero.state).color }]}>
                    {badge(hero.state).label}
                  </Text>
                </View>
              </View>
              <Text style={s.preview} numberOfLines={2}>{hero.last}</Text>
              {!live && <View style={s.actions}>
                <View style={{ flex: 1 }}>
                  <Button label="Confirm" onPress={() => act(hero, 'Confirmed')} />
                </View>
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Button label="Pending" variant="ghost" onPress={() => act(hero, 'Pending')} />
                </View>
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Button label="Cancel" variant="ghost" onPress={() => act(hero, 'Cancelled')} />
                </View>
              </View>}
              <Button label={live ? 'Conversation details kholen' : 'Chat kholen aur jawab dein'} icon="chatbubble-ellipses-outline" variant="ghost" onPress={() => navigation.navigate('Conversation', { threadId: hero.id })} />
            </View>
 
            {rest.map((th) => {
              const b = badge(th.state);
              return (
                <Pressable
                  key={th.id}
                  onPress={() => navigation.navigate('Conversation', { threadId: th.id })}
                  style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
                >
                  <View style={[s.avatar, s.avatarSm]}>
                    <Text style={[s.avatarText, { fontSize: 13 }]}>{initials(th.name)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={s.rowTop}>
                      <Text style={s.rowName} numberOfLines={1}>{th.name}</Text>
                      <Text style={s.rowTime}>{new Date(th.at).toLocaleDateString()}</Text>
                    </View>
                    <Text style={s.rowPreview} numberOfLines={1}>{th.last}</Text>
                    <View style={[s.badge, s.badgeSm, { backgroundColor: b.color + '22', alignSelf: 'flex-start' }]}>
                      <Ionicons name={b.icon} size={11} color={b.color} />
                      <Text style={[s.badgeText, s.badgeTextSm, { color: b.color }]}>{b.label}</Text>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={t.textMuted} />
                </Pressable>
              );
            })}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
 
const styles = (t) => StyleSheet.create({
  head: { paddingTop: 8, paddingBottom: 14 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '800', color: t.text },
  caption: { fontSize: 14, color: t.textMuted, marginTop: 4 },
  chips: { flexDirection: 'row', marginBottom: 16 },
  connection: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, backgroundColor: t.surface },
  offlineDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: t.warning, marginRight: 6 },
  connectionText: { color: t.warning, fontSize: 11, fontWeight: '700' },
  notice: { flexDirection: 'row', alignItems: 'center', backgroundColor: t.warning + '18', padding: 10, borderRadius: 12, marginBottom: 13 },
  noticeText: { flex: 1, color: t.text, fontSize: 12, lineHeight: 17, marginLeft: 7 },
  hero: {
    backgroundColor: t.surface,
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.border,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: t.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarSm: { width: 36, height: 36, borderRadius: 18, marginRight: 12 },
  avatarText: { fontSize: 15, fontWeight: '700', color: t.accent },
  name: { fontSize: 16, fontWeight: '700', color: t.text },
  time: { fontSize: 12, color: t.textMuted, marginTop: 2 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    marginLeft: 8,
  },
  badgeSm: { paddingHorizontal: 7, paddingVertical: 3, marginTop: 6 },
  badgeText: { fontSize: 11, fontWeight: '700', marginLeft: 4 },
  badgeTextSm: { fontSize: 10 },
  preview: { fontSize: 15, lineHeight: 21, color: t.textMuted },
  service: { fontSize: 13, color: t.textMuted, marginTop: 6 },
  actions: { flexDirection: 'row', marginTop: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.surface,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.border,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center' },
  rowName: { flex: 1, fontSize: 15, fontWeight: '700', color: t.text },
  rowTime: { fontSize: 12, color: t.textMuted, marginLeft: 8 },
  rowPreview: { fontSize: 14, color: t.textMuted, marginTop: 2 },
});