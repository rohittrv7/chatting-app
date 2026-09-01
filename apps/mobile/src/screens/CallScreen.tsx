import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Animated,
  Platform,
  useWindowDimensions,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import {
  Mic,
  MicOff,
  Video as VideoIcon,
  VideoOff,
  PhoneOff,
  Phone,
  ShieldCheck,
  Volume2,
  VolumeX,
  ArrowLeft,
  RefreshCw,
  Camera,
} from 'lucide-react-native';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import { callService, ActiveCallSession } from '../services/callService';
import { soundService } from '../services/soundService';
import { socketService } from '../services/socket';
import { SmartAvatar } from '../components/SmartAvatar';

type Props = NativeStackScreenProps<RootStackParamList, 'Call'>;

export const CallScreen: React.FC<Props> = ({ route, navigation }) => {
  const {
    callId,
    targetUserId,
    isCaller,
    isVideo: initialIsVideo,
  } = route.params || {
    callId: 'c1',
    targetUserId: 'Contact',
    isCaller: true,
    isVideo: false,
  };

  const { height: screenHeight, width: screenWidth } = useWindowDimensions();

  const [callSession, setCallSession] = useState<ActiveCallSession | null>(
    callService.getSession(),
  );
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [isVideo, setIsVideo] = useState(initialIsVideo || false);
  const [isConnected, setIsConnected] = useState(false);
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const [cameraFacing, setCameraFacing] = useState<CameraType>('front');
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [remoteVideoFrame, setRemoteVideoFrame] = useState<string | null>(null);

  const cameraRef = useRef<CameraView>(null);
  const hasNavigatedBack = useRef(false);

  const safeGoBack = useCallback(() => {
    if (hasNavigatedBack.current) return;
    hasNavigatedBack.current = true;
    if (navigation.canGoBack()) {
      navigation.goBack();
    }
  }, [navigation]);

  // Request camera permission when video is enabled
  useEffect(() => {
    if (isVideo && !cameraPermission?.granted) {
      requestCameraPermission();
    }
  }, [isVideo, cameraPermission, requestCameraPermission]);

  // Listen for remote video stream frames
  useEffect(() => {
    const handleRemoteFrame = (data: { callId: string; frameBase64: string }) => {
      if (data?.frameBase64) {
        setRemoteVideoFrame(data.frameBase64);
      }
    };

    socketService.on('call:video-frame', handleRemoteFrame);
    return () => {
      socketService.off('call:video-frame', handleRemoteFrame);
    };
  }, []);

  // Continuous live camera frame capture loop for video streaming
  useEffect(() => {
    let isStreaming = true;
    let timer: any = null;

    const captureAndStreamFrame = async () => {
      if (!isStreaming || !isVideo || !cameraPermission?.granted || !cameraRef.current) {
        return;
      }

      try {
        const targetId = callSession?.targetUserId || targetUserId;
        const currentCallId = callSession?.callId || callId;

        if (targetId && currentCallId && isConnected) {
          const photo = await cameraRef.current.takePictureAsync({
            quality: 0.25,
            base64: true,
            skipProcessing: true,
            shutterSound: false,
          });

          if (photo?.base64 && isStreaming) {
            const dataUri = `data:image/jpeg;base64,${photo.base64}`;
            socketService.emit('call:video-frame', {
              callId: currentCallId,
              targetUserId: targetId,
              frameBase64: dataUri,
              timestamp: Date.now(),
            });
          }
        }
      } catch (_) {}

      if (isStreaming && isVideo) {
        timer = setTimeout(captureAndStreamFrame, 900);
      }
    };

    if (isVideo && isConnected && cameraPermission?.granted) {
      timer = setTimeout(captureAndStreamFrame, 1000);
    }

    return () => {
      isStreaming = false;
      if (timer) clearTimeout(timer);
    };
  }, [
    isVideo,
    isConnected,
    cameraPermission?.granted,
    callSession?.targetUserId,
    callSession?.callId,
    targetUserId,
    callId,
  ]);

  // Animated pulse rings for ringing/active state
  const pulseAnim1 = useRef(new Animated.Value(1)).current;
  const pulseAnim2 = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const handleCallState = (session: ActiveCallSession | null) => {
      setCallSession(session);
      if (!session || session.state === 'ENDED') {
        soundService.stopCallSounds();
        setTimeout(() => {
          safeGoBack();
        }, 500);
        return;
      }

      if (session.state === 'CONNECTED') {
        soundService.stopCallSounds();
      }

      setIsConnected(session.state === 'CONNECTED');
      setIsMuted(session.isMuted);
      setIsSpeakerOn(session.isSpeakerOn);
      setIsVideo(session.callType === 'video' || session.isVideoEnabled);
      setSecondsElapsed(session.durationSeconds);
    };

    callService.addListener(handleCallState);
    return () => {
      callService.removeListener(handleCallState);
      soundService.stopCallSounds();
    };
  }, [safeGoBack]);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();

    const createPulse = (anim: Animated.Value, delay: number) => {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, {
            toValue: 1.4,
            duration: 1200,
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 1,
            duration: 1200,
            useNativeDriver: true,
          }),
        ]),
      );
    };

    const p1 = createPulse(pulseAnim1, 0);
    const p2 = createPulse(pulseAnim2, 400);

    p1.start();
    p2.start();

    return () => {
      p1.stop();
      p2.stop();
    };
  }, []);

  const formatDuration = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remSecs = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${remSecs.toString().padStart(2, '0')}`;
  };

  const handlePickUp = () => {
    callService.acceptCall();
    setIsConnected(true);
  };

  const handleEndCall = () => {
    if (callSession) {
      callService.endCall();
    }
    safeGoBack();
  };

  const handleToggleMute = () => {
    const muted = callService.toggleMute();
    setIsMuted(muted);
  };

  const handleToggleSpeaker = () => {
    const speaker = callService.toggleSpeaker();
    setIsSpeakerOn(speaker);
  };

  const handleToggleVideo = () => {
    const videoOn = callService.toggleVideoSwitch();
    setIsVideo(videoOn);
  };

  const handleFlipCamera = () => {
    setCameraFacing((prev) => (prev === 'front' ? 'back' : 'front'));
  };

  const displayName = callSession?.targetUserName || targetUserId || 'Contact';
  const avatarUrl = callSession?.targetUserAvatar;

  const isRinging = callSession?.state === 'OUTGOING_RINGING';
  const isCalling = callSession?.state === 'OUTGOING_CALLING';

  const statusText = isConnected
    ? formatDuration(secondsElapsed)
    : isRinging
      ? 'Ringing...'
      : isCalling
        ? 'Calling...'
        : isCaller
          ? 'Calling...'
          : 'Incoming Call...';

  const statusDotColor = isConnected || isRinging ? '#10B981' : '#F59E0B';
  const statusTextColor = isConnected || isRinging ? '#34D399' : '#FBBF24';
  const statusBadgeBg =
    isConnected || isRinging ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)';
  const statusBadgeBorder =
    isConnected || isRinging ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)';

  // Responsive scaling
  const avatarSize = screenHeight < 700 ? 90 : 110;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor="#070A12" />

      {/* Top Header with Back button & E2EE Info */}
      <View style={styles.topHeader}>
        <TouchableOpacity style={styles.backButton} onPress={safeGoBack} activeOpacity={0.7}>
          <ArrowLeft size={20} color="#94A3B8" />
        </TouchableOpacity>

        <View style={styles.securityPill}>
          <ShieldCheck size={13} color="#10B981" />
          <Text style={styles.securityText}>End-to-End Encrypted</Text>
        </View>

        {isVideo && cameraPermission?.granted ? (
          <TouchableOpacity
            style={styles.flipCameraHeaderBtn}
            onPress={handleFlipCamera}
            activeOpacity={0.7}
          >
            <RefreshCw size={18} color="#FFF" />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 38 }} />
        )}
      </View>

      {/* Main Body */}
      {isVideo ? (
        // 📹 TWO-WAY VIDEO CALL LAYOUT
        <View style={styles.videoMainContainer}>
          {/* Remote Video Stream Area */}
          <View style={styles.remoteVideoBackdrop}>
            {remoteVideoFrame ? (
              <View style={styles.remoteVideoWrapper}>
                <Image
                  source={{ uri: remoteVideoFrame }}
                  style={StyleSheet.absoluteFillObject}
                  resizeMode="cover"
                />
                <View style={styles.remoteOverlayInfo}>
                  <Text style={styles.remoteOverlayName} numberOfLines={1}>
                    {displayName}
                  </Text>
                  <Text style={styles.remoteOverlayDuration}>{formatDuration(secondsElapsed)}</Text>
                </View>
              </View>
            ) : (
              <View style={styles.remoteVideoAvatarContainer}>
                <SmartAvatar
                  avatarUrl={avatarUrl}
                  name={displayName}
                  size={110}
                  style={styles.remoteVideoAvatar}
                />
                <Text style={styles.remoteVideoName} numberOfLines={1}>
                  {displayName}
                </Text>
                <View
                  style={[
                    styles.statusBadge,
                    {
                      backgroundColor: statusBadgeBg,
                      borderColor: statusBadgeBorder,
                      marginTop: 6,
                    },
                  ]}
                >
                  <View style={[styles.statusDot, { backgroundColor: statusDotColor }]} />
                  <Text style={[styles.statusText, { color: statusTextColor }]}>{statusText}</Text>
                </View>
                <Text style={styles.callTypeLabel}>WhatsApp Live HD Video</Text>
              </View>
            )}
          </View>

          {/* Picture-in-Picture (PiP) Local Camera Tile */}
          {cameraPermission?.granted ? (
            <View style={styles.pipContainer}>
              <CameraView
                ref={cameraRef}
                facing={cameraFacing}
                style={styles.pipCamera}
                mute={true}
              >
                <TouchableOpacity
                  style={styles.pipFlipBtn}
                  onPress={handleFlipCamera}
                  activeOpacity={0.8}
                >
                  <RefreshCw size={14} color="#FFF" />
                </TouchableOpacity>
              </CameraView>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.pipPermissionCard}
              onPress={requestCameraPermission}
              activeOpacity={0.8}
            >
              <Camera size={20} color="#10B981" />
              <Text style={styles.pipPermissionText}>Enable Camera</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        // 📞 VOICE CALL LAYOUT
        <Animated.View style={[styles.centerContainer, { opacity: fadeAnim }]}>
          <View style={styles.avatarSection}>
            {/* Outer Pulse Rings */}
            <Animated.View
              style={[
                styles.pulseRing,
                {
                  width: avatarSize + 48,
                  height: avatarSize + 48,
                  borderRadius: (avatarSize + 48) / 2,
                  borderColor:
                    isConnected || isRinging
                      ? 'rgba(16, 185, 129, 0.25)'
                      : 'rgba(245, 158, 11, 0.25)',
                  transform: [{ scale: pulseAnim1 }],
                },
              ]}
            />
            <Animated.View
              style={[
                styles.pulseRing,
                {
                  width: avatarSize + 24,
                  height: avatarSize + 24,
                  borderRadius: (avatarSize + 24) / 2,
                  borderColor:
                    isConnected || isRinging
                      ? 'rgba(16, 185, 129, 0.4)'
                      : 'rgba(245, 158, 11, 0.4)',
                  transform: [{ scale: pulseAnim2 }],
                },
              ]}
            />

            {/* Main SmartAvatar */}
            <SmartAvatar
              avatarUrl={avatarUrl}
              name={displayName}
              size={avatarSize}
              borderRadius={avatarSize / 2}
              style={{
                borderWidth: 3,
                borderColor: isConnected || isRinging ? '#10B981' : '#F59E0B',
              }}
            />
          </View>

          <Text style={styles.nameText} numberOfLines={1} ellipsizeMode="tail">
            {displayName}
          </Text>

          <View
            style={[
              styles.statusBadge,
              {
                backgroundColor: statusBadgeBg,
                borderColor: statusBadgeBorder,
              },
            ]}
          >
            <View style={[styles.statusDot, { backgroundColor: statusDotColor }]} />
            <Text style={[styles.statusText, { color: statusTextColor }]}>{statusText}</Text>
          </View>

          <Text style={styles.callTypeLabel}>WhatsApp Encrypted Voice Call</Text>
        </Animated.View>
      )}

      {/* Control Buttons Bar */}
      <View style={styles.bottomControls}>
        {isConnected ? (
          // Active Connected Call Controls (Speaker, Mute, Video, End)
          <View style={styles.connectedControlsGrid}>
            <View style={styles.controlItem}>
              <TouchableOpacity
                style={[styles.controlBtn, isSpeakerOn && styles.controlBtnActive]}
                onPress={handleToggleSpeaker}
                activeOpacity={0.8}
              >
                {isSpeakerOn ? (
                  <Volume2 size={22} color="#000" />
                ) : (
                  <VolumeX size={22} color="#FFF" />
                )}
              </TouchableOpacity>
              <Text style={styles.btnLabel}>Speaker</Text>
            </View>

            <View style={styles.controlItem}>
              <TouchableOpacity
                style={[styles.controlBtn, isMuted && styles.controlBtnActive]}
                onPress={handleToggleMute}
                activeOpacity={0.8}
              >
                {isMuted ? <MicOff size={22} color="#000" /> : <Mic size={22} color="#FFF" />}
              </TouchableOpacity>
              <Text style={styles.btnLabel}>{isMuted ? 'Unmute' : 'Mute'}</Text>
            </View>

            <View style={styles.controlItem}>
              <TouchableOpacity
                style={[styles.controlBtn, isVideo && styles.controlBtnActive]}
                onPress={handleToggleVideo}
                activeOpacity={0.8}
              >
                {isVideo ? (
                  <VideoIcon size={22} color="#000" />
                ) : (
                  <VideoOff size={22} color="#FFF" />
                )}
              </TouchableOpacity>
              <Text style={styles.btnLabel}>{isVideo ? 'Audio' : 'Video'}</Text>
            </View>

            <View style={styles.controlItem}>
              <TouchableOpacity
                style={styles.endCallBtn}
                onPress={handleEndCall}
                activeOpacity={0.85}
              >
                <PhoneOff size={24} color="#FFF" />
              </TouchableOpacity>
              <Text style={[styles.btnLabel, { color: '#EF4444' }]}>End</Text>
            </View>
          </View>
        ) : isCaller ? (
          // Outgoing Call Controls: Cancel Call
          <View style={styles.singleActionRow}>
            <View style={styles.controlItem}>
              <TouchableOpacity
                style={styles.endCallBtnLarge}
                onPress={handleEndCall}
                activeOpacity={0.85}
              >
                <PhoneOff size={28} color="#FFF" />
              </TouchableOpacity>
              <Text style={[styles.btnLabel, { color: '#EF4444', fontWeight: '700' }]}>
                Cancel Call
              </Text>
            </View>
          </View>
        ) : (
          // Incoming Call Controls: Decline (Red) & Accept (Green)
          <View style={styles.incomingControlsRow}>
            <View style={styles.controlItem}>
              <TouchableOpacity
                style={styles.endCallBtnLarge}
                onPress={handleEndCall}
                activeOpacity={0.85}
              >
                <PhoneOff size={26} color="#FFF" />
              </TouchableOpacity>
              <Text style={[styles.btnLabel, { color: '#EF4444' }]}>Decline</Text>
            </View>

            <View style={styles.controlItem}>
              <TouchableOpacity
                style={styles.pickUpBtnLarge}
                onPress={handlePickUp}
                activeOpacity={0.85}
              >
                <Phone size={28} color="#FFF" />
              </TouchableOpacity>
              <Text style={[styles.btnLabel, { color: '#10B981', fontWeight: '700' }]}>Accept</Text>
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#070A12',
    justifyContent: 'space-between',
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 10,
    zIndex: 10,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  flipCameraHeaderBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  securityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.25)',
  },
  securityText: {
    color: '#10B981',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 6,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  avatarSection: {
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  pulseRing: {
    position: 'absolute',
    borderWidth: 2,
  },
  nameText: {
    fontSize: 26,
    fontWeight: '800',
    color: '#F8FAFC',
    textAlign: 'center',
    marginBottom: 10,
    maxWidth: '85%',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '700',
  },
  callTypeLabel: {
    fontSize: 13,
    color: '#94A3B8',
    fontWeight: '600',
    marginTop: 4,
  },
  // 📹 Video Call Specific Styles
  videoMainContainer: {
    flex: 1,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  remoteVideoBackdrop: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 24,
    marginVertical: 8,
    overflow: 'hidden',
  },
  remoteVideoWrapper: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    justifyContent: 'flex-end',
  },
  remoteOverlayInfo: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  remoteOverlayName: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
  remoteOverlayDuration: {
    color: '#10B981',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  remoteVideoAvatarContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  remoteVideoAvatar: {
    marginBottom: 16,
    shadowColor: '#38BDF8',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 18,
    elevation: 12,
  },
  remoteVideoName: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFF',
    marginBottom: 4,
    textAlign: 'center',
  },
  pipContainer: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 115,
    height: 165,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#38BDF8',
    backgroundColor: '#000',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.6,
    shadowRadius: 12,
    elevation: 14,
  },
  pipCamera: {
    flex: 1,
    position: 'relative',
  },
  pipFlipBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pipPermissionCard: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 115,
    height: 150,
    borderRadius: 18,
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 8,
  },
  pipPermissionText: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 6,
  },
  // Bottom Controls
  bottomControls: {
    paddingBottom: Platform.OS === 'ios' ? 36 : 28,
    paddingHorizontal: 24,
  },
  connectedControlsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingVertical: 16,
    paddingHorizontal: 10,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  singleActionRow: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  incomingControlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  controlItem: {
    alignItems: 'center',
  },
  controlBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  controlBtnActive: {
    backgroundColor: '#FFF',
  },
  endCallBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
  },
  endCallBtnLarge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
  },
  pickUpBtnLarge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#10B981',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
  },
  btnLabel: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 6,
    fontWeight: '600',
  },
});
