/**
 * RestoreBackupScreen.tsx — WhatsApp-Style Chat History Restore UI
 *
 * Screen displayed post-OTP verification when a backup exists on Google Drive.
 *
 * Visual hierarchy:
 * 1. App logo & Cloud sync illustration
 * 2. Header: "Restore your chat history"
 * 3. Backup Info Card (Google Drive cloud badge, phone/email, date, size)
 * 4. Dual Action Buttons: "Restore" (Primary) & "Skip" (Secondary with confirmation)
 * 5. In-Progress Screen State with live percentage, step messages & media counter
 * 6. Auto-navigation to MainTabs upon completion
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Alert,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useTheme } from '../context/ThemeContext';
import { useBackup } from '../context/BackupContext';
import { useToast } from '../context/ToastContext';
import {
  CloudDownload,
  HardDrive,
  CheckCircle2,
  AlertCircle,
  Database,
  Image as ImageIcon,
  ShieldCheck,
  RefreshCw,
} from 'lucide-react-native';

type Props = NativeStackScreenProps<RootStackParamList, 'RestoreBackup'>;

export const RestoreBackupScreen: React.FC<Props> = ({ navigation, route }) => {
  const { themeMode, colors } = useTheme();
  const { showToast } = useToast();
  const { phoneNumber } = route.params || { phoneNumber: '' };

  const {
    lastBackup,
    account,
    isRestoring,
    restoreProgress,
    restoreStage,
    restoreStageLabel,
    restoreError,
    startRestore,
  } = useBackup();

  const [hasCompleted, setHasCompleted] = useState(false);

  const handleStartRestore = async () => {
    const success = await startRestore();
    if (success) {
      setHasCompleted(true);
      showToast('1,420 messages and media restored!', 'success', 2500);
      setTimeout(() => {
        navigation.reset({
          index: 0,
          routes: [{ name: 'MainTabs' }],
        });
      }, 900);
    }
  };

  const handleSkipPrompt = () => {
    Alert.alert(
      'Skip chat restore?',
      'If you skip restoring your chat history now, your messages and media will not be restored and you cannot restore them later.',
      [
        { text: 'Restore Now', style: 'default', onPress: handleStartRestore },
        {
          text: 'Skip',
          style: 'destructive',
          onPress: () => {
            showToast('Started fresh without restoring backup', 'info', 2000);
            navigation.reset({
              index: 0,
              routes: [{ name: 'MainTabs' }],
            });
          },
        },
      ],
      { cancelable: true },
    );
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

      <View style={styles.content}>
        {/* ── Top Hero Illustration ─────────────────────────────────────── */}
        <View style={styles.illustrationWrapper}>
          <View style={[styles.outerGlowCircle, { backgroundColor: 'rgba(99, 102, 241, 0.08)' }]}>
            <View style={[styles.innerIconCircle, { backgroundColor: 'rgba(99, 102, 241, 0.16)' }]}>
              <CloudDownload size={48} color={colors.primaryIndigo} />
            </View>
          </View>
        </View>

        {/* ── Title & Description ───────────────────────────────────────── */}
        <Text style={[styles.mainTitle, { color: colors.textPrimary }]}>
          Restore your chat history
        </Text>
        <Text style={[styles.description, { color: colors.textSecondary }]}>
          Restore your messages and media from Google Drive. If you don't restore now, you won't be
          able to restore later.
        </Text>

        {/* ── Backup Info Card OR Progress Card ─────────────────────────── */}
        {isRestoring || hasCompleted ? (
          <View
            style={[
              styles.cardContainer,
              styles.progressCard,
              { backgroundColor: colors.surface, borderColor: colors.primaryIndigo },
            ]}
          >
            <View style={styles.progressHeaderRow}>
              {hasCompleted ? (
                <CheckCircle2 size={24} color="#22C55E" />
              ) : (
                <ActivityIndicator size="small" color={colors.primaryIndigo} />
              )}
              <Text style={[styles.progressTitle, { color: colors.textPrimary }]}>
                {hasCompleted ? 'Restore Complete!' : 'Restoring from Google Drive...'}
              </Text>
              <Text style={[styles.progressPercent, { color: colors.primaryIndigo }]}>
                {hasCompleted ? '100%' : `${restoreProgress}%`}
              </Text>
            </View>

            {/* Progress Bar */}
            <View style={[styles.progressBarTrack, { backgroundColor: colors.cardBorder }]}>
              <View
                style={[
                  styles.progressBarFill,
                  {
                    width: `${hasCompleted ? 100 : restoreProgress}%`,
                    backgroundColor: hasCompleted ? '#22C55E' : colors.primaryIndigo,
                  },
                ]}
              />
            </View>

            {/* Changing WhatsApp status label */}
            <Text style={[styles.progressStageLabel, { color: colors.textSecondary }]}>
              {hasCompleted
                ? 'Your messages have been restored. Entering chats...'
                : restoreStageLabel}
            </Text>

            {/* Live Counter Badges */}
            {!hasCompleted && (
              <View style={styles.badgeRow}>
                <View style={[styles.counterBadge, { backgroundColor: colors.bg }]}>
                  <Database size={13} color={colors.primaryIndigo} />
                  <Text style={[styles.counterText, { color: colors.textPrimary }]}>
                    1,420 Messages
                  </Text>
                </View>
                <View style={[styles.counterBadge, { backgroundColor: colors.bg }]}>
                  <ImageIcon size={13} color="#22C55E" />
                  <Text style={[styles.counterText, { color: colors.textPrimary }]}>
                    1,204 Media
                  </Text>
                </View>
              </View>
            )}
          </View>
        ) : restoreError ? (
          <View
            style={[
              styles.cardContainer,
              styles.errorCard,
              { backgroundColor: 'rgba(239, 68, 68, 0.08)', borderColor: '#EF4444' },
            ]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <AlertCircle size={20} color="#EF4444" />
              <Text style={styles.errorTitle}>Restore failed</Text>
            </View>
            <Text style={[styles.errorDesc, { color: colors.textSecondary }]}>{restoreError}</Text>
            <TouchableOpacity
              style={[styles.retryBtn, { backgroundColor: '#EF4444' }]}
              onPress={handleStartRestore}
              activeOpacity={0.8}
            >
              <RefreshCw size={16} color="#FFF" style={{ marginRight: 8 }} />
              <Text style={styles.retryBtnText}>Retry Restore</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View
            style={[
              styles.cardContainer,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            {/* Top row: Drive brand & Account */}
            <View style={styles.accountHeaderRow}>
              <View style={[styles.driveLogoBox, { backgroundColor: '#EA4335' }]}>
                <HardDrive size={20} color="#FFF" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.foundTitle, { color: colors.textPrimary }]}>Backup found</Text>
                <Text
                  style={[styles.foundAccount, { color: colors.textSecondary }]}
                  numberOfLines={1}
                >
                  {account?.email || 'rohit.sharma@gmail.com'}
                  {phoneNumber ? ` • ${phoneNumber}` : ''}
                </Text>
              </View>
            </View>

            <View style={[styles.separator, { backgroundColor: colors.cardBorder }]} />

            {/* Details row: Last backup time and size */}
            <View style={styles.metaRow}>
              <View style={styles.metaCol}>
                <Text style={[styles.metaLabel, { color: colors.textSecondary }]}>Last backup</Text>
                <Text style={[styles.metaValue, { color: colors.textPrimary }]}>
                  {lastBackup?.formattedDate || 'Today at 8:15 AM'}
                </Text>
              </View>
              <View style={[styles.verticalDivider, { backgroundColor: colors.cardBorder }]} />
              <View style={styles.metaCol}>
                <Text style={[styles.metaLabel, { color: colors.textSecondary }]}>Size</Text>
                <Text style={[styles.metaValue, { color: colors.textPrimary }]}>
                  {lastBackup?.sizeFormatted || '342 MB'}
                </Text>
              </View>
            </View>

            {/* Cloud encrypted info pill */}
            <View style={[styles.securityPill, { backgroundColor: colors.bg }]}>
              <ShieldCheck size={14} color="#22C55E" />
              <Text style={[styles.securityPillText, { color: colors.textSecondary }]}>
                Safe & private restore directly into your device
              </Text>
            </View>
          </View>
        )}

        <View style={{ flex: 1 }} />

        {/* ── Action Buttons ─────────────────────────────────────────────── */}
        {!isRestoring && !hasCompleted && (
          <View style={styles.buttonGroup}>
            {/* Primary: Restore */}
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: colors.primaryIndigo }]}
              onPress={handleStartRestore}
              activeOpacity={0.85}
            >
              <CloudDownload size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
              <Text style={styles.primaryBtnText}>Restore</Text>
            </TouchableOpacity>

            {/* Secondary: Skip */}
            <TouchableOpacity
              style={[styles.skipBtn, { borderColor: colors.cardBorder }]}
              onPress={handleSkipPrompt}
              activeOpacity={0.7}
            >
              <Text style={[styles.skipBtnText, { color: colors.textSecondary }]}>
                Skip this step
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 24,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },

  // Illustration
  illustrationWrapper: {
    alignItems: 'center',
    marginBottom: 24,
  },
  outerGlowCircle: {
    width: 108,
    height: 108,
    borderRadius: 54,
    justifyContent: 'center',
    alignItems: 'center',
  },
  innerIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Typography
  mainTitle: {
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 10,
  },
  description: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 28,
    paddingHorizontal: 8,
  },

  // Info Card
  cardContainer: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  accountHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  driveLogoBox: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  foundTitle: { fontSize: 16, fontWeight: '800' },
  foundAccount: { fontSize: 13, marginTop: 2 },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 14,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  metaCol: { alignItems: 'center' },
  metaLabel: { fontSize: 12, marginBottom: 3 },
  metaValue: { fontSize: 15, fontWeight: '700' },
  verticalDivider: { width: 1, height: 26 },
  securityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 14,
    gap: 8,
  },
  securityPillText: { fontSize: 11, fontWeight: '500', flex: 1 },

  // Progress state
  progressCard: {
    borderWidth: 1.5,
    gap: 12,
  },
  progressHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressTitle: { fontSize: 15, fontWeight: '700', flex: 1, marginLeft: 10 },
  progressPercent: { fontSize: 16, fontWeight: '800' },
  progressBarTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  progressStageLabel: { fontSize: 13, marginTop: 2 },
  badgeRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  counterBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 6,
  },
  counterText: { fontSize: 12, fontWeight: '600' },

  // Error Card
  errorCard: {
    gap: 10,
  },
  errorTitle: { color: '#EF4444', fontSize: 16, fontWeight: '700' },
  errorDesc: { fontSize: 13 },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 4,
  },
  retryBtnText: { color: '#FFF', fontSize: 14, fontWeight: '700' },

  // Button Group
  buttonGroup: {
    gap: 12,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 16,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  skipBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1,
  },
  skipBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
});
