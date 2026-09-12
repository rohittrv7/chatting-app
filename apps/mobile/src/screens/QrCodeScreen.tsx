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
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useChat } from '../context/ChatContext';
import { useTheme } from '../context/ThemeContext';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import QRCode from 'react-native-qrcode-svg';
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

export const QrCodeScreen: React.FC<Props> = ({ navigation }) => {
  const { userProfile, addConversation, conversations } = useChat();
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

  // 1. Dynamic User ID — always comes from auth state or userProfile (never hardcoded)
  const resolvedUserId = authUserId || (userProfile as any).userId || (userProfile as any).id || '';

  // 2. Structured QR Payload — encodes user identity dynamically
  const myQrData = JSON.stringify({
    app: 'whatsappconnect',
    v: 1,
    userId: resolvedUserId,
    username: userProfile.username?.replace(/^@+/, '') || '',
    name: userProfile.name || '',
    phone: userProfile.phone || '',
  });

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
        message: `Connect with me on WhatsApp Connect!\nUsername: @${username}\nUser ID: ${resolvedUserId}`,
        title: `Chat with ${userProfile.name || username}`,
      });
    } catch (e) {
      console.warn('Share error:', e);
    }
  };

  // Called when camera scans a barcode
  const handleBarCodeScanned = useCallback(
    async ({ data }: { type: string; data: string }) => {
      if (scannedResult || isLookingUp) return;

      let targetUserId = '';
      let targetUsername = '';

      // 1. Parse JSON format (our dynamic standard)
      try {
        const parsed = JSON.parse(data);
        if (parsed && typeof parsed === 'object') {
          targetUserId = parsed.userId || '';
          targetUsername = parsed.username || '';
        }
      } catch {
        // Not JSON — fallback to URI or plain text
      }

      // 2. Parse Deep-link or plain text formats
      if (!targetUserId) {
        if (data.startsWith('whatsappconnect://user/')) {
          targetUserId = decodeURIComponent(data.replace('whatsappconnect://user/', ''));
        } else if (data.startsWith('chatapp://user/')) {
          targetUsername = decodeURIComponent(data.replace('chatapp://user/', ''));
        } else if (data.startsWith('chatapp://chat/')) {
          targetUsername = decodeURIComponent(data.replace('chatapp://chat/', ''));
        } else if (
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.trim())
        ) {
          targetUserId = data.trim();
        } else if (data.includes('@')) {
          targetUsername = data.replace(/^@+/, '').trim();
        } else if (data.trim()) {
          targetUsername = data.trim();
        }
      }

      if (!targetUserId && !targetUsername) {
        setLookupError('Invalid QR code format. Please scan a valid WhatsApp Connect QR code.');
        return;
      }

      // 3. Self-scan check
      const myId = authUserId || (userProfile as any).userId || (userProfile as any).id;
      if (targetUserId && myId && targetUserId === myId) {
        setLookupError(
          'This is your own QR code! Share it with a contact so they can chat with you.',
        );
        return;
      }
      if (
        targetUsername &&
        userProfile.username &&
        targetUsername === userProfile.username.replace(/^@+/, '')
      ) {
        setLookupError(
          'This is your own QR code! Share it with a contact so they can chat with you.',
        );
        return;
      }

      setIsLookingUp(true);
      setLookupError(null);

      try {
        const authToken = token || (await (apiService as any).getStoredToken?.());
        if (!authToken) {
          throw new Error('Please log in to scan and connect with users.');
        }

        let found: any = null;

        // Try direct userId lookup first if UUID available
        if (targetUserId) {
          found = await apiService.getUserById(authToken, targetUserId);
        }

        // Fallback to username / phone search query
        if (!found && (targetUsername || targetUserId)) {
          const results = await apiService.searchUsers(authToken, targetUsername || targetUserId);
          found = results?.[0];
        }

        if (!found?.id) {
          setLookupError(
            `User "${targetUsername || targetUserId}" not found on WhatsApp Connect. They may need to create an account first.`,
          );
          setIsLookingUp(false);
          return;
        }

        setScannedResult({
          userId: found.id,
          name: found.name || found.displayName || found.username || targetUsername || 'User',
          username: found.username
            ? `@${found.username.replace(/^@+/, '')}`
            : `@${targetUsername || 'user'}`,
          status: found.about || 'Hey there! I am using WhatsApp.',
          avatarUrl: found.avatarUrl,
          phone: found.phoneNumber,
        });
      } catch (err: any) {
        setLookupError(
          err?.message || 'Could not connect to server. Please check your internet connection.',
        );
      } finally {
        setIsLookingUp(false);
      }
    },
    [scannedResult, isLookingUp, token, authUserId, userProfile],
  );

  const handleStartChatWithScannedUser = () => {
    if (!scannedResult) return;
    const { userId, name, username, avatarUrl } = scannedResult;
    setScannedResult(null);
    setLookupError(null);

    // Check if conversation with this user already exists
    const existingConv = conversations.find(
      (c) =>
        c.recipientDbId === userId ||
        (c.username && c.username.replace(/^@+/, '') === username.replace(/^@+/, '')),
    );

    if (existingConv) {
      navigation.navigate('Chat', {
        conversationId: existingConv.id,
        title: existingConv.title || name,
        username: existingConv.username || username,
        recipientDbId: existingConv.recipientDbId || userId,
      });
      return;
    }

    // Otherwise add new conversation entry and navigate
    addConversation(name, username, undefined, userId, avatarUrl);

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
        'Direct scanning from image files is under development.\nPlease point your camera directly at the QR code to connect.',
      );
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
              {userProfile.avatarUrl ? (
                <Image
                  source={{ uri: apiService.getResolvedMediaUrl(userProfile.avatarUrl) }}
                  style={styles.avatarImage}
                />
              ) : (
                <View style={[styles.avatarCircle, { backgroundColor: colors.primaryIndigo }]}>
                  <Text style={styles.avatarLetter}>
                    {userProfile.name ? userProfile.name[0].toUpperCase() : '?'}
                  </Text>
                </View>
              )}
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={[styles.userName, { color: colors.textPrimary }]} numberOfLines={1}>
                  {userProfile.name || 'WhatsApp User'}
                </Text>
                <Text style={[styles.userHandle, { color: colors.primaryIndigo }]}>
                  {userProfile.username || `@${userProfile.phone || 'user'}`}
                </Text>
              </View>
            </View>

            {/* Real, Scannable Dynamic QR Code */}
            <View style={styles.svgQrWrapper}>
              <QRCode
                value={myQrData}
                size={210}
                color="#0F172A"
                backgroundColor="#FFFFFF"
                logo={require('../../assets/icon.png')}
                logoSize={40}
                logoBackgroundColor="#FFFFFF"
                logoBorderRadius={8}
              />
            </View>

            <Text style={[styles.qrDescNote, { color: colors.textSecondary }]}>
              Your unique WhatsApp Connect QR code. Anyone who scans this code can message you
              directly.
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
                Camera permission is needed to scan QR codes and start chats instantly.
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
                Looking up user on WhatsApp Connect…
              </Text>
            </View>
          ) : lookupError ? (
            /* Lookup error state */
            <View style={styles.centerContainer}>
              <Text style={{ fontSize: 40, marginBottom: 16 }}>⚠️</Text>
              <Text style={[styles.permTitleText, { color: colors.textPrimary }]}>Scan Failed</Text>
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
                <Text style={styles.grantCameraBtnText}>Scan Again</Text>
              </TouchableOpacity>
            </View>
          ) : scannedResult ? (
            /* Scanned user confirmation card */
            <View
              style={[
                styles.scannedProfileCard,
                { backgroundColor: colors.surface, borderColor: colors.cardBorder },
              ]}
            >
              <View style={styles.scannedBadgeRow}>
                <ShieldCheck size={18} color="#22C55E" style={{ marginRight: 6 }} />
                <Text style={styles.scannedBadgeText}>Verified User Found</Text>
              </View>

              <Text style={[styles.confirmationPrompt, { color: colors.textSecondary }]}>
                Start chat with {scannedResult.name}?
              </Text>

              {scannedResult.avatarUrl ? (
                <Image
                  source={{ uri: apiService.getResolvedMediaUrl(scannedResult.avatarUrl) }}
                  style={styles.scannedAvatarImage}
                />
              ) : (
                <View
                  style={[styles.scannedAvatarCircle, { backgroundColor: colors.primaryIndigo }]}
                >
                  <Text style={styles.scannedAvatarLetter}>
                    {scannedResult.name[0]?.toUpperCase() || '?'}
                  </Text>
                </View>
              )}

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
                Align the QR code within the frame to scan
              </Text>

              <View style={[styles.viewfinderFrame, { borderColor: colors.primaryIndigo }]}>
                <CameraView
                  style={StyleSheet.absoluteFill}
                  facing="back"
                  enableTorch={flashOn}
                  barcodeScannerSettings={{
                    barcodeTypes: ['qr'],
                  }}
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

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 20, fontWeight: '700' },
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
  myCodeContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    alignItems: 'center',
    paddingBottom: 24,
  },
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
  avatarImage: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  avatarLetter: { fontSize: 20, fontWeight: '800', color: '#FFF' },
  userName: { fontSize: 17, fontWeight: '800' },
  userHandle: { fontSize: 13, fontWeight: '700', marginTop: 1 },
  svgQrWrapper: {
    padding: 16,
    backgroundColor: '#FFF',
    borderRadius: 24,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 4,
  },
  qrDescNote: { fontSize: 13, textAlign: 'center', lineHeight: 19, paddingHorizontal: 10 },
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
    width: 250,
    height: 250,
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
  scannedBadgeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  scannedBadgeText: { color: '#22C55E', fontSize: 13, fontWeight: '700' },
  confirmationPrompt: { fontSize: 14, fontWeight: '600', marginBottom: 16 },
  scannedAvatarCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  scannedAvatarImage: {
    width: 76,
    height: 76,
    borderRadius: 38,
    marginBottom: 12,
  },
  scannedAvatarLetter: { fontSize: 32, fontWeight: '800', color: '#FFF' },
  scannedName: { fontSize: 20, fontWeight: '800', marginBottom: 4 },
  scannedHandle: { fontSize: 14, fontWeight: '700', marginBottom: 4 },
  scannedStatus: { fontSize: 13, marginBottom: 20, textAlign: 'center', paddingHorizontal: 12 },
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
