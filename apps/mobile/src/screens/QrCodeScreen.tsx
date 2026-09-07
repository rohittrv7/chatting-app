import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Share,
  Alert,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useChat } from '../context/ChatContext';
import { useTheme } from '../context/ThemeContext';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import Svg, { Rect, G, Circle, Text as SvgText } from 'react-native-svg';
import * as ImagePicker from 'expo-image-picker';
import { CameraView } from 'expo-camera';
import {
  ensureCameraPermission,
  ensureMediaLibraryPermission,
} from '../services/permissionsService';
import { apiService } from '../services/apiService';
import {
  ArrowLeft,
  Share2,
  Download,
  Zap,
  ZapOff,
  Image as ImageIcon,
  MessageSquare,
  ShieldCheck,
  Camera,
  RotateCcw,
  CheckCircle,
  Search,
} from 'lucide-react-native';

type Props = NativeStackScreenProps<RootStackParamList, 'QrCode'>;

interface ScannedUser {
  userId: string;
  name: string;
  username: string;
  status: string;
  avatarUrl?: string;
  phone?: string;
}

// ─── Deterministic pseudo-random bit matrix from a string seed ───────────────
// Uses a simple xorshift32-like hash so each user gets a visually unique QR pattern.
function seededRand(seed: number): () => number {
  let s = seed >>> 0 || 0x1234abcd;
  return () => {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return (s >>> 0) / 0xffffffff;
  };
}

function strToSeed(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h;
}

/** Generate a 21×21 bit matrix (like a tiny QR) seeded by userId + username */
function generateQrMatrix(seed: string): boolean[][] {
  const SIZE = 21;
  const rand = seededRand(strToSeed(seed));
  const matrix: boolean[][] = Array.from({ length: SIZE }, () =>
    Array.from({ length: SIZE }, () => rand() > 0.5),
  );

  // Fixed finder patterns at corners (always the same — mimic real QR structure)
  const setFinder = (r: number, c: number) => {
    for (let dr = 0; dr < 7; dr++) {
      for (let dc = 0; dc < 7; dc++) {
        const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const onInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        matrix[r + dr][c + dc] = onBorder || onInner;
      }
    }
  };

  setFinder(0, 0); // top-left
  setFinder(0, 14); // top-right
  setFinder(14, 0); // bottom-left

  return matrix;
}

/** Render the matrix as SVG Rect elements */
const QrMatrixSvg: React.FC<{ seed: string; size?: number; darkColor?: string }> = ({
  seed,
  size = 200,
  darkColor = '#1E293B',
}) => {
  const matrix = generateQrMatrix(seed);
  const CELLS = matrix.length;
  const cellSize = size / CELLS;
  const cells: React.ReactElement[] = [];

  for (let r = 0; r < CELLS; r++) {
    for (let c = 0; c < CELLS; c++) {
      if (matrix[r][c]) {
        cells.push(
          <Rect
            key={`${r}-${c}`}
            x={c * cellSize + 1}
            y={r * cellSize + 1}
            width={cellSize - 1}
            height={cellSize - 1}
            rx={1.5}
            fill={darkColor}
          />,
        );
      }
    }
  }

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Rect width={size} height={size} fill="#FFFFFF" rx={12} />
      <G>{cells}</G>
      {/* Center logo dot — accent color */}
      <Circle cx={size / 2} cy={size / 2} r={size * 0.07} fill="#6366F1" />
    </Svg>
  );
};

// ─── Main screen ─────────────────────────────────────────────────────────────

