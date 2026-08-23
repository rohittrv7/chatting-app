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
      const uniqueList: ConversationItem[] = [];
      const seenKeys = new Set<string>();

      for (const conv of action.payload) {
        const cleanUser = (conv.username || '').replace(/^@+/, '').toLowerCase();
        const cleanTitle = (conv.title || '').trim().toLowerCase();
        const key = cleanUser || cleanTitle || conv.id;

        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          uniqueList.push(conv);
        }
      }

      state.conversations = uniqueList;
      safeStorage.setItem(CHAT_STORAGE_KEYS.CONVERSATIONS, JSON.stringify(uniqueList));
    },
    addConversation: (state, action: PayloadAction<ConversationItem>) => {
      const newConv = action.payload;
      const cleanUser = (newConv.username || '').replace(/^@+/, '').toLowerCase();
      const cleanTitle = (newConv.title || '').trim().toLowerCase();

      const existingIdx = state.conversations.findIndex(
        (c) =>
          c.id === newConv.id ||
          (cleanUser && (c.username || '').replace(/^@+/, '').toLowerCase() === cleanUser) ||
          (cleanTitle && (c.title || '').trim().toLowerCase() === cleanTitle),
      );

      if (existingIdx >= 0) {
        state.conversations[existingIdx] = {
          ...state.conversations[existingIdx],
          ...newConv,
          id: state.conversations[existingIdx].id || newConv.id,
        };
      } else {
        state.conversations.unshift(newConv);
      }
      safeStorage.setItem(CHAT_STORAGE_KEYS.CONVERSATIONS, JSON.stringify(state.conversations));
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
      const { messageId, clientMessageId, status } = action.payload;

      // Always update across all conversation buckets to guarantee consistency
      for (const cId of Object.keys(state.messagesMap)) {
        const msgs = state.messagesMap[cId];
        if (msgs && Array.isArray(msgs)) {
          for (const msg of msgs) {
            if (
              msg.id === messageId ||
              (clientMessageId && msg.id === clientMessageId) ||
              (messageId && msg.id && (msg.id.includes(messageId) || messageId.includes(msg.id)))
            ) {
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
    removeConversation: (
      state,
      action: PayloadAction<{ conversationId: string; aliasIds?: string[] }>,
    ) => {
      const { conversationId, aliasIds = [] } = action.payload;
      const targetLowerSet = new Set(
        [conversationId, ...aliasIds].filter(Boolean).map((s) => s.toLowerCase().trim()),
      );

      state.conversations = state.conversations.filter((c) => {
        const idLower = (c.id || '').toLowerCase().trim();
        const userLower = (c.username || '').toLowerCase().trim();
        const cleanUserLower = userLower.replace(/^@+/, '');
        const titleLower = (c.title || '').toLowerCase().trim();

        const match =
          targetLowerSet.has(idLower) ||
          targetLowerSet.has(userLower) ||
          targetLowerSet.has(cleanUserLower) ||
          targetLowerSet.has(titleLower);

        return !match;
      });

      for (const target of targetLowerSet) {
        delete state.messagesMap[target];
        for (const k of Object.keys(state.messagesMap)) {
          if (k.toLowerCase().trim() === target || k.toLowerCase().includes(target)) {
            delete state.messagesMap[k];
          }
        }
      }

      safeStorage.setItem(CHAT_STORAGE_KEYS.CONVERSATIONS, JSON.stringify(state.conversations));
      safeStorage.setItem(CHAT_STORAGE_KEYS.MESSAGES, JSON.stringify(state.messagesMap));
    },
    clearConversationMessages: (
      state,
      action: PayloadAction<{ conversationId: string; aliasIds?: string[] }>,
    ) => {
      const { conversationId, aliasIds = [] } = action.payload;
      const allTargetIds = new Set([conversationId, ...aliasIds]);

      for (const id of allTargetIds) {
        state.messagesMap[id] = [];
      }

      const conv = state.conversations.find((c) => allTargetIds.has(c.id));
      if (conv) {
        conv.lastMessage = '';
        conv.unread = '0';
      }

      safeStorage.setItem(CHAT_STORAGE_KEYS.CONVERSATIONS, JSON.stringify(state.conversations));
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
  removeConversation,
  clearConversationMessages,
  setActiveConversationId,
} = chatSlice.actions;

export default chatSlice.reducer;
