import './ui/nativeshim';
import 'react-native-gesture-handler';
import React from 'react';
import { StyleSheet, Platform, View, Text, Pressable, useWindowDimensions } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DefaultTheme, createNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
 
import { ThemeProvider, useTheme, guardScreen } from './ui/theme';
import { StoreProvider, useStore } from './store/store';
 
import DashboardScreen from './screens/DashboardScreen';
import InboxScreen from './screens/InboxScreen';
import CalendarScreen from './screens/CalendarScreen';
import CustomersScreen from './screens/CustomerScreen';
import OnboardingScreen from './screens/OnboardingScreen';
import AssistantScreen from './screens/AssistantScreen';
import GuideScreen from './screens/GuideScreen';
import SettingsScreen from './screens/SettingsScreen';
import ConversationScreen from './screens/ConversationScreen';
import CustomersListScreen from './screens/CustomersListScreen';
import CloudBusinessScreen from './screens/CloudBusinessScreen';
import AuthScreen from './screens/AuthScreen';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { CloudDataProvider } from './auth/CloudDataContext';
 
const Tab = createBottomTabNavigator();
const RootStack = createStackNavigator();
const navigationRef = createNavigationContainerRef();
 
 
const ICONS = {
  "Dashboard": ['ellipse-outline', 'ellipse'],
  "Inbox": ['ellipse-outline', 'ellipse'],
  "Calendar": ['calendar-outline', 'calendar'],
  "Assistant": ['sparkles-outline', 'sparkles'],
};
 
function Tabs() {
  const t = useTheme();
  const labelStyle = StyleSheet.flatten(t.font.caption);
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: t.accent,
        tabBarInactiveTintColor: t.textMuted,
        tabBarLabelStyle: labelStyle,
        // The web player has no safe area at the bottom, so the tab bar sat on the phone's edge; it gets
        // an iPhone's home-indicator room there (the preview draws the indicator over it).
        tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.border, ...(Platform.OS === 'web' ? { height: 78, paddingBottom: 22 } : {}) },
        tabBarIcon: ({ focused, color, size }) => {
          const pair = ICONS[route.name] || ['ellipse-outline', 'ellipse'];
          return <Ionicons name={focused ? pair[1] : pair[0]} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Dashboard" component={guardScreen(DashboardScreen, "Dashboard")} />
      <Tab.Screen name="Inbox" component={guardScreen(InboxScreen, "Inbox")} />
      <Tab.Screen name="Calendar" component={guardScreen(CalendarScreen, "Calendar")} />
      <Tab.Screen name="Assistant" component={guardScreen(AssistantScreen, "Assistant")} />
    </Tab.Navigator>
  );
}
 
function Root() {
  const t = useTheme();
  return (
    <NavigationContainer
      ref={navigationRef}
      theme={{
        ...DefaultTheme,
        dark: !!t.dark,
        colors: { ...DefaultTheme.colors, primary: t.accent, background: t.bg, card: t.surface, text: t.text, border: t.border, notification: t.accent },
      }}
    >
      <RootStack.Navigator initialRouteName="Main" screenOptions={{ cardStyle: { flex: 1 }, headerShown: false }}>
      <RootStack.Screen name="Main" component={guardScreen(Tabs, "Main")} options={{ headerShown: false }} />
      <RootStack.Screen name="Customers" component={guardScreen(CustomersScreen, "Customers")} />
      <RootStack.Screen name="CustomerList" component={guardScreen(CustomersListScreen, "CustomerList")} />
      <RootStack.Screen name="Onboarding" component={guardScreen(OnboardingScreen, "Onboarding")} />
      <RootStack.Screen name="Guide" component={guardScreen(GuideScreen, "Guide")} />
      <RootStack.Screen name="Settings" component={guardScreen(SettingsScreen, "Settings")} />
      <RootStack.Screen name="CloudBusiness" component={guardScreen(CloudBusinessScreen, "CloudBusiness")} options={{ title: 'Cloud business' }} />
      <RootStack.Screen name="Conversation" component={guardScreen(ConversationScreen, "Conversation")} />
      </RootStack.Navigator>
    </NavigationContainer>
  );
}
 
/* The web preview's player is 285 points wide; this app is laid out for an iPhone's 390 and shrunk
   to fit it, so it looks like a phone's screen scaled down rather than a phone's screen squeezed. */
const PHONE_W = 390;
function WebPhone({ children }) {
  const { width, height } = useWindowDimensions();
  if (Platform.OS !== 'web') return children;
  if (width >= PHONE_W) {
    return <View style={{ flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center' }}>{children}</View>;
  }
  const k = width / PHONE_W;
  return (
    <View style={{ width: PHONE_W, height: height / k, transform: [{ translateX: -(PHONE_W * (1 - k)) / 2 }, { translateY: -(height / k - height) / 2 }, { scale: k }] }}>
      {children}
    </View>
  );
}

function AppShell() {
  const { storageError } = useStore();
  const { session, demoMode, loading } = useAuth();
  const theme = useTheme();
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg }}>
        <Text style={{ color: theme.textMuted }}>JawabDo session load ho raha hai...</Text>
      </View>
    );
  }
  if (!session && !demoMode) return <AuthScreen />;
  return (
    <>
      <Root />
      {session ? (
        <Pressable
          onPress={() => navigationRef.isReady() && navigationRef.navigate('CloudBusiness')}
          accessibilityRole="button"
          accessibilityLabel="Open cloud business profile"
          style={{ position: 'absolute', top: Platform.OS === 'web' ? 52 : 8, left: 14, right: 14, zIndex: 20, padding: 9, borderRadius: 10, backgroundColor: theme.warning + 'EE' }}
        >
          <Text style={{ color: theme.text, fontSize: 11, fontWeight: '700', textAlign: 'center' }}>
            Live business account · Dashboard, inbox, calendar aur customers server se load hote hain · Tap for profile
          </Text>
        </Pressable>
      ) : null}
      {storageError ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: 12, right: 12, bottom: 88, padding: 12, borderRadius: 12, backgroundColor: '#7F1D1D', zIndex: 10 }}>
          <Text style={{ color: '#FFFFFF', fontSize: 12, lineHeight: 18 }}>{storageError}</Text>
        </View>
      ) : null}
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
    </>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider theme="forest">
          <WebPhone>
            <AuthProvider>
              <CloudDataProvider>
                <StoreProvider>
                  <AppShell />
                </StoreProvider>
              </CloudDataProvider>
            </AuthProvider>
          </WebPhone>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
 