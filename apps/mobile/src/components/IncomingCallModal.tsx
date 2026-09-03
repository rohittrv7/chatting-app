import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Animated,
  StatusBar,
  Image,
  Dimensions,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Phone,
  PhoneOff,
  Video as VideoIcon,
  ShieldCheck,
  MessageSquare,
  Sparkles,
} from 'lucide-react-native';
import { callService, ActiveCallSession } from '../services/callService';
import { soundService } from '../services/soundService';
import { socketService } from '../services/socket';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface Props {
  navigationRef?: any;
}

export const IncomingCallModal: React.FC<Props> = ({ navigationRef }) => {
  const [callSession, setCallSession] = useState<ActiveCallSession | null>(null);

  // Animated pulse rings for incoming ringtone effect
  const pulseAnim1 = useRef(new Animated.Value(1)).current;
  const pulseAnim2 = useRef(new Animated.Value(1)).current;
  const pulseAnim3 = useRef(new Animated.Value(1)).current;
  const acceptButtonPulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const handleCallState = (session: ActiveCallSession | null) => {
      setCallSession(session);
      if (!session || session.state === 'CONNECTED' || session.state === 'ENDED') {
        soundService.stopCallSounds();
      }
    };

    const handleDirectCancelOrEnd = (payload: any) => {
      console.log('📞 [IncomingCallModal] Direct cancel/end event received:', payload);
      soundService.stopCallSounds();
      setCallSession(null);
    };

    callService.addListener(handleCallState);
    socketService.on('call:ended', handleDirectCancelOrEnd);
    socketService.on('call:cancelled', handleDirectCancelOrEnd);
    socketService.on('call:cancel', handleDirectCancelOrEnd);
    socketService.on('call:end', handleDirectCancelOrEnd);
    const handleStatus = (data: any) => {
      if (data?.status === 'ENDED') handleDirectCancelOrEnd(data);
    };
    socketService.on('call:status', handleStatus);

    return () => {
      callService.removeListener(handleCallState);
      socketService.off('call:ended', handleDirectCancelOrEnd);
      socketService.off('call:cancelled', handleDirectCancelOrEnd);
      socketService.off('call:cancel', handleDirectCancelOrEnd);
      socketService.off('call:end', handleDirectCancelOrEnd);
      socketService.off('call:status', handleStatus);
      soundService.stopCallSounds();
    };
  }, []);

  const isVisible = callSession?.state === 'INCOMING_RINGING';

  useEffect(() => {
    if (isVisible) {
      const createPulse = (anim: Animated.Value, delay: number, maxScale = 1.6) => {
        return Animated.loop(
          Animated.sequence([
            Animated.delay(delay),
            Animated.timing(anim, {
              toValue: maxScale,
              duration: 1600,
              useNativeDriver: true,
            }),
            Animated.timing(anim, {
              toValue: 1,
              duration: 1600,
              useNativeDriver: true,
            }),
          ]),
        );
      };

      const p1 = createPulse(pulseAnim1, 0, 1.45);
      const p2 = createPulse(pulseAnim2, 500, 1.65);
      const p3 = createPulse(pulseAnim3, 1000, 1.85);

      const acceptLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(acceptButtonPulse, {
            toValue: 1.1,
            duration: 700,
            useNativeDriver: true,
          }),
          Animated.timing(acceptButtonPulse, {
            toValue: 1,
            duration: 700,
            useNativeDriver: true,
          }),
        ]),
      );

      p1.start();
      p2.start();
      p3.start();
      acceptLoop.start();

      return () => {
        p1.stop();
        p2.stop();
        p3.stop();
        acceptLoop.stop();
        soundService.stopCallSounds();
      };
    }
  }, [isVisible]);

  const handleAccept = () => {
    soundService.stopCallSounds();
    const session = callSession;
    callService.acceptCall();
    const nav = navigationRef?.current || navigationRef;
    if (nav?.navigate && session) {
      nav.navigate('Call', {
        callId: session.callId,
        targetUserId: session.callerId || session.targetUserId,
        isCaller: false,
        isVideo: session.callType === 'video',
      });
    }
  };

  const handleDecline = () => {
    soundService.stopCallSounds();
    callService.rejectCall();
  };

  if (!isVisible || !callSession) return null;

  const isVideo = callSession?.callType === 'video';
  const nameInitial = callSession?.callerName ? callSession.callerName[0].toUpperCase() : 'C';

  return (
    <View style={styles.modalOverlay}>
      <StatusBar barStyle="light-content" backgroundColor="#070A12" />
      <SafeAreaView style={styles.container}>
        {/* Background glow effects */}
        <View style={styles.backgroundBlob} />

        {/* Top Header info */}
        <View style={styles.topSection}>
          <View style={styles.securityBadge}>
            <ShieldCheck size={14} color="#10B981" />
            <Text style={styles.securityText}>End-to-End Encrypted</Text>
          </View>
          <Text style={styles.incomingLabel}>
            {isVideo ? 'Incoming Video Call...' : 'Incoming Voice Call...'}
          </Text>
        </View>

        {/* Center: Caller Avatar & Name */}
        <View style={styles.centerSection}>
          <View style={styles.avatarWrapper}>
            {/* Animated Pulse Waves */}
            <Animated.View
              style={[styles.pulseWave, { transform: [{ scale: pulseAnim1 }], opacity: 0.4 }]}
            />
            <Animated.View
              style={[styles.pulseWave, { transform: [{ scale: pulseAnim2 }], opacity: 0.25 }]}
            />
            <Animated.View
              style={[styles.pulseWave, { transform: [{ scale: pulseAnim3 }], opacity: 0.12 }]}
            />

            {callSession.callerAvatar ? (
              <Image source={{ uri: callSession.callerAvatar }} style={styles.avatarImage} />
            ) : (
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarInitial}>{nameInitial}</Text>
              </View>
            )}
          </View>

          <Text style={styles.callerName} numberOfLines={1}>
            {callSession.callerName}
          </Text>

          <View style={styles.callTypePill}>
            {isVideo ? (
              <VideoIcon size={16} color="#60A5FA" style={{ marginRight: 6 }} />
            ) : (
              <Phone size={15} color="#34D399" style={{ marginRight: 6 }} />
            )}
            <Text style={styles.callTypeSubtitle}>
              {isVideo ? 'WhatsApp HD Video Call' : 'WhatsApp Voice Call'}
            </Text>
          </View>
        </View>

        {/* Bottom Actions */}
        <View style={styles.bottomSection}>
          <View style={styles.actionsRow}>
            {/* Decline Button */}
            <View style={styles.actionCol}>
              <TouchableOpacity
                activeOpacity={0.8}
                style={styles.declineBtn}
                onPress={handleDecline}
              >
                <PhoneOff size={32} color="#FFF" />
              </TouchableOpacity>
              <Text style={styles.actionLabel}>Decline</Text>
            </View>

            {/* Accept Button */}
            <View style={styles.actionCol}>
              <Animated.View style={{ transform: [{ scale: acceptButtonPulse }] }}>
                <TouchableOpacity
                  activeOpacity={0.85}
                  style={styles.acceptBtn}
                  onPress={handleAccept}
                >
                  {isVideo ? (
                    <VideoIcon size={32} color="#FFF" />
                  ) : (
                    <Phone size={32} color="#FFF" />
                  )}
                </TouchableOpacity>
              </Animated.View>
              <Text style={styles.actionLabel}>Accept</Text>
            </View>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 999999,
    elevation: 999999,
    backgroundColor: '#070A12',
  },
  container: {
    flex: 1,
    backgroundColor: '#070A12',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Platform.OS === 'ios' ? 24 : 36,
  },
  backgroundBlob: {
    position: 'absolute',
    top: '20%',
    width: SCREEN_WIDTH * 1.2,
    height: SCREEN_WIDTH * 1.2,
    borderRadius: (SCREEN_WIDTH * 1.2) / 2,
    backgroundColor: 'rgba(79, 70, 229, 0.08)',
  },
  topSection: {
    alignItems: 'center',
    paddingTop: 16,
  },
  securityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.25)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 12,
  },
  securityText: {
    color: '#34D399',
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 6,
    letterSpacing: 0.3,
  },
  incomingLabel: {
    color: '#94A3B8',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  centerSection: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingHorizontal: 24,
  },
  avatarWrapper: {
    position: 'relative',
    width: 140,
    height: 140,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 28,
  },
  pulseWave: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 2,
    borderColor: '#10B981',
  },
  avatarCircle: {
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: '#4F46E5',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#10B981',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 12,
  },
  avatarImage: {
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 4,
    borderColor: '#10B981',
  },
  avatarInitial: {
    color: '#FFF',
    fontSize: 54,
    fontWeight: '900',
  },
  callerName: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 10,
    letterSpacing: 0.4,
  },
  callTypePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  callTypeSubtitle: {
    color: '#CBD5E1',
    fontSize: 14,
    fontWeight: '600',
  },
  bottomSection: {
    width: '100%',
    paddingHorizontal: 36,
    paddingBottom: 24,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    width: '100%',
  },
  actionCol: {
    alignItems: 'center',
  },
  declineBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 14,
    elevation: 8,
    marginBottom: 10,
  },
  acceptBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#10B981',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.6,
    shadowRadius: 16,
    elevation: 10,
    marginBottom: 10,
  },
  actionLabel: {
    color: '#E2E8F0',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
