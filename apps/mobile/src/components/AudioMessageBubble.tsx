import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Play, Pause, Mic } from 'lucide-react-native';
import { Audio, AVPlaybackStatus } from '../utils/audioModule';
import * as FileSystem from 'expo-file-system/legacy';
import nacl from 'tweetnacl';
import type { ChatMessage } from '../types';
import { apiService } from '../services/apiService';
import { arrayBufferToBase64, base64ToArrayBuffer } from '../services/signalProtocolStore';
import { safeStorage } from '../services/storageHelper';

// Pseudo-random but deterministic waveform bar heights for voice notes
const WAVEFORM_HEIGHTS = [
  6, 12, 18, 10, 16, 22, 14, 26, 20, 15, 24, 28, 18, 12, 22, 16, 24, 14, 20, 10, 8, 5,
];

interface AudioMessageBubbleProps {
  message: ChatMessage;
  isMe: boolean;
  colors: {
    surface: string;
    cardBorder: string;
    primaryIndigo: string;
    textPrimary: string;
    textSecondary: string;
  };
}

export const AudioMessageBubble: React.FC<AudioMessageBubbleProps> = ({
  message,
  isMe,
  colors,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState<number>((message.audioDurationSeconds || 0) * 1000);
  const soundRef = useRef<Audio.Sound | null>(null);
  const isSeekingRef = useRef(false);

  // Fallback audio URI
  const audioUri = message.audioPath || message.imagePath;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => {});
        soundRef.current = null;
      }
    };
  }, []);

  const onPlaybackStatusUpdate = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded) {
      if ('error' in status && status.error) {
        console.warn('Playback error:', status.error);
        setIsPlaying(false);
        setIsLoading(false);
      }
      return;
    }

    setIsPlaying(status.isPlaying);
    setIsLoading(false);

    if (!isSeekingRef.current) {
      setPositionMs(status.positionMillis);
      if (status.durationMillis) {
        setDurationMs(status.durationMillis);
      }
    }

    if (status.didJustFinish) {
      setIsPlaying(false);
      setPositionMs(0);
      soundRef.current?.setPositionAsync(0).catch(() => {});
    }
  }, []);

  // Resolve playable local URI (decrypting remote ciphertext if needed)
  const resolvePlayableUri = useCallback(async (): Promise<string | null> => {
    if (!audioUri) return null;

    // 1. If it's already a local file path
    if (
      audioUri.startsWith('file://') ||
      audioUri.startsWith('/') ||
      !audioUri.startsWith('http')
    ) {
      return audioUri;
    }

    // 2. Remote URL: check local cache
    const cacheFile = `${FileSystem.cacheDirectory}audio_msg_${message.id}.m4a`;
    try {
      const fileInfo = await FileSystem.getInfoAsync(cacheFile);
      if (fileInfo.exists && (fileInfo as any).size > 0) {
        return cacheFile;
      }
    } catch (_) {}

    // 3. Download remote audio
    const remoteResolvedUrl = apiService.getResolvedMediaUrl(audioUri);
    const tempEncFile = `${FileSystem.cacheDirectory}enc_temp_${message.id}.bin`;

    const downloadRes = await FileSystem.downloadAsync(remoteResolvedUrl, tempEncFile);
    if (downloadRes.status !== 200) {
      throw new Error(`Download failed with status ${downloadRes.status}`);
    }

    // 4. Decrypt if attachmentCrypto is present
    if (message.attachmentCrypto?.fileKey && message.attachmentCrypto?.fileNonce) {
      const cipherBase64 = await FileSystem.readAsStringAsync(tempEncFile, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const fileKey = new Uint8Array(base64ToArrayBuffer(message.attachmentCrypto.fileKey));
      const fileNonce = new Uint8Array(base64ToArrayBuffer(message.attachmentCrypto.fileNonce));
      const cipherBytes = new Uint8Array(base64ToArrayBuffer(cipherBase64));

      const decryptedBytes = nacl.secretbox.open(cipherBytes, fileNonce, fileKey);
      if (!decryptedBytes) {
        throw new Error('Failed to decrypt voice message attachment');
      }

      const decryptedBase64 = arrayBufferToBase64(decryptedBytes);
      await FileSystem.writeAsStringAsync(cacheFile, decryptedBase64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      FileSystem.deleteAsync(tempEncFile, { idempotent: true }).catch(() => {});

      // Record download on server for relay cleanup tracking
      safeStorage.getItem('@chat_token').then((tok) => {
        if (tok) apiService.recordAttachmentDownloaded(tok, message.id).catch(() => {});
      });

      return cacheFile;
    }

    // Unencrypted remote file fallback
    safeStorage.getItem('@chat_token').then((tok) => {
      if (tok) apiService.recordAttachmentDownloaded(tok, message.id).catch(() => {});
    });
    return downloadRes.uri;
  }, [audioUri, message.attachmentCrypto, message.id]);

  // Toggle play/pause
  const handleTogglePlay = useCallback(async () => {
    try {
      if (soundRef.current) {
        const status = await soundRef.current.getStatusAsync();
        if (status.isLoaded) {
          if (status.isPlaying) {
            await soundRef.current.pauseAsync();
            setIsPlaying(false);
            return;
          } else {
            await soundRef.current.playAsync();
            setIsPlaying(true);
            return;
          }
        }
      }

      // Load sound
      setIsLoading(true);
      const uriToPlay = await resolvePlayableUri();
      if (!uriToPlay) {
        setIsLoading(false);
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      const { sound } = await Audio.Sound.createAsync(
        { uri: uriToPlay },
        { shouldPlay: true, progressUpdateIntervalMillis: 100 },
        onPlaybackStatusUpdate,
      );

      soundRef.current = sound;
      setIsPlaying(true);
    } catch (err) {
      console.warn('Voice message playback failed:', err);
      setIsLoading(false);
      setIsPlaying(false);
    }
  }, [resolvePlayableUri, onPlaybackStatusUpdate]);

  // Seek on waveform bar tap
  const handleSeek = useCallback(
    async (ratio: number) => {
      if (!soundRef.current || durationMs <= 0) return;
      try {
        isSeekingRef.current = true;
        const targetMs = Math.floor(durationMs * ratio);
        setPositionMs(targetMs);
        await soundRef.current.setPositionAsync(targetMs);
      } catch (err) {
        console.warn('Seek failed:', err);
      } finally {
        isSeekingRef.current = false;
      }
    },
    [durationMs],
  );

  const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;
  const activeBarIndex = Math.floor(progress * WAVEFORM_HEIGHTS.length);

  const formatTime = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const playButtonBg = isMe ? '#FFFFFF' : colors.primaryIndigo;
  const playButtonIconColor = isMe ? colors.primaryIndigo : '#FFFFFF';
  const activeWaveColor = isMe ? '#FFFFFF' : colors.primaryIndigo;
  const inactiveWaveColor = isMe ? 'rgba(255, 255, 255, 0.4)' : 'rgba(148, 163, 184, 0.5)';
  const timerTextColor = isMe ? 'rgba(255, 255, 255, 0.85)' : colors.textSecondary;

  return (
    <View style={styles.container}>
      <View style={styles.bubbleRow}>
        {/* Play / Pause / Loading button */}
        <TouchableOpacity
          style={[styles.playBtn, { backgroundColor: playButtonBg }]}
          onPress={handleTogglePlay}
          activeOpacity={0.8}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={playButtonIconColor} />
          ) : isPlaying ? (
            <Pause size={18} color={playButtonIconColor} fill={playButtonIconColor} />
          ) : (
            <Play
              size={18}
              color={playButtonIconColor}
              fill={playButtonIconColor}
              style={{ marginLeft: 2 }}
            />
          )}
        </TouchableOpacity>

        {/* Waveform visualizer */}
        <View style={styles.waveformContainer}>
          <View style={styles.barsRow}>
            {WAVEFORM_HEIGHTS.map((height, idx) => {
              const isPassed = idx <= activeBarIndex;
              return (
                <TouchableOpacity
                  key={idx}
                  onPress={() => handleSeek(idx / WAVEFORM_HEIGHTS.length)}
                  activeOpacity={0.6}
                  style={styles.barTouchTarget}
                >
                  <View
                    style={[
                      styles.waveBar,
                      {
                        height,
                        backgroundColor: isPassed ? activeWaveColor : inactiveWaveColor,
                      },
                    ]}
                  />
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Time text & Mic indicator */}
          <View style={styles.metaRow}>
            <Text style={[styles.durationText, { color: timerTextColor }]}>
              {isPlaying || positionMs > 0
                ? `${formatTime(positionMs)} / ${formatTime(durationMs || positionMs)}`
                : formatTime(durationMs || (message.audioDurationSeconds || 0) * 1000)}
            </Text>
            <Mic size={12} color={timerTextColor} style={{ opacity: 0.8 }} />
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 4,
    paddingHorizontal: 2,
    minWidth: 220,
    maxWidth: 280,
  },
  bubbleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  playBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  waveformContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 30,
    paddingVertical: 2,
  },
  barTouchTarget: {
    paddingHorizontal: 1,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  waveBar: {
    width: 3,
    borderRadius: 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
    paddingHorizontal: 2,
  },
  durationText: {
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
