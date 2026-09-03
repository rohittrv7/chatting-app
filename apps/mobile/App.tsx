import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StatusBar, LogBox } from 'react-native';

LogBox.ignoreLogs([
  '[expo-av]: Expo AV has been deprecated',
  'Expo AV has been deprecated and will be removed in SDK 54',
  'Due to changes in Androids permission requirements',
  'Expo Go can no longer provide full access to the media library',
]);
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  NavigationContainer,
  DarkTheme,
  DefaultTheme,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Provider, useDispatch } from 'react-redux';
import { RootStackParamList } from './src/types';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { ChatProvider } from './src/context/ChatContext';
import { ToastProvider, useToast } from './src/context/ToastContext';
import { store } from './src/store';
import { restoreSession, logout } from './src/store/authSlice';
import { apiService, setSessionExpiredHandler } from './src/services/apiService';

import { PhoneAuthScreen } from './src/screens/PhoneAuthScreen';
import { OtpVerificationScreen } from './src/screens/OtpVerificationScreen';
import { NewUserProfileSetupScreen } from './src/screens/NewUserProfileSetupScreen';
import { ConversationListScreen } from './src/screens/ConversationListScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { CallScreen } from './src/screens/CallScreen';
import { ContactsScreen } from './src/screens/ContactsScreen';
import { EditProfileScreen } from './src/screens/EditProfileScreen';
import { AccountSettingsScreen } from './src/screens/AccountSettingsScreen';
import { PrivacySettingsScreen } from './src/screens/PrivacySettingsScreen';
import { ChatSettingsScreen } from './src/screens/ChatSettingsScreen';
import { CallSettingsScreen } from './src/screens/CallSettingsScreen';
import { NotificationSettingsScreen } from './src/screens/NotificationSettingsScreen';
import { StorageSettingsScreen } from './src/screens/StorageSettingsScreen';
import { HelpSettingsScreen } from './src/screens/HelpSettingsScreen';
import { QrCodeScreen } from './src/screens/QrCodeScreen';
import { IncomingCallModal } from './src/components/IncomingCallModal';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

function AppNavigator() {
  const dispatch = useDispatch();
  const { themeMode, colors } = useTheme();
  const { showToast } = useToast();
  const [initialRoute, setInitialRoute] = useState<keyof RootStackParamList | null>(null);

  useEffect(() => {
    // 🛡️ Global 401 Session Expiration & Refresh Failure Handler
    setSessionExpiredHandler(() => {
      dispatch(logout());
      showToast('Session expired. Please log in again.', 'warning');
      if (navigationRef.isReady()) {
        navigationRef.reset({
          index: 0,
          routes: [{ name: 'PhoneAuth' }],
        });
      }
    });
  }, [dispatch, showToast]);

  useEffect(() => {
    async function checkAuthSession() {
      const session = await apiService.loadStoredSession();
      if (
        session.token &&
        session.userProfile &&
        session.userProfile.name &&
        session.userProfile.username
      ) {
        dispatch(
          restoreSession({
            token: session.token,
            refreshToken: session.refreshToken,
            phoneNumber: session.phoneNumber || '',
            userId: session.userId,
            userProfile: session.userProfile,
            isNewUser: false,
          }),
        );
        setInitialRoute('MainTabs');
      } else if (session.token && session.isNewUser) {
        dispatch(
          restoreSession({
            token: session.token,
            refreshToken: session.refreshToken,
            phoneNumber: session.phoneNumber || '',
            userId: session.userId,
            userProfile: session.userProfile,
            isNewUser: true,
          }),
        );
        setInitialRoute('NewUserProfileSetup');
      } else {
        setInitialRoute('PhoneAuth');
      }
    }

    checkAuthSession();
  }, [dispatch]);

  if (!initialRoute) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.bg,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <ActivityIndicator size="large" color={colors.primaryIndigo} />
      </View>
    );
  }

  const baseTheme = themeMode === 'dark' ? DarkTheme : DefaultTheme;
  const customNavTheme = {
    ...baseTheme,
    dark: themeMode === 'dark',
    colors: {
      ...baseTheme.colors,
      primary: colors.primaryIndigo,
      background: colors.bg,
      card: colors.surface,
      text: colors.textPrimary,
      border: colors.cardBorder,
      notification: colors.unreadBadge,
    },
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar
        barStyle={themeMode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.bg}
      />
      <NavigationContainer ref={navigationRef} theme={customNavTheme}>
        <Stack.Navigator
          id="root-stack"
          initialRouteName={initialRoute}
          screenOptions={{
            headerShown: false,
            animation: 'slide_from_right',
            animationDuration: 220,
            contentStyle: { backgroundColor: colors.bg },
            gestureEnabled: true,
          }}
        >
          <Stack.Screen name="PhoneAuth" component={PhoneAuthScreen} />
          <Stack.Screen name="OtpVerification" component={OtpVerificationScreen} />
          <Stack.Screen name="NewUserProfileSetup" component={NewUserProfileSetupScreen} />
          <Stack.Screen name="MainTabs" component={ConversationListScreen} />
          <Stack.Screen name="Chat" component={ChatScreen} />
          <Stack.Screen name="Call" component={CallScreen} />
          <Stack.Screen name="Contacts" component={ContactsScreen} />
          <Stack.Screen name="EditProfile" component={EditProfileScreen} />
          <Stack.Screen name="AccountSettings" component={AccountSettingsScreen} />
          <Stack.Screen name="PrivacySettings" component={PrivacySettingsScreen} />
          <Stack.Screen name="ChatSettings" component={ChatSettingsScreen} />
          <Stack.Screen name="CallSettings" component={CallSettingsScreen} />
          <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
          <Stack.Screen name="StorageSettings" component={StorageSettingsScreen} />
          <Stack.Screen name="HelpSettings" component={HelpSettingsScreen} />
          <Stack.Screen name="QrCode" component={QrCodeScreen} />
        </Stack.Navigator>
      </NavigationContainer>
      <IncomingCallModal navigationRef={navigationRef} />
    </View>
  );
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  state = { hasError: false, error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error('🛑 [ErrorBoundary] Unhandled UI error caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View
          style={{
            flex: 1,
            backgroundColor: '#0F172A',
            justifyContent: 'center',
            alignItems: 'center',
            padding: 24,
          }}
        >
          <Text style={{ fontSize: 48, marginBottom: 16 }}>💬</Text>
          <Text
            style={{
              color: '#F8FAFC',
              fontSize: 18,
              fontWeight: '700',
              textAlign: 'center',
              marginBottom: 8,
            }}
          >
            Something went wrong
          </Text>
          <Text
            style={{
              color: '#94A3B8',
              fontSize: 13,
              textAlign: 'center',
              marginBottom: 24,
            }}
          >
            {this.state.error?.message || 'An unexpected error occurred.'}
          </Text>
          <TouchableOpacity
            style={{
              backgroundColor: '#4F46E5',
              paddingHorizontal: 24,
              paddingVertical: 12,
              borderRadius: 8,
            }}
            onPress={() => this.setState({ hasError: false, error: null })}
          >
            <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>Restart App</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <Provider store={store}>
          <ThemeProvider>
            <ChatProvider>
              <ToastProvider>
                <AppNavigator />
              </ToastProvider>
            </ChatProvider>
          </ThemeProvider>
        </Provider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
