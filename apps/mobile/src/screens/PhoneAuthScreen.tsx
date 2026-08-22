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
  KeyboardAvoidingView,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import { apiService } from '../services/apiService';
import { Phone, ArrowRight, ShieldCheck, MessageSquare, Sparkles } from 'lucide-react-native';

type Props = NativeStackScreenProps<RootStackParamList, 'PhoneAuth'>;

export const PhoneAuthScreen: React.FC<Props> = ({ navigation }) => {
  const [phoneNumber, setPhoneNumber] = useState('');
  const { themeMode, colors } = useTheme();
  const { showToast } = useToast();

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

  const handleSendOtp = async () => {
    const cleanDigits = phoneNumber.trim().replace(/\D/g, '');
    const clean10 = cleanDigits.length >= 10 ? cleanDigits.slice(-10) : cleanDigits;

    if (clean10.length < 10) {
      showToast('Please enter a valid 10-digit mobile number.', 'error');
      return;
    }

    const res = await apiService.requestOtp(clean10);
    showToast(`Verification OTP Sent: ${res.mockOtp}`, 'info', 5000);

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
      navigation.navigate('OtpVerification', {
        phoneNumber: clean10,
        generatedOtp: res.mockOtp,
      });
    });
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <StatusBar
        barStyle={themeMode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.bg}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Animated Hero Logo */}
          <Animated.View
            style={[
              styles.heroLogoWrapper,
              { opacity: fadeAnim, transform: [{ scale: scaleAnim }] },
            ]}
          >
            <View
              style={[
                styles.heroLogoCircle,
                { backgroundColor: colors.surface, borderColor: colors.cardBorder },
              ]}
            >
              <MessageSquare size={44} color={colors.primaryIndigo} />
            </View>
          </Animated.View>

          {/* Animated Badge */}
          <Animated.View
            style={[
              styles.badgeWrapper,
              { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
            ]}
          >
            <View
              style={[
                styles.badge,
                { backgroundColor: colors.surface, borderColor: colors.cardBorder },
              ]}
            >
              <Sparkles size={14} color={colors.primaryIndigo} />
              <Text style={[styles.badgeText, { color: colors.primaryIndigo }]}>
                Next-Gen Secure Chat
              </Text>
            </View>
          </Animated.View>

          {/* Headline and Subtitle */}
          <Animated.View
            style={[
              styles.textSection,
              { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
            ]}
          >
            <Text style={[styles.title, { color: colors.textPrimary }]}>
              Connect & Chat{'\n'}With Loved Ones
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Enter your 10-digit mobile number to receive an OTP code.
            </Text>
          </Animated.View>

          {/* Phone Input Box */}
          <Animated.View
            style={[
              styles.inputSection,
              { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
            ]}
          >
            <Text style={[styles.inputLabel, { color: colors.textPrimary }]}>
              Mobile Number (10 digits)
            </Text>
            <View
              style={[
                styles.inputContainer,
                { backgroundColor: colors.surface, borderColor: colors.cardBorder },
              ]}
            >
              <Phone size={20} color={colors.primaryIndigo} style={styles.phoneIcon} />
              <TextInput
                style={[styles.input, { color: colors.textPrimary }]}
                placeholder="e.g. 7970321084"
                placeholderTextColor={colors.textSecondary}
                keyboardType="phone-pad"
                maxLength={14}
                value={phoneNumber}
                onChangeText={setPhoneNumber}
              />
            </View>
          </Animated.View>

          {/* Animated Send OTP Button */}
          <Animated.View
            style={{
              width: '100%',
              marginTop: 24,
              opacity: fadeAnim,
              transform: [{ scale: btnScale }],
            }}
          >
            <TouchableOpacity
              style={[styles.phoneButton, { backgroundColor: colors.primaryIndigo }]}
              onPress={handleSendOtp}
              activeOpacity={0.85}
            >
              <Text style={styles.phoneButtonText}>Send OTP Code</Text>
              <View style={styles.iconCircleWhite}>
                <ArrowRight size={18} color={colors.primaryIndigo} />
              </View>
            </TouchableOpacity>
          </Animated.View>

          {/* Footer Security Guarantee */}
          <Animated.View style={[styles.footerInfo, { opacity: fadeAnim }]}>
            <ShieldCheck size={16} color={colors.textSecondary} style={{ marginRight: 6 }} />
            <Text style={[styles.footerText, { color: colors.textSecondary }]}>
              End-to-End Encrypted & Private
            </Text>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
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
    paddingTop: 30,
    paddingBottom: Platform.OS === 'android' ? 140 : 60,
    alignItems: 'center',
    maxWidth: 500,
    alignSelf: 'center',
    width: '100%',
  },
  heroLogoWrapper: {
    marginBottom: 20,
    alignItems: 'center',
  },
  heroLogoCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 6,
  },
  badgeWrapper: {
    marginBottom: 12,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 6,
  },
  textSection: {
    alignItems: 'center',
    marginBottom: 28,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 36,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 20,
  },
  inputSection: {
    width: '100%',
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
  },
  inputContainer: {
    width: '100%',
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  phoneIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
  },
  phoneButton: {
    width: '100%',
    height: 56,
    borderRadius: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  phoneButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
  iconCircleWhite: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  footerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 32,
  },
  footerText: {
    fontSize: 13,
    fontWeight: '500',
  },
});
