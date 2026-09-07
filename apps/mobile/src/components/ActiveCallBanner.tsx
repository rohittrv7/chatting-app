/**
 * ActiveCallBanner
 *
 * A persistent, full-width green banner that sits at the top of every screen
 * whenever there is an active/ringing call. Tapping it navigates back to the
 * CallScreen so the user can rejoin the call UI without ending the call.
 *
 * Usage: render <ActiveCallBanner navigation={navigation} /> at the top of any
 * screen that sits outside the CallScreen (e.g. ConversationListScreen, ChatScreen).
 */

import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { Phone, Video, X } from 'lucide-react-native';
import { callService, ActiveCallSession } from '../services/callService';

interface Props {
  /** React Navigation navigation prop — used to navigate back to CallScreen */
  navigation: any;
}

export const ActiveCallBanner: React.FC<Props> = ({ navigation }) => {
  const [session, setSession] = useState<ActiveCallSession | null>(callService.getSession());
  const pulseAnim = React.useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const unsub = callService.addListener((s) => setSession(s));
    return unsub;
  }, []);

  // Pulse animation on the dot while ringing
  useEffect(() => {
    if (!session) return;
    const isRinging =
      session.state === 'INCOMING_RINGING' ||
      session.state === 'OUTGOING_RINGING' ||
      session.state === 'OUTGOING_CALLING';

    if (isRinging) {
      const anim = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.2, duration: 500, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
        ]),
      );
      anim.start();
      return () => anim.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [session?.state, pulseAnim]);

  const handleTap = useCallback(() => {
    if (!session) return;
    navigation.navigate('Call', {
      callId: session.callId,
      targetUserId: session.targetUserId,
      targetUserName: session.targetUserName,
      isCaller: session.isCaller,
      isVideo: session.isVideoEnabled,
    });
  }, [session, navigation]);

  const handleEnd = useCallback(() => {
    if (!session) return;
    callService.endCall(session.callId);
  }, [session]);

  // Only show when there is a live call (not IDLE or ENDED)
  if (!session || session.state === 'ENDED' || (session.state as string) === 'IDLE') {
    return null;
  }

  const isConnected = session.state === 'CONNECTED';
  const isRinging =
    session.state === 'INCOMING_RINGING' ||
    session.state === 'OUTGOING_RINGING' ||
    session.state === 'OUTGOING_CALLING';

  const formatDuration = (s: number) =>
    `${Math.floor(s / 60)
      .toString()
      .padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  const statusLabel = isConnected
    ? formatDuration(session.durationSeconds)
    : isRinging
      ? session.isCaller
        ? 'Calling...'
        : 'Incoming call'
      : 'Connecting...';

  return (
    <TouchableOpacity style={styles.banner} onPress={handleTap} activeOpacity={0.85}>
      {/* Left: animated pulse dot + icon */}
      <View style={styles.leftSection}>
        <Animated.View style={[styles.pulseDot, { opacity: isRinging ? pulseAnim : 1 }]} />
        {session.callType === 'video' ? (
          <Video size={16} color="#FFF" style={styles.icon} />
        ) : (
          <Phone size={16} color="#FFF" style={styles.icon} />
        )}
        <View style={styles.textCol}>
          <Text style={styles.nameText} numberOfLines={1}>
            {session.targetUserName}
          </Text>
          <Text style={styles.statusText}>{statusLabel}</Text>
        </View>
      </View>

      {/* Right: tap to return label + end call X */}
      <View style={styles.rightSection}>
        <Text style={styles.tapLabel}>Tap to return</Text>
        <TouchableOpacity
          style={styles.endBtn}
          onPress={handleEnd}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <X size={14} color="#FFF" />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#16A34A', // green-600
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 9,
    // Subtle shadow so it floats above the content
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.22,
    shadowRadius: 4,
    elevation: 8,
  },
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#86EFAC', // green-300
    marginRight: 6,
  },
  icon: {
    marginRight: 8,
  },
  textCol: {
    flex: 1,
  },
  nameText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  statusText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 1,
  },
  rightSection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 10,
  },
  tapLabel: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
    marginRight: 10,
  },
  endBtn: {
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: 12,
    padding: 5,
  },
});
