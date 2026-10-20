import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Button, Chip } from '../ui/kit';
import { useTheme } from '../ui/theme';
import { useStore } from '../store/store';

const LANGUAGES = [
  { label: 'English', value: 'en' },
  { label: 'Roman Urdu', value: 'roman' },
  { label: 'Urdu', value: 'ur' },
];
const TONES = ['Friendly', 'Professional', 'Short & simple'];
const newId = () => 'item-' + Date.now().toString(36);

function normalizedLanguage(value) {
  if (value === 'English' || !value) return 'en';
  if (value === 'Urdu') return 'ur';
  if (value === 'Roman Urdu') return 'roman';
  return value;
}

function makePreviewReply(question, business) {
  const text = question.trim().toLowerCase();
  const language = normalizedLanguage(business.language);
  if (!text) return '';
  const service = (business.services || []).find((item) => item.name && text.includes(item.name.toLowerCase()));
  const asksPrice = /price|cost|charge|rate|kitna|qeemat|قیمت|ریٹ/.test(text);
  if (service && asksPrice) {
    if (Number(service.price) > 0) {
      const price = `Rs ${Number(service.price).toLocaleString('en-PK')}`;
      if (language === 'ur') return `${service.name} کی قیمت ${price} ہے۔ ملاقات کا وقت مالک تصدیق کرے گا۔`;
      if (language === 'en') return `${service.name} costs ${price}. The owner will confirm appointment times.`;
      return `${service.name} ka rate ${price} hai. Appointment ka exact time owner confirm karega.`;
    }
    if (language === 'ur') return 'اس سروس کی قیمت ابھی درج نہیں۔ مالک سے تصدیق کے بعد بتائیں گے۔';
    if (language === 'en') return 'This service does not have a saved price yet. The owner will confirm it.';
    return 'Is service ka rate abhi save nahi hai. Main owner se confirm karke batata hoon.';
  }
  const faq = (business.faqs || []).find((item) => {
    const words = (item.q || '').toLowerCase().split(/\W+/).filter((word) => word.length > 3);
    return item.a && words.some((word) => text.includes(word));
  });
  if (faq) return faq.a;
  if (language === 'ur') return 'اس سوال کا تصدیق شدہ جواب ابھی موجود نہیں۔ مالک سے تصدیق کر کے بتائیں گے۔';
  if (language === 'en') return 'I do not have a verified answer for this yet. The owner will confirm it for you.';
  return 'Is sawal ka verified jawab abhi mere paas nahi. Main owner se confirm karke aapko batata hoon.';
}

