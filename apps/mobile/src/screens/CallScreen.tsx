import React, { useState, useEffect, useRef } from 'react';
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
import { AppColors } from '../theme/colors';
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
} from 'lucide-react-native';

type Props = NativeStackScreenProps<RootStackParamList, 'Call'>;

export const CallScreen: React.FC<Props> = ({ route, navigation }) => {
  const { callId, targetUserId, isCaller, isVideo } = route.params || {
    callId: 'c1',
    targetUserId: 'Contact',
    isCaller: true,
    isVideo: false,
  };

  const { height: screenHeight, width: screenWidth } = useWindowDimensions();

  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [secondsElapsed, setSecondsElapsed] = useState(0);

  // Animated pulse rings for ringing/active state
  const pulseAnim1 = useRef(new Animated.Value(1)).current;
  const pulseAnim2 = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

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
            toValue: 1.35,
            duration: 1400,
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 1,
            duration: 1400,
            useNativeDriver: true,
          }),
        ]),
      );
    };

    const pulse1 = createPulse(pulseAnim1, 0);
    const pulse2 = createPulse(pulseAnim2, 700);

    pulse1.start();
    pulse2.start();

    return () => {
      pulse1.stop();
      pulse2.stop();
    };
  }, []);

  useEffect(() => {
    let timer: any = null;
    if (isConnected) {
      timer = setInterval(() => {
        setSecondsElapsed((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isConnected]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
      .toString()
      .padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  const handlePickUp = () => {
    setIsConnected(true);
  };

  const handleEndCall = () => {
    navigation.goBack();
  };

  const nameInitial = targetUserId ? targetUserId[0].toUpperCase() : 'C';
  const statusText = isConnected
    ? formatDuration(secondsElapsed)
    : isCaller
      ? 'Ringing...'
      : 'Incoming Call...';

  // Responsive scaling
  const avatarSize = screenHeight < 700 ? 84 : 100;
  const avatarTextSize = screenHeight < 700 ? 36 : 42;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor="#0B0E14" />

      {/* Top Header with Back button & E2EE Info */}
      <View style={styles.topHeader}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
        >
          <ArrowLeft size={20} color="#94A3B8" />
        </TouchableOpacity>

        <View style={styles.securityPill}>
          <ShieldCheck size={13} color="#10B981" />
          <Text style={styles.securityText}>End-to-End Encrypted</Text>
        </View>

        <View style={{ width: 36 }} />
      </View>

      {/* Center Caller Info with Animated Glowing Rings */}
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
                borderColor: isConnected ? 'rgba(16, 185, 129, 0.25)' : 'rgba(99, 102, 241, 0.25)',
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
                borderColor: isConnected ? 'rgba(16, 185, 129, 0.4)' : 'rgba(99, 102, 241, 0.4)',
                transform: [{ scale: pulseAnim2 }],
              },
            ]}
          />

          {/* Main Avatar */}
          <View
            style={[
              styles.avatarCircle,
              {
                width: avatarSize,
                height: avatarSize,
                borderRadius: avatarSize / 2,
                backgroundColor: isConnected ? '#4338CA' : '#6366F1',
                borderColor: isConnected ? '#10B981' : '#818CF8',
              },
            ]}
          >
            <Text style={[styles.avatarText, { fontSize: avatarTextSize }]}>{nameInitial}</Text>
          </View>
        </View>

        <Text style={styles.nameText} numberOfLines={1} ellipsizeMode="tail">
          {targetUserId}
        </Text>

        <View
          style={[
            styles.statusBadge,
            {
              backgroundColor: isConnected
                ? 'rgba(16, 185, 129, 0.15)'
                : 'rgba(99, 102, 241, 0.15)',
              borderColor: isConnected ? 'rgba(16, 185, 129, 0.3)' : 'rgba(99, 102, 241, 0.3)',
            },
          ]}
        >
          <View
            style={[styles.statusDot, { backgroundColor: isConnected ? '#10B981' : '#F59E0B' }]}
          />
          <Text style={[styles.statusText, { color: isConnected ? '#34D399' : '#FBBF24' }]}>
            {statusText}
          </Text>
        </View>

        <Text style={styles.callTypeLabel}>
          {isVideo ? 'HD Video Call' : 'Encrypted Voice Call'}
        </Text>
      </Animated.View>

      {/* Control Buttons Bar - Overflow-Proof & Responsive */}
      <View style={styles.bottomControls}>
        {isConnected ? (
          // Active Connected Call Controls (Speaker, Mute, Video, End)
          <View style={styles.connectedControlsGrid}>
            <View style={styles.controlItem}>
              <TouchableOpacity
                style={[styles.controlBtn, isSpeakerOn && styles.controlBtnActive]}
                onPress={() => setIsSpeakerOn(!isSpeakerOn)}
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
                onPress={() => setIsMuted(!isMuted)}
                activeOpacity={0.8}
              >
                {isMuted ? <MicOff size={22} color="#000" /> : <Mic size={22} color="#FFF" />}
              </TouchableOpacity>
              <Text style={styles.btnLabel}>{isMuted ? 'Unmute' : 'Mute'}</Text>
            </View>

            {isVideo && (
              <View style={styles.controlItem}>
                <TouchableOpacity
                  style={[styles.controlBtn, isCameraOff && styles.controlBtnActive]}
                  onPress={() => setIsCameraOff(!isCameraOff)}
                  activeOpacity={0.8}
                >
                  {isCameraOff ? (
                    <VideoOff size={22} color="#000" />
                  ) : (
                    <VideoIcon size={22} color="#FFF" />
                  )}
                </TouchableOpacity>
                <Text style={styles.btnLabel}>{isCameraOff ? 'Camera Off' : 'Video'}</Text>
              </View>
            )}

            <View style={styles.controlItem}>
              <TouchableOpacity
                style={styles.endCallBtn}
                onPress={handleEndCall}
                activeOpacity={0.85}
              >
                <PhoneOff size={24} color="#FFF" />
              </TouchableOpacity>
              <Text style={[styles.btnLabel, { color: '#EF4444' }]}>End Call</Text>
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
    backgroundColor: '#0B0E14',
    justifyContent: 'space-between',
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
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
  avatarCircle: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 10,
  },
  avatarText: {
    fontWeight: '800',
    color: '#FFF',
  },
  nameText: {
    fontSize: 24,
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
    color: '#64748B',
    fontWeight: '500',
    marginTop: 2,
  },
  bottomControls: {
    paddingBottom: Platform.OS === 'ios' ? 36 : 28,
    paddingHorizontal: 24,
  },
  connectedControlsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingVertical: 16,
    paddingHorizontal: 10,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
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
    fontWeight: '500',
  },
});