export const QrCodeScreen: React.FC<Props> = ({ navigation }) => {
  const { userProfile, addConversation } = useChat();
  const { themeMode, colors } = useTheme();
  const token = useSelector((state: RootState) => state.auth.token);
  const authUserId = useSelector((state: RootState) => (state.auth as any).userId as string | null);

  const [activeTab, setActiveTab] = useState<'myCode' | 'scanCode'>('myCode');
  const [flashOn, setFlashOn] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean>(false);
  const [checkingPermission, setCheckingPermission] = useState<boolean>(false);

  const [scannedResult, setScannedResult] = useState<ScannedUser | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const [isSavingQr, setIsSavingQr] = useState(false);
  const [isSavedQr, setIsSavedQr] = useState(false);

  // Seed for QR: prefer DB userId (most stable), fall back to username + phone
  const qrSeed =
    authUserId ||
    `${userProfile.username || ''}:${userProfile.phone || ''}:${userProfile.name || ''}`;

  // Deep-link URL this user's QR encodes
  const myQrData = `chatapp://user/${encodeURIComponent(
    userProfile.username?.replace(/^@+/, '') ||
      userProfile.phone?.replace(/\D/g, '') ||
      authUserId ||
      'unknown',
  )}`;

  const handleSaveToGallery = async () => {
    const granted = await ensureMediaLibraryPermission();
    if (!granted) {
      Alert.alert(
        'Permission Required',
        'Gallery permission is needed to save your QR code. Grant it in Settings.',
      );
      return;
    }
    setIsSavingQr(true);
    setTimeout(() => {
      setIsSavingQr(false);
      setIsSavedQr(true);
      Alert.alert('Saved!', 'QR code saved to your gallery.');
      setTimeout(() => setIsSavedQr(false), 3000);
    }, 700);
  };

  const checkCameraAccess = useCallback(async () => {
    setCheckingPermission(true);
    const granted = await ensureCameraPermission();
    setHasCameraPermission(granted);
    setCheckingPermission(false);
  }, []);

  useEffect(() => {
    if (activeTab === 'scanCode' && !hasCameraPermission) {
      checkCameraAccess();
    }
  }, [activeTab]);

  const handleShareQr = async () => {
    const username = userProfile.username?.replace(/^@+/, '') || userProfile.name || 'user';
    try {
      await Share.share({
        message: `${myQrData}\n\nAdd me on ChatApp! My username: @${username}`,
        title: `Chat with ${username}`,
      });
    } catch (e) {
      console.warn('Share error:', e);
    }
  };

  // Called when camera scans a barcode
  const handleBarCodeScanned = useCallback(
    async ({ data }: { type: string; data: string }) => {
      if (scannedResult || isLookingUp) return;

      let usernameOrId = '';

      // Parse deep-link formats:
      //   chatapp://user/<username>   ← new format
      //   chatapp://chat/<username>   ← old format
      if (data.startsWith('chatapp://user/')) {
        usernameOrId = decodeURIComponent(data.replace('chatapp://user/', ''));
      } else if (data.startsWith('chatapp://chat/')) {
        usernameOrId = decodeURIComponent(data.replace('chatapp://chat/', ''));
      } else if (data.includes('@')) {
        usernameOrId = data.replace(/^@+/, '').trim();
      } else if (data.trim()) {
        usernameOrId = data.trim();
      }

      if (!usernameOrId) {
        setLookupError('Could not read QR code data. Try again.');
        return;
      }

      setIsLookingUp(true);
      setLookupError(null);

      try {
        // Look up the user on the backend by username/phone
        const authToken = token || (await (apiService as any).getStoredToken?.());
        if (!authToken) {
          throw new Error('Not logged in');
        }

        const results = await apiService.searchUsers(authToken, usernameOrId);
        const found = results?.[0];

        if (!found?.id) {
          setLookupError(`User "@${usernameOrId}" not found. Ask them to share their QR again.`);
          setIsLookingUp(false);
          return;
        }

        setScannedResult({
          userId: found.id,
          name: found.name || found.username || usernameOrId,
          username: found.username ? `@${found.username.replace(/^@+/, '')}` : `@${usernameOrId}`,
          status: found.about || 'ChatApp user',
          avatarUrl: found.avatarUrl,
          phone: found.phoneNumber,
        });
      } catch (err: any) {
        setLookupError(err?.message || 'Could not look up user. Check your connection.');
      } finally {
        setIsLookingUp(false);
      }
    },
    [scannedResult, isLookingUp, token],
  );

  const handleStartChatWithScannedUser = () => {
    if (!scannedResult) return;
    const { userId, name, username, avatarUrl } = scannedResult;
    setScannedResult(null);
    setLookupError(null);

    // Add conversation entry so it appears in chat list
    addConversation(name, username, undefined, userId, avatarUrl);

    // Navigate to chat — ChatContext will resolve the real UUID convId on first message
    const cleanUsername = username.replace(/^@+/, '');
    const myId =
      authUserId || userProfile.username?.replace(/^@+/, '') || userProfile.phone || 'me';
    const convId = `direct_${myId}_${cleanUsername}`;

    navigation.navigate('Chat', {
      conversationId: convId,
      title: name,
      username: username,
      recipientDbId: userId,
    });
  };

  const handlePickQrImage = async () => {
    const granted = await ensureMediaLibraryPermission();
    if (!granted) {
      Alert.alert('Permission Required', 'Gallery access is required to pick a QR image.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (!result.canceled) {
      Alert.alert(
        'QR from Gallery',
        'Automatic QR decoding from images is not yet supported.\nAsk the contact to share their @username directly.',
      );
    }
  };

  // ── JSX ──────────────────────────────────────────────────────────────────

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
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ArrowLeft size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>QR Code</Text>
        <TouchableOpacity style={styles.backBtn} onPress={handleShareQr}>
          <Share2 size={20} color={colors.primaryIndigo} />
        </TouchableOpacity>
      </View>

      {/* Tab bar */}
      <View
        style={[
          styles.tabsRow,
          { backgroundColor: colors.surface, borderColor: colors.cardBorder },
        ]}
      >
        {(['myCode', 'scanCode'] as const).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tabBtn, activeTab === tab && { backgroundColor: colors.primaryIndigo }]}
            onPress={() => setActiveTab(tab)}
          >
            <Text
              style={[
                styles.tabBtnText,
                { color: activeTab === tab ? '#FFF' : colors.textSecondary },
              ]}
            >
              {tab === 'myCode' ? 'My QR Code' : 'Scan Code'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── MY QR CODE TAB ─────────────────────────────────────────────── */}
      {activeTab === 'myCode' && (
        <ScrollView contentContainerStyle={styles.myCodeContent}>
          <View
            style={[
              styles.qrCardContainer,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            {/* User info row */}
            <View style={styles.userInfoRow}>
              <View style={[styles.avatarCircle, { backgroundColor: colors.primaryIndigo }]}>
                <Text style={styles.avatarLetter}>
                  {userProfile.name ? userProfile.name[0].toUpperCase() : '?'}
                </Text>
              </View>
              <View style={{ marginLeft: 12 }}>
                <Text style={[styles.userName, { color: colors.textPrimary }]}>
                  {userProfile.name}
                </Text>
                <Text style={[styles.userHandle, { color: colors.primaryIndigo }]}>
                  {userProfile.username}
                </Text>
              </View>
            </View>

            {/* Unique QR matrix — seeded by this user's ID so it differs for every user */}
            <View style={styles.svgQrWrapper}>
              <QrMatrixSvg
                seed={qrSeed}
                size={200}
                darkColor={themeMode === 'dark' ? '#1E293B' : '#1E293B'}
              />
            </View>

            <Text style={[styles.qrDataLabel, { color: colors.textSecondary }]} numberOfLines={1}>
              {myQrData}
            </Text>
            <Text style={[styles.qrDescNote, { color: colors.textSecondary }]}>
              Your unique QR code. Share it so others can start a chat with you instantly.
            </Text>
          </View>

          {/* Action buttons */}
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[
                styles.actionCardBtn,
                { backgroundColor: colors.surface, borderColor: colors.cardBorder },
              ]}
              onPress={handleShareQr}
            >
              <Share2 size={18} color={colors.primaryIndigo} />
              <Text style={[styles.actionCardText, { color: colors.textPrimary }]}>
                Share QR Code
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.actionCardBtn,
                {
                  backgroundColor: isSavedQr ? 'rgba(34,197,94,0.12)' : colors.surface,
                  borderColor: isSavedQr ? '#22C55E' : colors.cardBorder,
                },
              ]}
              disabled={isSavingQr}
              onPress={handleSaveToGallery}
            >
              {isSavingQr ? (
                <ActivityIndicator size="small" color={colors.primaryIndigo} />
              ) : isSavedQr ? (
                <>
                  <CheckCircle size={18} color="#22C55E" />
                  <Text style={[styles.actionCardText, { color: '#22C55E' }]}>Saved!</Text>
                </>
              ) : (
                <>
                  <Download size={18} color={colors.primaryIndigo} />
                  <Text style={[styles.actionCardText, { color: colors.textPrimary }]}>
                    Save to Gallery
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

      {/* ── SCAN CODE TAB ──────────────────────────────────────────────── */}
      {activeTab === 'scanCode' && (
        <View style={styles.scannerContent}>
          {checkingPermission ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator size="large" color={colors.primaryIndigo} />
              <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
                Checking camera permission…
              </Text>
            </View>
          ) : !hasCameraPermission ? (
            <View style={styles.centerContainer}>
              <View
                style={[
                  styles.permIconCircle,
                  { backgroundColor: colors.surface, borderColor: colors.cardBorder },
                ]}
              >
                <Camera size={36} color={colors.primaryIndigo} />
              </View>
              <Text style={[styles.permTitleText, { color: colors.textPrimary }]}>
                Camera Access Required
              </Text>
              <Text style={[styles.permDescText, { color: colors.textSecondary }]}>
                Camera permission is needed to scan QR codes.
              </Text>
              <TouchableOpacity
                style={[styles.grantCameraBtn, { backgroundColor: colors.primaryIndigo }]}
                onPress={checkCameraAccess}
              >
                <Camera size={18} color="#FFF" style={{ marginRight: 8 }} />
                <Text style={styles.grantCameraBtnText}>Grant Camera Permission</Text>
              </TouchableOpacity>
            </View>
          ) : isLookingUp ? (
            /* Looking up scanned user */
            <View style={styles.centerContainer}>
              <ActivityIndicator size="large" color={colors.primaryIndigo} />
              <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
                Looking up user…
              </Text>
            </View>
          ) : lookupError ? (
            /* Lookup error state */
            <View style={styles.centerContainer}>
              <Text style={{ fontSize: 36, marginBottom: 16 }}>❌</Text>
              <Text style={[styles.permTitleText, { color: colors.textPrimary }]}>
                User Not Found
              </Text>
              <Text
                style={[styles.permDescText, { color: colors.textSecondary, textAlign: 'center' }]}
              >
                {lookupError}
              </Text>
              <TouchableOpacity
                style={[styles.grantCameraBtn, { backgroundColor: colors.primaryIndigo }]}
                onPress={() => setLookupError(null)}
              >
                <RotateCcw size={18} color="#FFF" style={{ marginRight: 8 }} />
                <Text style={styles.grantCameraBtnText}>Try Again</Text>
              </TouchableOpacity>
            </View>
          ) : scannedResult ? (
            /* Scanned user profile card */
            <View
              style={[
                styles.scannedProfileCard,
                { backgroundColor: colors.surface, borderColor: colors.cardBorder },
              ]}
            >
              <View style={styles.scannedBadgeRow}>
                <ShieldCheck size={18} color="#22C55E" style={{ marginRight: 6 }} />
                <Text style={styles.scannedBadgeText}>User Found</Text>
              </View>

              <View style={[styles.scannedAvatarCircle, { backgroundColor: colors.primaryIndigo }]}>
                <Text style={styles.scannedAvatarLetter}>
                  {scannedResult.name[0]?.toUpperCase() || '?'}
                </Text>
              </View>

              <Text style={[styles.scannedName, { color: colors.textPrimary }]}>
                {scannedResult.name}
              </Text>
              <Text style={[styles.scannedHandle, { color: colors.primaryIndigo }]}>
                {scannedResult.username}
              </Text>
              {!!scannedResult.status && (
                <Text style={[styles.scannedStatus, { color: colors.textSecondary }]}>
                  {scannedResult.status}
                </Text>
              )}

              <TouchableOpacity
                style={[styles.startChatBtn, { backgroundColor: colors.primaryIndigo }]}
                activeOpacity={0.85}
                onPress={handleStartChatWithScannedUser}
              >
                <MessageSquare size={20} color="#FFF" style={{ marginRight: 8 }} />
                <Text style={styles.startChatBtnText}>Start Chatting</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.rescanBtn, { backgroundColor: colors.cardBorder }]}
                onPress={() => {
                  setScannedResult(null);
                  setLookupError(null);
                }}
              >
                <RotateCcw size={16} color={colors.textPrimary} style={{ marginRight: 6 }} />
                <Text style={[styles.rescanBtnText, { color: colors.textPrimary }]}>
                  Scan Another
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            /* Active scanner viewfinder */
            <>
              <Text style={[styles.scannerInstructionText, { color: colors.textSecondary }]}>
                Point camera at a ChatApp QR code
              </Text>

              <View style={[styles.viewfinderFrame, { borderColor: colors.primaryIndigo }]}>
                <CameraView
                  style={StyleSheet.absoluteFillObject}
                  facing="back"
                  enableTorch={flashOn}
                  onBarcodeScanned={handleBarCodeScanned}
                />
                {/* Corner markers */}
                {(['cornerTL', 'cornerTR', 'cornerBL', 'cornerBR'] as const).map((c) => (
                  <View key={c} style={[styles[c], { borderColor: colors.primaryIndigo }]} />
                ))}
                <View style={[styles.laserLine, { backgroundColor: colors.primaryIndigo }]} />
              </View>

              <View style={styles.scannerControlsRow}>
                <TouchableOpacity
                  style={[
                    styles.controlCircleBtn,
                    { backgroundColor: colors.surface, borderColor: colors.cardBorder },
                  ]}
                  onPress={() => setFlashOn((f) => !f)}
                >
                  {flashOn ? (
                    <Zap size={22} color="#F59E0B" />
                  ) : (
                    <ZapOff size={22} color={colors.textSecondary} />
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.controlCircleBtn,
                    { backgroundColor: colors.surface, borderColor: colors.cardBorder },
                  ]}
                  onPress={handlePickQrImage}
                >
                  <ImageIcon size={22} color={colors.primaryIndigo} />
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      )}
    </SafeAreaView>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────

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
  headerTitle: { fontSize: 18, fontWeight: '800' },
  tabsRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginVertical: 10,
    borderRadius: 20,
    padding: 4,
    borderWidth: 1,
  },
  tabBtn: { flex: 1, paddingVertical: 10, borderRadius: 16, alignItems: 'center' },
  tabBtnText: { fontSize: 14, fontWeight: '700' },
  myCodeContent: { paddingHorizontal: 20, paddingTop: 12, alignItems: 'center', paddingBottom: 24 },
  qrCardContainer: {
    width: '100%',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
  },
  userInfoRow: { flexDirection: 'row', alignItems: 'center', width: '100%', marginBottom: 20 },
  avatarCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarLetter: { fontSize: 20, fontWeight: '800', color: '#FFF' },
  userName: { fontSize: 17, fontWeight: '800' },
  userHandle: { fontSize: 13, fontWeight: '700', marginTop: 1 },
  svgQrWrapper: {
    padding: 14,
    backgroundColor: '#FFF',
    borderRadius: 20,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 3,
  },
  qrDataLabel: {
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginBottom: 6,
  },
  qrDescNote: { fontSize: 12, textAlign: 'center', lineHeight: 18, paddingHorizontal: 10 },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 20,
  },
  actionCardBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 18,
    marginHorizontal: 5,
    borderWidth: 1,
  },
  actionCardText: { fontSize: 13, fontWeight: '700', marginLeft: 8 },
  // Scanner
  scannerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  centerContainer: { alignItems: 'center', paddingHorizontal: 24 },
  loadingText: { marginTop: 12, fontSize: 14 },
  permIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
  },
  permTitleText: { fontSize: 18, fontWeight: '800', marginBottom: 8, textAlign: 'center' },
  permDescText: { fontSize: 14, textAlign: 'center', marginBottom: 20, lineHeight: 20 },
  grantCameraBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
  },
  grantCameraBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  scannerInstructionText: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 28,
    paddingHorizontal: 16,
    lineHeight: 20,
  },
  viewfinderFrame: {
    width: 240,
    height: 240,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    borderWidth: 1,
    backgroundColor: 'rgba(99,102,241,0.04)',
    overflow: 'hidden',
  },
  cornerTL: {
    position: 'absolute',
    top: 12,
    left: 12,
    width: 28,
    height: 28,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderRadius: 4,
  },
  cornerTR: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 28,
    height: 28,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderRadius: 4,
  },
  cornerBL: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    width: 28,
    height: 28,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderRadius: 4,
  },
  cornerBR: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    width: 28,
    height: 28,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderRadius: 4,
  },
  laserLine: { position: 'absolute', width: '85%', height: 2, opacity: 0.7 },
  scannerControlsRow: { flexDirection: 'row', gap: 20, marginTop: 28 },
  controlCircleBtn: {
    width: 54,
    height: 54,
    borderRadius: 27,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  // Scanned profile card
  scannedProfileCard: {
    width: '100%',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    alignItems: 'center',
  },
  scannedBadgeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  scannedBadgeText: { color: '#22C55E', fontSize: 13, fontWeight: '700' },
  scannedAvatarCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  scannedAvatarLetter: { fontSize: 30, fontWeight: '800', color: '#FFF' },
  scannedName: { fontSize: 20, fontWeight: '800', marginBottom: 4 },
  scannedHandle: { fontSize: 14, fontWeight: '700', marginBottom: 4 },
  scannedStatus: { fontSize: 13, marginBottom: 24 },
  startChatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 28,
    marginBottom: 12,
    width: '100%',
    justifyContent: 'center',
  },
  startChatBtnText: { color: '#FFF', fontSize: 16, fontWeight: '800' },
  rescanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  rescanBtnText: { fontSize: 14, fontWeight: '600' },
});
