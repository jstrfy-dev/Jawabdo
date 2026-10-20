import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
 
const KEY = 'jawabdo.store.v1';
const DAY = 86400000;
 
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const SAFE_SAMPLE_REPLIES = {
  'Walaikum assalam! Hair colour Rs 3,200 se shuru hota hai. Kal 12:30 pe slot available hai?': 'Hair colour Rs 3,200 se shuru hota hai. Slot abhi confirm nahi; owner check karke batayega.',
  'Ji bilkul! Aapka manicure kal 3:00 PM pe confirm hai. Gulberg salon par milte hain.': 'Request mil gayi. Appointment ka exact waqt owner confirm karke batayega.',
  'Done! Bridal makeup kal 10:00 AM confirm. Rs 8,500, 30% advance Rs 2,550.': 'Bridal Makeup Rs 8,500 hai. Final appointment aur advance details owner confirm karega.',
  'Shukriya! Receipt WhatsApp par bhej diya gaya hai.': 'Payment ya receipt status verify nahi kar sakta. Owner se confirm karein.',
};

const isoAt = (offsetDays, hh, mm) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
};
 
const seed = () => {
  const now = Date.now();
  return {
    seeded: true,
    dataMode: 'demo',
    business: {
      name: 'Glow Salon',
      type: 'Salon',
      area: 'Gulberg, Lahore',
      language: 'en',
      assistantTone: 'Friendly',
      whatsappStatus: 'not_connected',
      hours: [
        { day: 'Mon', open: '10:00', close: '20:00', closed: false },
        { day: 'Tue', open: '10:00', close: '20:00', closed: false },
        { day: 'Wed', open: '10:00', close: '20:00', closed: false },
        { day: 'Thu', open: '10:00', close: '20:00', closed: false },
        { day: 'Fri', open: '10:00', close: '21:00', closed: false },
        { day: 'Sat', open: '10:00', close: '21:00', closed: false },
        { day: 'Sun', open: '12:00', close: '18:00', closed: false },
      ],
      services: [
        { id: 'sv1', name: 'Bridal Makeup', price: 8500, duration: 180, photo: 'https://images.unsplash.com/photo-1487412947147-5cebf100ffc2?w=640&q=70' },
        { id: 'sv2', name: 'Hair Colour', price: 3200, duration: 90, photo: 'https://picsum.photos/seed/haircolour1/640/640' },
        { id: 'sv3', name: 'Manicure', price: 1500, duration: 45, photo: 'https://picsum.photos/seed/manicure2/640/640' },
        { id: 'sv4', name: 'Facial', price: 2800, duration: 60, photo: 'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?w=640&q=70' },
      ],
      faqs: [
        { id: 'fq1', q: 'Do you take advance payment?', a: 'Yes, 30% advance to confirm bridal bookings.' },
        { id: 'fq2', q: 'Parking available?', a: 'Street parking outside the salon in Gulberg.' },
        { id: 'fq3', q: 'Home service?', a: 'Home service available within Gulberg for Rs 500 extra.' },
      ],
      address: 'Main Boulevard, Gulberg III, Lahore',
      slotsPerDay: 10,
      onboardingStep: 0,
    },
    bookings: [
      { id: 'bk1', customerId: 'c1', customer: 'Ayesha Khan', service: 'Bridal Makeup', amount: 8500, at: isoAt(0, 10, 0), status: 'Confirmed', staff: 'Sara', photo: 'https://images.unsplash.com/photo-1487412947147-5cebf100ffc2?w=640&q=70' },
      { id: 'bk2', customerId: 'c2', customer: 'Sana Malik', service: 'Hair Colour', amount: 3200, at: isoAt(0, 12, 30), status: 'Pending', staff: 'Noor', photo: 'https://picsum.photos/seed/haircolour1/640/640' },
      { id: 'bk3', customerId: 'c3', customer: 'Hina Raza', service: 'Manicure', amount: 1500, at: isoAt(0, 15, 0), status: 'Confirmed', staff: 'Sara', photo: 'https://picsum.photos/seed/manicure2/640/640' },
      { id: 'bk4', customerId: 'c4', customer: 'Fatima Noor', service: 'Facial', amount: 2800, at: isoAt(-1, 16, 0), status: 'Completed', staff: 'Noor', photo: 'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?w=640&q=70' },
      { id: 'bk5', customerId: 'c5', customer: 'Zoya Ahmed', service: 'Hair Colour', amount: 3200, at: isoAt(1, 11, 0), status: 'Pending', staff: 'Noor', photo: 'https://picsum.photos/seed/haircolour1/640/640' },
      { id: 'bk6', customerId: 'c6', customer: 'Mariam Ali', service: 'Facial', amount: 2800, at: isoAt(2, 14, 0), status: 'Confirmed', staff: 'Sara', photo: 'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?w=640&q=70' },
      { id: 'bk7', customerId: 'c1', customer: 'Ayesha Khan', service: 'Manicure', amount: 1500, at: isoAt(-3, 13, 0), status: 'Completed', staff: 'Sara', photo: 'https://picsum.photos/seed/manicure2/640/640' },
      { id: 'bk8', customerId: 'c7', customer: 'Rabia Sheikh', service: 'Bridal Makeup', amount: 8500, at: isoAt(4, 9, 30), status: 'Confirmed', staff: 'Noor', photo: 'https://images.unsplash.com/photo-1487412947147-5cebf100ffc2?w=640&q=70' },
    ],
    customers: [
      { id: 'c1', name: 'Ayesha Khan', phone: '+92 300 1112233', tags: ['VIP', 'Bridal'], notes: 'Prefers morning slots. Allergic to bleach.', visits: 14, spent: 38000, lastVisit: new Date(now - 2 * DAY).toISOString(), payment: 'Paid', photo: 'https://picsum.photos/seed/ayeshakhan3/640/640' },
      { id: 'c2', name: 'Sana Malik', phone: '+92 321 4455667', tags: ['Colour'], notes: 'Wants ash brown tone.', visits: 6, spent: 14500, lastVisit: new Date(now - 9 * DAY).toISOString(), payment: 'Due', photo: 'https://picsum.photos/seed/sanamalik4/640/640' },
      { id: 'c3', name: 'Hina Raza', phone: '+92 333 7788990', tags: ['Regular'], notes: 'Comes every 3 weeks.', visits: 9, spent: 12800, lastVisit: new Date(now - 5 * DAY).toISOString(), payment: 'Paid', photo: 'https://picsum.photos/seed/hinaraza5/640/640' },
      { id: 'c4', name: 'Fatima Noor', phone: '+92 345 2233445', tags: ['Facial'], notes: 'Sensitive skin.', visits: 4, spent: 9600, lastVisit: new Date(now - 1 * DAY).toISOString(), payment: 'Paid', photo: 'https://picsum.photos/seed/fatimanoor6/640/640' },
      { id: 'c5', name: 'Zoya Ahmed', phone: '+92 302 5566778', tags: ['New'], notes: 'Came via Instagram ad.', visits: 1, spent: 3200, lastVisit: new Date(now - 12 * DAY).toISOString(), payment: 'Due', photo: 'https://picsum.photos/seed/zoyaahmed7/640/640' },
      { id: 'c6', name: 'Mariam Ali', phone: '+92 311 9988776', tags: ['Regular', 'VIP'], notes: 'Books for her sisters too.', visits: 11, spent: 26400, lastVisit: new Date(now - 4 * DAY).toISOString(), payment: 'Paid', photo: 'https://picsum.photos/seed/mariamali8/640/640' },
      { id: 'c7', name: 'Rabia Sheikh', phone: '+92 336 1231234', tags: ['Bridal'], notes: 'Wedding in 3 weeks.', visits: 3, spent: 17000, lastVisit: new Date(now - 7 * DAY).toISOString(), payment: 'Due', photo: 'https://picsum.photos/seed/rabiasheikh9/640/640' },
    ],
    threads: [
      { id: 'th1', customerId: 'c2', name: 'Sana Malik', photo: 'https://picsum.photos/seed/sanamalik4/640/640', last: 'Kitna charge hoga hair colour ka?', state: 'Flagged', at: new Date(now - 2 * 60000).toISOString(), unread: 1, messages: [
        { id: 'm1', from: 'them', text: 'Assalam o alaikum, kitna charge hoga hair colour ka?', at: new Date(now - 3 * 60000).toISOString() },
        { id: 'm2', from: 'ai', text: 'Hair colour Rs 3,200 se shuru hota hai. Slot abhi confirm nahi; owner check karke batayega.', at: new Date(now - 2.5 * 60000).toISOString() },
        { id: 'm3', from: 'them', text: 'Ash brown tone chahiye, confirm kar dein?', at: new Date(now - 2 * 60000).toISOString() },
      ], bookingId: 'bk2' },
      { id: 'th2', customerId: 'c3', name: 'Hina Raza', photo: 'https://picsum.photos/seed/hinaraza5/640/640', last: 'Kal ka slot confirm kar dein', state: 'AI replied', at: new Date(now - 18 * 60000).toISOString(), unread: 0, messages: [
        { id: 'm4', from: 'them', text: 'Kal ka slot confirm kar dein', at: new Date(now - 20 * 60000).toISOString() },
        { id: 'm5', from: 'ai', text: 'Request mil gayi. Appointment ka exact waqt owner confirm karke batayega.', at: new Date(now - 18 * 60000).toISOString() },
      ], bookingId: 'bk3' },
      { id: 'th3', customerId: 'c1', name: 'Ayesha Khan', photo: 'https://picsum.photos/seed/ayeshakhan3/640/640', last: 'Shukriya, bridal makeup ke liye confirm!', state: 'AI replied', at: new Date(now - 3 * 3600000).toISOString(), unread: 0, messages: [
        { id: 'm6', from: 'them', text: 'Bridal makeup kal 10 baje confirm kar dein', at: new Date(now - 3.2 * 3600000).toISOString() },
        { id: 'm7', from: 'ai', text: 'Bridal Makeup Rs 8,500 hai. Final appointment aur advance details owner confirm karega.', at: new Date(now - 3 * 3600000).toISOString() },
      ], bookingId: 'bk1' },
      { id: 'th4', customerId: 'c5', name: 'Zoya Ahmed', photo: 'https://picsum.photos/seed/zoyaahmed8/640/640', last: 'Do you do keratin treatment?', state: 'Flagged', at: new Date(now - 5 * 3600000).toISOString(), unread: 1, messages: [
        { id: 'm8', from: 'them', text: 'Do you do keratin treatment?', at: new Date(now - 5 * 3600000).toISOString() },
      ], bookingId: null },
      { id: 'th5', customerId: 'c6', name: 'Mariam Ali', photo: 'https://picsum.photos/seed/mariamali8/640/640', last: 'Payment kar diya, receipt bhej dein', state: 'AI replied', at: new Date(now - 26 * 3600000).toISOString(), unread: 0, messages: [
        { id: 'm9', from: 'them', text: 'Payment kar diya, receipt bhej dein', at: new Date(now - 26 * 3600000).toISOString() },
        { id: 'm10', from: 'ai', text: 'Payment ya receipt status verify nahi kar sakta. Owner se confirm karein.', at: new Date(now - 25.8 * 3600000).toISOString() },
      ], bookingId: null },
    ],
    stats: {
      recoveredLeads: 12,
      revenueWeek: 42000,
      noShowsPrevented: 2,
      replyStreak: 6,
      bookingsToday: 8,
      slotsToday: 10,
    },
    blocks: [
      { id: 'bl1', at: isoAt(1, 13, 0), until: isoAt(1, 14, 0), staff: 'Sara', reason: 'Lunch' },
    ],
    sync: { online: true, lastSync: new Date(now - 60000).toISOString() },
  };
};
 
