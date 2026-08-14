import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
} from 'react-native';
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
  Lock,
  BellRing,
} from 'lucide-react-native';

type Props = NativeStackScreenProps<RootStackParamList, 'Call'>;

export const CallScreen: React.FC<Props> = ({ route, navigation }) => {
  const { callId, targetUserId, isCaller, isVideo } = route.params || {
    callId: 'c1',
    targetUserId: 'Contact',
    isCaller: true,
    isVideo: false,
  };

  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [secondsElapsed, setSecondsElapsed] = useState(0);

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

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={AppColors.darkBg} />

      {/* Top Header info in Video mode */}
      {isVideo && isConnected && (
        <View style={styles.videoHeader}>
          <Lock size={14} color={AppColors.onlineEmerald} />
          <Text style={styles.videoHeaderText}>
            {targetUserId} • {statusText}
          </Text>
        </View>
      )}

      {/* Center Avatar & Status */}
      <View style={styles.centerContainer}>
        <View style={[styles.avatarBorder, isConnected ? styles.connectedBorder : styles.ringingBorder]}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>{nameInitial}</Text>
          </View>
        </View>

        <Text style={styles.nameText}>{targetUserId}</Text>

        <View style={styles.statusRow}>
          {isConnected ? (
            <Lock size={16} color={AppColors.onlineEmerald} />
          ) : (
            <BellRing size={16} color={AppColors.accentAmber} />
          )}
          <Text style={[styles.statusText, isConnected ? styles.statusConnected : styles.statusRinging]}>
            {statusText}
          </Text>
        </View>

        {!isConnected && (
          <Text style={styles.subStatusText}>
            {isCaller ? `Calling ${targetUserId}...` : `Incoming Call from ${targetUserId}`}
          </Text>
        )}
      </View>

      {/* Control Buttons Bar */}
      <View style={styles.bottomControls}>
        {isConnected ? (
          // Connected Call Controls: Mute, Video, End Call
          <View style={styles.controlsRow}>
            <TouchableOpacity
              style={[styles.controlBtn, isMuted && styles.controlBtnActive]}
              onPress={() => setIsMuted(!isMuted)}
            >
              {isMuted ? (
                <MicOff size={22} color="#000" />
              ) : (
                <Mic size={22} color="#FFF" />
              )}
            </TouchableOpacity>

            {isVideo && (
              <TouchableOpacity
                style={[styles.controlBtn, isCameraOff && styles.controlBtnActive]}
                onPress={() => setIsCameraOff(!isCameraOff)}
              >
                {isCameraOff ? (
                  <VideoOff size={22} color="#000" />
                ) : (
                  <VideoIcon size={22} color="#FFF" />
                )}
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.endCallBtn} onPress={handleEndCall}>
              <PhoneOff size={26} color="#FFF" />
            </TouchableOpacity>
          </View>
        ) : isCaller ? (
          // Outgoing Call Mode: SINGLE RED CANCEL BUTTON
          <View style={{ alignItems: 'center' }}>
            <TouchableOpacity style={styles.endCallBtnLarge} onPress={handleEndCall}>
              <PhoneOff size={28} color="#FFF" />
            </TouchableOpacity>
            <Text style={styles.btnLabel}>Cancel Call</Text>
          </View>
        ) : (
          // Incoming Call Mode: DECLINE (Red) & PICK UP (Green)
          <View style={styles.controlsRowSpace}>
            <View style={{ alignItems: 'center' }}>
              <TouchableOpacity style={styles.endCallBtn} onPress={handleEndCall}>
                <PhoneOff size={24} color="#FFF" />
              </TouchableOpacity>
              <Text style={styles.btnLabel}>Decline</Text>
            </View>

            <View style={{ alignItems: 'center' }}>
              <TouchableOpacity style={styles.pickUpBtn} onPress={handlePickUp}>
                <Phone size={28} color="#FFF" />
              </TouchableOpacity>
              <Text style={[styles.btnLabel, { fontWeight: '700', color: '#FFF' }]}>
                Pick Up
              </Text>
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
    backgroundColor: AppColors.darkBg,
    justifyContent: 'space-between',
  },
  videoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    marginTop: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  videoHeaderText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 14,
    marginLeft: 8,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarBorder: {
    padding: 6,
    borderRadius: 66,
    borderWidth: 4,
  },
  ringingBorder: {
    borderColor: AppColors.accentAmber,
  },
  connectedBorder: {
    borderColor: AppColors.onlineEmerald,
  },
  avatarCircle: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: AppColors.primaryIndigo,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 44,
    fontWeight: '800',
    color: '#FFF',
  },
  nameText: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFF',
    marginTop: 20,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  statusText: {
    fontSize: 18,
    fontWeight: '700',
    marginLeft: 8,
  },
  statusRinging: {
    color: AppColors.accentAmber,
  },
  statusConnected: {
    color: '#38BDF8',
  },
  subStatusText: {
    fontSize: 14,
    color: AppColors.textSecondaryDark,
    marginTop: 12,
  },
  bottomControls: {
    paddingBottom: 48,
    paddingHorizontal: 32,
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
  },
  controlsRowSpace: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  controlBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  controlBtnActive: {
    backgroundColor: '#FFF',
  },
  endCallBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: AppColors.missedRed,
    justifyContent: 'center',
    alignItems: 'center',
  },
  endCallBtnLarge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: AppColors.missedRed,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pickUpBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: AppColors.onlineEmerald,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnLabel: {
    fontSize: 12,
    color: AppColors.textSecondaryDark,
    marginTop: 6,
  },
});
