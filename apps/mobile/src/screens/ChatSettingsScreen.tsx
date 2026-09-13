/**
 * ChatSettingsScreen — Appearance & Chat Settings
 *
 * Features:
 * - Theme toggle (Dark/Light) — persisted via ThemeContext + backend
 * - Font size selector (Small/Normal/Large) — persisted locally
 * - Chat Wallpaper placeholder
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ScrollView,
  Alert,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useTheme, ChatFontSize } from '../context/ThemeContext';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import { apiService } from '../services/apiService';
import { useBackup } from '../context/BackupContext';
import * as ImagePicker from 'expo-image-picker';
import {
  ArrowLeft,
  Check,
  Moon,
  Sun,
  Type,
  CloudUpload,
  ChevronRight,
  Palette,
  ImagePlus,
  RotateCcw,
} from 'lucide-react-native';

type Props = NativeStackScreenProps<RootStackParamList, 'ChatSettings'>;

const FONT_SIZES: { label: string; value: ChatFontSize; size: number }[] = [
  { label: 'Small', value: 'small', size: 13 },
  { label: 'Normal', value: 'normal', size: 15 },
  { label: 'Large', value: 'large', size: 18 },
];

const WALLPAPER_PRESETS = [
  { name: 'Default', color: null },
  { name: 'Midnight', color: '#0B1014' },
  { name: 'Slate', color: '#0F172A' },
  { name: 'Charcoal', color: '#18181B' },
  { name: 'Emerald', color: '#064E3B' },
  { name: 'Navy', color: '#1E1B4B' },
  { name: 'Wine', color: '#3B0764' },
  { name: 'Espresso', color: '#1C1917' },
  { name: 'Forest', color: '#022C22' },
];

export const ChatSettingsScreen: React.FC<Props> = ({ navigation }) => {
  const {
    themeMode,
    colors,
    setThemeMode,
    chatWallpaper,
    setChatWallpaper,
    chatFontSize,
    setChatFontSize,
  } = useTheme();
  const { lastBackup } = useBackup();
  const token = useSelector((state: RootState) => state.auth.token);

  const handleThemeChange = (mode: 'dark' | 'light') => {
    setThemeMode(mode);
    // Persist to backend so the theme setting is synced across devices
    if (token) {
      apiService.updateUserSettings(token, { theme: mode }).catch(() => {});
    }
  };

  const handlePickGalleryWallpaper = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Needed',
          'Please allow photo library access to select a custom chat wallpaper.',
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.85,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setChatWallpaper(result.assets[0].uri);
      }
    } catch (err) {
      console.warn('[ChatSettings] Failed to pick image', err);
    }
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
                fontSize: FONT_SIZES.find((f) => f.value === chatFontSize)?.size ?? 15,
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
                      chatFontSize === opt.value ? colors.primaryIndigo : colors.cardBorder,
                    borderColor:
                      chatFontSize === opt.value ? colors.primaryIndigo : colors.cardBorder,
                  },
                ]}
                onPress={() => setChatFontSize(opt.value)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.fontChipText,
                    { color: chatFontSize === opt.value ? '#FFF' : colors.textSecondary },
                  ]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── Chat Wallpaper ───────────────────────────────────────── */}
        <Text style={[styles.sectionHeader, { color: colors.textSecondary, marginTop: 24 }]}>
          CHAT WALLPAPER
        </Text>

        <View
          style={[
            styles.wallpaperCard,
            { backgroundColor: colors.surface, borderColor: colors.cardBorder },
          ]}
        >
          <View style={styles.wallpaperHeader}>
            <View style={[styles.iconBox, { backgroundColor: 'rgba(99,102,241,0.12)' }]}>
              <Palette size={20} color={colors.primaryIndigo} />
            </View>
            <View style={{ marginLeft: 12, flex: 1 }}>
              <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Wallpaper Theme</Text>
              <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>
                Choose a color preset or select a custom image
              </Text>
            </View>
          </View>

          {/* Current Wallpaper Preview / Status */}
          <View
            style={[
              styles.wallpaperPreviewBox,
              {
                backgroundColor: chatWallpaper
                  ? chatWallpaper.startsWith('#')
                    ? chatWallpaper
                    : 'transparent'
                  : colors.bg,
                borderColor: colors.cardBorder,
              },
            ]}
          >
            {chatWallpaper && !chatWallpaper.startsWith('#') ? (
              <Image
                source={{ uri: chatWallpaper }}
                style={StyleSheet.absoluteFill}
                resizeMode="cover"
              />
            ) : null}
            <View style={styles.wallpaperPreviewOverlay}>
              <Text style={styles.wallpaperPreviewText}>
                {chatWallpaper
                  ? chatWallpaper.startsWith('#')
                    ? `Preset: ${WALLPAPER_PRESETS.find((p) => p.color === chatWallpaper)?.name || chatWallpaper}`
                    : 'Custom Image Wallpaper'
                  : 'Default Dark Background'}
              </Text>
            </View>
          </View>

          {/* Color Presets Palette */}
          <Text style={[styles.presetSubtitle, { color: colors.textSecondary }]}>
            CURATED COLOR PRESETS
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.presetsRow}
          >
            {WALLPAPER_PRESETS.map((preset) => {
              const isSelected = chatWallpaper === preset.color;
              return (
                <TouchableOpacity
                  key={preset.name}
                  style={[
                    styles.presetItem,
                    isSelected && { borderColor: colors.primaryIndigo, borderWidth: 2 },
                  ]}
                  onPress={() => setChatWallpaper(preset.color)}
                  activeOpacity={0.8}
                >
                  <View
                    style={[
                      styles.presetCircle,
                      {
                        backgroundColor:
                          preset.color || (themeMode === 'dark' ? '#0B1014' : '#F8FAFC'),
                        borderColor: colors.cardBorder,
                      },
                    ]}
                  >
                    {isSelected && (
                      <Check size={14} color={preset.color === '#F8FAFC' ? '#000' : '#FFF'} />
                    )}
                  </View>
                  <Text
                    style={[
                      styles.presetName,
                      { color: isSelected ? colors.primaryIndigo : colors.textSecondary },
                    ]}
                    numberOfLines={1}
                  >
                    {preset.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Gallery Button & Reset Action */}
          <View style={styles.wallpaperActionsRow}>
            <TouchableOpacity
              style={[styles.galleryPickBtn, { borderColor: colors.primaryIndigo }]}
              onPress={handlePickGalleryWallpaper}
              activeOpacity={0.7}
            >
              <ImagePlus size={18} color={colors.primaryIndigo} />
              <Text style={[styles.galleryPickText, { color: colors.primaryIndigo }]}>
                Choose from Gallery
              </Text>
            </TouchableOpacity>

            {chatWallpaper !== null && (
              <TouchableOpacity
                style={[styles.resetWallpaperBtn, { borderColor: colors.cardBorder }]}
                onPress={() => setChatWallpaper(null)}
                activeOpacity={0.7}
              >
                <RotateCcw size={16} color={colors.textSecondary} />
                <Text style={[styles.resetWallpaperText, { color: colors.textSecondary }]}>
                  Reset
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* ── Chat Backup ─────────────────────────────────────────── */}
        <Text style={[styles.sectionHeader, { color: colors.textSecondary, marginTop: 24 }]}>
          BACKUP & RESTORE
        </Text>

        <TouchableOpacity
          style={[
            styles.backupCard,
            { backgroundColor: colors.surface, borderColor: colors.cardBorder },
          ]}
          activeOpacity={0.7}
          onPress={() => navigation.navigate('ChatBackup')}
        >
          <View style={[styles.backupIconBox, { backgroundColor: 'rgba(99,102,241,0.12)' }]}>
            <CloudUpload size={22} color={colors.primaryIndigo} />
          </View>
          <View style={{ marginLeft: 12, flex: 1 }}>
            <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Chat backup</Text>
            <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>
              {lastBackup
                ? `Last backup: ${lastBackup.formattedDate} (${lastBackup.sizeFormatted})`
                : 'Back up messages and media to Google Drive'}
            </Text>
          </View>
          <ChevronRight size={18} color={colors.textSecondary} />
        </TouchableOpacity>
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
  wallpaperCard: { borderRadius: 18, padding: 16, borderWidth: 1, gap: 14 },
  wallpaperHeader: { flexDirection: 'row', alignItems: 'center' },
  wallpaperPreviewBox: {
    height: 70,
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  wallpaperPreviewOverlay: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 12,
  },
  wallpaperPreviewText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
  },
  presetSubtitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  presetsRow: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 4,
  },
  presetItem: {
    alignItems: 'center',
    padding: 4,
    borderRadius: 12,
  },
  presetCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  presetName: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },
  wallpaperActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 6,
  },
  galleryPickBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    backgroundColor: 'rgba(99,102,241,0.06)',
    gap: 8,
  },
  galleryPickText: {
    fontSize: 13,
    fontWeight: '700',
  },
  resetWallpaperBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
  },
  resetWallpaperText: {
    fontSize: 13,
    fontWeight: '600',
  },
  backupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
  },
  backupIconBox: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  cardDesc: { fontSize: 12, marginTop: 2 },
});