const StoreContext = createContext(null);
 
export const StoreProvider = ({ children }) => {
  const [state, setState] = useState({ ready: false, seeded: false, dataMode: 'demo', business: null, bookings: [], customers: [], threads: [], stats: null, blocks: [], sync: null });
  const [storageError, setStorageError] = useState(null);
  const loaded = useRef(false);
  const writeQueue = useRef(Promise.resolve());
 
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          const threads = parsed.seeded && Array.isArray(parsed.threads)
            ? parsed.threads.map((thread) => ({
              ...thread,
              messages: (thread.messages || []).map((message) => ({
                ...message,
                text: SAFE_SAMPLE_REPLIES[message.text] || message.text,
              })),
            }))
            : parsed.threads;
          setState((current) => ({
            ...current,
            ...parsed,
            threads,
            ready: true,
            dataMode: parsed.dataMode || (parsed.seeded ? 'demo' : 'local'),
          }));
        } else {
          const s = seed();
          await AsyncStorage.setItem(KEY, JSON.stringify(s));
          setState({ ready: true, ...s });
        }
      } catch (e) {
        setState({ ready: true, ...seed() });
        setStorageError('Saved data could not be loaded. Sample data is showing on this device.');
      } finally {
        loaded.current = true;
      }
    })();
  }, []);
 
  useEffect(() => {
    if (!loaded.current || !state.ready) return;
    const { ready, ...rest } = state;
    const snapshot = JSON.stringify(rest);
    writeQueue.current = writeQueue.current.catch(() => {}).then(() => AsyncStorage.setItem(KEY, snapshot));
    writeQueue.current.then(
      () => setStorageError(null),
      () => setStorageError('Changes could not be saved on this device. Check available storage and try again.')
    );
  }, [state]);
 
  const patch = useCallback((fn) => setState((s) => ({ ...s, ...(typeof fn === 'function' ? fn(s) : fn) })), []);
 
  const saveBusiness = useCallback((business) => patch((s) => ({ business: { ...s.business, ...business } })), [patch]);
 
  const addBooking = useCallback((b) => patch((s) => ({
    bookings: [{ id: uid(), status: 'Pending', staff: 'Sara', at: new Date().toISOString(), amount: 0, service: '', customer: '', customerId: null, ...b }, ...s.bookings],
  })), [patch]);
 
  const updateBookingStatus = useCallback((id, status) => patch((s) => ({
    bookings: s.bookings.map((b) => (b.id === id ? { ...b, status } : b)),
  })), [patch]);
 
  const addCustomerNote = useCallback((id, note) => patch((s) => ({
    customers: s.customers.map((c) => (c.id === id ? { ...c, notes: note } : c)),
  })), [patch]);

  const setCustomerTags = useCallback((id, tags) => patch((s) => ({
    customers: s.customers.map((c) => (c.id === id ? { ...c, tags } : c)),
  })), [patch]);

  const addCustomerTag = useCallback((id, tag) => patch((s) => ({
    customers: s.customers.map((c) => (c.id === id && !c.tags.includes(tag) ? { ...c, tags: [...c.tags, tag] } : c)),
  })), [patch]);
 
  const setCustomerPayment = useCallback((id, payment) => patch((s) => ({
    customers: s.customers.map((c) => (c.id === id ? { ...c, payment } : c)),
  })), [patch]);
 
  const flagForOwner = useCallback((threadId) => patch((s) => ({
    threads: s.threads.map((t) => (t.id === threadId ? { ...t, state: 'Flagged', unread: 1 } : t)),
  })), [patch]);

  const takeOverThread = useCallback((threadId) => patch((s) => ({
    threads: s.threads.map((t) => (t.id === threadId ? { ...t, state: 'Owner handling', unread: 0 } : t)),
  })), [patch]);

  const replyThread = useCallback((threadId, text, sender = 'ai') => patch((s) => ({
    threads: s.threads.map((t) => (t.id === threadId ? {
      ...t,
      state: sender === 'owner' ? 'Owner replied' : 'AI replied',
      unread: 0,
      last: text,
      at: new Date().toISOString(),
      messages: [...(t.messages || []), { id: uid(), from: sender, text, at: new Date().toISOString() }],
    } : t)),
  })), [patch]);
 
  const markThreadRead = useCallback((threadId) => patch((s) => ({
    threads: s.threads.map((t) => (t.id === threadId ? { ...t, unread: 0 } : t)),
  })), [patch]);
 
  const toggleLanguage = useCallback(() => patch((s) => ({
    business: { ...s.business, language: s.business?.language === 'en' ? 'ur' : 'en' },
  })), [patch]);
 
  const addBlock = useCallback((b) => patch((s) => ({
    blocks: [{ id: uid(), ...b }, ...s.blocks],
  })), [patch]);
 
  const removeBlock = useCallback((id) => patch((s) => ({ blocks: s.blocks.filter((b) => b.id !== id) })), [patch]);
 
  const moveBooking = useCallback((id, at) => patch((s) => ({
    bookings: s.bookings.map((b) => (b.id === id ? { ...b, at } : b)),
  })), [patch]);
 
  const syncStatus = useCallback(() => patch((s) => ({ sync: { ...s.sync, online: true, lastSync: new Date().toISOString() } })), [patch]);
 
  const value = useMemo(() => ({
    ready: state.ready,
    seeded: state.seeded,
    dataMode: state.dataMode,
    storageError,
    business: state.business,
    bookings: state.bookings,
    customers: state.customers,
    threads: state.threads,
    stats: state.stats,
    blocks: state.blocks,
    sync: state.sync,
    saveBusiness,
    addBooking,
    updateBookingStatus,
    addCustomerNote,
    setCustomerTags,
    addCustomerTag,
    setCustomerPayment,
    flagForOwner,
    takeOverThread,
    replyThread,
    markThreadRead,
    toggleLanguage,
    addBlock,
    removeBlock,
    moveBooking,
    syncStatus,
  }), [state, storageError, saveBusiness, addBooking, updateBookingStatus, addCustomerNote, setCustomerTags, addCustomerTag, setCustomerPayment, flagForOwner, takeOverThread, replyThread, markThreadRead, toggleLanguage, addBlock, removeBlock, moveBooking, syncStatus]);
 
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
};
 
export const useStore = () => {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
};
 
export const AppStoreProvider = StoreProvider;
 