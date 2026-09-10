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
import {
  ArrowLeft,
  Lock,
  Eye,
  Clock,
  CheckCheck,
  ChevronRight,
  ChevronDown,
} from 'lucide-react-native';

type Props = NativeStackScreenProps<RootStackParamList, 'PrivacySettings'>;

type Visibility = 'EVERYONE' | 'CONTACTS' | 'NOBODY';

interface PrivacySettings {
  lastSeenVisibility: Visibility;
  profilePhotoVis: Visibility;
  aboutVisibility: Visibility;
  readReceipts: boolean;
}

const VISIBILITY_OPTIONS: { label: string; value: Visibility }[] = [
  { label: 'Everyone', value: 'EVERYONE' },
  { label: 'My Contacts', value: 'CONTACTS' },
  { label: 'Nobody', value: 'NOBODY' },
];

const VisibilityPicker: React.FC<{
  value: Visibility;
  onChange: (v: Visibility) => void;
  colors: any;
}> = ({ value, onChange, colors }) => {
  const [open, setOpen] = useState(false);
  const selected = VISIBILITY_OPTIONS.find((o) => o.value === value);

  return (
    <View>
      <TouchableOpacity
        style={[
          styles.pickerBtn,
          { borderColor: colors.cardBorder, backgroundColor: colors.inputBg || colors.cardBorder },
        ]}
        onPress={() => setOpen((p) => !p)}
        activeOpacity={0.7}
      >
        <Text style={[styles.pickerBtnText, { color: colors.primaryIndigo }]}>
          {selected?.label ?? value}
        </Text>
        <ChevronDown size={16} color={colors.primaryIndigo} />
      </TouchableOpacity>
      {open && (
        <View
          style={[
            styles.pickerDropdown,
            { backgroundColor: colors.surface, borderColor: colors.cardBorder },
          ]}
        >
          {VISIBILITY_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={[
                styles.pickerOption,
                opt.value === value && { backgroundColor: 'rgba(99,102,241,0.10)' },
              ]}
              onPress={() => {
                onChange(opt.value);
                setOpen(false);
              }}
            >
              <Text
                style={[
                  styles.pickerOptionText,
                  { color: opt.value === value ? colors.primaryIndigo : colors.textPrimary },
                ]}
              >
                {opt.label}
              </Text>
              {opt.value === value && <ChevronRight size={14} color={colors.primaryIndigo} />}
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
};

export const PrivacySettingsScreen: React.FC<Props> = ({ navigation }) => {
  const { themeMode, colors } = useTheme();
  const token = useSelector((state: RootState) => state.auth.token);

  const [settings, setSettings] = useState<PrivacySettings>({
    lastSeenVisibility: 'EVERYONE',
    profilePhotoVis: 'EVERYONE',
    aboutVisibility: 'EVERYONE',
    readReceipts: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Load from backend on mount
  useEffect(() => {
    if (!token) return;
    apiService
      .getUserSettings(token)
      .then((data) => {
        if (data) {
          setSettings({
            lastSeenVisibility: (data.lastSeenVisibility as Visibility) ?? 'EVERYONE',
            profilePhotoVis: (data.profilePhotoVis as Visibility) ?? 'EVERYONE',
            aboutVisibility: (data.aboutVisibility as Visibility) ?? 'EVERYONE',
            readReceipts: data.readReceipts ?? true,
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  // Auto-save whenever settings change (debounced 600ms)
  const saveSettings = useCallback(
    async (updated: PrivacySettings) => {
      if (!token) return;
      setSaving(true);
      try {
        await apiService.updateUserSettings(token, {
          readReceipts: updated.readReceipts,
          lastSeenVisibility: updated.lastSeenVisibility,
          profilePhotoVis: updated.profilePhotoVis,
          aboutVisibility: updated.aboutVisibility,
        });
        setSavedAt(Date.now());
      } catch (_) {}
      setSaving(false);
    },
    [token],
  );

  const update = useCallback(
    (patch: Partial<PrivacySettings>) => {
      const next = { ...settings, ...patch };
      setSettings(next);
      saveSettings(next);
    },
    [settings, saveSettings],
  );

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.bg }]}
      edges={['top', 'bottom', 'left', 'right']}
    >
      <StatusBar
        barStyle={themeMode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.bg}
      />

      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.bg }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
        >
          <ArrowLeft size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Privacy</Text>
        {saving ? (
          <ActivityIndicator size="small" color={colors.primaryIndigo} style={{ marginRight: 4 }} />
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
          {/* ── Last Seen & Online ─── */}
          <View
            style={[
              styles.sectionCard,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            <View style={styles.settingRow}>
              <View style={[styles.iconBox, { backgroundColor: 'rgba(99,102,241,0.12)' }]}>
                <Clock size={20} color={colors.primaryIndigo} />
              </View>
              <View style={styles.settingTextCol}>
                <Text style={[styles.settingTitle, { color: colors.textPrimary }]}>
                  Last Seen & Online
                </Text>
                <Text style={[styles.settingDesc, { color: colors.textSecondary }]}>
                  Who can see when you were last active
                </Text>
              </View>
            </View>
            <VisibilityPicker
              value={settings.lastSeenVisibility}
              onChange={(v) => update({ lastSeenVisibility: v })}
              colors={colors}
            />
            <Text style={[styles.hint, { color: colors.textSecondary }]}>
              If you disable Last Seen, you will not be able to see others' Last Seen.
            </Text>
          </View>

          {/* ── Profile Photo ─── */}
          <View
            style={[
              styles.sectionCard,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            <View style={styles.settingRow}>
              <View style={[styles.iconBox, { backgroundColor: 'rgba(16,185,129,0.12)' }]}>
                <Eye size={20} color="#10B981" />
              </View>
              <View style={styles.settingTextCol}>
                <Text style={[styles.settingTitle, { color: colors.textPrimary }]}>
                  Profile Photo
                </Text>
                <Text style={[styles.settingDesc, { color: colors.textSecondary }]}>
                  Who can see your profile picture
                </Text>
              </View>
            </View>
            <VisibilityPicker
              value={settings.profilePhotoVis}
              onChange={(v) => update({ profilePhotoVis: v })}
              colors={colors}
            />
          </View>

          {/* ── Read Receipts ─── */}
          <View
            style={[
              styles.sectionCard,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            <View style={[styles.settingRow, { alignItems: 'center' }]}>
              <View style={[styles.iconBox, { backgroundColor: 'rgba(59,130,246,0.12)' }]}>
                <CheckCheck size={20} color="#3B82F6" />
              </View>
              <View style={[styles.settingTextCol, { flex: 1 }]}>
                <Text style={[styles.settingTitle, { color: colors.textPrimary }]}>
                  Read Receipts
                </Text>
                <Text style={[styles.settingDesc, { color: colors.textSecondary }]}>
                  Show blue ticks when you've read messages
                </Text>
              </View>
              <Switch
                value={settings.readReceipts}
                onValueChange={(v) => update({ readReceipts: v })}
                thumbColor={settings.readReceipts ? colors.primaryIndigo : '#94A3B8'}
                trackColor={{ false: '#374151', true: 'rgba(99,102,241,0.35)' }}
              />
            </View>
            {!settings.readReceipts && (
              <Text style={[styles.hint, { color: '#F59E0B' }]}>
                ⚠ When off, you won't be able to see read receipts from others either.
              </Text>
            )}
          </View>

          {/* ── About ─── */}
          <View
            style={[
              styles.sectionCard,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            <View style={styles.settingRow}>
              <View style={[styles.iconBox, { backgroundColor: 'rgba(168,85,247,0.12)' }]}>
                <Lock size={20} color="#A855F7" />
              </View>
              <View style={[styles.settingTextCol, { flex: 1 }]}>
                <Text style={[styles.settingTitle, { color: colors.textPrimary }]}>About</Text>
                <Text style={[styles.settingDesc, { color: colors.textSecondary }]}>
                  Who can see your "About" bio text
                </Text>
              </View>
            </View>
            <VisibilityPicker
              value={settings.aboutVisibility}
              onChange={(v) => update({ aboutVisibility: v })}
              colors={colors}
            />
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
  savedLabel: { fontSize: 12, fontWeight: '700', marginRight: 4 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, gap: 12 },
  sectionCard: {
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    gap: 10,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingTextCol: { flex: 1 },
  settingTitle: { fontSize: 16, fontWeight: '700' },
  settingDesc: { fontSize: 12, marginTop: 2, lineHeight: 16 },
  hint: { fontSize: 12, lineHeight: 16, paddingHorizontal: 4 },
  // Picker
  pickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  pickerBtnText: { fontSize: 14, fontWeight: '700' },
  pickerDropdown: {
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 4,
    overflow: 'hidden',
  },
  pickerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  pickerOptionText: { fontSize: 14, fontWeight: '600' },
});
