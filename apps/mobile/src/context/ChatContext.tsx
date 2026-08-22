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
  removeConversation,
  clearConversationMessages,
  setActiveConversationId,
  CHAT_STORAGE_KEYS,
} from '../store/chatSlice';
import { safeStorage } from '../services/storageHelper';
import { ConversationItem, ChatMessage, UserProfile } from '../types';
import { socketService } from '../services/socket';

import {
  getDeterministicConversationId,
  getResolvedDisplayName,
} from '../services/contactsService';

interface ChatContextType {
  userProfile: UserProfile;
  updateUserProfile: (profile: Partial<UserProfile>) => void;
  conversations: ConversationItem[];
  messagesMap: Record<string, ChatMessage[]>;
  presenceMap: Record<string, { isOnline: boolean; lastSeen?: string }>;
  isUserOnline: (userIdOrHandle?: string) => boolean;
  queryPresence: (userIds: string[]) => void;
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
  deleteConversation: (conversationId: string, aliasIds?: string[]) => void;
  clearMessages: (conversationId: string, aliasIds?: string[]) => void;
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
  presenceMap: {},
  isUserOnline: () => false,
  queryPresence: () => {},
  addMessage: () => {},
  addConversation: () => {},
  deleteConversation: () => {},
  clearMessages: () => {},
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
  const authProfile = useSelector((state: RootState) => state.auth.userProfile);
  const authPhone = useSelector((state: RootState) => state.auth.phoneNumber);

  const [userProfile, setUserProfile] = useState<UserProfile>(defaultUserProfile);
  const [presenceMap, setPresenceMap] = useState<
    Record<string, { isOnline: boolean; lastSeen?: string }>
  >({});

  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  const activeConversationIdRef = useRef(activeConversationId);
  activeConversationIdRef.current = activeConversationId;
  const userProfileRef = useRef(userProfile);
  userProfileRef.current = userProfile;

  useEffect(() => {
    if (authProfile) {
      setUserProfile((prev) => ({
        ...prev,
        ...authProfile,
        phone: authProfile.phone || authPhone || prev.phone,
      }));
    }
  }, [authProfile, authPhone]);

