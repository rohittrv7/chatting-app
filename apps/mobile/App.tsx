import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Provider, useDispatch } from 'react-redux';
import { RootStackParamList } from './src/types';
import { ThemeProvider } from './src/context/ThemeContext';
import { ChatProvider } from './src/context/ChatContext';
import { ToastProvider } from './src/context/ToastContext';
import { store } from './src/store';
import { restoreSession } from './src/store/authSlice';
import { apiService } from './src/services/apiService';

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

const Stack = createNativeStackNavigator<RootStackParamList>();

function AppNavigator() {
  const dispatch = useDispatch();
  const [initialRoute, setInitialRoute] = useState<keyof RootStackParamList | null>(null);

  useEffect(() => {
    async function checkAuthSession() {
      const session = await apiService.loadStoredSession();
      if (session.token && session.userProfile && session.userProfile.name && session.userProfile.username) {
        dispatch(
          restoreSession({
            token: session.token,
            phoneNumber: session.phoneNumber || '',
            userProfile: session.userProfile,
            isNewUser: false,
          })
        );
        setInitialRoute('MainTabs');
      } else if (session.token && session.isNewUser) {
        dispatch(
          restoreSession({
            token: session.token,
            phoneNumber: session.phoneNumber || '',
            userProfile: session.userProfile,
            isNewUser: true,
          })
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
      <View style={{ flex: 1, backgroundColor: '#000000', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#6366F1" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        id="root-stack"
        initialRouteName={initialRoute}
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
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
  );
}

export default function App() {
  return (
    <Provider store={store}>
      <ThemeProvider>
        <ChatProvider>
          <ToastProvider>
            <AppNavigator />
          </ToastProvider>
        </ChatProvider>
      </ThemeProvider>
    </Provider>
  );
}
