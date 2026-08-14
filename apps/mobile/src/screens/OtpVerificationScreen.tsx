import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  ScrollView,
  Platform,
  Alert,
  Animated,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useChat } from '../context/ChatContext';
import { useTheme } from '../context/ThemeContext';
import { ArrowLeft, CheckCircle, RefreshCw, KeyRound } from 'lucide-react-native';

type Props = NativeStackScreenProps<RootStackParamList, 'OtpVerification'>;

export const OtpVerificationScreen: React.FC<Props> = ({ route, navigation }) => {
  const { phoneNumber } = route.params || { phoneNumber: '+91 98765 43210' };
  const [otp, setOtp] = useState('123456');
  const [resendTimer, setResendTimer] = useState(30);
  const { userProfile } = useChat();
  const { themeMode, colors } = useTheme();

  // Pure React Native Animated values
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const btnScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 700,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 700,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 6,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (resendTimer > 0) {
      timer = setTimeout(() => setResendTimer(resendTimer - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [resendTimer]);

  const handleVerify = () => {
    if (otp.length < 6) {
      Alert.alert('Invalid OTP', 'Please enter a valid 6-digit OTP code.');
      return;
    }

    Animated.sequence([
      Animated.timing(btnScale, {
        toValue: 0.94,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(btnScale, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start(() => {
      // If user has not configured name or username, route to NewUserProfileSetup Screen!
      const isExistingUser = userProfile.name && userProfile.name.trim().length > 0 && userProfile.username;
      if (isExistingUser) {
        navigation.replace('MainTabs');
      } else {
        navigation.replace('NewUserProfileSetup', { phoneNumber });
      }
    });
  };

  const handleResend = () => {
    setResendTimer(30);
    Alert.alert('OTP Sent', `A new verification code has been sent to ${phoneNumber}`);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <StatusBar
        barStyle={themeMode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.bg}
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Animated Top Header */}
        <Animated.View style={[styles.header, { opacity: fadeAnim }]}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={[styles.backBtn, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
            <ArrowLeft size={20} color={colors.textPrimary} />
          </TouchableOpacity>
        </Animated.View>

        {/* Hero Icon */}
        <Animated.View style={[styles.iconWrapper, { opacity: fadeAnim, transform: [{ scale: scaleAnim }] }]}>
          <View style={[styles.iconCircle, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
            <KeyRound size={42} color={colors.primaryIndigo} />
          </View>
        </Animated.View>

        {/* Title & Info */}
        <Animated.View style={[styles.textSection, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Verification Code 🔑</Text>
          <Text style={[styles.infoText, { color: colors.textSecondary }]}>
            Enter 6-digit code sent via SMS to{' '}
            <Text style={{ fontWeight: '700', color: colors.textPrimary }}>{phoneNumber}</Text>
          </Text>
        </Animated.View>

        {/* OTP Input Box */}
        <Animated.View style={[styles.inputSection, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <View style={[styles.otpInputContainer, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
            <TextInput
              style={[styles.otpInput, { color: colors.textPrimary }]}
              value={otp}
              onChangeText={setOtp}
              keyboardType="number-pad"
              maxLength={6}
              textAlign="center"
              autoFocus
            />
          </View>
        </Animated.View>

        {/* Resend Link */}
        <Animated.View style={[styles.resendSection, { opacity: fadeAnim }]}>
          {resendTimer > 0 ? (
            <Text style={[styles.timerText, { color: colors.textSecondary }]}>
              Resend OTP in <Text style={{ color: colors.primaryIndigo, fontWeight: '700' }}>{resendTimer}s</Text>
            </Text>
          ) : (
            <TouchableOpacity onPress={handleResend} style={styles.resendBtn}>
              <RefreshCw size={14} color={colors.primaryIndigo} style={{ marginRight: 6 }} />
              <Text style={[styles.resendText, { color: colors.primaryIndigo }]}>Resend OTP Now</Text>
            </TouchableOpacity>
          )}
        </Animated.View>

        {/* Verify Button */}
        <Animated.View style={{ width: '100%', marginTop: 24, opacity: fadeAnim, transform: [{ scale: btnScale }] }}>
          <TouchableOpacity
            style={[styles.verifyButton, { backgroundColor: colors.primaryIndigo }]}
            onPress={handleVerify}
            activeOpacity={0.85}
          >
            <Text style={styles.verifyButtonText}>Verify & Continue</Text>
            <CheckCircle size={20} color="#FFF" style={{ marginLeft: 8 }} />
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingVertical: 16,
    alignItems: 'center',
    maxWidth: 500,
    alignSelf: 'center',
    width: '100%',
  },
  header: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  iconWrapper: {
    marginBottom: 20,
    alignItems: 'center',
  },
  iconCircle: {
    width: 86,
    height: 86,
    borderRadius: 43,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 6,
  },
  textSection: {
    alignItems: 'center',
    marginBottom: 28,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
  },
  infoText: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 22,
  },
  inputSection: {
    width: '100%',
    marginBottom: 16,
  },
  otpInputContainer: {
    width: '100%',
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderWidth: 1,
  },
  otpInput: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: 14,
  },
  resendSection: {
    marginVertical: 12,
  },
  timerText: {
    fontSize: 14,
    fontWeight: '500',
  },
  resendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  resendText: {
    fontSize: 14,
    fontWeight: '700',
  },
  verifyButton: {
    width: '100%',
    height: 56,
    borderRadius: 28,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  verifyButtonText: {
    color: '#FFF',
    fontSize: 17,
    fontWeight: '700',
  },
});
