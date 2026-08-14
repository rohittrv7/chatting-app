import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useTheme } from '../context/ThemeContext';
import { Phone } from 'lucide-react-native';

type Props = NativeStackScreenProps<RootStackParamList, 'PhoneAuth'>;

export const PhoneAuthScreen: React.FC<Props> = ({ navigation }) => {
  const [phoneNumber, setPhoneNumber] = useState('+1 234 567 8900');
  const { themeMode, colors } = useTheme();

  const handleProceed = () => {
    if (phoneNumber.trim()) {
      navigation.navigate('OtpVerification', { phoneNumber: phoneNumber.trim() });
    }
  };

  const handleGoogleSignup = () => {
    navigation.replace('MainTabs');
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <StatusBar
        barStyle={themeMode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.bg}
      />
      <View style={styles.content}>
        <View style={styles.topSpacer} />

        <Text style={[styles.title, { color: colors.textPrimary }]}>
          Chat And{'\n'}Connect 👩🏻‍💻 With{'\n'}Your 👩🏻 Loved{'\n'}Ones Easily
        </Text>

        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Sign in right now to get started and{'\n'}get all the greatest perks!
        </Text>

        <View style={styles.middleSpacer} />

        {/* Phone Input Box */}
        <View style={[styles.inputContainer, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
          <TextInput
            style={[styles.input, { color: colors.textPrimary }]}
            placeholder="Enter Phone Number"
            placeholderTextColor={colors.textSecondary}
            keyboardType="phone-pad"
            value={phoneNumber}
            onChangeText={setPhoneNumber}
          />
        </View>

        <View style={{ height: 16 }} />

        {/* Phone Button */}
        <TouchableOpacity style={styles.phoneButton} onPress={handleProceed} activeOpacity={0.8}>
          <Text style={styles.phoneButtonText}>Sign up with phone number</Text>
          <View style={styles.iconCircle}>
            <Phone size={18} color="#000" />
          </View>
        </TouchableOpacity>

        <View style={{ height: 12 }} />

        {/* Indigo Google Button */}
        <TouchableOpacity style={[styles.googleButton, { backgroundColor: colors.primaryIndigo }]} onPress={handleGoogleSignup} activeOpacity={0.8}>
          <Text style={styles.googleButtonText}>Sign up with Google account</Text>
          <View style={styles.iconCircleWhite}>
            <Text style={[styles.gText, { color: colors.primaryIndigo }]}>G</Text>
          </View>
        </TouchableOpacity>

        <View style={{ height: 24 }} />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
    alignItems: 'center',
    maxWidth: 500,
    alignSelf: 'center',
    width: '100%',
  },
  topSpacer: {
    flex: 1,
  },
  middleSpacer: {
    flex: 1,
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 38,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 14,
    lineHeight: 20,
  },
  inputContainer: {
    width: '100%',
    borderRadius: 28,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderWidth: 1,
  },
  input: {
    fontSize: 16,
    fontWeight: '700',
  },
  phoneButton: {
    width: '100%',
    height: 56,
    backgroundColor: '#F59E0B',
    borderRadius: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  phoneButtonText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '700',
  },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  googleButton: {
    width: '100%',
    height: 56,
    borderRadius: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  googleButtonText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
  },
  iconCircleWhite: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  gText: {
    fontSize: 16,
    fontWeight: '800',
  },
});
