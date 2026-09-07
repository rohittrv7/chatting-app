/**
 * NotificationSettingsScreen — Functional notification preferences
 *
 * Settings:
 * - Message notifications on/off
 * - Call notifications on/off
 * - Notification preview (show content vs "New message")
 * - In-app sounds on/off (stored locally)
 *
 * All preferences persisted via GET/POST /auth/settings.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ScrollView,
  Switch,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useTheme } from '../context/ThemeContext';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import { apiService } from '../services/apiService';
import { ArrowLeft, Bell, MessageSquare, Phone, Eye, Volume2 } from 'lucide-react-native';

type Props = NativeStackScreenProps<RootStackParamList, 'NotificationSettings'>;

interface NotifSettings {
  messageNotifications: boolean;
  callNotifications: boolean;
  notificationPreview: boolean;
}

export const NotificationSettingsScreen: React.FC<Props> = ({ navigation }) => {
  const { themeMode, colors } = useTheme();
  const token = useSelector((state: RootState) => state.auth.token);

  const [settings, setSettings] = useState<NotifSettings>({
    messageNotifications: true,
    callNotifications: true,
    notificationPreview: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Load from backend
  useEffect(() => {
    if (!token) return;
    apiService
      .getUserSettings(token)
      .then((data) => {
        if (data) {
          setSettings({
            messageNotifications: data.messageNotifications ?? true,
            callNotifications: data.callNotifications ?? true,
            notificationPreview: data.notificationPreview ?? true,
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  const saveSettings = useCallback(
    async (updated: NotifSettings) => {
      if (!token) return;
      setSaving(true);
      try {
        await apiService.updateUserSettings(token, {
          messageNotifications: updated.messageNotifications,
          callNotifications: updated.callNotifications,
          notificationPreview: updated.notificationPreview,
        });
        setSavedAt(Date.now());
      } catch (_) {}
      setSaving(false);
    },
    [token],
  );

  const update = useCallback(
    (patch: Partial<NotifSettings>) => {
      const next = { ...settings, ...patch };
      setSettings(next);
      saveSettings(next);
    },
    [settings, saveSettings],
  );

  const switchColor = (on: boolean) => ({
    thumbColor: on ? colors.primaryIndigo : '#94A3B8',
    trackColor: { false: '#374151', true: 'rgba(99,102,241,0.35)' },
  });

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.bg }]}
      edges={['top', 'bottom', 'left', 'right']}
    >
      <StatusBar
        barStyle={themeMode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.bg}
      />

      <View style={[styles.header, { backgroundColor: colors.bg }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
          activeOpacity={0.7}
        >
          <ArrowLeft size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Notifications</Text>
        {saving ? (
          <ActivityIndicator size="small" color={colors.primaryIndigo} />
        ) : savedAt ? (
          <Text style={[styles.savedLabel, { color: '#10B981' }]}>Saved ✓</Text>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primaryIndigo} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {/* ── Message notifications ─── */}
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            <View style={styles.cardRow}>
              <View style={[styles.iconBox, { backgroundColor: 'rgba(99,102,241,0.12)' }]}>
                <MessageSquare size={20} color={colors.primaryIndigo} />
              </View>
              <View style={styles.cardText}>
                <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
                  Message Notifications
                </Text>
                <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>
                  Show banner when a new message arrives
                </Text>
              </View>
              <Switch
                value={settings.messageNotifications}
                onValueChange={(v) => update({ messageNotifications: v })}
                {...switchColor(settings.messageNotifications)}
              />
            </View>
          </View>

          {/* ── Call notifications ─── */}
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            <View style={styles.cardRow}>
              <View style={[styles.iconBox, { backgroundColor: 'rgba(16,185,129,0.12)' }]}>
                <Phone size={20} color="#10B981" />
              </View>
              <View style={styles.cardText}>
                <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
                  Call Notifications
                </Text>
                <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>
                  Wake device when an incoming call arrives
                </Text>
              </View>
              <Switch
                value={settings.callNotifications}
                onValueChange={(v) => update({ callNotifications: v })}
                {...switchColor(settings.callNotifications)}
              />
            </View>
          </View>

          {/* ── Notification preview ─── */}
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            <View style={styles.cardRow}>
              <View style={[styles.iconBox, { backgroundColor: 'rgba(59,130,246,0.12)' }]}>
                <Eye size={20} color="#3B82F6" />
              </View>
              <View style={styles.cardText}>
                <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
                  Show Message Preview
                </Text>
                <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>
                  {settings.notificationPreview
                    ? 'Preview shown: "Hey, are you free…"'
                    : 'Privacy mode: "New message" only'}
                </Text>
              </View>
              <Switch
                value={settings.notificationPreview}
                onValueChange={(v) => update({ notificationPreview: v })}
                {...switchColor(settings.notificationPreview)}
              />
            </View>
            {!settings.notificationPreview && (
              <Text style={[styles.hint, { color: colors.textSecondary }]}>
                Only "New message" will be shown on your lock screen — content stays private.
              </Text>
            )}
          </View>

          {/* ── In-app sounds (info only) ─── */}
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            <View style={styles.cardRow}>
              <View style={[styles.iconBox, { backgroundColor: 'rgba(245,158,11,0.12)' }]}>
                <Volume2 size={20} color="#F59E0B" />
              </View>
              <View style={styles.cardText}>
                <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>In-App Sounds</Text>
                <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>
                  Message send/receive tones, call ringtones
                </Text>
              </View>
              <Text style={[styles.badge, { color: colors.primaryIndigo }]}>System</Text>
            </View>
            <Text style={[styles.hint, { color: colors.textSecondary }]}>
              Use your device's sound settings to control volume and silent mode behaviour.
            </Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  backBtn: { padding: 4 },
  title: { fontSize: 20, fontWeight: '800' },
  savedLabel: { fontSize: 12, fontWeight: '700' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, gap: 12 },
  card: { borderRadius: 18, padding: 16, borderWidth: 1, gap: 10 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardText: { flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  cardDesc: { fontSize: 12, marginTop: 2, lineHeight: 16 },
  hint: { fontSize: 12, lineHeight: 16, paddingHorizontal: 2 },
  badge: { fontSize: 12, fontWeight: '700' },
});