export default function AssistantScreen({ navigation }) {
  const t = useTheme();
  const { business, saveBusiness, dataMode } = useStore();
  const [draft, setDraft] = useState('');
  const [question, setQuestion] = useState('Hair Colour ka price kya hai?');
  const [reply, setReply] = useState('');
  const [notice, setNotice] = useState('');
  const details = business || {};
  const services = details.services || [];
  const faqs = details.faqs || [];
  const s = styles(t);
  const demoPreview = useMemo(() => makePreviewReply(question, details), [question, details.services, details.faqs]);

  const update = (key, value) => saveBusiness({ ...details, [key]: value });
  const addService = () => {
    const name = draft.trim();
    if (!name) {
      setNotice('Pehle service ka naam likhein.');
      return;
    }
    saveBusiness({ ...details, services: [...services, { id: newId(), name, price: 0 }] });
    setDraft('');
    setNotice('Service add ho gayi. Rate abhi confirm karna baqi hai.');
  };
  const updateService = (id, key, value) => {
    const parsed = key === 'price' ? (value === '' ? '' : Number(value.replace(/[^\d]/g, ''))) : value;
    saveBusiness({ ...details, services: services.map((item) => item.id === id ? { ...item, [key]: parsed } : item) });
  };
  const removeService = (id) => saveBusiness({ ...details, services: services.filter((item) => item.id !== id) });
  const updateFaq = (id, key, value) => saveBusiness({ ...details, faqs: faqs.map((item) => item.id === id ? { ...item, [key]: value } : item) });
  const addFaq = () => saveBusiness({ ...details, faqs: [...faqs, { id: newId(), q: '', a: '' }] });
  const removeFaq = (id) => saveBusiness({ ...details, faqs: faqs.filter((item) => item.id !== id) });

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        <View style={s.header}>
          <Text style={s.eyebrow}>JAWABDO ASSISTANT</Text>
          <Text style={s.title}>Apne assistant ko sikhayein</Text>
          <Text style={s.subtitle}>Yahan di hui maloomat jawab ka source hogi. Jo baat yahan nahi, us par assistant owner se confirm karega.</Text>
        </View>
        <View style={s.status}>
          <Ionicons name="flask-outline" size={18} color={t.warning} />
          <View style={{ flex: 1, marginLeft: 9 }}>
            <Text style={s.statusTitle}>{dataMode === 'demo' ? 'Demo mode — live AI connected nahi' : 'Local mode — live AI connected nahi'}</Text>
            <Text style={s.small}>Neeche sirf local rule-based preview hai. Customer ko WhatsApp par koi jawab nahi bheja ja raha.</Text>
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.sectionTitle}>Business profile</Text>
          <Text style={s.label}>Business ka naam</Text>
          <TextInput value={details.name || ''} onChangeText={(value) => update('name', value)} placeholder="Misal: Noor Salon" placeholderTextColor={t.textMuted} style={s.input} />
          <Text style={s.label}>Business kis qisam ka hai?</Text>
          <TextInput value={details.type || ''} onChangeText={(value) => update('type', value)} placeholder="Misal: Salon, boutique, clinic" placeholderTextColor={t.textMuted} style={s.input} />
          <Text style={s.label}>Address / area</Text>
          <TextInput value={details.address || details.area || ''} onChangeText={(value) => update('address', value)} placeholder="Shehar aur area" placeholderTextColor={t.textMuted} style={s.input} />
          <Text style={s.label}>Jawab kis zubaan mein ho?</Text>
          <View style={s.chips}>
            {LANGUAGES.map((language) => (
              <Chip key={language.value} label={language.label} active={normalizedLanguage(details.language) === language.value} onPress={() => update('language', language.value)} />
            ))}
          </View>
          <Text style={s.label}>Jawab ka lehja</Text>
          <View style={s.chips}>
            {TONES.map((tone) => <Chip key={tone} label={tone} active={(details.assistantTone || 'Friendly') === tone} onPress={() => update('assistantTone', tone)} />)}
          </View>
          <Button label="Opening hours aur setup edit karein" icon="time-outline" variant="ghost" onPress={() => navigation.navigate('Onboarding')} />
        </View>

        <View style={s.card}>
          <Text style={s.sectionTitle}>Services aur sahi rates</Text>
          <Text style={s.small}>Rate 0 ho ya missing ho to preview rate nahi banayega.</Text>
          {services.map((service) => (
            <View key={service.id} style={s.item}>
              <View style={{ flex: 1 }}>
                <TextInput value={service.name} onChangeText={(value) => updateService(service.id, 'name', value)} placeholder="Service name" placeholderTextColor={t.textMuted} style={s.input} />
                <TextInput value={String(service.price || '')} onChangeText={(value) => updateService(service.id, 'price', value)} keyboardType="number-pad" placeholder="Rate in Rs" placeholderTextColor={t.textMuted} style={s.input} />
              </View>
              <Pressable onPress={() => removeService(service.id)} accessibilityLabel={'Remove ' + service.name} style={s.remove}>
                <Ionicons name="trash-outline" size={18} color={t.danger} />
              </Pressable>
            </View>
          ))}
          <View style={s.addRow}>
            <TextInput value={draft} onChangeText={setDraft} placeholder="Nayi service ka naam" placeholderTextColor={t.textMuted} style={[s.input, { flex: 1, marginBottom: 0 }]} />
            <Pressable onPress={addService} accessibilityLabel="Add service" style={s.add}>
              <Ionicons name="add" size={21} color={t.onAccent} />
            </Pressable>
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.sectionTitle}>FAQs ke verified jawab</Text>
          {faqs.map((faq, index) => (
            <View key={faq.id} style={s.faq}>
              <View style={s.faqHeader}>
                <Text style={s.label}>Sawal {index + 1}</Text>
                <Pressable onPress={() => removeFaq(faq.id)} accessibilityLabel="Remove FAQ" hitSlop={8}>
                  <Ionicons name="close-circle-outline" size={20} color={t.textMuted} />
                </Pressable>
              </View>
              <TextInput value={faq.q} onChangeText={(value) => updateFaq(faq.id, 'q', value)} placeholder="Customer kya pooch sakta hai?" placeholderTextColor={t.textMuted} style={s.input} />
              <TextInput value={faq.a} onChangeText={(value) => updateFaq(faq.id, 'a', value)} placeholder="Aapka tasdeeq-shuda jawab" placeholderTextColor={t.textMuted} style={[s.input, s.answer]} multiline />
            </View>
          ))}
          <Button label="FAQ add karein" icon="add" variant="ghost" onPress={addFaq} />
        </View>

        <View style={s.card}>
          <Text style={s.sectionTitle}>Jawab ka sample dekhein</Text>
          <Text style={s.small}>Misal ka sawal edit karke apne saved rates aur FAQs test karein.</Text>
          <TextInput value={question} onChangeText={setQuestion} placeholder="Customer ka sawal" placeholderTextColor={t.textMuted} style={s.input} multiline />
          <Button label="Sample jawab banayein" icon="sparkles-outline" onPress={() => {
            const generated = makePreviewReply(question, details);
            setReply(generated);
            setNotice(generated.includes('confirm') ? 'Jawab mein owner se confirmation ka zikr hai.' : 'Yeh jawab aapke saved business data se bana hai.');
          }} />
          {!!(reply || demoPreview) && (
            <View style={s.reply}>
              <Text style={s.replyLabel}>SAMPLE ONLY · WHATSAPP PAR NAHI BHEJA</Text>
              <Text style={s.replyText}>{reply || demoPreview}</Text>
            </View>
          )}
          {!!notice && <Text style={s.notice}>{notice}</Text>}
        </View>

        <Button label="Guide aur WhatsApp setup" icon="help-circle-outline" variant="ghost" onPress={() => navigation.navigate('Guide')} />
      </ScrollView>
    </Screen>
  );
}

