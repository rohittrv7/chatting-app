/**
 * ChatBackupScreen.tsx — WhatsApp-Style Chat Backup & Cloud Sync UI
 *
 * Visual hierarchy:
 * 1. Google Account Card (connected / connect button + bottom sheet account picker)
 * 2. Last Backup Info (Date, Time, Size, Message count, Cloud badge)
 * 3. "Back Up Now" action button with live animated progress and changing stages
 * 4. Backup Settings (Frequency bottom sheet, Network type, Include videos toggle, dynamic summary)
 * 5. Delete Backup (destructive action with confirmation alert)
 * 6. Quick developer testing drawer for simulating failure/restore conditions
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ScrollView,
  Switch,
  Modal,
  Alert,
  ActivityIndicator,
  Animated,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useTheme } from '../context/ThemeContext';
import { useBackup } from '../context/BackupContext';
import {
  MOCK_GOOGLE_ACCOUNTS,
  GoogleAccount,
  BackupFrequency,
  BackupNetworkType,
} from '../services/googleDriveBackupService';
import {
  ArrowLeft,
  Cloud,
  CloudUpload,
  Check,
  CheckCircle2,
  AlertCircle,
  HardDrive,
  Wifi,
  Video,
  Calendar,
  Trash2,
  ChevronRight,
  ShieldCheck,
  RefreshCw,
  Plus,
  UserCheck,
  Image as ImageIcon,
} from 'lucide-react-native';

type Props = NativeStackScreenProps<RootStackParamList, 'ChatBackup'>;

export const ChatBackupScreen: React.FC<Props> = ({ navigation }) => {
  const { themeMode, colors } = useTheme();
  const {
    account,
    lastBackup,
    settings,
    isBackingUp,
    backupProgress,
    backupStageLabel,
    backupError,
    mockFailureMode,
    mockBackupAvailable,
    connectAccount,
    updateSettings,
    startBackup,
    cancelBackup,
    deleteBackup,
    toggleMockFailure,
    toggleMockBackupAvailable,
  } = useBackup();

  // Modals
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showFrequencyModal, setShowFrequencyModal] = useState(false);
  const [showNetworkModal, setShowNetworkModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDevControls, setShowDevControls] = useState(false);

  // Frequency options
  const FREQUENCY_OPTIONS: { label: string; value: BackupFrequency }[] = [
    { label: 'Daily', value: 'daily' },
    { label: 'Weekly', value: 'weekly' },
    { label: 'Monthly', value: 'monthly' },
    { label: 'Only when I tap "Back up"', value: 'manual' },
  ];

  // Network options
  const NETWORK_OPTIONS: { label: string; value: BackupNetworkType; desc: string }[] = [
    { label: 'Wi-Fi only', value: 'wifi', desc: 'Recommended to save mobile data' },
    { label: 'Wi-Fi or cellular', value: 'cellular', desc: 'Back up using any available network' },
  ];

  const handleSelectAccount = async (acc: GoogleAccount) => {
    setShowAccountModal(false);
    await connectAccount(acc);
  };

  const handleSelectFrequency = async (freq: BackupFrequency) => {
    setShowFrequencyModal(false);
    await updateSettings({ frequency: freq });
  };

  const handleSelectNetwork = async (net: BackupNetworkType) => {
    setShowNetworkModal(false);
    await updateSettings({ networkType: net });
  };

  const handleToggleImages = async (val: boolean) => {
    await updateSettings({ includeImages: val });
  };

  const handleToggleVideos = async (val: boolean) => {
    await updateSettings({ includeVideos: val });
  };

  const handleConfirmDelete = () => {
    Alert.alert(
      'Delete backup?',
      'Your messages and media backup will be permanently deleted from Google Drive.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setIsDeleting(true);
            try {
              await deleteBackup();
            } finally {
              setIsDeleting(false);
            }
          },
        },
      ],
      { cancelable: true },
    );
  };

  // Helper summary line
  const mediaParts = [
    settings.includeImages ? 'Photos' : null,
    settings.includeVideos ? 'Videos' : null,
  ].filter(Boolean);
  const mediaSummaryText =
    mediaParts.length > 0 ? `${mediaParts.join(' & ')} included` : 'Media excluded';
  const networkSummaryText =
    settings.networkType === 'wifi' ? 'Wi-Fi only' : 'Wi-Fi or cellular data';
  const summaryLine = `${mediaSummaryText}, ${networkSummaryText}`;

  // 🛡️ Developer Testing Controls:
  // Strictly hidden in production/release builds via __DEV__ check,
  // and collapsed by default in development to avoid cluttering normal UI.
  const renderDeveloperControls = () => {
    if (!__DEV__) {
      return null;
    }

    return (
      <View
        style={[styles.devBox, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}
      >
        <TouchableOpacity
          style={styles.devHeaderToggle}
          onPress={() => setShowDevControls((prev) => !prev)}
          activeOpacity={0.7}
        >
          <Text style={[styles.devTitle, { color: colors.textSecondary }]}>
            🛠️ DEVELOPER TESTING CONTROLS (DEBUG ONLY)
          </Text>
          <Text style={[styles.devToggleHint, { color: colors.primaryIndigo }]}>
            {showDevControls ? 'Hide ▲' : 'Show ▼'}
          </Text>
        </TouchableOpacity>

        {showDevControls && (
          <View style={{ marginTop: 12 }}>
            <View style={styles.devRow}>
              <Text style={[styles.devLabel, { color: colors.textPrimary }]}>
                Simulate Failure on Backup
              </Text>
              <Switch
                value={mockFailureMode}
                onValueChange={toggleMockFailure}
                trackColor={{ false: colors.cardBorder, true: '#EF4444' }}
                thumbColor="#FFF"
              />
            </View>

            <View style={[styles.rowSeparator, { backgroundColor: colors.cardBorder }]} />

            <View style={styles.devRow}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={[styles.devLabel, { color: colors.textPrimary }]}>
                  Backup Exists for Restore Screen
                </Text>
                <Text style={[styles.devSubLabel, { color: colors.textSecondary }]}>
                  {mockBackupAvailable
                    ? 'Screen 2 will appear after OTP login'
                    : 'Screen 2 will be SKIPPED after OTP (Screen 3)'}
                </Text>
              </View>
              <Switch
                value={mockBackupAvailable}
                onValueChange={toggleMockBackupAvailable}
                trackColor={{ false: colors.cardBorder, true: '#22C55E' }}
                thumbColor="#FFF"
              />
            </View>
          </View>
        )}
      </View>
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

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <View style={[styles.header, { backgroundColor: colors.bg }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
          activeOpacity={0.7}
        >
          <ArrowLeft size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Chat backup</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ── Top Hero Card / Last Backup Info ───────────────────────────── */}
        <View
          style={[
            styles.heroCard,
            { backgroundColor: colors.surface, borderColor: colors.cardBorder },
          ]}
        >
          <View style={styles.heroTopRow}>
            <View style={[styles.cloudIconBox, { backgroundColor: 'rgba(99, 102, 241, 0.12)' }]}>
              <CloudUpload size={28} color={colors.primaryIndigo} />
            </View>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={[styles.heroHeading, { color: colors.textPrimary }]}>
                {lastBackup ? 'Last Backup' : 'No Backup Yet'}
              </Text>
              <Text style={[styles.heroSubheading, { color: colors.textSecondary }]}>
                {lastBackup
                  ? `${lastBackup.formattedDate} • ${lastBackup.sizeFormatted}`
                  : 'Back up your chat history to Google Drive'}
              </Text>
            </View>
          </View>

          {lastBackup && (
            <View
              style={[
                styles.statsRow,
                { borderTopColor: colors.cardBorder, borderTopWidth: StyleSheet.hairlineWidth },
              ]}
            >
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: colors.textPrimary }]}>
                  {lastBackup.chatsCount}
                </Text>
                <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Chats</Text>
              </View>
              <View style={[styles.statDivider, { backgroundColor: colors.cardBorder }]} />
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: colors.textPrimary }]}>
                  {lastBackup.messagesCount.toLocaleString()}
                </Text>
                <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Messages</Text>
              </View>
              <View style={[styles.statDivider, { backgroundColor: colors.cardBorder }]} />
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: colors.textPrimary }]}>
                  {lastBackup.mediaFilesCount.toLocaleString()}
                </Text>
                <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Media files</Text>
              </View>
            </View>
          )}

          {/* Cloud encrypted note */}
          <View style={[styles.securityBadge, { backgroundColor: colors.bg }]}>
            <ShieldCheck size={16} color="#22C55E" />
            <Text style={[styles.securityText, { color: colors.textSecondary }]}>
              Encrypted cloud backup stored in your private Google Drive
            </Text>
          </View>
        </View>

        {/* ── Google Account Info Card ───────────────────────────────────── */}
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
          GOOGLE DRIVE ACCOUNT
        </Text>

        <View
          style={[
            styles.cardContainer,
            { backgroundColor: colors.surface, borderColor: colors.cardBorder },
          ]}
        >
          {account ? (
            <TouchableOpacity
              style={styles.accountRow}
              activeOpacity={0.7}
              onPress={() => setShowAccountModal(true)}
            >
              {account.avatarUrl ? (
                <Image source={{ uri: account.avatarUrl }} style={styles.accountAvatar} />
              ) : (
                <View style={[styles.accountAvatarPlaceholder, { backgroundColor: '#4285F4' }]}>
                  <Text style={styles.avatarLetter}>
                    {account.name ? account.name[0].toUpperCase() : 'G'}
                  </Text>
                </View>
              )}
              <View style={{ flex: 1, marginLeft: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={[styles.accountName, { color: colors.textPrimary }]}>
                    {account.name}
                  </Text>
                  <View style={styles.connectedPill}>
                    <Text style={styles.connectedPillText}>Connected</Text>
                  </View>
                </View>
                <Text style={[styles.accountEmail, { color: colors.textSecondary }]}>
                  {account.email}
                </Text>
              </View>
              <Text style={[styles.switchLink, { color: colors.primaryIndigo }]}>Switch</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.connectButtonRow}
              activeOpacity={0.8}
              onPress={() => setShowAccountModal(true)}
            >
              <View style={[styles.gDriveCircle, { backgroundColor: '#EA4335' }]}>
                <HardDrive size={18} color="#FFF" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.connectTitle, { color: colors.textPrimary }]}>
                  Connect Google Drive
                </Text>
                <Text style={[styles.connectDesc, { color: colors.textSecondary }]}>
                  Choose a Google account to save chat backups
                </Text>
              </View>
              <ChevronRight size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        {/* ── Back Up Now Button / Progress Card ─────────────────────────── */}
        <View style={styles.actionSection}>
          {isBackingUp ? (
            <View
              style={[
                styles.progressCard,
                { backgroundColor: colors.surface, borderColor: colors.primaryIndigo },
              ]}
            >
              <View style={styles.progressHeaderRow}>
                <ActivityIndicator size="small" color={colors.primaryIndigo} />
                <Text style={[styles.progressTitle, { color: colors.textPrimary }]}>
                  Backing up to Google Drive...
                </Text>
                <Text style={[styles.progressPercent, { color: colors.primaryIndigo }]}>
                  {backupProgress}%
                </Text>
              </View>

              {/* Progress Bar Track */}
              <View style={[styles.progressBarTrack, { backgroundColor: colors.cardBorder }]}>
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      width: `${backupProgress}%`,
                      backgroundColor: colors.primaryIndigo,
                    },
                  ]}
                />
              </View>

              <View style={styles.progressFooterRow}>
                <Text
                  style={[styles.progressStageText, { color: colors.textSecondary }]}
                  numberOfLines={1}
                >
                  {backupStageLabel || 'Please keep the app open...'}
                </Text>
                <TouchableOpacity
                  onPress={cancelBackup}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : backupError ? (
            <View
              style={[
                styles.errorCard,
                { backgroundColor: 'rgba(239, 68, 68, 0.08)', borderColor: '#EF4444' },
              ]}
            >
              <View style={styles.errorHeader}>
                <AlertCircle size={20} color="#EF4444" />
                <Text style={styles.errorTitle}>Backup failed</Text>
              </View>
              <Text style={[styles.errorDesc, { color: colors.textSecondary }]}>{backupError}</Text>
              <TouchableOpacity
                style={[styles.retryBtn, { backgroundColor: '#EF4444' }]}
                onPress={() => startBackup()}
                activeOpacity={0.8}
              >
                <RefreshCw size={16} color="#FFF" style={{ marginRight: 8 }} />
                <Text style={styles.retryBtnText}>Retry Backup</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={[
                styles.backupNowBtn,
                { backgroundColor: colors.primaryIndigo },
                !account && { opacity: 0.85 },
              ]}
              onPress={() => {
                if (!account) {
                  setShowAccountModal(true);
                } else {
                  startBackup();
                }
              }}
              activeOpacity={0.85}
            >
              <CloudUpload size={20} color="#FFFFFF" style={{ marginRight: 10 }} />
              <Text style={styles.backupNowBtnText}>Back up now</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Backup Settings Section ────────────────────────────────────── */}
        <Text style={[styles.sectionTitle, { color: colors.textSecondary, marginTop: 24 }]}>
          BACKUP SETTINGS
        </Text>

        <View
          style={[
            styles.cardContainer,
            { backgroundColor: colors.surface, borderColor: colors.cardBorder },
          ]}
        >
          {/* Backup frequency */}
          <TouchableOpacity
            style={styles.settingRow}
            activeOpacity={0.7}
            onPress={() => setShowFrequencyModal(true)}
          >
            <View style={[styles.settingIconBox, { backgroundColor: 'rgba(99, 102, 241, 0.12)' }]}>
              <Calendar size={18} color={colors.primaryIndigo} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.settingTitle, { color: colors.textPrimary }]}>
                Back up to Google Drive
              </Text>
              <Text style={[styles.settingValue, { color: colors.textSecondary }]}>
                {FREQUENCY_OPTIONS.find((f) => f.value === settings.frequency)?.label}
              </Text>
            </View>
            <ChevronRight size={18} color={colors.textSecondary} />
          </TouchableOpacity>

          <View style={[styles.rowSeparator, { backgroundColor: colors.cardBorder }]} />

          {/* Backup over network */}
          <TouchableOpacity
            style={styles.settingRow}
            activeOpacity={0.7}
            onPress={() => setShowNetworkModal(true)}
          >
            <View style={[styles.settingIconBox, { backgroundColor: 'rgba(34, 197, 94, 0.12)' }]}>
              <Wifi size={18} color="#22C55E" />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.settingTitle, { color: colors.textPrimary }]}>Back up over</Text>
              <Text style={[styles.settingValue, { color: colors.textSecondary }]}>
                {settings.networkType === 'wifi' ? 'Wi-Fi only' : 'Wi-Fi or cellular'}
              </Text>
            </View>
            <ChevronRight size={18} color={colors.textSecondary} />
          </TouchableOpacity>

          <View style={[styles.rowSeparator, { backgroundColor: colors.cardBorder }]} />

          {/* Include photos / images */}
          <View style={styles.settingRow}>
            <View style={[styles.settingIconBox, { backgroundColor: 'rgba(59, 130, 246, 0.12)' }]}>
              <ImageIcon size={18} color="#3B82F6" />
            </View>
            <View style={{ flex: 1, marginLeft: 12, marginRight: 8 }}>
              <Text style={[styles.settingTitle, { color: colors.textPrimary }]}>
                Include photos
              </Text>
              <Text style={[styles.settingDesc, { color: colors.textSecondary }]}>
                Back up photos and images shared in chats
              </Text>
            </View>
            <Switch
              value={settings.includeImages}
              onValueChange={handleToggleImages}
              trackColor={{ false: colors.cardBorder, true: colors.primaryIndigo }}
              thumbColor="#FFFFFF"
            />
          </View>

          <View style={[styles.rowSeparator, { backgroundColor: colors.cardBorder }]} />

          {/* Include videos */}
          <View style={styles.settingRow}>
            <View style={[styles.settingIconBox, { backgroundColor: 'rgba(245, 158, 11, 0.12)' }]}>
              <Video size={18} color="#F59E0B" />
            </View>
            <View style={{ flex: 1, marginLeft: 12, marginRight: 8 }}>
              <Text style={[styles.settingTitle, { color: colors.textPrimary }]}>
                Include videos
              </Text>
              <Text style={[styles.settingDesc, { color: colors.textSecondary }]}>
                Videos may significantly increase backup size
              </Text>
            </View>
            <Switch
              value={settings.includeVideos}
              onValueChange={handleToggleVideos}
              trackColor={{ false: colors.cardBorder, true: colors.primaryIndigo }}
              thumbColor="#FFFFFF"
            />
          </View>
        </View>

        {/* Live settings summary line */}
        <Text style={[styles.summaryFooterText, { color: colors.textSecondary }]}>
          ℹ️ {summaryLine}
        </Text>

        {/* ── Destructive Action: Delete Backup ─────────────────────────── */}
        {lastBackup && (
          <TouchableOpacity
            style={[styles.deleteBtn, { borderColor: 'rgba(239, 68, 68, 0.3)' }]}
            onPress={handleConfirmDelete}
            activeOpacity={0.7}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <ActivityIndicator size="small" color="#EF4444" />
            ) : (
              <>
                <Trash2 size={16} color="#EF4444" style={{ marginRight: 8 }} />
                <Text style={styles.deleteBtnText}>Delete backup from Google Drive</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {/* ── Developer Mock Controls (Guarded by __DEV__) ───────────── */}
        {renderDeveloperControls()}
      </ScrollView>

      {/* ── Modal: Google Account Picker Bottom Sheet ──────────────────── */}
      <Modal
        visible={showAccountModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAccountModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowAccountModal(false)}
        >
          <View
            style={[
              styles.modalSheet,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>
                Choose a Google Account
              </Text>
              <Text style={[styles.modalSub, { color: colors.textSecondary }]}>
                to back up chats and media
              </Text>
            </View>

            {/* ── Real Google Sign-In button ─────────────────────────── */}
            {/* MOCK_GOOGLE_ACCOUNTS is now an empty array (real OAuth replaces it). */}
            {/* The "Sign in with Google" button triggers the full OAuth2 PKCE flow. */}

            {/* Show currently connected account if any */}
            {account && (
              <TouchableOpacity
                style={[styles.accountPickerItem, { backgroundColor: 'rgba(99, 102, 241, 0.08)' }]}
                activeOpacity={0.7}
                onPress={() => setShowAccountModal(false)}
              >
                {account.avatarUrl ? (
                  <Image source={{ uri: account.avatarUrl }} style={styles.pickerAvatar} />
                ) : (
                  <View
                    style={[
                      styles.pickerAvatar,
                      {
                        backgroundColor: '#EA4335',
                        alignItems: 'center',
                        justifyContent: 'center',
                      },
                    ]}
                  >
                    <Text style={{ color: '#FFF', fontWeight: '700', fontSize: 18 }}>
                      {account.name[0]?.toUpperCase() ?? 'G'}
                    </Text>
                  </View>
                )}
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[styles.pickerName, { color: colors.textPrimary }]}>
                    {account.name}
                  </Text>
                  <Text style={[styles.pickerEmail, { color: colors.textSecondary }]}>
                    {account.email}
                  </Text>
                </View>
                <Check size={18} color={colors.primaryIndigo} />
              </TouchableOpacity>
            )}

            {/* Sign in / Add another account via real Google OAuth */}
            <TouchableOpacity
              style={styles.addAccountRow}
              activeOpacity={0.7}
              onPress={async () => {
                setShowAccountModal(false);
                // Small delay so modal closes smoothly before OAuth browser opens
                setTimeout(async () => {
                  try {
                    await connectAccount('');
                  } catch (e: any) {
                    // Error surfaced via BackupContext / screen toast — no additional handling needed
                  }
                }, 300);
              }}
            >
              <View style={[styles.addAccountIcon, { backgroundColor: '#EA4335' }]}>
                {/* Google "G" logo using text — avoids needing a vector asset */}
                <Text style={{ color: '#FFF', fontWeight: '800', fontSize: 15 }}>G</Text>
              </View>
              <Text style={[styles.addAccountText, { color: colors.primaryIndigo }]}>
                {account ? 'Switch Google account' : 'Sign in with Google'}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Modal: Backup Frequency Picker ─────────────────────────────── */}
      <Modal
        visible={showFrequencyModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowFrequencyModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowFrequencyModal(false)}
        >
          <View
            style={[
              styles.modalSheet,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>
                Backup Frequency
              </Text>
              <Text style={[styles.modalSub, { color: colors.textSecondary }]}>
                How often should WhatsApp back up your chats?
              </Text>
            </View>

            {FREQUENCY_OPTIONS.map((opt) => {
              const isSelected = settings.frequency === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={styles.pickerOptionRow}
                  activeOpacity={0.7}
                  onPress={() => handleSelectFrequency(opt.value)}
                >
                  <Text
                    style={[
                      styles.pickerOptionText,
                      { color: isSelected ? colors.primaryIndigo : colors.textPrimary },
                      isSelected && { fontWeight: '700' },
                    ]}
                  >
                    {opt.label}
                  </Text>
                  {isSelected && <Check size={18} color={colors.primaryIndigo} />}
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Modal: Network Type Picker ─────────────────────────────────── */}
      <Modal
        visible={showNetworkModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowNetworkModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowNetworkModal(false)}
        >
          <View
            style={[
              styles.modalSheet,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>Back Up Over</Text>
              <Text style={[styles.modalSub, { color: colors.textSecondary }]}>
                Choose data network for uploading backups
              </Text>
            </View>

            {NETWORK_OPTIONS.map((opt) => {
              const isSelected = settings.networkType === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={styles.networkPickerRow}
                  activeOpacity={0.7}
                  onPress={() => handleSelectNetwork(opt.value)}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        styles.pickerOptionText,
                        { color: isSelected ? colors.primaryIndigo : colors.textPrimary },
                        isSelected && { fontWeight: '700' },
                      ]}
                    >
                      {opt.label}
                    </Text>
                    <Text style={[styles.networkDescText, { color: colors.textSecondary }]}>
                      {opt.desc}
                    </Text>
                  </View>
                  {isSelected && <Check size={18} color={colors.primaryIndigo} />}
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </Modal>
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
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 20, fontWeight: '800' },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 40,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },

  // Hero card
  heroCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'center' },
  cloudIconBox: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroHeading: { fontSize: 18, fontWeight: '800' },
  heroSubheading: { fontSize: 13, marginTop: 3 },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: 14,
    marginTop: 14,
  },
  statItem: { alignItems: 'center' },
  statValue: { fontSize: 16, fontWeight: '800' },
  statLabel: { fontSize: 12, marginTop: 2 },
  statDivider: { width: 1, height: 24 },
  securityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 14,
    gap: 8,
  },
  securityText: { fontSize: 11, fontWeight: '500', flex: 1 },

  // Section titles
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 10,
    marginLeft: 2,
  },
  cardContainer: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
  },

  // Account row
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  accountAvatar: { width: 44, height: 44, borderRadius: 22 },
  accountAvatarPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarLetter: { color: '#FFF', fontSize: 18, fontWeight: '800' },
  accountName: { fontSize: 15, fontWeight: '700' },
  connectedPill: {
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    marginLeft: 8,
  },
  connectedPillText: { color: '#22C55E', fontSize: 10, fontWeight: '700' },
  accountEmail: { fontSize: 13, marginTop: 2 },
  switchLink: { fontSize: 14, fontWeight: '700' },

  connectButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  gDriveCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  connectTitle: { fontSize: 15, fontWeight: '700' },
  connectDesc: { fontSize: 12, marginTop: 2 },

  // Action Button / Progress
  actionSection: { marginTop: 16 },
  backupNowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    borderRadius: 16,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  backupNowBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },

  progressCard: {
    borderRadius: 18,
    borderWidth: 1.5,
    padding: 16,
    gap: 12,
  },
  progressHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressTitle: { fontSize: 15, fontWeight: '700', flex: 1, marginLeft: 10 },
  progressPercent: { fontSize: 15, fontWeight: '800' },
  progressBarTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  progressFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressStageText: { fontSize: 12, flex: 1, marginRight: 12 },
  cancelText: { color: '#EF4444', fontSize: 13, fontWeight: '700' },

  errorCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    gap: 8,
  },
  errorHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  errorTitle: { color: '#EF4444', fontSize: 15, fontWeight: '700' },
  errorDesc: { fontSize: 13 },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 12,
    marginTop: 4,
  },
  retryBtnText: { color: '#FFF', fontSize: 14, fontWeight: '700' },

  // Settings rows
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  settingIconBox: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingTitle: { fontSize: 15, fontWeight: '600' },
  settingValue: { fontSize: 13, marginTop: 2 },
  settingDesc: { fontSize: 11, marginTop: 2 },
  rowSeparator: { height: StyleSheet.hairlineWidth, marginLeft: 66 },
  summaryFooterText: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 8,
    marginLeft: 4,
  },

  // Delete action
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    marginTop: 24,
  },
  deleteBtnText: { color: '#EF4444', fontSize: 14, fontWeight: '700' },

  // Developer box
  devBox: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    marginTop: 24,
  },
  devHeaderToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  devTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  devToggleHint: { fontSize: 12, fontWeight: '700' },
  devRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  devLabel: { fontSize: 13, fontWeight: '600' },
  devSubLabel: { fontSize: 11, marginTop: 2 },

  // Modal bottom sheet
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 36,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  modalHeader: { marginBottom: 16 },
  modalTitle: { fontSize: 18, fontWeight: '800' },
  modalSub: { fontSize: 13, marginTop: 3 },
  accountPickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    marginBottom: 6,
  },
  pickerAvatar: { width: 40, height: 40, borderRadius: 20 },
  pickerName: { fontSize: 15, fontWeight: '700' },
  pickerEmail: { fontSize: 13, marginTop: 1 },
  addAccountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    marginTop: 6,
  },
  addAccountIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addAccountText: { fontSize: 15, fontWeight: '700', marginLeft: 12 },

  pickerOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  pickerOptionText: { fontSize: 16 },
  networkPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  networkDescText: { fontSize: 12, marginTop: 2 },
});
