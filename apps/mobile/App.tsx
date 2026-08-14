import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList } from './src/types';
import { ThemeProvider } from './src/context/ThemeContext';
import { ChatProvider } from './src/context/ChatContext';

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

export default function App() {
  return (
    <ThemeProvider>
      <ChatProvider>
        <NavigationContainer>
          <Stack.Navigator
            id="root-stack"
            initialRouteName="PhoneAuth"
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
      </ChatProvider>
    </ThemeProvider>
  );
}
