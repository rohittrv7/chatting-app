import React, { createContext, useContext, useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../store';
import {
  setConversations,
  addConversation as addConvRedux,
  setMessagesForConversation,
  appendMessage,
  updateMessageStatus,
  markAllMessagesRead,
  toggleStarMessage as toggleStarRedux,
  setActiveConversationId,
  CHAT_STORAGE_KEYS,
} from '../store/chatSlice';
import { safeStorage } from '../services/storageHelper';
import { ConversationItem, ChatMessage, UserProfile } from '../types';
import { socketService } from '../services/socket';

interface ChatContextType {
  userProfile: UserProfile;
  updateUserProfile: (profile: Partial<UserProfile>) => void;
  conversations: ConversationItem[];
  messagesMap: Record<string, ChatMessage[]>;
  addMessage: (
    conversationId: string,
    text: string,
    isMe?: boolean,
    imagePath?: string,
    receiverId?: string,
  ) => void;
  addConversation: (title: string, username?: string) => void;
  updateLastMessage: (conversationId: string, text: string) => void;
  toggleStarMessage: (conversationId: string, messageId: string) => boolean;
  markConversationRead: (conversationId: string) => void;
  openChatRoom: (conversationId: string) => void;
  closeChatRoom: (conversationId: string) => void;
}

const defaultUserProfile: UserProfile = {
  name: '',
  username: '',
  status: 'Available | Let’s chat 🚀',
  phone: '+91 98765 43210',
};

const ChatContext = createContext<ChatContextType>({
  userProfile: defaultUserProfile,
  updateUserProfile: () => {},
  conversations: [],
  messagesMap: {},
  addMessage: () => {},
  addConversation: () => {},
  updateLastMessage: () => {},
  toggleStarMessage: () => false,
  markConversationRead: () => {},
  openChatRoom: () => {},
  closeChatRoom: () => {},
});

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const dispatch = useDispatch();
  const { conversations, messagesMap, activeConversationId } = useSelector(
    (state: RootState) => state.chat,
  );
  const token = useSelector((state: RootState) => state.auth.token);

  const [userProfile, setUserProfile] = useState<UserProfile>(defaultUserProfile);

  useEffect(() => {
    // 1. Load stored profile
    safeStorage.getItem('@whatsapp_connect_user_profile').then((data) => {
      if (data) {
        try {
          const parsed = JSON.parse(data);
          setUserProfile(parsed);
        } catch (e) {}
      }
    });

    // 2. Load stored conversations & messages
    safeStorage.getItem(CHAT_STORAGE_KEYS.CONVERSATIONS).then((data) => {
      if (data) {
        try {
          const parsed = JSON.parse(data);
          if (Array.isArray(parsed) && parsed.length > 0) {
            dispatch(setConversations(parsed));
          }
        } catch (e) {}
      }
    });

    safeStorage.getItem(CHAT_STORAGE_KEYS.MESSAGES).then((data) => {
      if (data) {
        try {
          const parsed = JSON.parse(data);
          if (parsed && typeof parsed === 'object') {
            for (const [convId, msgs] of Object.entries(parsed)) {
              if (Array.isArray(msgs)) {
                dispatch(setMessagesForConversation({ conversationId: convId, messages: msgs }));
              }
            }
          }
        } catch (e) {}
      }
    });
  }, []);

  useEffect(() => {
    const currentUserId = userProfile.username || userProfile.phone || 'me_user';

    socketService.connect(currentUserId, {
      onMessageReceived: (payload) => {
        const now = new Date();
        const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

        const incomingMsg: ChatMessage = {
          id: payload.serverMessageId || `msg_${Date.now()}`,
          conversationId: payload.conversationId,
          text: payload.text || '',
          isMe: false,
          time: timeStr,
          status: 'DELIVERED', // Recipient received -> Double Tick
          imagePath: payload.imagePath,
          isStarred: false,
        };

        dispatch(appendMessage({ conversationId: payload.conversationId, message: incomingMsg }));

        // If user is currently looking at this active conversation, send READ receipt (Violet Tick)
        if (activeConversationId === payload.conversationId) {
          socketService.sendReceipt(incomingMsg.id, payload.conversationId, 'READ');
        }
      },

      onMessageAck: (ack) => {
        // Server received -> Single Tick ✓
        dispatch(
          updateMessageStatus({
            messageId: ack.serverMessageId,
            clientMessageId: ack.clientMessageId,
            status: 'SERVER_RECEIVED',
          }),
        );
      },

      onReceiptUpdate: (receipt) => {
        // DELIVERED (✓✓ Double Tick) or READ (✓✓ Violet Tick)
        dispatch(
          updateMessageStatus({
            conversationId: receipt.conversationId,
            messageId: receipt.messageId,
            clientMessageId: receipt.clientMessageId,
            status: receipt.status === 'READ' ? 'READ' : 'DELIVERED',
          }),
        );
      },
    });

    return () => {
      socketService.disconnect();
    };
  }, [userProfile.username, userProfile.phone, activeConversationId]);

  const updateUserProfile = (profile: Partial<UserProfile>) => {
    setUserProfile((prev) => {
      const updated = { ...prev, ...profile };
      safeStorage.setItem('@whatsapp_connect_user_profile', JSON.stringify(updated));
      return updated;
    });
  };

  const addMessage = (
    conversationId: string,
    text: string,
    isMe: boolean = true,
    imagePath?: string,
    receiverId?: string,
  ) => {
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    const clientMessageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

    const newMsg: ChatMessage = {
      id: clientMessageId,
      conversationId,
      text,
      isMe,
      time: timeStr,
      status: 'SERVER_RECEIVED', // Starts with Single Tick ✓ upon server delivery
      imagePath,
      isStarred: false,
    };

    dispatch(appendMessage({ conversationId, message: newMsg }));

    if (isMe) {
      socketService.sendMessage({
        conversationId,
        clientMessageId,
        senderName: userProfile.name || 'Me',
        receiverId,
        text,
        imagePath,
      });
    }
  };

  const toggleStarMessage = (conversationId: string, messageId: string): boolean => {
    dispatch(toggleStarRedux({ conversationId, messageId }));
    const roomMsgs = messagesMap[conversationId] || [];
    const msg = roomMsgs.find((m) => m.id === messageId);
    return msg ? !msg.isStarred : true;
  };

  const updateLastMessage = (conversationId: string, text: string) => {
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    const conv = conversations.find((c) => c.id === conversationId || c.title === conversationId);
    if (conv) {
      dispatch(
        setConversations(
          conversations.map((c) =>
            c.id === conversationId ? { ...c, lastMessage: text, time: timeStr, unread: '0' } : c,
          ),
        ),
      );
    }
  };

  const addConversation = (title: string, username?: string) => {
    const generatedUsername = username || `@${title.toLowerCase().replace(/\s+/g, '_')}`;
    const newConv: ConversationItem = {
      id: `conv_${Date.now()}`,
      title,
      username: generatedUsername,
      lastMessage: 'Tap to start end-to-end encrypted chat',
      time: 'Just now',
      unread: '0',
      avatar: title ? title[0].toUpperCase() : 'C',
    };
    dispatch(addConvRedux(newConv));
  };

  const markConversationRead = (conversationId: string) => {
    dispatch(markAllMessagesRead({ conversationId }));
    const roomMsgs = messagesMap[conversationId] || [];
    for (const msg of roomMsgs) {
      if (!msg.isMe && msg.status !== 'READ') {
        socketService.sendReceipt(msg.id, conversationId, 'READ');
      }
    }
  };

  const openChatRoom = (conversationId: string) => {
    dispatch(setActiveConversationId(conversationId));
    socketService.openChat(conversationId);
    markConversationRead(conversationId);
  };

  const closeChatRoom = (conversationId: string) => {
    dispatch(setActiveConversationId(null));
    socketService.closeChat(conversationId);
  };

  return (
    <ChatContext.Provider
      value={{
        userProfile,
        updateUserProfile,
        conversations,
        messagesMap,
        addMessage,
        addConversation,
        updateLastMessage,
        toggleStarMessage,
        markConversationRead,
        openChatRoom,
        closeChatRoom,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};

export const useChat = () => useContext(ChatContext);
