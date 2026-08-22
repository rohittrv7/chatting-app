import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
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
    contactTitle?: string,
    contactUsername?: string,
  ) => void;
  addConversation: (title: string, username?: string, customId?: string) => void;
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
  phone: '',
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
            const sanitized = parsed.map((conv) => {
              const isTimestampTitle =
                /^\d{10,}$/.test(conv.title) || conv.title.startsWith('1787');
              if (isTimestampTitle) {
                return {
                  ...conv,
                  title: conv.username ? conv.username.replace(/^@+/, '') : 'Priya Sharma',
                  username: conv.username || '@priya_s',
                  avatar: 'P',
                };
              }
              return conv;
            });
            dispatch(setConversations(sanitized));
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

  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  const activeConversationIdRef = useRef(activeConversationId);
  activeConversationIdRef.current = activeConversationId;
  const userProfileRef = useRef(userProfile);
  userProfileRef.current = userProfile;

  useEffect(() => {
    const currentUserId = userProfile.username || userProfile.phone || 'me_user';
    if (!currentUserId || currentUserId === 'me_user') return;

    socketService.connect(currentUserId, {
      onMessageReceived: (payload) => {
        // Prevent echo if message was sent by current user
        const myUsername = (userProfileRef.current.username || '').toLowerCase().replace(/^@+/, '');
        const myPhone = (userProfileRef.current.phone || '').replace(/\D/g, '');
        const sender = (payload.senderId || payload.senderName || '').toLowerCase().replace(/^@+/, '');
        const senderDigits = (payload.senderId || '').replace(/\D/g, '');

        if (
          (myUsername && sender && myUsername === sender) ||
          (myPhone && senderDigits && (myPhone === senderDigits || myPhone.endsWith(senderDigits) || senderDigits.endsWith(myPhone)))
        ) {
          return;
        }

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

        // Ensure conversation exists in main chat list with updated lastMessage and sender title
        const existingConv = conversationsRef.current.find(
          (c) => c.id === payload.conversationId || c.title === payload.senderName
        );
        if (existingConv) {
          updateLastMessage(payload.conversationId, payload.text || '📷 Photo');
        } else {
          dispatch(
            addConvRedux({
              id: payload.conversationId,
              title: payload.senderName || 'Friend',
              username: payload.senderId ? `@${payload.senderId.replace(/^@+/, '')}` : undefined,
              lastMessage: payload.text || '📷 Photo',
              time: timeStr,
              unread: '1',
              avatar: '',
              isOnline: true,
            })
          );
        }

        // If user is currently looking at this active conversation, send READ receipt (Violet Tick)
        if (activeConversationIdRef.current === payload.conversationId) {
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
  }, [userProfile.username, userProfile.phone]);

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
    contactTitle?: string,
    contactUsername?: string,
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

    // Automatically create/update conversation in the main conversation list
    const existingConv = conversations.find(
      (c) =>
        c.id === conversationId ||
        (contactTitle && c.title.toLowerCase() === contactTitle.toLowerCase()),
    );
    if (existingConv) {
      updateLastMessage(existingConv.id, text || (imagePath ? '📷 Photo' : ''));
    } else {
      const convTitle =
        contactTitle ||
        (conversationId.startsWith('conv_')
          ? conversationId.replace(/^conv_/, '')
          : conversationId);
      dispatch(
        addConvRedux({
          id: conversationId,
          title: convTitle,
          username: contactUsername || (receiverId ? `@${receiverId.replace(/^@+/, '')}` : undefined),
          lastMessage: text || (imagePath ? '📷 Photo' : ''),
          time: timeStr,
          unread: '0',
          avatar: convTitle ? convTitle[0].toUpperCase() : 'C',
          isOnline: true,
        })
      );
    }

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

  const addConversation = (title: string, username?: string, customId?: string) => {
    const convId =
      customId ||
      `conv_${(username ? username.replace(/^@+/, '') : title.toLowerCase()).replace(/[^a-z0-9]/g, '_')}`;
    const existing = conversations.find(
      (c) =>
        c.id === convId ||
        c.title.toLowerCase() === title.toLowerCase() ||
        (username && c.username?.toLowerCase() === username.toLowerCase()),
    );
    if (existing) return;

    const generatedUsername = username || `@${title.toLowerCase().replace(/\s+/g, '_')}`;
    const newConv: ConversationItem = {
      id: convId,
      title,
      username: generatedUsername,
      lastMessage: 'Tap to start end-to-end encrypted chat',
      time: 'Just now',
      unread: '0',
      avatar: title ? title[0].toUpperCase() : 'C',
      isOnline: true,
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
