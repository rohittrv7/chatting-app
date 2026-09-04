import React, { useState, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Plus, X, Smile, Send, Mic } from 'lucide-react-native';
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

    return (
      <View
        style={[
          styles.inputBarContainer,
          { backgroundColor: colors.surface, borderTopColor: colors.cardBorder },
        ]}
      >
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
          <TouchableOpacity
            style={[styles.sendBtn, { backgroundColor: colors.cardBorder }]}
            activeOpacity={0.8}
          >
            <Mic size={18} color={colors.textSecondary} />
          </TouchableOpacity>
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
});
