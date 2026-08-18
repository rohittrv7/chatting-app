import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { ConversationItem, ChatMessage } from '../types';
import { safeStorage } from '../services/storageHelper';

export const CHAT_STORAGE_KEYS = {
  CONVERSATIONS: '@whatsapp_connect_conversations',
  MESSAGES: '@whatsapp_connect_messages',
};

interface ChatState {
  conversations: ConversationItem[];
  messagesMap: Record<string, ChatMessage[]>;
  activeConversationId: string | null;
}

const initialState: ChatState = {
  conversations: [],
  messagesMap: {},
  activeConversationId: null,
};

export const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    setConversations: (state, action: PayloadAction<ConversationItem[]>) => {
      state.conversations = action.payload;
      safeStorage.setItem(CHAT_STORAGE_KEYS.CONVERSATIONS, JSON.stringify(action.payload));
    },
    addConversation: (state, action: PayloadAction<ConversationItem>) => {
      const exists = state.conversations.some(
        (c) =>
          c.id === action.payload.id ||
          c.title.toLowerCase() === action.payload.title.toLowerCase(),
      );
      if (!exists) {
        state.conversations.unshift(action.payload);
        safeStorage.setItem(CHAT_STORAGE_KEYS.CONVERSATIONS, JSON.stringify(state.conversations));
      }
    },
    setMessagesForConversation: (
      state,
      action: PayloadAction<{ conversationId: string; messages: ChatMessage[] }>,
    ) => {
      state.messagesMap[action.payload.conversationId] = action.payload.messages;
      safeStorage.setItem(CHAT_STORAGE_KEYS.MESSAGES, JSON.stringify(state.messagesMap));
    },
    appendMessage: (
      state,
      action: PayloadAction<{ conversationId: string; message: ChatMessage }>,
    ) => {
      const { conversationId, message } = action.payload;
      if (!state.messagesMap[conversationId]) {
        state.messagesMap[conversationId] = [];
      }
      // Check if message already exists
      const existingIdx = state.messagesMap[conversationId].findIndex((m) => m.id === message.id);
      if (existingIdx >= 0) {
        state.messagesMap[conversationId][existingIdx] = message;
      } else {
        state.messagesMap[conversationId].push(message);
      }

      // Keep only the most recent 50 messages per room to optimize storage and memory
      if (state.messagesMap[conversationId].length > 50) {
        state.messagesMap[conversationId] = state.messagesMap[conversationId].slice(-50);
      }

      // Update lastMessage in conversations
      const conv = state.conversations.find(
        (c) => c.id === conversationId || c.title === conversationId,
      );
      if (conv) {
        conv.lastMessage = message.text || (message.imagePath ? '📷 Photo' : 'Message');
        conv.time = message.time;
      }

      safeStorage.setItem(CHAT_STORAGE_KEYS.MESSAGES, JSON.stringify(state.messagesMap));
      safeStorage.setItem(CHAT_STORAGE_KEYS.CONVERSATIONS, JSON.stringify(state.conversations));
    },
    updateMessageStatus: (
      state,
      action: PayloadAction<{
        conversationId?: string;
        messageId: string;
        clientMessageId?: string;
        status: 'SENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'SERVER_RECEIVED';
      }>,
    ) => {
      const { conversationId, messageId, clientMessageId, status } = action.payload;

      // Update in specific conversation if provided or across all conversations
      const convIds = conversationId ? [conversationId] : Object.keys(state.messagesMap);

      for (const cId of convIds) {
        const msgs = state.messagesMap[cId];
        if (msgs) {
          for (const msg of msgs) {
            if (msg.id === messageId || (clientMessageId && msg.id === clientMessageId)) {
              msg.status = status;
            }
          }
        }
      }
      safeStorage.setItem(CHAT_STORAGE_KEYS.MESSAGES, JSON.stringify(state.messagesMap));
    },
    markAllMessagesRead: (state, action: PayloadAction<{ conversationId: string }>) => {
      const { conversationId } = action.payload;
      const msgs = state.messagesMap[conversationId];
      if (msgs) {
        for (const msg of msgs) {
          if (!msg.isMe) {
            msg.status = 'READ';
          }
        }
      }
      const conv = state.conversations.find((c) => c.id === conversationId);
      if (conv) {
        conv.unread = '0';
      }
      safeStorage.setItem(CHAT_STORAGE_KEYS.MESSAGES, JSON.stringify(state.messagesMap));
    },
    toggleStarMessage: (
      state,
      action: PayloadAction<{ conversationId: string; messageId: string }>,
    ) => {
      const { conversationId, messageId } = action.payload;
      const msgs = state.messagesMap[conversationId];
      if (msgs) {
        const msg = msgs.find((m) => m.id === messageId);
        if (msg) {
          msg.isStarred = !msg.isStarred;
        }
      }
      safeStorage.setItem(CHAT_STORAGE_KEYS.MESSAGES, JSON.stringify(state.messagesMap));
    },
    setActiveConversationId: (state, action: PayloadAction<string | null>) => {
      state.activeConversationId = action.payload;
    },
  },
});

export const {
  setConversations,
  addConversation,
  setMessagesForConversation,
  appendMessage,
  updateMessageStatus,
  markAllMessagesRead,
  toggleStarMessage,
  setActiveConversationId,
} = chatSlice.actions;

export default chatSlice.reducer;
