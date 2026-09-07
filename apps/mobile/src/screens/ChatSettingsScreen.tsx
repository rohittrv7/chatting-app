/**
 * ChatSettingsScreen — Appearance & Chat Settings
 *
 * Features:
 * - Theme toggle (Dark/Light) — persisted via ThemeContext + backend
 * - Font size selector (Small/Normal/Large) — persisted locally
 * - Chat Wallpaper placeholder
 */

import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StatusBar, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useTheme } from '../context/ThemeContext';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import { apiService } from '../services/apiService';
import { safeStorage } from '../services/storageHelper';
import { ArrowLeft, Check, Moon, Sun, Type } from 'lucide-react-native';

type Props = NativeStackScreenProps<RootStackParamList, 'ChatSettings'>;

type FontSizeOption = 'small' | 'normal' | 'large';
const FONT_SIZE_KEY = '@chat_font_size';

const FONT_SIZES: { label: string; value: FontSizeOption; size: number }[] = [
  { label: 'Small', value: 'small', size: 13 },
  { label: 'Normal', value: 'normal', size: 15 },
  { label: 'Large', value: 'large', size: 18 },
];

export const ChatSettingsScreen: React.FC<Props> = ({ navigation }) => {
  const { themeMode, colors, setThemeMode } = useTheme();
  const token = useSelector((state: RootState) => state.auth.token);
  const [fontSize, setFontSizeState] = useState<FontSizeOption>('normal');

  // Load persisted font size
  useEffect(() => {
    safeStorage.getItem(FONT_SIZE_KEY).then((v) => {
      if (v === 'small' || v === 'normal' || v === 'large') setFontSizeState(v);
    });
  }, []);

  const handleThemeChange = (mode: 'dark' | 'light') => {
    setThemeMode(mode);
    // Persist to backend so the theme setting is synced across devices
    if (token) {
      apiService.updateUserSettings(token, { theme: mode }).catch(() => {});
    }
  };

  const handleFontSize = (value: FontSizeOption) => {
    setFontSizeState(value);
    safeStorage.setItem(FONT_SIZE_KEY, value);
    // Font size is a local-only preference — no backend sync needed
  };

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
        <Text style={[styles.title, { color: colors.textPrimary }]}>Chat & Appearance</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* ── Theme ───────────────────────────────────────────────── */}
        <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>APP THEME</Text>

        <TouchableOpacity
          style={[
            styles.themeCard,
            { backgroundColor: colors.surface },
            themeMode === 'dark'
              ? { borderColor: colors.primaryIndigo, borderWidth: 2 }
              : { borderColor: colors.cardBorder, borderWidth: 1 },
          ]}
          activeOpacity={0.8}
          onPress={() => handleThemeChange('dark')}
        >
          <View style={[styles.themeIconBox, { backgroundColor: '#0A0A0A' }]}>
            <Moon size={22} color="#6366F1" />
          </View>
          <View style={styles.themeTextCol}>
            <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Dark Mode</Text>
            <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>
              Pure black — best for OLED screens
            </Text>
          </View>
          {themeMode === 'dark' && (
            <View style={[styles.checkCircle, { backgroundColor: colors.primaryIndigo }]}>
              <Check size={14} color="#FFF" />
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.themeCard,
            { backgroundColor: colors.surface },
            themeMode === 'light'
              ? { borderColor: colors.primaryIndigo, borderWidth: 2 }
              : { borderColor: colors.cardBorder, borderWidth: 1 },
          ]}
          activeOpacity={0.8}
          onPress={() => handleThemeChange('light')}
        >
          <View style={[styles.themeIconBox, { backgroundColor: '#EDE9FE' }]}>
            <Sun size={22} color="#6366F1" />
          </View>
          <View style={styles.themeTextCol}>
            <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Light Mode</Text>
            <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>
              High contrast for bright environments
            </Text>
          </View>
          {themeMode === 'light' && (
            <View style={[styles.checkCircle, { backgroundColor: colors.primaryIndigo }]}>
              <Check size={14} color="#FFF" />
            </View>
          )}
        </TouchableOpacity>

        {/* ── Font Size ────────────────────────────────────────────── */}
        <Text style={[styles.sectionHeader, { color: colors.textSecondary, marginTop: 24 }]}>
          FONT SIZE
        </Text>

        <View
          style={[
            styles.fontSizeCard,
            { backgroundColor: colors.surface, borderColor: colors.cardBorder },
          ]}
        >
          <View style={styles.fontSizeHeader}>
            <View style={[styles.iconBox, { backgroundColor: 'rgba(99,102,241,0.12)' }]}>
              <Type size={20} color={colors.primaryIndigo} />
            </View>
            <View style={{ marginLeft: 12, flex: 1 }}>
              <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Chat Font Size</Text>
              <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>
                Controls text size inside chat bubbles
              </Text>
            </View>
          </View>

          {/* Preview */}
          <View
            style={[
              styles.fontPreviewBox,
              { backgroundColor: colors.bg, borderColor: colors.cardBorder },
            ]}
          >
            <Text
              style={{
                fontSize: FONT_SIZES.find((f) => f.value === fontSize)?.size ?? 15,
                color: colors.textPrimary,
                fontWeight: '500',
              }}
            >
              Hey! This is how your chat messages will look. 👋
            </Text>
          </View>

          {/* Size chips */}
          <View style={styles.fontChipsRow}>
            {FONT_SIZES.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[
                  styles.fontChip,
                  {
                    backgroundColor:
                      fontSize === opt.value ? colors.primaryIndigo : colors.cardBorder,
                    borderColor: fontSize === opt.value ? colors.primaryIndigo : colors.cardBorder,
                  },
                ]}
                onPress={() => handleFontSize(opt.value)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.fontChipText,
                    { color: fontSize === opt.value ? '#FFF' : colors.textSecondary },
                  ]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </ScrollView>
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
  scroll: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 },
  sectionHeader: { fontSize: 12, fontWeight: '700', marginBottom: 10, letterSpacing: 0.5 },
  themeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
  },
  themeIconBox: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  themeTextCol: { flex: 1, marginLeft: 12 },
  checkCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fontSizeCard: { borderRadius: 18, padding: 16, borderWidth: 1, gap: 14 },
  fontSizeHeader: { flexDirection: 'row', alignItems: 'center' },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fontPreviewBox: {
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
  },
  fontChipsRow: { flexDirection: 'row', gap: 10 },
  fontChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
  },
  fontChipText: { fontSize: 14, fontWeight: '700' },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  cardDesc: { fontSize: 12, marginTop: 2 },
});
