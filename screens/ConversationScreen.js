import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Button } from '../ui/kit';
import { useTheme } from '../ui/theme';
import { useStore } from '../store/store';
import { useAuth } from '../auth/AuthContext';
import { useCloudData } from '../auth/CloudDataContext';

export default function ConversationScreen({ route, navigation }) {
  const t = useTheme();
  const store = useStore();
  const { session } = useAuth();
  const cloud = useCloudData();
  const live = Boolean(session);
  const { replyThread, takeOverThread, markThreadRead } = store;
  const [draft, setDraft] = useState('');
  const [liveMessages, setLiveMessages] = useState([]);
  const [messageError, setMessageError] = useState('');
  const [messageLoading, setMessageLoading] = useState(false);
  const threadId = route.params?.threadId;
  const localThread = (store.threads || []).find((item) => item.id === threadId);
  const cloudThread = cloud.conversations.find((item) => item.id === threadId);
  const thread = live ? (cloudThread ? { ...cloudThread, messages: liveMessages } : null) : localThread;
  const s = styles(t);

  useEffect(() => {
    if (!live && localThread) markThreadRead(localThread.id);
  }, [live, localThread?.id, markThreadRead]);

  useEffect(() => {
    if (!live || !threadId) return undefined;
    let active = true;
    setMessageLoading(true);
    setMessageError('');
    cloud.getConversationMessages(threadId)
      .then((messages) => { if (active) setLiveMessages(messages); })
      .catch((error) => { if (active) setMessageError(error.message); })
      .finally(() => { if (active) setMessageLoading(false); });
    return () => { active = false; };
  }, [live, threadId, cloud.getConversationMessages]);

  if (!thread) {
    return (
      <Screen>
        <View style={s.empty}>
          <Text style={s.title}>Yeh chat nahi mili</Text>
          <Text style={s.muted}>Inbox par wapas ja kar dobara kholen.</Text>
          <Button label="Inbox kholen" onPress={() => navigation.goBack()} />
        </View>
      </Screen>
    );
  }

  const ownerHasControl = thread.state === 'Owner handling' || thread.state === 'Owner replied';
  const send = () => {
    const text = draft.trim();
    if (!text) return;
    replyThread(thread.id, text, 'owner');
    setDraft('');
  };

  return (
    <Screen>
      <View style={s.header}>
        <Pressable onPress={() => navigation.goBack()} accessibilityLabel="Back to inbox" style={s.back}>
          <Ionicons name="chevron-back" size={22} color={t.text} />
        </Pressable>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={s.title}>{thread.name}</Text>
          <Text style={s.muted}>{thread.state}{live && thread.phone ? ` · ${thread.phone}` : live ? ' · server conversation' : ' · sample conversation'}</Text>
        </View>
        <Pressable onPress={() => navigation.navigate('Customers', { customerId: thread.customerId })} accessibilityLabel="Customer profile" style={s.profileLink}>
          <Ionicons name="person-outline" size={18} color={t.accent} />
        </Pressable>
        {!live && <View style={s.demo}><Text style={s.demoText}>DEMO</Text></View>}
      </View>
      <View style={s.notice}>
        <Ionicons name="information-circle-outline" size={17} color={t.warning} />
        <Text style={s.noticeText}>{live ? 'Yeh conversation read-only hai; app se manual WhatsApp replies send karne ka endpoint configured nahi.' : 'Yeh local sample chat hai. Message WhatsApp par nahi bheja jayega.'}</Text>
      </View>
      {messageLoading && <Text style={s.muted}>Messages load ho rahe hain...</Text>}
      {!!messageError && <Text style={[s.muted, { color: t.danger }]}>{messageError}</Text>}
      <ScrollView style={s.messages} contentContainerStyle={{ paddingVertical: 12 }} showsVerticalScrollIndicator={false}>
        {live && thread.messages.length === 0 && !messageLoading
          ? <Text style={s.muted}>Is conversation ke messages server par maujood nahi.</Text>
          : null}
        {(thread.messages || []).map((message) => {
          const outgoing = message.from !== 'them';
          return (
            <View key={message.id} style={[s.bubble, outgoing ? s.outgoing : s.incoming]}>
              <Text style={[s.sender, outgoing && { color: t.accent }]}>{message.from === 'owner' ? 'Aap' : message.from === 'ai' ? (live ? 'JawabDo' : 'JawabDo · sample') : thread.name}</Text>
              <Text style={s.message}>{message.text}</Text>
            </View>
          );
        })}
      </ScrollView>
      {live && !ownerHasControl && thread.state !== 'Closed' && (
        <Button label="Owner ko conversation assign karein" icon="person-outline" variant="ghost" onPress={() => cloud.setConversationState(thread.id, 'owner_handling').catch((error) => setMessageError(error.message))} />
      )}
      {!live && !ownerHasControl && (
        <Button label="Main khud jawab dunga/dungi" icon="person-outline" variant="ghost" onPress={() => takeOverThread(thread.id)} />
      )}
      {!live && ownerHasControl && (
        <View style={s.composer}>
          <TextInput value={draft} onChangeText={setDraft} placeholder="Apna jawab likhein..." placeholderTextColor={t.textMuted} style={s.input} multiline />
          <Pressable onPress={send} accessibilityLabel="Send local reply" style={[s.send, !draft.trim() && { opacity: 0.5 }]} disabled={!draft.trim()}>
            <Ionicons name="send" size={17} color={t.onAccent} />
          </Pressable>
        </View>
      )}
    </Screen>
  );
}

const styles = (t) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingTop: 6, paddingBottom: 12 },
  back: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surface },
  profileLink: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: t.accentSoft, marginRight: 7 },
  title: { color: t.text, fontSize: 18, fontWeight: '800' },
  muted: { color: t.textMuted, fontSize: 12, marginTop: 3 },
  demo: { backgroundColor: t.warning + '22', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 },
  demoText: { color: t.warning, fontSize: 9, fontWeight: '800' },
  notice: { flexDirection: 'row', alignItems: 'center', padding: 11, borderRadius: 12, backgroundColor: t.warning + '18' },
  noticeText: { flex: 1, color: t.text, fontSize: 12, lineHeight: 17, marginLeft: 7 },
  messages: { flex: 1, marginTop: 8 },
  bubble: { maxWidth: '84%', borderRadius: 16, padding: 12, marginVertical: 5 },
  incoming: { alignSelf: 'flex-start', backgroundColor: t.surface, borderBottomLeftRadius: 4 },
  outgoing: { alignSelf: 'flex-end', backgroundColor: t.accentSoft, borderBottomRightRadius: 4 },
  sender: { color: t.textMuted, fontSize: 10, fontWeight: '700', marginBottom: 5 },
  message: { color: t.text, fontSize: 14, lineHeight: 20 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', paddingTop: 8 },
  input: { flex: 1, minHeight: 44, maxHeight: 100, borderRadius: 15, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, paddingHorizontal: 12, paddingVertical: 10, color: t.text, fontSize: 14 },
  send: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: t.accent, marginLeft: 8 },
  empty: { flex: 1, justifyContent: 'center', padding: 24 },
});
