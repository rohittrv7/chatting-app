import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Animated,
  Platform,
  Modal,
  useWindowDimensions,
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
  Volume2,
  VolumeX,
  ArrowLeft,
  RefreshCw,
  MessageSquare,
  Check,
  Lock,
  Activity,
  Bluetooth,
  Headphones,
  Smartphone,
  X,
} from 'lucide-react-native';
// Safe dynamic RTCView component
const SafeRTCView: React.FC<any> = (props) => {
  try {
    const webrtc = require('react-native-webrtc');
    const NativeRTCView = webrtc?.RTCView;
    if (NativeRTCView) {
      return <NativeRTCView {...props} />;
    }
  } catch (_) {}
  return (
    <View
      style={[
        props.style,
        { backgroundColor: '#0B1014', justifyContent: 'center', alignItems: 'center' },
      ]}
    >
      <Text style={{ color: '#94A3B8', fontSize: 13 }}>Video Stream</Text>
    </View>
  );
};
type MediaStream = any;

import { callService, ActiveCallSession } from '../services/callService';
import { webrtcService } from '../services/webrtcService';
import {
  audioRoutingService,
  AudioRoute,
  AudioDeviceStatus,
} from '../services/audioRoutingService';
import { SmartAvatar } from '../components/SmartAvatar';

type Props = NativeStackScreenProps<RootStackParamList, 'Call'>;

