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

const initialConversations: ConversationItem[] = [
  {
    id: 'conv_alex',
    title: 'Alex Morgan',
    username: '@alex_morgan',
    lastMessage: 'Are we meeting today?',
    time: '9:30 AM',
    unread: '1',
    avatar: 'A',
    isOnline: true,
  },
  {
    id: 'conv_sara',
    title: 'Sara Johnson',
    username: '@sara_j',
    lastMessage: 'Yeah, that works for me!',
    time: '8:58 AM',
    unread: '0',
    avatar: 'S',
    isOnline: false,
  },
  {
    id: 'conv_mike',
    title: 'Michael Smith',
    username: '@michael_s',
    lastMessage: 'Can you send the file?',
    time: 'Yesterday',
    unread: '0',
    avatar: 'M',
    isOnline: true,
  },
  {
    id: 'conv_emily',
    title: 'Emily Davis',
    username: '@emily_d',
    lastMessage: 'Thanks a lot! 😇',
    time: 'Tuesday',
    unread: '0',
    avatar: 'E',
    isOnline: false,
  },
];

const initialMessages: Record<string, ChatMessage[]> = {
  conv_alex: [
    {
      id: 'm1',
      conversationId: 'conv_alex',
      text: "Hey! How's the project going?",
      isMe: false,
      time: '9:20 AM',
      status: 'READ',
    },
    {
      id: 'm2',
      conversationId: 'conv_alex',
      text: "It's going great! Almost done with the new design.",
      isMe: true,
      time: '9:21 AM',
      status: 'READ',
    },
    {
      id: 'm3',
      conversationId: 'conv_alex',
      text: "That's awesome! Can't wait to see it.",
      isMe: false,
      time: '9:22 AM',
      status: 'READ',
    },
    {
      id: 'm4',
      conversationId: 'conv_alex',
      text: 'New_Design.fig',
      isFile: true,
      fileSize: '12.4 MB',
      isMe: false,
      time: '9:23 AM',
      status: 'READ',
    },
    {
      id: 'm5',
      conversationId: 'conv_alex',
      text: 'Here you go! Let me know what you think.',
      isMe: true,
      time: '9:24 AM',
      status: 'READ',
    },
  ],
};

const initialState: ChatState = {
  conversations: initialConversations,
  messagesMap: initialMessages,
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
