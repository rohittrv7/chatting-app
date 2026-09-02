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
        const updated = {
          ...state.conversations[existingIdx],
          ...newConv,
          id: state.conversations[existingIdx].id || newConv.id,
        };
        // Move to the top of the chat list
        state.conversations.splice(existingIdx, 1);
        state.conversations.unshift(updated);
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
      const msgs = state.messagesMap[conversationId];

      // Dedup: skip if exact same id already exists or duplicate call log within 20 seconds
      const exactIdx = msgs.findIndex((m) => {
        if (m.id === message.id) return true;
        if (message.callLog && m.callLog) {
          if (
            m.id.startsWith('call_log_') &&
            message.id.startsWith('call_log_') &&
            m.callLog.callType === message.callLog.callType &&
            Math.abs((m.createdAtMs || 0) - (message.createdAtMs || Date.now())) < 20000
          ) {
            return true;
          }
        }
        return false;
      });

      if (exactIdx >= 0) {
        // Update existing (e.g. status change)
        msgs[exactIdx] = { ...msgs[exactIdx], ...message, id: msgs[exactIdx].id };
        safeStorage.setItem(CHAT_STORAGE_KEYS.MESSAGES, JSON.stringify(state.messagesMap));
        safeStorage.setItem(CHAT_STORAGE_KEYS.CONVERSATIONS, JSON.stringify(state.conversations));
        return;
      }

      msgs.push(message);

      // Keep only the most recent 100 messages per room
      if (msgs.length > 100) {
        state.messagesMap[conversationId] = msgs.slice(-100);
      }

      // Update lastMessage in conversation list and MOVE TO THE TOP OF THE LIST
      const convIdx = state.conversations.findIndex((c) => c.id === conversationId);
      if (convIdx >= 0) {
        const conv = { ...state.conversations[convIdx] };
        conv.lastMessage =
          message.text ||
          (message.imagePath ? '📷 Photo' : message.location ? '📍 Location' : 'Message');
        conv.time = message.time;
        conv.lastMessageStatus = message.status;
        conv.lastMessageIsMe = message.isMe;

        // Move to index 0 (top of the chat list)
        state.conversations.splice(convIdx, 1);
        state.conversations.unshift(conv);
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
        status: 'SENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'SERVER_RECEIVED' | 'FAILED';
      }>,
    ) => {
      const { messageId, clientMessageId, status } = action.payload;

      for (const cId of Object.keys(state.messagesMap)) {
        const msgs = state.messagesMap[cId];
        if (!msgs) continue;
        for (let i = 0; i < msgs.length; i++) {
          const msg = msgs[i];
          const matchById = msg.id === messageId;
          const matchByClient = clientMessageId && msg.id === clientMessageId;
          if (matchById || matchByClient) {
            // If we got a real serverMessageId, replace the optimistic clientMessageId
            // This prevents a duplicate bubble when message:new also arrives
            if (clientMessageId && messageId && messageId !== clientMessageId) {
              msgs[i] = { ...msg, id: messageId, status };
            } else {
              msgs[i] = { ...msg, status };
            }
          }
        }
      }

      // Update lastMessageStatus in conversation
      for (const c of state.conversations) {
        const msgs = state.messagesMap[c.id];
        if (!msgs || msgs.length === 0) continue;
        const lastMsg = msgs[msgs.length - 1];
        if (lastMsg.id === messageId || (clientMessageId && lastMsg.id === clientMessageId)) {
          c.lastMessageStatus = status;
        }
      }

      safeStorage.setItem(CHAT_STORAGE_KEYS.MESSAGES, JSON.stringify(state.messagesMap));
      safeStorage.setItem(CHAT_STORAGE_KEYS.CONVERSATIONS, JSON.stringify(state.conversations));
    },
    updateMessageProgress: (
      state,
      action: PayloadAction<{
        messageId: string;
        uploadProgress: number;
        isUploading: boolean;
        imagePath?: string;
      }>,
    ) => {
      const { messageId, uploadProgress, isUploading, imagePath } = action.payload;
      for (const cId of Object.keys(state.messagesMap)) {
        const msgs = state.messagesMap[cId];
        if (msgs && Array.isArray(msgs)) {
          for (const msg of msgs) {
            if (msg.id === messageId) {
              msg.uploadProgress = uploadProgress;
              msg.isUploading = isUploading;
              if (imagePath) msg.imagePath = imagePath;
            }
          }
        }
      }
      safeStorage.setItem(CHAT_STORAGE_KEYS.MESSAGES, JSON.stringify(state.messagesMap));
    },
    updateMessageMediaDownloaded: (
      state,
      action: PayloadAction<{
        messageId: string;
        imagePath?: string;
        isDownloaded: boolean;
      }>,
    ) => {
      const { messageId, imagePath, isDownloaded } = action.payload;
      for (const cId of Object.keys(state.messagesMap)) {
        const msgs = state.messagesMap[cId];
        if (msgs && Array.isArray(msgs)) {
          for (const msg of msgs) {
            if (msg.id === messageId) {
              msg.isDownloaded = isDownloaded;
              if (imagePath) msg.imagePath = imagePath;
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
    toggleMessageReaction: (
      state,
      action: PayloadAction<{
        conversationId?: string;
        messageId: string;
        emoji: string;
        senderIsMe: boolean;
      }>,
    ) => {
      const { messageId, emoji, senderIsMe } = action.payload;
      for (const cId of Object.keys(state.messagesMap)) {
        const msgs = state.messagesMap[cId];
        if (!msgs) continue;
        for (const msg of msgs) {
          if (msg.id === messageId) {
            const rx: Record<string, number> = { ...(msg.reactions || {}) };
            if (senderIsMe) {
              const oldEmoji = msg.myReaction;
              if (oldEmoji) {
                rx[oldEmoji] = Math.max(0, (rx[oldEmoji] || 1) - 1);
                if (rx[oldEmoji] === 0) delete rx[oldEmoji];
              }
              if (oldEmoji === emoji) {
                msg.myReaction = undefined;
              } else {
                msg.myReaction = emoji;
                rx[emoji] = (rx[emoji] || 0) + 1;
              }
            } else {
              rx[emoji] = (rx[emoji] || 0) + 1;
            }
            msg.reactions = rx;
          }
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
  updateMessageProgress,
  updateMessageMediaDownloaded,
  markAllMessagesRead,
  toggleStarMessage,
  toggleMessageReaction,
  removeConversation,
  clearConversationMessages,
  setActiveConversationId,
} = chatSlice.actions;

export default chatSlice.reducer;
