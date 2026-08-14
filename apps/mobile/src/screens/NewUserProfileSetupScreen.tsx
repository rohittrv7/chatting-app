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
  Image,
  Platform,
  Animated,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useChat } from '../context/ChatContext';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import * as ImagePicker from 'expo-image-picker';
import { Camera, User, AtSign, Info, Sparkles, ArrowRight } from 'lucide-react-native';

type Props = NativeStackScreenProps<RootStackParamList, 'NewUserProfileSetup'>;

export const NewUserProfileSetupScreen: React.FC<Props> = ({ route, navigation }) => {
  const { phoneNumber } = route.params || { phoneNumber: '+91 98765 43210' };
  const { updateUserProfile } = useChat();
  const { themeMode, colors } = useTheme();
  const { showToast } = useToast();

  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [status, setStatus] = useState('Available | Ready to connect');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);

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

  const handlePickAvatar = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        showToast('Media gallery permission is required to select profile photo', 'warning');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]?.uri) {
        setAvatarUri(result.assets[0].uri);
        showToast('Profile photo selected!', 'success', 2000);
      }
    } catch (error) {
      console.log('Error picking avatar:', error);
      showToast('Could not open image gallery', 'error');
    }
  };

  const handleCompleteSetup = () => {
    if (!name.trim()) {
      showToast('Full Name is required to continue', 'error');
      return;
    }
    if (!username.trim()) {
      showToast('Username handle (@username) is required', 'error');
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
      const formattedUsername = username.startsWith('@') ? username.trim() : `@${username.trim()}`;

      updateUserProfile({
        name: name.trim(),
        username: formattedUsername,
        status: status.trim() || 'Available',
        phone: phoneNumber,
        avatarUrl: avatarUri || undefined,
      });

      showToast('Profile Created Successfully!', 'success', 2500);
      navigation.replace('MainTabs');
    });
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
        {/* Animated Welcome Badge */}
        <Animated.View style={[styles.badgeWrapper, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <View style={[styles.badge, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
            <Sparkles size={16} color={colors.primaryIndigo} />
            <Text style={[styles.badgeText, { color: colors.primaryIndigo }]}>New User Setup</Text>
          </View>
        </Animated.View>

        {/* Animated Headline without emojis */}
        <Animated.View style={[styles.titleSection, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Welcome! Setup Your Profile</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Personalize your identity so your friends & contacts can find you easily.
          </Text>
        </Animated.View>

        {/* Animated Avatar Picker */}
        <Animated.View style={[styles.avatarSection, { opacity: fadeAnim, transform: [{ scale: scaleAnim }] }]}>
          <TouchableOpacity activeOpacity={0.85} onPress={handlePickAvatar} style={styles.avatarTouchable}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
            ) : (
              <View style={[styles.avatarPlaceholder, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
                <User size={48} color={colors.textSecondary} />
              </View>
            )}
            <View style={[styles.cameraBadge, { backgroundColor: colors.primaryIndigo }]}>
              <Camera size={18} color="#FFF" />
            </View>
          </TouchableOpacity>
          <Text style={[styles.photoLabel, { color: colors.textSecondary }]}>
            {avatarUri ? 'Tap to change photo' : 'Add Profile Photo (Optional)'}
          </Text>
        </Animated.View>

        {/* Animated Form Fields */}
        <Animated.View style={[styles.formContainer, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          {/* Name Field (Required) */}
          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: colors.textPrimary }]}>
              Full Name <Text style={styles.requiredStar}>*</Text>
            </Text>
            <View style={[styles.inputBox, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
              <User size={20} color={colors.primaryIndigo} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: colors.textPrimary }]}
                placeholder="Enter your name (e.g. Rohit Sharma)"
                placeholderTextColor={colors.textSecondary}
                value={name}
                onChangeText={setName}
              />
            </View>
          </View>

          {/* Username Field (Required) */}
          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: colors.textPrimary }]}>
              Username <Text style={styles.requiredStar}>*</Text>
            </Text>
            <View style={[styles.inputBox, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
              <AtSign size={20} color={colors.primaryIndigo} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: colors.textPrimary }]}
                placeholder="Choose @username (e.g. rohit_dev)"
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="none"
                value={username}
                onChangeText={setUsername}
              />
            </View>
          </View>

          {/* Bio/Status Field (Optional) */}
          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: colors.textPrimary }]}>
              Bio / Status <Text style={[styles.optionalTag, { color: colors.textSecondary }]}> (Optional)</Text>
            </Text>
            <View style={[styles.inputBox, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
              <Info size={20} color={colors.primaryIndigo} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: colors.textPrimary }]}
                placeholder="Tell something about yourself"
                placeholderTextColor={colors.textSecondary}
                value={status}
                onChangeText={setStatus}
              />
            </View>
          </View>
        </Animated.View>

        {/* Animated Submit Button */}
        <Animated.View style={{ width: '100%', marginTop: 24, opacity: fadeAnim, transform: [{ scale: btnScale }] }}>
          <TouchableOpacity
            style={[styles.submitBtn, { backgroundColor: colors.primaryIndigo }]}
            onPress={handleCompleteSetup}
            activeOpacity={0.85}
          >
            <Text style={styles.submitBtnText}>Get Started Now</Text>
            <ArrowRight size={20} color="#FFF" style={{ marginLeft: 8 }} />
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
    paddingHorizontal: 24,
    paddingVertical: 20,
    alignItems: 'center',
    maxWidth: 520,
    alignSelf: 'center',
    width: '100%',
  },
  badgeWrapper: {
    alignItems: 'center',
    marginBottom: 14,
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
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 6,
  },
  titleSection: {
    alignItems: 'center',
    marginBottom: 28,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 34,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: 28,
  },
  avatarTouchable: {
    position: 'relative',
  },
  avatarImage: {
    width: 104,
    height: 104,
    borderRadius: 52,
  },
  avatarPlaceholder: {
    width: 104,
    height: 104,
    borderRadius: 52,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
  },
  cameraBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#000',
  },
  photoLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 10,
  },
  formContainer: {
    width: '100%',
  },
  inputGroup: {
    marginBottom: 18,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
  },
  requiredStar: {
    color: '#EF4444',
  },
  optionalTag: {
    fontSize: 12,
    fontWeight: '400',
  },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  submitBtn: {
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
  submitBtnText: {
    color: '#FFF',
    fontSize: 17,
    fontWeight: '700',
  },
});
