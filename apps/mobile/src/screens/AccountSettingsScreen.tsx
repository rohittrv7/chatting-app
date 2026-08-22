import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  ScrollView,
  Platform,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useDispatch } from 'react-redux';
import { RootStackParamList } from '../types';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import { logout } from '../store/authSlice';
import { ArrowLeft, User, ShieldCheck, KeyRound, Smartphone, LogOut } from 'lucide-react-native';
import { LogoutConfirmModal } from '../components/LogoutConfirmModal';

type Props = NativeStackScreenProps<RootStackParamList, 'AccountSettings'>;

export const AccountSettingsScreen: React.FC<Props> = ({ navigation }) => {
  const { themeMode, colors } = useTheme();
  const { showToast } = useToast();
  const dispatch = useDispatch();
  const [showLogoutModal, setShowLogoutModal] = useState<boolean>(false);

  const handleConfirmLogout = () => {
    setShowLogoutModal(false);
    dispatch(logout());
    showToast('Logged out successfully', 'info');
    navigation.reset({
      index: 0,
      routes: [{ name: 'PhoneAuth' }],
    });
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <StatusBar
        barStyle={themeMode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.bg}
      />
      <View style={[styles.header, { backgroundColor: colors.bg }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
        >
          <ArrowLeft size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Account Settings</Text>
      </View>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 30 }}
      >
        {[
          {
            label: 'Security Notifications',
            icon: ShieldCheck,
            desc: 'Get notified when security keys change',
          },
          { label: 'Two-Step Verification', icon: KeyRound, desc: 'Add PIN for extra security' },
          { label: 'Change Phone Number', icon: Smartphone, desc: 'Migrate your account details' },
          { label: 'Request Account Info', icon: User, desc: 'Download account data report' },
        ].map((item, idx) => {
          const Icon = item.icon;
          return (
            <TouchableOpacity
              key={idx}
              style={[
                styles.card,
                { backgroundColor: colors.surface, borderColor: colors.cardBorder },
              ]}
            >
              <View style={[styles.iconBox, { backgroundColor: colors.cardBorder }]}>
                <Icon size={20} color={colors.primaryIndigo} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{item.label}</Text>
                <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>{item.desc}</Text>
              </View>
            </TouchableOpacity>
          );
        })}

        {/* Log Out Option */}
        <TouchableOpacity
          style={[
            styles.card,
            {
              backgroundColor: colors.surface,
              borderColor: 'rgba(239, 68, 68, 0.3)',
              marginTop: 10,
            },
          ]}
          onPress={() => setShowLogoutModal(true)}
          activeOpacity={0.8}
        >
          <View style={[styles.iconBox, { backgroundColor: 'rgba(239, 68, 68, 0.12)' }]}>
            <LogOut size={20} color="#EF4444" />
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={[styles.cardTitle, { color: '#EF4444' }]}>Log Out</Text>
            <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>
              Clear session & return to login screen
            </Text>
          </View>
        </TouchableOpacity>
      </ScrollView>

      <LogoutConfirmModal
        visible={showLogoutModal}
        onCancel={() => setShowLogoutModal(false)}
        onConfirm={handleConfirmLogout}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 4 : 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  backBtn: { padding: 4, marginRight: 10 },
  title: { fontSize: 20, fontWeight: '800' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  cardDesc: { fontSize: 12, marginTop: 2 },
});
