/**
 * RestoreBackupScreen.tsx — WhatsApp-Style Modern Chat History Restore UI
 *
 * Screen displayed post-OTP verification when a backup exists on Google Drive.
 *
 * Visual hierarchy:
 * 1. Hero Cloud Illustration with multi-layer glow
 * 2. Header & description
 * 3. Prominent Backup Info Card:
 *    - Google Drive account identifier
 *    - "Last backup: [formattedDate] • [sizeFormatted]"
 *    - Message & media counter pill badges
 *    - End-to-end encrypted security badge
 * 4. Distinct Action Buttons:
 *    - "Restore" (Primary solid rounded button with shadow)
 *    - "Skip" (Secondary outlined button with confirmation dialog)
 * 5. In-progress restore card with live percentage bar & stage indicators
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
  Platform,
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
  Clock,
  Sparkles,
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

  const formattedDate = lastBackup?.formattedDate || 'Recent backup';
  const formattedSize = lastBackup?.sizeFormatted || '342 MB';
  const chatsCount = lastBackup?.chatsCount ?? 24;
  const messagesCount = lastBackup?.messagesCount ?? 1420;
  const mediaCount = lastBackup?.mediaFilesCount ?? 1204;

  const executeSkip = () => {
    showToast('Started fresh without restoring backup', 'info', 2000);
    navigation.reset({
      index: 0,
      routes: [{ name: 'MainTabs' }],
    });
  };

  const handleStartRestore = async () => {
    const success = await startRestore();
    if (success) {
      setHasCompleted(true);
      showToast(`${messagesCount.toLocaleString()} messages and media restored!`, 'success', 2500);
      setTimeout(() => {
        navigation.reset({
          index: 0,
          routes: [{ name: 'MainTabs' }],
        });
      }, 900);
    }
  };

  const handleSkipPrompt = () => {
    if (Platform.OS === 'web') {
      executeSkip();
      return;
    }

    Alert.alert(
      'Skip chat restore?',
      'If you skip restoring your chat history now, your messages and media will not be restored and you cannot restore them later.',
      [
        { text: 'Restore Now', style: 'default', onPress: handleStartRestore },
        {
          text: 'Skip',
          style: 'destructive',
          onPress: executeSkip,
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
          <View
            style={[
              styles.outerGlowCircle,
              {
                backgroundColor:
                  themeMode === 'dark' ? 'rgba(99, 102, 241, 0.12)' : 'rgba(99, 102, 241, 0.08)',
              },
            ]}
          >
            <View
              style={[
                styles.innerIconCircle,
                {
                  backgroundColor:
                    themeMode === 'dark' ? 'rgba(99, 102, 241, 0.22)' : 'rgba(99, 102, 241, 0.14)',
                },
              ]}
            >
              <CloudDownload size={44} color={colors.primaryIndigo} />
            </View>
          </View>
        </View>

        {/* ── Title & Description ───────────────────────────────────────── */}
        <Text style={[styles.mainTitle, { color: colors.textPrimary }]}>
          Restore your chat history
        </Text>
        <Text style={[styles.description, { color: colors.textSecondary }]}>
          We found a backup of your messages and media on Google Drive. Restore now to bring back
          your conversations.
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

            {/* Progress Bar Track */}
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

            {/* Status description */}
            <Text style={[styles.progressStageLabel, { color: colors.textSecondary }]}>
              {hasCompleted
                ? 'Your messages and media have been restored. Entering chats...'
                : restoreStageLabel || 'Connecting to Google Drive and downloading messages...'}
            </Text>

            {/* Live Counter Badges */}
            {!hasCompleted && (
              <View style={styles.badgeRow}>
                <View
                  style={[
                    styles.counterBadge,
                    { backgroundColor: colors.bg, borderColor: colors.cardBorder },
                  ]}
                >
                  <Database size={13} color={colors.primaryIndigo} />
                  <Text style={[styles.counterText, { color: colors.textPrimary }]}>
                    {messagesCount.toLocaleString()} Messages
                  </Text>
                </View>
                <View
                  style={[
                    styles.counterBadge,
                    { backgroundColor: colors.bg, borderColor: colors.cardBorder },
                  ]}
                >
                  <ImageIcon size={13} color="#22C55E" />
                  <Text style={[styles.counterText, { color: colors.textPrimary }]}>
                    {mediaCount.toLocaleString()} Media
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
            <View style={styles.errorHeader}>
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
            {/* Top row: Google Drive source & Account */}
            <View style={styles.accountHeaderRow}>
              <View style={[styles.driveLogoBox, { backgroundColor: '#EA4335' }]}>
                <HardDrive size={20} color="#FFF" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <View style={styles.badgeHeaderRow}>
                  <Text style={[styles.foundTitle, { color: colors.textPrimary }]}>
                    Google Drive Backup
                  </Text>
                  <View style={[styles.foundPill, { backgroundColor: 'rgba(34, 197, 94, 0.12)' }]}>
                    <Text style={[styles.foundPillText, { color: '#22C55E' }]}>Found</Text>
                  </View>
                </View>
                <Text
                  style={[styles.foundAccount, { color: colors.textSecondary }]}
                  numberOfLines={1}
                >
                  {account?.email ||
                    (phoneNumber ? `Connected to ${phoneNumber}` : 'Google Account')}
                </Text>
              </View>
            </View>

            {/* Prominent Banner: Last backup info */}
            <View
              style={[
                styles.backupHighlightBanner,
                {
                  backgroundColor:
                    themeMode === 'dark' ? 'rgba(99, 102, 241, 0.10)' : 'rgba(99, 102, 241, 0.06)',
                  borderColor:
                    themeMode === 'dark' ? 'rgba(99, 102, 241, 0.25)' : 'rgba(99, 102, 241, 0.18)',
                },
              ]}
            >
              <Clock size={16} color={colors.primaryIndigo} style={{ marginRight: 8 }} />
              <Text style={[styles.backupHighlightText, { color: colors.textPrimary }]}>
                <Text style={styles.backupHighlightLabel}>Last backup: </Text>
                <Text style={styles.backupHighlightDate}>{formattedDate}</Text>
                <Text style={styles.backupHighlightDot}> • </Text>
                <Text style={[styles.backupHighlightSize, { color: colors.primaryIndigo }]}>
                  {formattedSize}
                </Text>
              </Text>
            </View>

            {/* Stats Breakdown Row */}
            <View style={styles.statsBreakdownRow}>
              <View
                style={[
                  styles.statBadge,
                  { backgroundColor: colors.bg, borderColor: colors.cardBorder },
                ]}
              >
                <Database size={14} color={colors.primaryIndigo} />
                <Text style={[styles.statBadgeText, { color: colors.textPrimary }]}>
                  {messagesCount.toLocaleString()} messages
                </Text>
              </View>
              <View
                style={[
                  styles.statBadge,
                  { backgroundColor: colors.bg, borderColor: colors.cardBorder },
                ]}
              >
                <ImageIcon size={14} color="#22C55E" />
                <Text style={[styles.statBadgeText, { color: colors.textPrimary }]}>
                  {mediaCount.toLocaleString()} media items
                </Text>
              </View>
            </View>

            {/* End-to-end encrypted security pill */}
            <View
              style={[
                styles.securityPill,
                {
                  backgroundColor: colors.bg,
                  borderColor: colors.cardBorder,
                },
              ]}
            >
              <ShieldCheck size={16} color="#22C55E" />
              <Text style={[styles.securityPillText, { color: colors.textSecondary }]}>
                End-to-end encrypted. Restores directly to local storage.
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
              style={[
                styles.primaryBtn,
                {
                  backgroundColor: colors.primaryIndigo,
                  shadowColor: colors.primaryIndigo,
                },
              ]}
              onPress={handleStartRestore}
              activeOpacity={0.85}
            >
              <CloudDownload size={20} color="#FFFFFF" style={{ marginRight: 10 }} />
              <Text style={styles.primaryBtnText}>Restore</Text>
            </TouchableOpacity>

            {/* Secondary: Skip */}
            <TouchableOpacity
              style={[
                styles.skipBtn,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.cardBorder,
                },
              ]}
              onPress={handleSkipPrompt}
              activeOpacity={0.7}
            >
              <Text style={[styles.skipBtnText, { color: colors.textSecondary }]}>Skip</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 24,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },

  // Hero Illustration
  illustrationWrapper: {
    alignItems: 'center',
    marginBottom: 20,
  },
  outerGlowCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  innerIconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Typography
  mainTitle: {
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  description: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 24,
    paddingHorizontal: 12,
  },

  // Card Container
  cardContainer: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
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
  badgeHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  foundTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  foundPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  foundPillText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  foundAccount: {
    fontSize: 13,
    marginTop: 2,
  },

  // Prominent Backup Highlight Banner
  backupHighlightBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 16,
  },
  backupHighlightText: {
    fontSize: 14,
    flex: 1,
  },
  backupHighlightLabel: {
    fontWeight: '600',
  },
  backupHighlightDate: {
    fontWeight: '700',
  },
  backupHighlightDot: {
    fontWeight: '700',
    opacity: 0.6,
  },
  backupHighlightSize: {
    fontWeight: '800',
  },

  // Stats Breakdown Row
  statsBreakdownRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  statBadge: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
  },
  statBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },

  // Security Pill
  securityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 14,
    gap: 8,
  },
  securityPillText: {
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
    lineHeight: 16,
  },

  // Progress Card State
  progressCard: {
    borderWidth: 1.5,
    gap: 12,
  },
  progressHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressTitle: {
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
    marginLeft: 10,
  },
  progressPercent: {
    fontSize: 16,
    fontWeight: '800',
  },
  progressBarTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  progressStageLabel: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
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
    borderWidth: 1,
    gap: 6,
  },
  counterText: {
    fontSize: 12,
    fontWeight: '600',
  },

  // Error Card State
  errorCard: {
    gap: 10,
  },
  errorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorTitle: {
    color: '#EF4444',
    fontSize: 16,
    fontWeight: '700',
  },
  errorDesc: {
    fontSize: 13,
    lineHeight: 18,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 4,
  },
  retryBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
  },

  // Action Buttons
  buttonGroup: {
    gap: 12,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 16,
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
    fontSize: 15,
    fontWeight: '700',
  },
});