const EMOJI_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

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
  const [cameraFacing, setCameraFacing] = useState<'front' | 'back'>('front');

  // Audio Routing & Bluetooth
  const [audioStatus, setAudioStatus] = useState<AudioDeviceStatus>(
    audioRoutingService.getStatus(),
  );
  const [isRouteModalVisible, setIsRouteModalVisible] = useState(false);

  // Runtime Noise Cancellation
  const [isNoiseCancellationOn, setIsNoiseCancellationOn] = useState(
    callSession?.isNoiseSuppressionOn || false,
  );

  // Floating Reaction
  const [floatingReaction, setFloatingReaction] = useState<string | null>(null);
  const reactionAnim = useRef(new Animated.Value(0)).current;

  // WebRTC Live Media Streams
  const [localStream, setLocalStream] = useState<MediaStream | null>(
    webrtcService.getLocalStream(),
  );
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(
    webrtcService.getRemoteStream(),
  );

  const hasNavigatedBack = useRef(false);

  const safeGoBack = useCallback(() => {
    if (hasNavigatedBack.current) return;
    hasNavigatedBack.current = true;
    if (navigation.canGoBack()) {
      navigation.goBack();
    }
  }, [navigation]);

  // Subscribe to live WebRTC media streams
  useEffect(() => {
    const unsubLocal = webrtcService.subscribeLocalStream((stream) => {
      setLocalStream(stream);
    });
    const unsubRemote = webrtcService.subscribeRemoteStream((stream) => {
      setRemoteStream(stream);
    });

    return () => {
      unsubLocal();
      unsubRemote();
    };
  }, []);

  // Subscribe to live Audio Routing device changes
  useEffect(() => {
    const unsubAudio = audioRoutingService.addListener((status) => {
      setAudioStatus(status);
      setIsSpeakerOn(status.selectedDevice === 'SPEAKER_PHONE');
    });

    return unsubAudio;
  }, []);

  // Animated pulse rings for ringing/active state
  const pulseAnim1 = useRef(new Animated.Value(1)).current;
  const pulseAnim2 = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();

    const ring1 = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim1, {
          toValue: 1.3,
          duration: 1500,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim1, {
          toValue: 1,
          duration: 1500,
          useNativeDriver: true,
        }),
      ]),
    );

    const ring2 = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim2, {
          toValue: 1.5,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim2, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        }),
      ]),
    );

    ring1.start();
    ring2.start();

    return () => {
      ring1.stop();
      ring2.stop();
    };
  }, []);

  // Sync call state with CallService
  useEffect(() => {
    const unsubscribe = callService.addListener((session) => {
      setCallSession(session);
      if (session) {
        setIsMuted(session.isMuted);
        setIsSpeakerOn(session.isSpeakerOn);
        setIsVideo(session.isVideoEnabled);
        setIsConnected(session.state === 'CONNECTED');
        setSecondsElapsed(session.durationSeconds);
        setIsNoiseCancellationOn(session.isNoiseSuppressionOn);
      } else {
        safeGoBack();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [safeGoBack]);

  // Handle call termination auto-navigation
  useEffect(() => {
    if (callSession?.state === 'ENDED') {
      const timer = setTimeout(() => {
        safeGoBack();
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [callSession?.state, safeGoBack]);

  const handleToggleMute = () => {
    const newMute = callService.toggleMute();
    setIsMuted(newMute);
  };

  const handleAudioRoutePress = () => {
    // If bluetooth or headset is available, or multiple devices exist, open route picker modal
    if (
      audioStatus.hasBluetooth ||
      audioStatus.hasWiredHeadset ||
      audioStatus.availableDevices.length > 2
    ) {
      setIsRouteModalVisible(true);
    } else {
      // Direct toggle between Speaker and Earpiece
      const targetRoute: AudioRoute =
        audioStatus.selectedDevice === 'SPEAKER_PHONE' ? 'EARPIECE' : 'SPEAKER_PHONE';
      audioRoutingService.chooseAudioRoute(targetRoute);
    }
  };

  const selectAudioRoute = (route: AudioRoute) => {
    audioRoutingService.chooseAudioRoute(route);
    setIsRouteModalVisible(false);
  };

  const handleToggleVideo = () => {
    const newVideo = callService.toggleVideoSwitch();
    setIsVideo(newVideo);
  };

  const handleFlipCamera = () => {
    webrtcService.switchCamera();
    setCameraFacing((prev) => (prev === 'front' ? 'back' : 'front'));
  };

  const handleEndCall = () => {
    callService.endCall(callSession?.callId || callId);
    safeGoBack();
  };

  const handleToggleNoiseCancellation = async () => {
    const newState = await callService.toggleNoiseSuppression();
    setIsNoiseCancellationOn(newState);
  };

  const handleReaction = (emoji: string) => {
    setFloatingReaction(emoji);
    reactionAnim.setValue(0);
    Animated.sequence([
      Animated.timing(reactionAnim, {
        toValue: 1,
        duration: 1200,
        useNativeDriver: true,
      }),
    ]).start(() => setFloatingReaction(null));
  };

  const handleSendMessage = () => {
    navigation.navigate('Chat', {
      conversationId: callSession?.conversationId || (route.params as any)?.conversationId || '',
      title: displayName,
      recipientDbId: targetUserId,
      avatarUrl: avatarUrl,
    });
  };

  const formatDuration = (totalSeconds: number): string => {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const displayName =
    callSession?.targetUserName || (route.params as any)?.targetUserName || 'Contact';
  const avatarUrl = callSession?.targetUserAvatar;

  const isRinging = callSession?.state === 'OUTGOING_RINGING';
  const isCalling = callSession?.state === 'OUTGOING_CALLING';

  const isEnded = callSession?.state === 'ENDED';
  const statusText = isEnded
    ? callSession?.endReason === 'permission_denied'
      ? 'Permission Denied'
      : callSession?.endReason === 'media_error'
        ? 'Media Error'
        : 'Call Ended'
    : isConnected
      ? formatDuration(secondsElapsed)
      : isRinging
        ? 'Ringing...'
        : isCalling
          ? 'Calling...'
          : isCaller
            ? 'Calling...'
            : 'Incoming Call...';

  const hasRemoteVideo = isVideo && remoteStream && remoteStream.getVideoTracks().length > 0;
  const hasLocalVideo = isVideo && localStream && localStream.getVideoTracks().length > 0;
  const avatarSize = screenHeight < 700 ? 110 : 130;

  // Active audio route icon helper
  const renderAudioRouteIcon = (size = 22, color = '#FFF') => {
    if (audioStatus.selectedDevice === 'BLUETOOTH') {
      return <Bluetooth size={size} color={color} />;
    }
    if (audioStatus.selectedDevice === 'WIRED_HEADSET') {
      return <Headphones size={size} color={color} />;
    }
    if (audioStatus.selectedDevice === 'SPEAKER_PHONE') {
      return <Volume2 size={size} color={color} />;
    }
    return <Smartphone size={size} color={color} />;
  };

  const getAudioRouteLabel = () => {
    if (audioStatus.selectedDevice === 'BLUETOOTH') return 'Bluetooth';
    if (audioStatus.selectedDevice === 'WIRED_HEADSET') return 'Headset';
    if (audioStatus.selectedDevice === 'SPEAKER_PHONE') return 'Speaker';
    return 'Earpiece';
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor="#0B1014" />

      {/* Floating Animated Reaction */}
      {floatingReaction && (
        <Animated.View
          style={[
            styles.floatingReactionContainer,
            {
              opacity: reactionAnim.interpolate({
                inputRange: [0, 0.2, 0.8, 1],
                outputRange: [0, 1, 1, 0],
              }),
              transform: [
                {
                  translateY: reactionAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -160],
                  }),
                },
                {
                  scale: reactionAnim.interpolate({
                    inputRange: [0, 0.3, 1],
                    outputRange: [0.6, 1.4, 1],
                  }),
                },
              ],
            },
          ]}
          pointerEvents="none"
        >
          <Text style={styles.floatingReactionText}>{floatingReaction}</Text>
        </Animated.View>
      )}

      {/* Top Header matching WhatsApp Layout */}
      <View style={styles.topHeader}>
        {/* Left: Signal / Audio indicator pill */}
        <TouchableOpacity style={styles.headerPillBtn} onPress={safeGoBack} activeOpacity={0.7}>
          <Activity size={18} color="#10B981" />
        </TouchableOpacity>

        {/* Center: Recipient Name & Live Status Duration */}
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {displayName}
          </Text>
          <Text style={styles.headerSubtitle}>{statusText}</Text>
        </View>

        {/* Right: End-to-End Encryption Lock Pill */}
        <View style={styles.headerPillBtn}>
          <Lock size={16} color="#FFFFFF" />
        </View>
      </View>

      {/* Main Body */}
      {isVideo ? (
        // 📹 TRUE WEBRTC VIDEO CALL LAYOUT
        <View style={styles.videoMainContainer}>
          {/* Remote Video Stream Area */}
          <View style={styles.remoteVideoBackdrop}>
            {hasRemoteVideo ? (
              <View style={styles.remoteVideoWrapper}>
                <SafeRTCView
                  streamURL={remoteStream!.toURL()}
                  style={StyleSheet.absoluteFillObject}
                  objectFit="cover"
                  zOrder={0}
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
                  size={120}
                  style={styles.remoteVideoAvatar}
                />
                <Text style={styles.remoteVideoName} numberOfLines={1}>
                  {displayName}
                </Text>
                <Text style={styles.statusSubText}>{statusText}</Text>
              </View>
            )}
          </View>

          {/* Picture-in-Picture (PiP) Local Video Tile */}
          {hasLocalVideo && (
            <View style={styles.pipContainer}>
              <SafeRTCView
                streamURL={localStream!.toURL()}
                style={styles.pipCamera}
                objectFit="cover"
                zOrder={1}
                mirror={cameraFacing === 'front'}
              />
              <TouchableOpacity
                style={styles.pipFlipBtn}
                onPress={handleFlipCamera}
                activeOpacity={0.8}
              >
                <RefreshCw size={14} color="#FFF" />
              </TouchableOpacity>
            </View>
          )}
        </View>
      ) : (
        // 📞 TRUE WEBRTC VOICE CALL LAYOUT (Matching Screenshot)
        <Animated.View style={[styles.voiceCenterContainer, { opacity: fadeAnim }]}>
          <View style={styles.avatarSection}>
            {/* Animated Pulse Waves */}
            <Animated.View
              style={[
                styles.pulseRing,
                {
                  width: avatarSize + 56,
                  height: avatarSize + 56,
                  borderRadius: (avatarSize + 56) / 2,
                  borderColor: isConnected
                    ? 'rgba(16, 185, 129, 0.25)'
                    : 'rgba(59, 130, 246, 0.25)',
                  transform: [{ scale: pulseAnim1 }],
                },
              ]}
            />
            <Animated.View
              style={[
                styles.pulseRing,
                {
                  width: avatarSize + 28,
                  height: avatarSize + 28,
                  borderRadius: (avatarSize + 28) / 2,
                  borderColor: isConnected ? 'rgba(16, 185, 129, 0.4)' : 'rgba(59, 130, 246, 0.4)',
                  transform: [{ scale: pulseAnim2 }],
                },
              ]}
            />

            {/* Main Centered Circular Avatar */}
            <SmartAvatar
              avatarUrl={avatarUrl}
              name={displayName}
              size={avatarSize}
              borderRadius={avatarSize / 2}
              style={styles.avatar}
            />
          </View>
        </Animated.View>
      )}

      {/* Bottom Section */}
      <View style={styles.bottomSection}>
        {/* Floating Emoji Reactions Bar (Matches Screenshot) */}
        <View style={styles.reactionsBar}>
          {EMOJI_REACTIONS.map((emoji) => (
            <TouchableOpacity
              key={emoji}
              style={styles.reactionBtn}
              onPress={() => handleReaction(emoji)}
              activeOpacity={0.6}
            >
              <Text style={styles.reactionEmoji}>{emoji}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* WhatsApp-Style Action Card (Send message & Noise cancellation) */}
        <View style={styles.actionCard}>
          {/* Row 1: Send message */}
          <TouchableOpacity
            style={styles.actionRow}
            onPress={handleSendMessage}
            activeOpacity={0.7}
          >
            <View style={styles.actionIconCircle}>
              <MessageSquare size={18} color="#FFFFFF" />
            </View>
            <Text style={styles.actionText}>Send message</Text>
          </TouchableOpacity>

          <View style={styles.actionDivider} />

          {/* Row 2: Noise cancellation Toggle Switch */}
          <TouchableOpacity
            style={styles.actionRow}
            onPress={handleToggleNoiseCancellation}
            activeOpacity={0.8}
          >
            <View style={styles.actionIconCircle}>
              <Mic size={18} color="#FFFFFF" />
            </View>
            <Text style={styles.actionText}>Noise cancellation</Text>

            {/* WhatsApp Styled Toggle Switch with Checkmark */}
            <View
              style={[
                styles.switchTrack,
                isNoiseCancellationOn ? styles.switchTrackOn : styles.switchTrackOff,
              ]}
            >
              <View
                style={[
                  styles.switchThumb,
                  isNoiseCancellationOn ? styles.switchThumbOn : styles.switchThumbOff,
                ]}
              >
                {isNoiseCancellationOn && <Check size={12} color="#000000" strokeWidth={3} />}
              </View>
            </View>
          </TouchableOpacity>
        </View>

        {/* Primary Call Controls Bar */}
        <View style={styles.controlsBar}>
          {/* Mute Button */}
          <TouchableOpacity
            style={[styles.controlBtn, isMuted && styles.controlBtnActiveRed]}
            onPress={handleToggleMute}
            activeOpacity={0.7}
          >
            {isMuted ? <MicOff size={22} color="#EF4444" /> : <Mic size={22} color="#F8FAFC" />}
            <Text style={[styles.controlLabel, isMuted && { color: '#EF4444' }]}>
              {isMuted ? 'Muted' : 'Mute'}
            </Text>
          </TouchableOpacity>

          {/* Audio Route Selector Button (Bluetooth / Speaker / Earpiece) */}
          <TouchableOpacity
            style={[
              styles.controlBtn,
              audioStatus.selectedDevice === 'BLUETOOTH'
                ? styles.controlBtnActiveBlue
                : isSpeakerOn
                  ? styles.controlBtnActiveGreen
                  : null,
            ]}
            onPress={handleAudioRoutePress}
            activeOpacity={0.7}
          >
            {renderAudioRouteIcon(
              22,
              audioStatus.selectedDevice === 'BLUETOOTH'
                ? '#3B82F6'
                : isSpeakerOn
                  ? '#10B981'
                  : '#F8FAFC',
            )}
            <Text
              style={[
                styles.controlLabel,
                audioStatus.selectedDevice === 'BLUETOOTH'
                  ? { color: '#3B82F6' }
                  : isSpeakerOn
                    ? { color: '#10B981' }
                    : null,
              ]}
            >
              {getAudioRouteLabel()}
            </Text>
          </TouchableOpacity>

          {/* Video Toggle Button */}
          <TouchableOpacity
            style={[styles.controlBtn, isVideo && styles.controlBtnActiveBlue]}
            onPress={handleToggleVideo}
            activeOpacity={0.7}
          >
            {isVideo ? (
              <VideoIcon size={22} color="#3B82F6" />
            ) : (
              <VideoOff size={22} color="#94A3B8" />
            )}
            <Text style={[styles.controlLabel, isVideo && { color: '#3B82F6' }]}>
              {isVideo ? 'Video On' : 'Video'}
            </Text>
          </TouchableOpacity>

          {/* End Call Button */}
          <TouchableOpacity style={styles.endCallBtn} onPress={handleEndCall} activeOpacity={0.8}>
            <PhoneOff size={26} color="#FFF" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Audio Route Selection Bottom Sheet Modal */}
      <Modal
        visible={isRouteModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsRouteModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setIsRouteModalVisible(false)}
        >
          <View style={styles.routeSheetContainer}>
            <View style={styles.routeSheetHeader}>
              <Text style={styles.routeSheetTitle}>Select Audio Output</Text>
              <TouchableOpacity
                onPress={() => setIsRouteModalVisible(false)}
                style={styles.closeBtn}
              >
                <X size={20} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            {/* Bluetooth Route (if available) */}
            {audioStatus.hasBluetooth && (
              <TouchableOpacity
                style={[
                  styles.routeOption,
                  audioStatus.selectedDevice === 'BLUETOOTH' && styles.routeOptionActive,
                ]}
                onPress={() => selectAudioRoute('BLUETOOTH')}
              >
                <View style={styles.routeOptionLeft}>
                  <Bluetooth size={22} color="#3B82F6" />
                  <View style={styles.routeTextCol}>
                    <Text style={styles.routeOptionTitle}>Bluetooth Device</Text>
                    <Text style={styles.routeOptionSub}>Connected headset</Text>
                  </View>
                </View>
                {audioStatus.selectedDevice === 'BLUETOOTH' && <Check size={20} color="#3B82F6" />}
              </TouchableOpacity>
            )}

            {/* Wired Headset (if available) */}
            {audioStatus.hasWiredHeadset && (
              <TouchableOpacity
                style={[
                  styles.routeOption,
                  audioStatus.selectedDevice === 'WIRED_HEADSET' && styles.routeOptionActive,
                ]}
                onPress={() => selectAudioRoute('WIRED_HEADSET')}
              >
                <View style={styles.routeOptionLeft}>
                  <Headphones size={22} color="#10B981" />
                  <View style={styles.routeTextCol}>
                    <Text style={styles.routeOptionTitle}>Wired Headphones</Text>
                    <Text style={styles.routeOptionSub}>Connected via 3.5mm / Type-C</Text>
                  </View>
                </View>
                {audioStatus.selectedDevice === 'WIRED_HEADSET' && (
                  <Check size={20} color="#10B981" />
                )}
              </TouchableOpacity>
            )}

            {/* Speakerphone */}
            <TouchableOpacity
              style={[
                styles.routeOption,
                audioStatus.selectedDevice === 'SPEAKER_PHONE' && styles.routeOptionActive,
              ]}
              onPress={() => selectAudioRoute('SPEAKER_PHONE')}
            >
              <View style={styles.routeOptionLeft}>
                <Volume2 size={22} color="#10B981" />
                <View style={styles.routeTextCol}>
                  <Text style={styles.routeOptionTitle}>Speaker</Text>
                  <Text style={styles.routeOptionSub}>Loudspeaker output</Text>
                </View>
              </View>
              {audioStatus.selectedDevice === 'SPEAKER_PHONE' && (
                <Check size={20} color="#10B981" />
              )}
            </TouchableOpacity>

            {/* Phone Earpiece */}
            <TouchableOpacity
              style={[
                styles.routeOption,
                audioStatus.selectedDevice === 'EARPIECE' && styles.routeOptionActive,
              ]}
              onPress={() => selectAudioRoute('EARPIECE')}
            >
              <View style={styles.routeOptionLeft}>
                <Smartphone size={22} color="#94A3B8" />
                <View style={styles.routeTextCol}>
                  <Text style={styles.routeOptionTitle}>Phone Earpiece</Text>
                  <Text style={styles.routeOptionSub}>Hold phone to ear</Text>
                </View>
              </View>
              {audioStatus.selectedDevice === 'EARPIECE' && <Check size={20} color="#10B981" />}
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1014',
    justifyContent: 'space-between',
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 14 : 8,
    zIndex: 10,
  },
  headerPillBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(30, 36, 43, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  headerCenter: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    paddingHorizontal: 8,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  headerSubtitle: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '500',
    marginTop: 2,
    textAlign: 'center',
  },
  voiceCenterContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    flex: 1,
  },
  avatarSection: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    borderWidth: 1.5,
  },
  avatar: {
    borderWidth: 3.5,
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  bottomSection: {
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === 'android' ? 20 : 10,
    zIndex: 10,
  },
  reactionsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: 'rgba(30, 36, 43, 0.92)',
    borderRadius: 28,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  reactionBtn: {
    padding: 6,
  },
  reactionEmoji: {
    fontSize: 24,
  },
  floatingReactionContainer: {
    position: 'absolute',
    top: '40%',
    alignSelf: 'center',
    zIndex: 50,
  },
  floatingReactionText: {
    fontSize: 72,
  },
  actionCard: {
    backgroundColor: 'rgba(30, 36, 43, 0.95)',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 6,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  actionIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  actionText: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  actionDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginLeft: 50,
  },
  switchTrack: {
    width: 50,
    height: 30,
    borderRadius: 15,
    padding: 3,
    justifyContent: 'center',
  },
  switchTrackOn: {
    backgroundColor: '#FFFFFF',
  },
  switchTrackOff: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  switchThumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchThumbOn: {
    backgroundColor: '#000000',
    alignSelf: 'flex-end',
  },
  switchThumbOff: {
    backgroundColor: '#FFFFFF',
    alignSelf: 'flex-start',
  },
  controlsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: 'rgba(30, 36, 43, 0.85)',
    borderRadius: 28,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  controlBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  controlBtnActiveRed: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
  },
  controlBtnActiveGreen: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.4)',
  },
  controlBtnActiveBlue: {
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.4)',
  },
  controlLabel: {
    fontSize: 10,
    color: '#94A3B8',
    fontWeight: '600',
    marginTop: 4,
  },
  endCallBtn: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  videoMainContainer: {
    flex: 1,
    position: 'relative',
    marginHorizontal: 12,
    marginVertical: 10,
    borderRadius: 24,
    overflow: 'hidden',
  },
  remoteVideoBackdrop: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderRadius: 24,
    overflow: 'hidden',
  },
  remoteVideoWrapper: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  remoteOverlayInfo: {
    position: 'absolute',
    top: 16,
    left: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  remoteOverlayName: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700',
  },
  remoteOverlayDuration: {
    color: '#10B981',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  remoteVideoAvatarContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  remoteVideoAvatar: {
    borderWidth: 3,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    marginBottom: 16,
  },
  remoteVideoName: {
    color: '#FFF',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  statusSubText: {
    color: '#10B981',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 6,
  },
  pipContainer: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 100,
    height: 140,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.25)',
    backgroundColor: '#000',
    elevation: 8,
  },
  pipCamera: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  pipFlipBtn: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
  },
  routeSheetContainer: {
    backgroundColor: '#1E242B',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: Platform.OS === 'android' ? 32 : 40,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  routeSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255, 255, 255, 0.12)',
  },
  routeSheetTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  closeBtn: {
    padding: 4,
  },
  routeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 16,
    marginBottom: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  routeOptionActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  routeOptionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  routeTextCol: {
    marginLeft: 14,
  },
  routeOptionTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  routeOptionSub: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
  },
});
