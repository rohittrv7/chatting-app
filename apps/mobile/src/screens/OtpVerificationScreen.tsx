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
  Animated,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useDispatch } from 'react-redux';
import { useChat } from '../context/ChatContext';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import { otpVerifiedSuccess } from '../store/authSlice';
import { apiService } from '../services/apiService';
import { ArrowLeft, CheckCircle, RefreshCw, KeyRound } from 'lucide-react-native';

type Props = NativeStackScreenProps<RootStackParamList, 'OtpVerification'>;

export const OtpVerificationScreen: React.FC<Props> = ({ route, navigation }) => {
  const { phoneNumber, generatedOtp = '849201' } = route.params || {
    phoneNumber: '+91 98765 43210',
    generatedOtp: '849201',
  };

  const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [resendTimer, setResendTimer] = useState(30);
  const { userProfile, updateUserProfile } = useChat();
  const { themeMode, colors } = useTheme();
  const { showToast } = useToast();
  const dispatch = useDispatch();

  const inputRefs = useRef<Array<TextInput | null>>([]);

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

    // Notify simulated SMS receipt in Toast
    showToast(`SMS Auto-Detected: Code is ${generatedOtp}`, 'info', 4500);

    // Auto-fill simulation after 800ms
    const autoFillTimer = setTimeout(() => {
      const digits = generatedOtp.split('').slice(0, 6);
      setOtpDigits(digits);
      showToast('OTP Auto-Filled Successfully!', 'success', 2500);

      // Auto-proceed after auto-fill
      const autoProceedTimer = setTimeout(() => {
        proceedToNextScreen();
      }, 900);

      return () => clearTimeout(autoProceedTimer);
    }, 900);

    return () => clearTimeout(autoFillTimer);
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (resendTimer > 0) {
      timer = setTimeout(() => setResendTimer(resendTimer - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [resendTimer]);

  const handleDigitChange = (text: string, index: number) => {
    const newDigits = [...otpDigits];
    newDigits[index] = text;
    setOtpDigits(newDigits);

    // Auto-focus next input box
    if (text && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-verify if all 6 digits entered
    if (newDigits.join('').length === 6) {
      proceedToNextScreen(newDigits.join(''));
    }
  };

  const handleKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === 'Backspace' && !otpDigits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const proceedToNextScreen = async (codeToVerify?: string) => {
    const currentCode = codeToVerify || otpDigits.join('');
    if (currentCode.length < 6) {
      showToast('Please enter complete 6-digit OTP code', 'warning');
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
    ]).start(async () => {
      const verifyRes = await apiService.verifyOtp(phoneNumber, currentCode);

      dispatch(
        otpVerifiedSuccess({
          token: verifyRes.accessToken,
          phoneNumber,
          userProfile: verifyRes.user,
          isNewUser: verifyRes.isNewUser,
        })
      );

      showToast('Phone Number Verified!', 'success', 2000);

      if (verifyRes.isNewUser) {
        navigation.replace('NewUserProfileSetup', { phoneNumber });
      } else {
        if (verifyRes.user) {
          updateUserProfile(verifyRes.user);
        }
        navigation.replace('MainTabs');
      }
    });
  };

  const handleResend = () => {
    setResendTimer(30);
    const newOtp = Math.floor(100000 + Math.random() * 900000).toString();
    showToast(`New Code Sent: ${newOtp}`, 'info', 4000);
    setOtpDigits(['', '', '', '', '', '']);
    inputRefs.current[0]?.focus();
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
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={[styles.backBtn, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}
          >
            <ArrowLeft size={20} color={colors.textPrimary} />
          </TouchableOpacity>
        </Animated.View>

        {/* Hero Icon */}
        <Animated.View style={[styles.iconWrapper, { opacity: fadeAnim, transform: [{ scale: scaleAnim }] }]}>
          <View style={[styles.iconCircle, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
            <KeyRound size={42} color={colors.primaryIndigo} />
          </View>
        </Animated.View>

        {/* Title & Info without emojis */}
        <Animated.View style={[styles.textSection, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Verification Code</Text>
          <Text style={[styles.infoText, { color: colors.textSecondary }]}>
            Enter 6-digit code sent via SMS to{' '}
            <Text style={{ fontWeight: '700', color: colors.textPrimary }}>{phoneNumber}</Text>
          </Text>
        </Animated.View>

        {/* 6 Individual Centered OTP Digit Boxes */}
        <Animated.View style={[styles.otpRowContainer, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          {otpDigits.map((digit, idx) => (
            <View
              key={idx}
              style={[
                styles.otpBox,
                {
                  backgroundColor: colors.surface,
                  borderColor: digit ? colors.primaryIndigo : colors.cardBorder,
                  borderWidth: digit ? 2 : 1,
                },
              ]}
            >
              <TextInput
                ref={(el) => {
                  inputRefs.current[idx] = el;
                }}
                style={[styles.otpBoxText, { color: colors.textPrimary }]}
                keyboardType="number-pad"
                maxLength={1}
                value={digit}
                onChangeText={(text) => handleDigitChange(text, idx)}
                onKeyPress={(e) => handleKeyPress(e, idx)}
                selectTextOnFocus
              />
            </View>
          ))}
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
            onPress={() => proceedToNextScreen()}
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
  otpRowContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    maxWidth: 380,
    marginBottom: 20,
  },
  otpBox: {
    width: 48,
    height: 56,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  otpBoxText: {
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    width: '100%',
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