  useEffect(() => {
    // 1. Load stored profile
    safeStorage.getItem('@whatsapp_connect_user_profile').then((data) => {
      if (data) {
        try {
          const parsed = JSON.parse(data);
          setUserProfile((prev) => ({ ...prev, ...parsed }));
        } catch (e) {}
      }
    });

    // 2. Load stored conversations & deduplicate/merge by username and canonical ID
    safeStorage.getItem(CHAT_STORAGE_KEYS.CONVERSATIONS).then((data) => {
      if (data) {
        try {
          const parsed = JSON.parse(data);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const myUser = userProfileRef.current.username || userProfileRef.current.phone || 'me';
            const uniqueMap = new Map<string, ConversationItem>();

            for (const conv of parsed) {
              const cleanUser = (conv.username || '').replace(/^@+/, '').toLowerCase();
              const resolvedTitle = getResolvedDisplayName(
                { username: conv.username, name: conv.title },
                conv.title,
              );
              const canonicalId =
                conv.id && conv.id.startsWith('direct_')
                  ? conv.id
                  : getDeterministicConversationId(myUser, cleanUser || resolvedTitle);

              const existing =
                uniqueMap.get(canonicalId) ||
                (cleanUser ? uniqueMap.get(cleanUser) : null) ||
                uniqueMap.get(resolvedTitle.toLowerCase());

              if (existing) {
                existing.lastMessage = conv.lastMessage || existing.lastMessage;
                existing.time = conv.time || existing.time;
              } else {
                uniqueMap.set(canonicalId, {
                  ...conv,
                  id: canonicalId,
                  title: resolvedTitle,
                  username: conv.username || (cleanUser ? `@${cleanUser}` : undefined),
                  avatar: resolvedTitle ? resolvedTitle[0].toUpperCase() : 'C',
                });
              }
            }
            dispatch(setConversations(Array.from(uniqueMap.values())));
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
    const currentUserId =
      (userProfile.username || authProfile?.username || '').replace(/^@+/, '') ||
      (userProfile.phone || authPhone || authProfile?.phone || '').replace(/\D/g, '') ||
      userProfile.name ||
      '';
    if (!currentUserId) return;

    socketService.connect(currentUserId, {
      onMessageReceived: (payload) => {
        // Prevent echo if message was sent by current user
        const myUsername = (userProfileRef.current.username || authProfile?.username || '')
          .toLowerCase()
          .replace(/^@+/, '');
        const myPhone = (userProfileRef.current.phone || authPhone || '').replace(/\D/g, '');
        const sender = (payload.senderId || payload.senderName || '')
          .toLowerCase()
          .replace(/^@+/, '');
        const senderDigits = (payload.senderId || '').replace(/\D/g, '');

        if (
          (myUsername && sender && myUsername === sender) ||
          (myPhone &&
            senderDigits &&
            (myPhone === senderDigits ||
              myPhone.endsWith(senderDigits) ||
              senderDigits.endsWith(myPhone)))
        ) {
          return;
        }

        const now = new Date();
        const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

        // Compute deterministic canonical ID
        const myId =
          userProfileRef.current.username ||
          authProfile?.username ||
          userProfileRef.current.phone ||
          authPhone ||
          'me';
        const senderId = payload.senderId || payload.senderName || 'friend';
        const canonicalConvId =
          payload.conversationId && payload.conversationId.startsWith('direct_')
            ? payload.conversationId
            : getDeterministicConversationId(myId, senderId);

        // Resolve display name: phonebook contact name if saved, else sender profile name
        const resolvedTitle = getResolvedDisplayName(
          { username: payload.senderId, name: payload.senderName },
          payload.senderName || 'Friend',
        );

        const incomingMsg: ChatMessage = {
          id: payload.serverMessageId || `msg_${Date.now()}`,
          conversationId: canonicalConvId,
          text: payload.text || '',
          isMe: false,
          time: timeStr,
          status: 'DELIVERED',
          imagePath: payload.imagePath,
          isStarred: false,
        };

        dispatch(appendMessage({ conversationId: canonicalConvId, message: incomingMsg }));
        if (payload.conversationId && payload.conversationId !== canonicalConvId) {
          dispatch(appendMessage({ conversationId: payload.conversationId, message: incomingMsg }));
        }
        if (payload.senderId) {
          const cleanSender = payload.senderId.replace(/^@+/, '');
          dispatch(appendMessage({ conversationId: `conv_${cleanSender}`, message: incomingMsg }));
        }

        // Ensure conversation exists in main chat list with updated lastMessage and resolved title
        const existingConv = conversationsRef.current.find(
          (c) =>
            c.id === canonicalConvId ||
            c.id === payload.conversationId ||
            (c.username &&
              payload.senderId &&
              c.username.replace(/^@+/, '').toLowerCase() ===
                payload.senderId.replace(/^@+/, '').toLowerCase()) ||
            c.title.toLowerCase() === resolvedTitle.toLowerCase(),
        );

        if (existingConv) {
          updateLastMessage(existingConv.id, payload.text || '📷 Photo');
        } else {
          dispatch(
            addConvRedux({
              id: canonicalConvId,
              title: resolvedTitle,
              username: payload.senderId ? `@${payload.senderId.replace(/^@+/, '')}` : undefined,
              lastMessage: payload.text || '📷 Photo',
              time: timeStr,
              unread: '1',
              avatar: resolvedTitle ? resolvedTitle[0].toUpperCase() : 'C',
              isOnline: true,
            }),
          );
        }

        // If user is currently looking at this active conversation, send READ receipt (Violet Tick)
        if (
          activeConversationIdRef.current === canonicalConvId ||
          activeConversationIdRef.current === payload.conversationId
        ) {
          socketService.sendReceipt(incomingMsg.id, canonicalConvId, 'READ');
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

      onPresenceUpdate: (presence) => {
        const clean = (presence.username || presence.userId).replace(/^@+/, '').toLowerCase();
        setPresenceMap((prev) => ({
          ...prev,
          [presence.userId.toLowerCase()]: {
            isOnline: presence.isOnline,
            lastSeen: presence.lastSeen,
          },
          [clean]: { isOnline: presence.isOnline, lastSeen: presence.lastSeen },
          [`@${clean}`]: { isOnline: presence.isOnline, lastSeen: presence.lastSeen },
        }));

        // Also update online flag in conversations list
        dispatch(
          setConversations(
            conversationsRef.current.map((c) => {
              const convHandle = (c.username || c.title).replace(/^@+/, '').toLowerCase();
              if (convHandle === clean || c.id === presence.userId) {
                return { ...c, isOnline: presence.isOnline };
              }
              return c;
            }),
          ),
        );
      },

      onPresenceResult: (data) => {
        if (data?.presences) {
          const mapped: Record<string, { isOnline: boolean; lastSeen?: string }> = {};
          for (const [k, v] of Object.entries(data.presences)) {
            const clean = k.replace(/^@+/, '').toLowerCase();
            const val = { isOnline: Boolean(v?.isOnline), lastSeen: v?.lastSeen };
            mapped[k.toLowerCase()] = val;
            mapped[clean] = val;
            mapped[`@${clean}`] = val;
          }
          setPresenceMap((prev) => ({ ...prev, ...mapped }));
        }
      },
    });

    // Query presence immediately on connect
    const initialHandles = conversationsRef.current
      .flatMap((c) => [c.username, c.title, c.id])
      .filter(Boolean) as string[];
    if (initialHandles.length > 0) {
      socketService.queryPresence(initialHandles);
    }
  }, [
    userProfile.username,
    userProfile.phone,
    userProfile.name,
    authProfile?.username,
    authProfile?.phone,
    authPhone,
  ]);

  // Periodic real-time presence heartbeat (queries every 6 seconds)
  useEffect(() => {
    const interval = setInterval(() => {
      const handles = conversationsRef.current
        .flatMap((c) => [c.username, c.title, c.id])
        .filter(Boolean) as string[];
      if (handles.length > 0) {
        socketService.queryPresence(handles);
      }
    }, 6000);
    return () => clearInterval(interval);
  }, []);

  const isUserOnline = (userIdOrHandle?: string): boolean => {
    if (!userIdOrHandle) return false;
    const raw = userIdOrHandle.trim().toLowerCase();
    const clean = raw.replace(/^@+/, '');
    const digits = clean.replace(/\D/g, '');

    const entry =
      presenceMap[raw] ||
      presenceMap[clean] ||
      presenceMap[`@${clean}`] ||
      (digits ? presenceMap[digits] : undefined);

    return entry ? Boolean(entry.isOnline) : false;
  };

  const queryPresence = (userIds: string[]) => {
    socketService.queryPresence(userIds);
  };

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

    const myIdentifier = userProfile.username || userProfile.phone || 'me';
    const targetIdentifier = receiverId || contactUsername || contactTitle || conversationId;
    const canonicalConvId = conversationId.startsWith('direct_')
      ? conversationId
      : getDeterministicConversationId(myIdentifier, targetIdentifier);

    const resolvedTitle = getResolvedDisplayName(
      { username: contactUsername || receiverId, name: contactTitle },
      contactTitle || (canonicalConvId.startsWith('direct_') ? targetIdentifier : canonicalConvId),
    );

    const newMsg: ChatMessage = {
      id: clientMessageId,
      conversationId: canonicalConvId,
      text,
      isMe,
      time: timeStr,
      status: 'SERVER_RECEIVED',
      imagePath,
      isStarred: false,
    };

    dispatch(appendMessage({ conversationId: canonicalConvId, message: newMsg }));
    if (conversationId && conversationId !== canonicalConvId) {
      dispatch(appendMessage({ conversationId, message: newMsg }));
    }

    // Automatically create/update conversation in the main conversation list
    const existingConv = conversations.find(
      (c) =>
        c.id === canonicalConvId ||
        c.id === conversationId ||
        (contactTitle && c.title.toLowerCase() === contactTitle.toLowerCase()),
    );
    if (existingConv) {
      updateLastMessage(existingConv.id, text || (imagePath ? '📷 Photo' : ''));
    } else {
      dispatch(
        addConvRedux({
          id: canonicalConvId,
          title: resolvedTitle,
          username:
            contactUsername || (receiverId ? `@${receiverId.replace(/^@+/, '')}` : undefined),
          lastMessage: text || (imagePath ? '📷 Photo' : ''),
          time: timeStr,
          unread: '0',
          avatar: resolvedTitle ? resolvedTitle[0].toUpperCase() : 'C',
          isOnline: true,
        }),
      );
    }

    if (isMe) {
      socketService.sendMessage({
        conversationId: canonicalConvId,
        clientMessageId,
        senderName: userProfile.name || 'Me',
        receiverId: receiverId || contactUsername || targetIdentifier,
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
    const myIdentifier = userProfile.username || userProfile.phone || 'me';
    const target = username || title;
    const convId = customId || getDeterministicConversationId(myIdentifier, target);
    const resolvedTitle = getResolvedDisplayName({ username, name: title }, title);

    const existing = conversations.find(
      (c) =>
        c.id === convId ||
        (username && c.username?.toLowerCase() === username.toLowerCase()) ||
        c.title.toLowerCase() === resolvedTitle.toLowerCase(),
    );
    if (existing) return;

    const generatedUsername = username || `@${resolvedTitle.toLowerCase().replace(/\s+/g, '_')}`;
    const newConv: ConversationItem = {
      id: convId,
      title: resolvedTitle,
      username: generatedUsername,
      lastMessage: 'Tap to start end-to-end encrypted chat',
      time: 'Just now',
      unread: '0',
      avatar: resolvedTitle ? resolvedTitle[0].toUpperCase() : 'C',
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

  const deleteConversation = (conversationId: string, aliasIds?: string[]) => {
    const conv = conversations.find((c) => c.id === conversationId);
    const cleanUser = conv?.username ? conv.username.replace(/^@+/, '') : '';
    const myId = (userProfile.username || userProfile.phone || 'me').replace(/^@+/, '');
    const canonicalId = getDeterministicConversationId(myId, cleanUser || conversationId);

    const allAliases = [
      conversationId,
      canonicalId,
      `conv_${cleanUser}`,
      ...(aliasIds || []),
    ].filter(Boolean);

    dispatch(removeConversation({ conversationId, aliasIds: allAliases }));
  };

  const clearMessages = (conversationId: string, aliasIds?: string[]) => {
    const conv = conversations.find((c) => c.id === conversationId);
    const cleanUser = conv?.username ? conv.username.replace(/^@+/, '') : '';
    const myId = (userProfile.username || userProfile.phone || 'me').replace(/^@+/, '');
    const canonicalId = getDeterministicConversationId(myId, cleanUser || conversationId);

    const allAliases = [
      conversationId,
      canonicalId,
      `conv_${cleanUser}`,
      ...(aliasIds || []),
    ].filter(Boolean);

    dispatch(clearConversationMessages({ conversationId, aliasIds: allAliases }));
  };

  return (
    <ChatContext.Provider
      value={{
        userProfile,
        updateUserProfile,
        conversations,
        messagesMap,
        presenceMap,
        isUserOnline,
        queryPresence,
        addMessage,
        addConversation,
        deleteConversation,
        clearMessages,
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
