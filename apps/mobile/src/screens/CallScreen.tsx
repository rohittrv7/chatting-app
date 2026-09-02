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
} from 'lucide-react-native';
import { RTCView, MediaStream } from 'react-native-webrtc';
import { callService, ActiveCallSession } from '../services/callService';
import { webrtcService } from '../services/webrtcService';
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
  const [cameraFacing, setCameraFacing] = useState<'front' | 'back'>('front');

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

  const handleToggleSpeaker = () => {
    const newSpeaker = callService.toggleSpeaker();
    setIsSpeakerOn(newSpeaker);
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

  const statusText = isConnected
    ? formatDuration(secondsElapsed)
    : isRinging
      ? 'Ringing...'
      : isCalling
        ? 'Calling...'
        : isCaller
          ? 'Calling...'
          : 'Incoming Call...';

  const statusBadgeBg = isConnected
    ? 'rgba(16, 185, 129, 0.15)'
    : isRinging
      ? 'rgba(59, 130, 246, 0.15)'
      : 'rgba(245, 158, 11, 0.15)';

  const statusBadgeBorder = isConnected
    ? 'rgba(16, 185, 129, 0.35)'
    : isRinging
      ? 'rgba(59, 130, 246, 0.35)'
      : 'rgba(245, 158, 11, 0.35)';

  const statusDotColor = isConnected ? '#10B981' : isRinging ? '#3B82F6' : '#F59E0B';
  const statusTextColor = isConnected ? '#10B981' : isRinging ? '#60A5FA' : '#FBBF24';

  const hasRemoteVideo = isVideo && remoteStream && remoteStream.getVideoTracks().length > 0;
  const hasLocalVideo = isVideo && localStream && localStream.getVideoTracks().length > 0;
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

        {isVideo && hasLocalVideo ? (
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

      {/* Main Video or Voice Call Body */}
      {isVideo ? (
        // 📹 TRUE WEBRTC VIDEO CALL LAYOUT
        <View style={styles.videoMainContainer}>
          {/* Remote Video Stream Area */}
          <View style={styles.remoteVideoBackdrop}>
            {hasRemoteVideo ? (
              <View style={styles.remoteVideoWrapper}>
                <RTCView
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
                <Text style={styles.callTypeLabel}>WebRTC Live HD Video</Text>
              </View>
            )}
          </View>

          {/* Picture-in-Picture (PiP) Local Video Tile */}
          {hasLocalVideo && (
            <View style={styles.pipContainer}>
              <RTCView
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
        // 📞 TRUE WEBRTC VOICE CALL LAYOUT
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
              style={styles.avatar}
            />
          </View>

          <Text style={styles.callerName} numberOfLines={1}>
            {displayName}
          </Text>

          {/* Live Status Badge */}
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

          <Text style={styles.callTypeLabel}>WebRTC HD Voice Call</Text>
        </Animated.View>
      )}

      {/* Control Buttons Bar */}
      <View style={styles.controlsWrapper}>
        <View style={styles.controlsCard}>
          {/* Mute Button */}
          <TouchableOpacity
            style={[styles.controlBtn, isMuted && styles.controlBtnActive]}
            onPress={handleToggleMute}
            activeOpacity={0.7}
          >
            {isMuted ? <MicOff size={22} color="#EF4444" /> : <Mic size={22} color="#F8FAFC" />}
            <Text style={[styles.controlLabel, isMuted && { color: '#EF4444' }]}>
              {isMuted ? 'Muted' : 'Mute'}
            </Text>
          </TouchableOpacity>

          {/* Speaker Button */}
          <TouchableOpacity
            style={[styles.controlBtn, isSpeakerOn && styles.controlBtnActiveGreen]}
            onPress={handleToggleSpeaker}
            activeOpacity={0.7}
          >
            {isSpeakerOn ? (
              <Volume2 size={22} color="#10B981" />
            ) : (
              <VolumeX size={22} color="#94A3B8" />
            )}
            <Text style={[styles.controlLabel, isSpeakerOn && { color: '#10B981' }]}>
              {isSpeakerOn ? 'Speaker' : 'Earpiece'}
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
              {isVideo ? 'Video On' : 'Video Off'}
            </Text>
          </TouchableOpacity>

          {/* End Call Button */}
          <TouchableOpacity style={styles.endCallBtn} onPress={handleEndCall} activeOpacity={0.8}>
            <PhoneOff size={26} color="#FFF" />
          </TouchableOpacity>
        </View>
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
    paddingTop: Platform.OS === 'android' ? 14 : 6,
    zIndex: 10,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  securityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.25)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
  },
  securityText: {
    color: '#10B981',
    fontSize: 11,
    fontWeight: '600',
    marginLeft: 6,
  },
  flipCameraHeaderBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    flex: 1,
  },
  avatarSection: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  pulseRing: {
    position: 'absolute',
    borderWidth: 1.5,
  },
  avatar: {
    borderWidth: 3,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  callerName: {
    fontSize: 26,
    fontWeight: '700',
    color: '#F8FAFC',
    marginBottom: 8,
    textAlign: 'center',
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
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  callTypeLabel: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
    marginTop: 4,
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
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
  controlsWrapper: {
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'android' ? 24 : 12,
    zIndex: 10,
  },
  controlsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: 'rgba(30, 41, 59, 0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 28,
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  controlBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  controlBtnActive: {
    backgroundColor: 'rgba(239, 68, 68, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
  },
  controlBtnActiveGreen: {
    backgroundColor: 'rgba(16, 185, 129, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.4)',
  },
  controlBtnActiveBlue: {
    backgroundColor: 'rgba(59, 130, 246, 0.18)',
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
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
});
