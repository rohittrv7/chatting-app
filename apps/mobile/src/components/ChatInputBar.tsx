import React, {
  useState,
  useRef,
  useCallback,
  useImperativeHandle,
  forwardRef,
  useEffect,
} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Animated,
  PanResponder,
} from 'react-native';
import { Plus, X, Smile, Send, Mic, ChevronLeft } from 'lucide-react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import { socketService } from '../services/socket';

export interface ChatInputBarRef {
  appendEmoji: (emoji: string) => void;
  focus: () => void;
  clear: () => void;
  setText: (text: string) => void;
}

export interface ChatInputBarProps {
  conversationId: string;
  effectiveTargetId?: string;
  onSendMessage: (text: string) => void | Promise<void>;
  onSendAudio?: (uri: string, durationSeconds: number) => void | Promise<void>;
  showAttachMenu: boolean;
  setShowAttachMenu: (updater: boolean | ((prev: boolean) => boolean)) => void;
  showEmojiPicker: boolean;
  setShowEmojiPicker: (updater: boolean | ((prev: boolean) => boolean)) => void;
  colors: {
    surface: string;
    cardBorder: string;
    primaryIndigo: string;
    inputBg: string;
    textPrimary: string;
    textSecondary: string;
  };
}

const ChatInputBarComponent = forwardRef<ChatInputBarRef, ChatInputBarProps>(
  (
    {
      conversationId,
      effectiveTargetId,
      onSendMessage,
      onSendAudio,
      showAttachMenu,
      setShowAttachMenu,
      showEmojiPicker,
      setShowEmojiPicker,
      colors,
    },
    ref,
  ) => {
    const [text, setText] = useState('');
    const textInputRef = useRef<TextInput>(null);
    const typingDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastTypingSentRef = useRef(false);
    const lastTypingPingTimeRef = useRef(0);

    // ── Voice Recording State ─────────────────────────────────────────────────
    const [isRecording, setIsRecording] = useState(false);
    const [recordingDurationSec, setRecordingDurationSec] = useState(0);
    const [isCancelHighlighted, setIsCancelHighlighted] = useState(false);
    const recordingRef = useRef<Audio.Recording | null>(null);
    const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const recordingStartTimeRef = useRef<number>(0);
    const isCancelledRef = useRef(false);
    const panX = useRef(new Animated.Value(0)).current;
    const pulseAnim = useRef(new Animated.Value(1)).current;
    const waveAnim1 = useRef(new Animated.Value(6)).current;
    const waveAnim2 = useRef(new Animated.Value(14)).current;
    const waveAnim3 = useRef(new Animated.Value(8)).current;
    const waveAnim4 = useRef(new Animated.Value(18)).current;
    const waveAnim5 = useRef(new Animated.Value(10)).current;

    // Pulse animation loop for recording indicator
    useEffect(() => {
      let pulseLoop: Animated.CompositeAnimation | null = null;
      let waveLoop: Animated.CompositeAnimation | null = null;

      if (isRecording) {
        pulseLoop = Animated.loop(
          Animated.sequence([
            Animated.timing(pulseAnim, { toValue: 1.4, duration: 600, useNativeDriver: true }),
            Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
          ]),
        );
        pulseLoop.start();

        waveLoop = Animated.loop(
          Animated.sequence([
            Animated.parallel([
              Animated.timing(waveAnim1, { toValue: 18, duration: 250, useNativeDriver: false }),
              Animated.timing(waveAnim2, { toValue: 8, duration: 250, useNativeDriver: false }),
              Animated.timing(waveAnim3, { toValue: 20, duration: 250, useNativeDriver: false }),
              Animated.timing(waveAnim4, { toValue: 10, duration: 250, useNativeDriver: false }),
              Animated.timing(waveAnim5, { toValue: 16, duration: 250, useNativeDriver: false }),
            ]),
            Animated.parallel([
              Animated.timing(waveAnim1, { toValue: 6, duration: 250, useNativeDriver: false }),
              Animated.timing(waveAnim2, { toValue: 16, duration: 250, useNativeDriver: false }),
              Animated.timing(waveAnim3, { toValue: 8, duration: 250, useNativeDriver: false }),
              Animated.timing(waveAnim4, { toValue: 18, duration: 250, useNativeDriver: false }),
              Animated.timing(waveAnim5, { toValue: 8, duration: 250, useNativeDriver: false }),
            ]),
          ]),
        );
        waveLoop.start();
      } else {
        pulseAnim.setValue(1);
      }

      return () => {
        pulseLoop?.stop();
        waveLoop?.stop();
      };
    }, [isRecording, pulseAnim, waveAnim1, waveAnim2, waveAnim3, waveAnim4, waveAnim5]);

    // Cleanup audio on unmount
    useEffect(() => {
      return () => {
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        if (recordingRef.current) {
          recordingRef.current.stopAndUnloadAsync().catch(() => {});
          recordingRef.current = null;
        }
      };
    }, []);

    // Stop typing helper
    const stopTyping = useCallback(() => {
      if (typingDebounceTimerRef.current) clearTimeout(typingDebounceTimerRef.current);
      if (effectiveTargetId && lastTypingSentRef.current) {
        lastTypingSentRef.current = false;
        lastTypingPingTimeRef.current = 0;
        socketService.sendTyping(conversationId, effectiveTargetId, false);
      }
    }, [conversationId, effectiveTargetId]);

    // Handle character typing
    const handleInputChange = useCallback(
      (newText: string) => {
        setText(newText);
        if (!effectiveTargetId) return;

        if (newText.length > 0) {
          const now = Date.now();
          if (!lastTypingSentRef.current || now - lastTypingPingTimeRef.current > 1800) {
            lastTypingSentRef.current = true;
            lastTypingPingTimeRef.current = now;
            socketService.sendTyping(conversationId, effectiveTargetId, true);
          }
          if (typingDebounceTimerRef.current) clearTimeout(typingDebounceTimerRef.current);
          typingDebounceTimerRef.current = setTimeout(() => {
            lastTypingSentRef.current = false;
            lastTypingPingTimeRef.current = 0;
            socketService.sendTyping(conversationId, effectiveTargetId, false);
          }, 2500);
        } else if (newText.length === 0 && lastTypingSentRef.current) {
          stopTyping();
        }
      },
      [conversationId, effectiveTargetId, stopTyping],
    );

    // Send action
    const handleSend = useCallback(() => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setText('');
      stopTyping();
      onSendMessage(trimmed);
    }, [text, stopTyping, onSendMessage]);

    const handleKeyPress = useCallback(
      (e: any) => {
        if (e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
          e.preventDefault?.();
          handleSend();
        }
      },
      [handleSend],
    );

    // ── Audio Recording Flow ──────────────────────────────────────────────────
    const startAudioRecording = useCallback(async () => {
      try {
        const perm = await Audio.requestPermissionsAsync();
        if (!perm.granted) {
          alert('Microphone permission is required to record voice messages.');
          return;
        }

        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
        });

        const rec = new Audio.Recording();
        await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
        await rec.startAsync();

        recordingRef.current = rec;
        isCancelledRef.current = false;
        setIsCancelHighlighted(false);
        setIsRecording(true);
        setRecordingDurationSec(0);
        recordingStartTimeRef.current = Date.now();
        panX.setValue(0);

        try {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        } catch (_) {}

        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = setInterval(() => {
          const elapsed = (Date.now() - recordingStartTimeRef.current) / 1000;
          setRecordingDurationSec(elapsed);
        }, 200);
      } catch (err) {
        console.warn('Failed to start recording:', err);
        setIsRecording(false);
      }
    }, [panX]);

    const stopAudioRecording = useCallback(
      async (shouldCancel: boolean) => {
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }

        const rec = recordingRef.current;
        recordingRef.current = null;
        setIsRecording(false);
        setIsCancelHighlighted(false);
        panX.setValue(0);

        if (!rec) return;

        try {
          await rec.stopAndUnloadAsync();
          const uri = rec.getURI();
          const totalSec = (Date.now() - recordingStartTimeRef.current) / 1000;

          if (shouldCancel || totalSec < 1 || !uri) {
            // Discard recording
            if (uri) {
              FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
            }
            if (shouldCancel) {
              try {
                await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              } catch (_) {}
            }
            return;
          }

          // Valid recording — send it
          try {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          } catch (_) {}

          if (onSendAudio) {
            onSendAudio(uri, totalSec);
          }
        } catch (err) {
          console.warn('Failed to stop/send recording:', err);
        }
      },
      [onSendAudio, panX],
    );

    // PanResponder for drag-to-cancel gesture on Mic button
    const panResponder = useRef(
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          startAudioRecording();
        },
        onPanResponderMove: (_, gestureState) => {
          if (gestureState.dx < 0) {
            panX.setValue(Math.max(-120, gestureState.dx));
            if (gestureState.dx < -60) {
              if (!isCancelledRef.current) {
                isCancelledRef.current = true;
                setIsCancelHighlighted(true);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
              }
            } else {
              if (isCancelledRef.current) {
                isCancelledRef.current = false;
                setIsCancelHighlighted(false);
              }
            }
          }
        },
        onPanResponderRelease: () => {
          stopAudioRecording(isCancelledRef.current);
        },
        onPanResponderTerminate: () => {
          stopAudioRecording(true);
        },
      }),
    ).current;

    // Expose methods to parent
    useImperativeHandle(
      ref,
      () => ({
        appendEmoji: (emoji: string) => {
          setText((prev) => prev + emoji);
        },
        focus: () => {
          textInputRef.current?.focus();
        },
        clear: () => {
          setText('');
          stopTyping();
        },
        setText: (newText: string) => {
          setText(newText);
        },
      }),
      [stopTyping],
    );

    const hasText = text.trim().length > 0;
    const formatDuration = (sec: number) => {
      const mins = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      return `${mins}:${s.toString().padStart(2, '0')}`;
    };

    return (
      <View
        style={[
          styles.inputBarContainer,
          { backgroundColor: colors.surface, borderTopColor: colors.cardBorder },
        ]}
      >
        {isRecording ? (
          /* ── ACTIVE RECORDING UI ── */
          <View style={styles.recordingRow}>
            {/* Red pulsing recording indicator & timer */}
            <View style={styles.recordingTimerContainer}>
              <Animated.View
                style={[
                  styles.recordingDot,
                  {
                    transform: [{ scale: pulseAnim }],
                    backgroundColor: isCancelHighlighted ? '#EF4444' : '#EF4444',
                  },
                ]}
              />
              <Text style={[styles.recordingTimerText, { color: colors.textPrimary }]}>
                {formatDuration(recordingDurationSec)}
              </Text>

              {/* Animated live waveform bars */}
              <View style={styles.waveContainer}>
                <Animated.View
                  style={[
                    styles.waveBar,
                    { height: waveAnim1, backgroundColor: colors.primaryIndigo },
                  ]}
                />
                <Animated.View
                  style={[
                    styles.waveBar,
                    { height: waveAnim2, backgroundColor: colors.primaryIndigo },
                  ]}
                />
                <Animated.View
                  style={[
                    styles.waveBar,
                    { height: waveAnim3, backgroundColor: colors.primaryIndigo },
                  ]}
                />
                <Animated.View
                  style={[
                    styles.waveBar,
                    { height: waveAnim4, backgroundColor: colors.primaryIndigo },
                  ]}
                />
                <Animated.View
                  style={[
                    styles.waveBar,
                    { height: waveAnim5, backgroundColor: colors.primaryIndigo },
                  ]}
                />
              </View>
            </View>

            {/* Slide to cancel hint */}
            <View style={styles.cancelHintContainer}>
              <ChevronLeft
                size={16}
                color={isCancelHighlighted ? '#EF4444' : colors.textSecondary}
              />
              <Text
                style={[
                  styles.cancelHintText,
                  { color: isCancelHighlighted ? '#EF4444' : colors.textSecondary },
                ]}
              >
                {isCancelHighlighted ? 'Release to cancel' : 'Slide to cancel'}
              </Text>
            </View>

            {/* Dragging Mic button */}
            <Animated.View
              style={[
                styles.micHoldingBtn,
                {
                  transform: [{ translateX: panX }],
                  backgroundColor: isCancelHighlighted ? '#EF4444' : colors.primaryIndigo,
                },
              ]}
              {...panResponder.panHandlers}
            >
              <Mic size={22} color="#FFF" />
            </Animated.View>
          </View>
        ) : (
          /* ── STANDARD INPUT BAR ── */
          <>
            <TouchableOpacity
              style={[styles.plusBtn, { backgroundColor: colors.cardBorder }]}
              onPress={() => setShowAttachMenu((v: boolean) => !v)}
              activeOpacity={0.7}
            >
              {showAttachMenu ? (
                <X size={20} color={colors.primaryIndigo} />
              ) : (
                <Plus size={20} color={colors.primaryIndigo} />
              )}
            </TouchableOpacity>

            <View
              style={[
                styles.inputFieldWrapper,
                { backgroundColor: colors.inputBg, borderColor: colors.cardBorder },
              ]}
            >
              <TextInput
                ref={textInputRef}
                style={[styles.textInput, { color: colors.textPrimary }]}
                placeholder="Type a message..."
                placeholderTextColor={colors.textSecondary}
                value={text}
                onChangeText={handleInputChange}
                onKeyPress={handleKeyPress}
                returnKeyType="send"
                onSubmitEditing={handleSend}
                blurOnSubmit={false}
                multiline
              />
              <TouchableOpacity
                style={{ padding: 4, marginRight: 6 }}
                onPress={() => setShowEmojiPicker((v: boolean) => !v)}
                activeOpacity={0.7}
              >
                <Smile
                  size={20}
                  color={showEmojiPicker ? colors.primaryIndigo : colors.textSecondary}
                />
              </TouchableOpacity>
            </View>

            {hasText ? (
              <TouchableOpacity
                style={[styles.sendBtn, { backgroundColor: colors.primaryIndigo }]}
                onPress={handleSend}
                activeOpacity={0.8}
              >
                <Send size={18} color="#FFF" />
              </TouchableOpacity>
            ) : (
              <View
                style={[styles.sendBtn, { backgroundColor: colors.cardBorder }]}
                {...panResponder.panHandlers}
              >
                <Mic size={18} color={colors.textSecondary} />
              </View>
            )}
          </>
        )}
      </View>
    );
  },
);

ChatInputBarComponent.displayName = 'ChatInputBar';

export const ChatInputBar = React.memo(ChatInputBarComponent);

const styles = StyleSheet.create({
  inputBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 24 : 12,
    borderTopWidth: 1,
    minHeight: 64,
  },
  plusBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  inputFieldWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 28,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderWidth: 1,
    marginRight: 10,
  },
  textInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 4,
    maxHeight: 100,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // ── Recording styles ──
  recordingRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  recordingTimerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  recordingTimerText: {
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    marginRight: 10,
  },
  waveContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 22,
    gap: 3,
  },
  waveBar: {
    width: 3,
    borderRadius: 2,
  },
  cancelHintContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    opacity: 0.85,
  },
  cancelHintText: {
    fontSize: 13,
    fontWeight: '500',
    marginLeft: 2,
  },
  micHoldingBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
});