const styles = (t) => StyleSheet.create({
  content: { paddingBottom: 34 },
  header: { paddingTop: 8, paddingBottom: 14 },
  eyebrow: { color: t.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.3 },
  title: { color: t.text, fontSize: 25, lineHeight: 32, fontWeight: '800', marginTop: 5 },
  subtitle: { color: t.textMuted, fontSize: 14, lineHeight: 21, marginTop: 6 },
  status: { flexDirection: 'row', alignItems: 'flex-start', padding: 13, borderRadius: 15, backgroundColor: t.warning + '18', marginBottom: 14 },
  statusTitle: { color: t.text, fontWeight: '700', fontSize: 14 },
  small: { color: t.textMuted, fontSize: 12, lineHeight: 18, marginTop: 4, marginBottom: 8 },
  card: { backgroundColor: t.surface, borderRadius: 18, padding: 16, marginBottom: 13, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border },
  sectionTitle: { color: t.text, fontSize: 17, fontWeight: '700', marginBottom: 11 },
  label: { color: t.textMuted, fontSize: 12, fontWeight: '600', marginTop: 7, marginBottom: 5 },
  input: { color: t.text, fontSize: 14, minHeight: 44, borderRadius: 12, backgroundColor: t.bg, borderWidth: 1, borderColor: t.border, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 9 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 2 },
  item: { flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border, paddingTop: 8, marginTop: 6 },
  remove: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  addRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  add: { width: 44, height: 44, borderRadius: 14, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  faq: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border, paddingTop: 8, marginTop: 8 },
  faqHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  answer: { minHeight: 76, textAlignVertical: 'top' },
  reply: { backgroundColor: t.accentSoft, borderRadius: 13, padding: 13, marginTop: 10 },
  replyLabel: { color: t.accent, fontSize: 9, fontWeight: '800', letterSpacing: 0.6, marginBottom: 6 },
  replyText: { color: t.text, fontSize: 14, lineHeight: 21 },
  notice: { color: t.accent, fontSize: 12, marginTop: 8 },
});
