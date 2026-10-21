import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Button } from '../ui/kit';
import { useTheme } from '../ui/theme';
import { useAuth } from '../auth/AuthContext';
import { useCloudData } from '../auth/CloudDataContext';

const STEPS = [
  ['storefront-outline', 'Apna business batayein', 'Naam, address aur opening hours set karein.', 'Misal: Noor Salon, Gulberg — 10am se 8pm.'],
  ['pricetag-outline', 'Services aur rates add karein', 'Har service ka sahi rate likhein; JawabDo sirf yahi rates preview mein use karega.', 'Misal: Hair colour — Rs 3,200 se.'],
  ['help-circle-outline', 'FAQs aur jawab tayyar karein', 'Parking, advance ya home service ke verified jawab save karein.', 'Misal: “Parking hai?” — “Ji, salon ke bahar street parking.”'],
  ['logo-whatsapp', 'WhatsApp Business connect karein', 'Backend webhook aur Embedded Signup server endpoints ka foundation hai, lekin Expo app mein login/Meta onboarding UI abhi wired nahi. WhatsApp abhi connected nahi; setup guide mein requirements hain.', 'Customer consent aur approved templates zaroori hain.'],
  ['chatbubbles-outline', 'Customer sawalon ka jawab dein', 'Configured live connection ke baad assistant kaam karega. Abhi preview sirf sample hai; inbox mein aap khud jawab bhej sakte hain.', 'Rate ya policy maloom na ho to owner se confirm karein.'],
  ['calendar-outline', 'Bookings aur customers dekhein', 'Inbox aur calendar mein requests review karein; customer notes aur tags record karein.', 'Booking ya payment ko confirmed tabhi kahein jab waqai confirm ho.'],
];

export default function GuideScreen({ navigation }) {
  const t = useTheme();
  const { session } = useAuth();
  const cloud = useCloudData();
  const s = styles(t);
  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        <View style={s.header}>
          <Text style={s.eyebrow}>KHUSH AAMDEED</Text>
          <Text style={s.title}>JawabDo kaise kaam karta hai?</Text>
          <Text style={s.subtitle}>Aap apna business samjhayen; JawabDo customer sawalon aur bookings ko sambhalne mein madad karta hai.</Text>
          <View style={s.demoBanner}>
            <Ionicons name="information-circle-outline" size={19} color={t.warning} />
            <Text style={s.demoText}>{session
              ? `Backend account signed in. WhatsApp ${cloud.connection?.status === 'connected' ? 'backend se connected report hua hai' : 'connected nahi hai'}.`
              : 'App demo mode hai — live backend login ya real WhatsApp account connected nahi.'}</Text>
          </View>
        </View>
        {STEPS.map(([icon, title, body, example], index) => (
          <View key={title} style={s.card}>
            <View style={s.cardTop}>
              <View style={s.icon}><Ionicons name={icon} size={20} color={t.accent} /></View>
              <Text style={s.step}>QADAM {index + 1}</Text>
            </View>
            <Text style={s.cardTitle}>{title}</Text>
            <Text style={s.body}>{body}</Text>
            <Text style={s.example}>{example}</Text>
          </View>
        ))}
        <Button label="Business setup kholen" icon="arrow-forward" onPress={() => navigation.navigate(session ? 'CloudBusiness' : 'Onboarding')} />
        <Pressable onPress={() => navigation.navigate('Settings')} style={s.link}>
          <Text style={s.linkText}>WhatsApp, plans aur privacy settings</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const styles = (t) => StyleSheet.create({
  content: { paddingBottom: 36 },
  header: { paddingTop: 8, paddingBottom: 16 },
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1.4, color: t.accent, marginBottom: 8 },
  title: { fontSize: 27, lineHeight: 34, fontWeight: '800', color: t.text },
  subtitle: { fontSize: 15, lineHeight: 22, color: t.textMuted, marginTop: 8 },
  demoBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: t.warning + '18', borderRadius: 14, padding: 12, marginTop: 16 },
  demoText: { flex: 1, color: t.text, fontSize: 13, lineHeight: 19, marginLeft: 8 },
  card: { backgroundColor: t.surface, borderRadius: 18, padding: 17, marginBottom: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border },
  cardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  icon: { width: 36, height: 36, borderRadius: 12, backgroundColor: t.accentSoft, alignItems: 'center', justifyContent: 'center', marginRight: 9 },
  step: { color: t.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  cardTitle: { color: t.text, fontSize: 17, fontWeight: '700' },
  body: { color: t.textMuted, fontSize: 14, lineHeight: 21, marginTop: 5 },
  example: { color: t.accent, fontSize: 13, lineHeight: 19, marginTop: 10 },
  link: { paddingVertical: 12, alignItems: 'center' },
  linkText: { color: t.accent, fontSize: 14, fontWeight: '700' },
});
