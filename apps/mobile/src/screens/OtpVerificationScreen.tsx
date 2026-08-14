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
import { ArrowLeft } from 'lucide-react-native';

type Props = NativeStackScreenProps<RootStackParamList, 'OtpVerification'>;

export const OtpVerificationScreen: React.FC<Props> = ({ route, navigation }) => {
  const { phoneNumber } = route.params || { phoneNumber: '+1 234 567 8900' };
  const [otp, setOtp] = useState('123456');
  const { themeMode, colors } = useTheme();

  const handleVerify = () => {
    navigation.replace('MainTabs');
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <StatusBar
        barStyle={themeMode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.bg}
      />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ArrowLeft size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Verify Number</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.body}>
        <Text style={[styles.infoText, { color: colors.textSecondary }]}>
          Waiting to automatically detect an SMS sent to{' '}
          <Text style={{ fontWeight: '700', color: colors.textPrimary }}>{phoneNumber}</Text>
        </Text>

        <View style={{ height: 32 }} />

        {/* OTP Input Box */}
        <View style={[styles.otpInputContainer, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
          <TextInput
            style={[styles.otpInput, { color: colors.textPrimary }]}
            value={otp}
            onChangeText={setOtp}
            keyboardType="number-pad"
            maxLength={6}
            textAlign="center"
          />
        </View>

        <View style={{ height: 36 }} />

        <TouchableOpacity style={[styles.verifyButton, { backgroundColor: colors.primaryIndigo }]} onPress={handleVerify} activeOpacity={0.8}>
          <Text style={styles.verifyButtonText}>Verify & Continue</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  body: {
    flex: 1,
    paddingHorizontal: 24,
    alignItems: 'center',
    paddingTop: 24,
  },
  infoText: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
  },
  otpInputContainer: {
    width: '100%',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderWidth: 1,
  },
  otpInput: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 12,
  },
  verifyButton: {
    width: '100%',
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
  verifyButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
