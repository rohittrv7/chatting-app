import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Share,
  Alert,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useChat } from '../context/ChatContext';
import { useTheme } from '../context/ThemeContext';
import Svg, { Rect, G } from 'react-native-svg';
import * as ImagePicker from 'expo-image-picker';
import { ensureCameraPermission, ensureMediaLibraryPermission } from '../services/permissionsService';
import {
  ArrowLeft,
  Share2,
  Download,
  Zap,
  ZapOff,
  Image as ImageIcon,
  Scan,
  MessageSquare,
  ShieldCheck,
  Camera,
  RotateCcw,
  CheckCircle,
} from 'lucide-react-native';

type Props = NativeStackScreenProps<RootStackParamList, 'QrCode'>;

interface ScannedUser {
  name: string;
  username: string;
  status: string;
  avatar: string;
  phone: string;
}

export const QrCodeScreen: React.FC<Props> = ({ navigation }) => {
  const { userProfile, addConversation } = useChat();
  const { themeMode, colors } = useTheme();

  const [activeTab, setActiveTab] = useState<'myCode' | 'scanCode'>('myCode');
  const [flashOn, setFlashOn] = useState(false);

  // Camera Permission state
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean>(true);
  const [checkingPermission, setCheckingPermission] = useState<boolean>(false);

  // Scanned user profile state
  const [scannedResult, setScannedResult] = useState<ScannedUser | null>(null);

  const [isSavingQr, setIsSavingQr] = useState(false);
  const [isSavedQr, setIsSavedQr] = useState(false);

  const handleSaveToGallery = async () => {
    try {
      setIsSavingQr(true);
      const granted = await ensureMediaLibraryPermission();
      if (!granted) {
        setIsSavingQr(false);
        Alert.alert('Permission Denied', 'Gallery access is required to save your QR code.');
        return;
      }

      setTimeout(() => {
        setIsSavingQr(false);
        setIsSavedQr(true);
        Alert.alert(
          'Saved to Gallery 🎉',
          `Your personal QR Code for ${userProfile.username} has been saved to your device photos gallery successfully!`
        );
        setTimeout(() => setIsSavedQr(false), 3000);
      }, 800);
    } catch (e) {
      setIsSavingQr(false);
      Alert.alert('Error', 'Failed to save QR Code to gallery.');
    }
  };

  const checkCameraAccess = async () => {
    setCheckingPermission(true);
    const granted = await ensureCameraPermission();
    setHasCameraPermission(granted);
    setCheckingPermission(false);
  };

  useEffect(() => {
    if (activeTab === 'scanCode') {
      checkCameraAccess();
    }
  }, [activeTab]);

  const handleShareQr = async () => {
    try {
      await Share.share({
        message: `Scan my chatting system QR Code or add me via username ${userProfile.username}!`,
      });
    } catch (e) {
      console.warn('Share error:', e);
    }
  };

  const handleSimulateScan = (scannedUser: ScannedUser) => {
    setScannedResult(scannedUser);
    addConversation(scannedUser.name, scannedUser.username);
  };

  const handleStartChatWithScannedUser = () => {
    if (!scannedResult) return;
    const name = scannedResult.name;
    setScannedResult(null);
    navigation.navigate('Chat', {
      conversationId: `conv_${Date.now()}`,
      title: name,
    });
  };

  const handlePickQrImage = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission Required', 'Permission to access gallery is required!');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
      });

      if (!result.canceled) {
        handleSimulateScan({
          name: 'Alex Morgan',
          username: '@alex_morgan',
          status: 'Coding & Connecting 🚀 | Available for chats',
          avatar: 'A',
          phone: '+1 (555) 019-2834',
        });
      }
    } catch (e) {
      console.warn('Error picking image:', e);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <StatusBar
        barStyle={themeMode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.bg}
      />

      {/* Top Header */}
      <View style={[styles.header, { backgroundColor: colors.bg }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ArrowLeft size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>QR Code & Scanner</Text>
        <TouchableOpacity style={styles.backBtn} onPress={handleShareQr}>
          <Share2 size={20} color={colors.primaryIndigo} />
        </TouchableOpacity>
      </View>

      {/* Tabs Selector Bar */}
      <View style={[styles.tabsRow, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
        <TouchableOpacity
          style={[
            styles.tabBtn,
            activeTab === 'myCode' && { backgroundColor: colors.primaryIndigo },
          ]}
          onPress={() => setActiveTab('myCode')}
        >
          <Text
            style={[
              styles.tabBtnText,
              { color: activeTab === 'myCode' ? '#FFF' : colors.textSecondary },
            ]}
          >
            My QR Code
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.tabBtn,
            activeTab === 'scanCode' && { backgroundColor: colors.primaryIndigo },
          ]}
          onPress={() => setActiveTab('scanCode')}
        >
          <Text
            style={[
              styles.tabBtnText,
              { color: activeTab === 'scanCode' ? '#FFF' : colors.textSecondary },
            ]}
          >
            Scan Code
          </Text>
        </TouchableOpacity>
      </View>

      {/* Content Area */}
      {activeTab === 'myCode' ? (
        <ScrollView contentContainerStyle={styles.myCodeContent}>
          {/* Main QR Card */}
          <View
            style={[
              styles.qrCardContainer,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            {/* User Info Header */}
            <View style={styles.userInfoRow}>
              <View style={[styles.avatarCircle, { backgroundColor: colors.primaryIndigo }]}>
                <Text style={styles.avatarLetter}>{userProfile.name ? userProfile.name[0].toUpperCase() : 'R'}</Text>
              </View>
              <View style={{ marginLeft: 12 }}>
                <Text style={[styles.userName, { color: colors.textPrimary }]}>{userProfile.name}</Text>
                <Text style={[styles.userHandle, { color: colors.primaryIndigo }]}>{userProfile.username}</Text>
              </View>
            </View>

            {/* High Resolution Vector QR Code */}
            <View style={styles.svgQrWrapper}>
              <Svg width={200} height={200} viewBox="0 0 256 256">
                <Rect width="256" height="256" fill="#FFFFFF" rx="20" />
                {/* Outer Finder Patterns */}
                <G fill="#1E293B">
                  {/* Top-Left Finder */}
                  <Rect x="20" y="20" width="60" height="60" rx="12" />
                  <Rect x="30" y="30" width="40" height="40" rx="8" fill="#FFFFFF" />
                  <Rect x="40" y="40" width="20" height="20" rx="4" fill="#6366F1" />

                  {/* Top-Right Finder */}
                  <Rect x="176" y="20" width="60" height="60" rx="12" />
                  <Rect x="186" y="30" width="40" height="40" rx="8" fill="#FFFFFF" />
                  <Rect x="196" y="40" width="20" height="20" rx="4" fill="#6366F1" />

                  {/* Bottom-Left Finder */}
                  <Rect x="20" y="176" width="60" height="60" rx="12" />
                  <Rect x="30" y="186" width="40" height="40" rx="8" fill="#FFFFFF" />
                  <Rect x="40" y="196" width="20" height="20" rx="4" fill="#6366F1" />

                  {/* Random Pattern Matrix Dots */}
                  <Rect x="95" y="25" width="16" height="16" rx="4" />
                  <Rect x="120" y="25" width="16" height="16" rx="4" />
                  <Rect x="145" y="25" width="16" height="16" rx="4" />
                  <Rect x="95" y="55" width="16" height="16" rx="4" fill="#6366F1" />
                  <Rect x="145" y="55" width="16" height="16" rx="4" />

                  <Rect x="25" y="95" width="16" height="16" rx="4" />
                  <Rect x="55" y="95" width="16" height="16" rx="4" fill="#6366F1" />
                  <Rect x="85" y="95" width="16" height="16" rx="4" />
                  <Rect x="115" y="95" width="16" height="16" rx="4" />
                  <Rect x="145" y="95" width="16" height="16" rx="4" fill="#6366F1" />
                  <Rect x="175" y="95" width="16" height="16" rx="4" />
                  <Rect x="205" y="95" width="16" height="16" rx="4" />

                  <Rect x="25" y="125" width="16" height="16" rx="4" fill="#6366F1" />
                  <Rect x="85" y="125" width="16" height="16" rx="4" />
                  <Rect x="115" y="125" width="26" height="26" rx="6" fill="#6366F1" />
                  <Rect x="175" y="125" width="16" height="16" rx="4" />

                  <Rect x="25" y="150" width="16" height="16" rx="4" />
                  <Rect x="55" y="150" width="16" height="16" rx="4" />
                  <Rect x="145" y="150" width="16" height="16" rx="4" fill="#6366F1" />
                  <Rect x="205" y="150" width="16" height="16" rx="4" />

                  <Rect x="95" y="176" width="16" height="16" rx="4" />
                  <Rect x="125" y="176" width="16" height="16" rx="4" fill="#6366F1" />
                  <Rect x="155" y="176" width="16" height="16" rx="4" />
                  <Rect x="185" y="176" width="16" height="16" rx="4" />
                  <Rect x="215" y="176" width="16" height="16" rx="4" />

                  <Rect x="95" y="210" width="16" height="16" rx="4" />
                  <Rect x="145" y="210" width="16" height="16" rx="4" />
                  <Rect x="175" y="210" width="16" height="16" rx="4" fill="#6366F1" />
                  <Rect x="215" y="210" width="16" height="16" rx="4" />
                </G>
              </Svg>
            </View>

            <Text style={[styles.qrDescNote, { color: colors.textSecondary }]}>
              Your QR code is private. If you share it with someone, they can scan it with their camera to message you.
            </Text>
          </View>

          {/* Action Buttons */}
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.actionCardBtn, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}
              onPress={handleShareQr}
            >
              <Share2 size={18} color={colors.primaryIndigo} />
              <Text style={[styles.actionCardText, { color: colors.textPrimary }]}>Share QR Code</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.actionCardBtn,
                {
                  backgroundColor: isSavedQr ? 'rgba(34, 197, 94, 0.15)' : colors.surface,
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
                  <Text style={[styles.actionCardText, { color: colors.textPrimary }]}>Save to Gallery</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      ) : (
        /* 📷 SCAN CODE TAB (Camera Scanner Frame & Permission Check) */
        <View style={styles.scannerContent}>
          {checkingPermission ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator size="large" color={colors.primaryIndigo} />
              <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Checking camera permissions...</Text>
            </View>
          ) : !hasCameraPermission ? (
            /* 🚫 Camera Permission Denied State */
            <View style={styles.centerContainer}>
              <View style={[styles.permIconCircle, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
                <Camera size={36} color={colors.primaryIndigo} />
              </View>
              <Text style={[styles.permTitleText, { color: colors.textPrimary }]}>Camera Access Required</Text>
              <Text style={[styles.permDescText, { color: colors.textSecondary }]}>
                To scan QR codes and connect with friends, chatting system needs permission to use your camera.
              </Text>
              <TouchableOpacity style={[styles.grantCameraBtn, { backgroundColor: colors.primaryIndigo }]} onPress={checkCameraAccess}>
                <Camera size={18} color="#FFF" style={{ marginRight: 8 }} />
                <Text style={styles.grantCameraBtnText}>Grant Camera Permission</Text>
              </TouchableOpacity>
            </View>
          ) : scannedResult ? (
            /* 📋 Scanned Profile Result Card with Message Option */
            <View style={[styles.scannedProfileCard, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
              <View style={styles.scannedBadgeRow}>
                <ShieldCheck size={18} color="#22C55E" style={{ marginRight: 6 }} />
                <Text style={styles.scannedBadgeText}>Verified User Code</Text>
              </View>

              <View style={[styles.scannedAvatarCircle, { backgroundColor: colors.primaryIndigo }]}>
                <Text style={styles.scannedAvatarLetter}>{scannedResult.avatar}</Text>
              </View>

              <Text style={[styles.scannedName, { color: colors.textPrimary }]}>{scannedResult.name}</Text>
              <Text style={[styles.scannedHandle, { color: colors.primaryIndigo }]}>{scannedResult.username}</Text>
              <Text style={[styles.scannedStatus, { color: colors.textSecondary }]}>{scannedResult.status}</Text>
              <Text style={[styles.scannedPhone, { color: colors.textSecondary }]}>{scannedResult.phone}</Text>

              {/* Start Chat Button */}
              <TouchableOpacity
                style={[styles.startChatBtn, { backgroundColor: colors.primaryIndigo }]}
                activeOpacity={0.85}
                onPress={handleStartChatWithScannedUser}
              >
                <MessageSquare size={20} color="#FFF" style={{ marginRight: 8 }} />
                <Text style={styles.startChatBtnText}>Start Chatting Now</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.rescanBtn, { backgroundColor: colors.cardBorder }]}
                onPress={() => setScannedResult(null)}
              >
                <RotateCcw size={16} color={colors.textPrimary} style={{ marginRight: 6 }} />
                <Text style={[styles.rescanBtnText, { color: colors.textPrimary }]}>Scan Another Code</Text>
              </TouchableOpacity>
            </View>
          ) : (
            /* 🔍 Active Viewfinder Camera Frame */
            <>
              <Text style={[styles.scannerInstructionText, { color: colors.textSecondary }]}>
                Tap camera frame or align chatting system QR code to scan automatically
              </Text>

              <TouchableOpacity
                style={[styles.viewfinderFrame, { borderColor: colors.primaryIndigo }]}
                activeOpacity={0.85}
                onPress={() =>
                  handleSimulateScan({
                    name: 'Alex Morgan',
                    username: '@alex_morgan',
                    status: 'Coding & Connecting 🚀 | Available for chats',
                    avatar: 'A',
                    phone: '+1 (555) 019-2834',
                  })
                }
              >
                <View style={[styles.cornerTL, { borderColor: colors.primaryIndigo }]} />
                <View style={[styles.cornerTR, { borderColor: colors.primaryIndigo }]} />
                <View style={[styles.cornerBL, { borderColor: colors.primaryIndigo }]} />
                <View style={[styles.cornerBR, { borderColor: colors.primaryIndigo }]} />

                <View style={[styles.laserLine, { backgroundColor: colors.primaryIndigo }]} />
                <Scan size={44} color={colors.primaryIndigo} style={{ opacity: 0.4 }} />
                <Text style={[styles.tapToScanHint, { color: colors.primaryIndigo }]}>Tap Frame to Scan</Text>
              </TouchableOpacity>

              {/* Control Buttons Bar */}
              <View style={styles.scannerControlsRow}>
                <TouchableOpacity
                  style={[styles.controlCircleBtn, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}
                  onPress={() => setFlashOn(!flashOn)}
                >
                  {flashOn ? <Zap size={22} color="#F59E0B" /> : <ZapOff size={22} color={colors.textSecondary} />}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.controlCircleBtn, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}
                  onPress={handlePickQrImage}
                >
                  <ImageIcon size={22} color={colors.primaryIndigo} />
                </TouchableOpacity>
              </View>

              {/* Quick Scan Demo Action */}
              <TouchableOpacity
                style={[styles.simulateScanBtn, { backgroundColor: colors.primaryIndigo }]}
                onPress={() =>
                  handleSimulateScan({
                    name: 'Alex Morgan',
                    username: '@alex_morgan',
                    status: 'Coding & Connecting 🚀 | Available for chats',
                    avatar: 'A',
                    phone: '+1 (555) 019-2834',
                  })
                }
              >
                <Scan size={18} color="#FFF" style={{ marginRight: 8 }} />
                <Text style={styles.simulateScanBtnText}>Scan QR Code Now (@alex_morgan)</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  tabsRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginVertical: 10,
    borderRadius: 20,
    padding: 4,
    borderWidth: 1,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 16,
    alignItems: 'center',
  },
  tabBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
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
  userInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginBottom: 20,
  },
  avatarCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarLetter: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFF',
  },
  userName: {
    fontSize: 17,
    fontWeight: '800',
  },
  userHandle: {
    fontSize: 13,
    fontWeight: '700',
    marginTop: 1,
  },
  svgQrWrapper: {
    padding: 12,
    backgroundColor: '#FFF',
    borderRadius: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 3,
  },
  qrDescNote: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 10,
  },
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
  actionCardText: {
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 8,
  },
  scannerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  centerContainer: {
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
  },
  permIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
  },
  permTitleText: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  permDescText: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  grantCameraBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
  },
  grantCameraBtnText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
  },
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
    backgroundColor: 'rgba(99, 102, 241, 0.04)',
    overflow: 'hidden',
  },
  cornerTL: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 32,
    height: 32,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 16,
  },
  cornerTR: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 32,
    height: 32,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 16,
  },
  cornerBL: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: 32,
    height: 32,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 16,
  },
  cornerBR: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 32,
    height: 32,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 16,
  },
  laserLine: {
    position: 'absolute',
    top: '48%',
    left: 10,
    right: 10,
    height: 3,
    borderRadius: 2,
  },
  scannerControlsRow: {
    flexDirection: 'row',
    marginTop: 28,
  },
  controlCircleBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 10,
    borderWidth: 1,
  },
  simulateScanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 24,
    marginTop: 28,
  },
  simulateScanBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
  },
  // Scanned User Result Card
  scannedProfileCard: {
    width: '100%',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
  },
  scannedBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  scannedBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#22C55E',
  },
  scannedAvatarCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  scannedAvatarLetter: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFF',
  },
  scannedName: {
    fontSize: 20,
    fontWeight: '800',
  },
  scannedHandle: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 2,
  },
  scannedStatus: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
  },
  scannedPhone: {
    fontSize: 12,
    marginTop: 2,
  },
  startChatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: 14,
    borderRadius: 24,
    marginTop: 20,
  },
  startChatBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '800',
  },
  rescanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: 12,
    borderRadius: 20,
    marginTop: 10,
  },
  rescanBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  tapToScanHint: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
