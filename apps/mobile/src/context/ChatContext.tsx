/**
 * ChatContext — app-wide chat state + single socket lifecycle.
 *
 * Socket rules enforced here:
 *  - Socket connects ONCE when token + userId are available (after login).
 *  - Socket disconnects ONCE on logout.
 *  - All socket event callbacks are registered in socketService.connect() — never in screens.
 *  - Messages are keyed by clientMessageId first, serverMessageId on ACK.
 *    This is the anti-duplication reconciliation — optimistic bubble never becomes two.
 */

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../store';
import {
  setConversations,
  addConversation as addConvRedux,
  setMessagesForConversation,
  appendMessage,
  updateMessageStatus,
  updateMessageProgress,
  markAllMessagesRead,
  toggleStarMessage as toggleStarRedux,
  toggleMessageReaction as toggleReactionRedux,
  removeConversation,
  clearConversationMessages,
  setActiveConversationId,
  CHAT_STORAGE_KEYS,
} from '../store/chatSlice';
import {
  tokensRefreshed as tokensRefreshedAction,
  profileUpdatedSuccess,
  AUTH_STORAGE_KEYS,
} from '../store/authSlice';
import { safeStorage } from '../services/storageHelper';
import { ConversationItem, ChatMessage, UserProfile } from '../types';
import {
  socketService,
  IncomingMessage,
  MessageAck,
  ReceiptUpdate,
  PresenceUpdate,
} from '../services/socket';
import {
  apiService,
  setTokensRefreshedHandler,
  extractUserIdFromToken,
} from '../services/apiService';
import {
  getDeterministicConversationId,
  getResolvedDisplayName,
  getResolvedContact,
  syncContactsWithBackend,
} from '../services/contactsService';

// ─── Context type ─────────────────────────────────────────────────────────────

interface ChatContextType {
  userProfile: UserProfile;
  updateUserProfile: (profile: Partial<UserProfile>) => void;
  conversations: ConversationItem[];
  messagesMap: Record<string, ChatMessage[]>;
  presenceMap: Record<string, { isOnline: boolean; lastSeen?: string | null }>;
  typingMap: Record<string, boolean>;
  isUserOnline: (userId?: string) => boolean;
  getLastSeen: (userId?: string) => string | null | undefined;
  isUserTyping: (conversationId?: string, senderId?: string) => boolean;
  queryPresence: (userIds: string[]) => void;
  syncServerConversations: () => Promise<void>;
  loadHistoricalMessagesForConversation: (conversationId: string) => Promise<void>;
  addMessage: (
    conversationId: string,
    text: string,
    isMe?: boolean,
    imagePath?: string,
    location?: { lat: number; lng: number; label?: string },
    receiverId?: string,
    contactTitle?: string,
    contactUsername?: string,
  ) => void;
  updateMessageUploadProgress: (
    messageId: string,
    uploadProgress: number,
    isUploading: boolean,
    imagePath?: string,
  ) => void;
  addConversation: (
    title: string,
    username?: string,
    customId?: string,
    recipientDbId?: string,
    avatarUrl?: string,
    phone?: string,
    about?: string,
  ) => void;
  deleteConversation: (conversationId: string, aliasIds?: string[]) => void;
  clearMessages: (conversationId: string, aliasIds?: string[]) => void;
  updateLastMessage: (conversationId: string, text: string, incrementUnread?: boolean) => void;
  toggleStarMessage: (conversationId: string, messageId: string) => boolean;
  reactToMessage: (
    conversationId: string,
    messageId: string,
    emoji: string,
    receiverId?: string,
  ) => void;
  markConversationRead: (conversationId: string) => void;
  openChatRoom: (conversationId: string) => void;
  closeChatRoom: (conversationId: string) => void;
}

const defaultUserProfile: UserProfile = {
  name: '',
  username: '',
  status: "Available | Let's chat 🚀",
  phone: '',
};

const ChatContext = createContext<ChatContextType>({
  userProfile: defaultUserProfile,
  updateUserProfile: () => {},
  conversations: [],
  messagesMap: {},
  presenceMap: {},
  typingMap: {},
  isUserOnline: () => false,
  getLastSeen: () => undefined,
  isUserTyping: () => false,
  queryPresence: () => {},
  syncServerConversations: async () => {},
  loadHistoricalMessagesForConversation: async () => {},
  addMessage: () => {},
  updateMessageUploadProgress: () => {},
  addConversation: () => {},
  deleteConversation: () => {},
  clearMessages: () => {},
  updateLastMessage: () => {},
  toggleStarMessage: () => false,
  reactToMessage: () => {},
  markConversationRead: () => {},
  openChatRoom: () => {},
  closeChatRoom: () => {},
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const dispatch = useDispatch();
  const { conversations, messagesMap, activeConversationId } = useSelector(
    (state: RootState) => state.chat,
  );
  const token = useSelector((state: RootState) => state.auth.token);
  const authProfile = useSelector((state: RootState) => state.auth.userProfile);
  const authPhone = useSelector((state: RootState) => state.auth.phoneNumber);
  const authUserId = useSelector(
    (state: RootState) => (state.auth as any).userId as string | undefined,
  );

  const effectiveUserId =
    authUserId || (token ? extractUserIdFromToken(token) : null) || (authProfile as any)?.id || '';

  const [userProfile, setUserProfile] = useState<UserProfile>(defaultUserProfile);
  const [presenceMap, setPresenceMap] = useState<
    Record<string, { isOnline: boolean; lastSeen?: string | null }>
  >({});
  const [typingMap, setTypingMap] = useState<Record<string, boolean>>({});
  const typingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Always-fresh refs — socket callbacks read these without stale closure issues
  const conversationsRef = useRef(conversations);
  const activeConvIdRef = useRef(activeConversationId);
  const userProfileRef = useRef(userProfile);
  const tokenRef = useRef(token);
  const messagesMapRef = useRef(messagesMap);
  const authUserIdRef = useRef(effectiveUserId);
  /** Track sent receipts to prevent double-sending */
  const sentReceiptsRef = useRef<Set<string>>(new Set());

  conversationsRef.current = conversations;
  activeConvIdRef.current = activeConversationId;
  userProfileRef.current = userProfile;
  tokenRef.current = token;
  messagesMapRef.current = messagesMap;
  authUserIdRef.current = effectiveUserId;

  // ─── Register tokensRefreshed callback ONCE so any refreshAuthToken() call
  //     automatically updates Redux → triggers socket reconnect via [token] dep
  useEffect(() => {
    setTokensRefreshedHandler((newAccessToken: string, newRefreshToken: string) => {
      dispatch(tokensRefreshedAction({ token: newAccessToken, refreshToken: newRefreshToken }));
    });
    return () => setTokensRefreshedHandler(() => {});
  }, [dispatch]);

  // ─── Sync authProfile ────────────────────────────────────────────────────

  useEffect(() => {
    if (authProfile) {
      setUserProfile((prev) => ({
        ...prev,
        ...authProfile,
        phone: authProfile.phone || authPhone || prev.phone,
      }));
    }
  }, [authProfile, authPhone]);

  // ─── Restore persisted state once ────────────────────────────────────────

  useEffect(() => {
    safeStorage.getItem('@whatsapp_connect_user_profile').then((data) => {
      if (!data) return;
      try {
        setUserProfile((prev) => ({ ...prev, ...JSON.parse(data) }));
      } catch {}
    });

    safeStorage.getItem(CHAT_STORAGE_KEYS.CONVERSATIONS).then((data) => {
      if (!data) return;
      try {
        const parsed: ConversationItem[] = JSON.parse(data);
        if (Array.isArray(parsed) && parsed.length > 0) dispatch(setConversations(parsed));
      } catch {}
    });

    safeStorage.getItem(CHAT_STORAGE_KEYS.MESSAGES).then((data) => {
      if (!data) return;
      try {
        const parsed = JSON.parse(data);
        if (parsed && typeof parsed === 'object') {
          for (const [convId, msgs] of Object.entries(parsed)) {
            if (Array.isArray(msgs)) {
              dispatch(
                setMessagesForConversation({
                  conversationId: convId,
                  messages: msgs as ChatMessage[],
                }),
              );
            }
          }
        }
      } catch {}
    });
  }, []);

  // ─── On login: sync server conversations + contacts ───────────────────────

  useEffect(() => {
    if (!token) return;
    syncServerConversations();
    syncContactsWithBackend(token)
      .then((res) => {
        if (!res?.allSorted?.length) return;
        const updated = conversationsRef.current.map((conv) => {
          const matched = getResolvedContact({
            username: conv.username,
            name: conv.title,
            phone: conv.phone,
          });
          if (!matched) return conv;
          return {
            ...conv,
            title: matched.name || conv.title,
            avatarUrl: matched.avatarUrl || conv.avatarUrl,
            phone: matched.phone || conv.phone,
            about: matched.about || conv.about,
          };
        });
        dispatch(setConversations(updated));
      })
      .catch(() => {});
  }, [token]);

  // ─── Socket: connect / reconnect whenever token or userId changes ─────────
  // This fires on: initial login, token refresh (via tokensRefreshedAction), app restore.
  // socketService.connect() is a no-op if token+userId unchanged AND socket is live.

  useEffect(() => {
    if (!token) return;
    const uid = effectiveUserId || extractUserIdFromToken(token) || 'user';

    socketService.connect({
      token,
      userId: uid,
      callbacks: {
        onConnect: _handleConnect,
        onDisconnect: _handleDisconnect,
        onMessageNew: _handleIncomingMessage,
        onMessageAck: _handleMessageAck,
        onReceiptUpdate: _handleReceiptUpdate,
        onPresenceUpdate: _handlePresenceUpdate,
        onPresenceResult: _handlePresenceResult,
        onTypingUpdate: _handleTypingUpdate,
        onReactionUpdate: _handleReactionUpdate,
        onMessageDeleted: _handleMessageDeleted,
      },
    });

    // Query presence after connect — use a tiny delay so socket is fully ready
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const knownIds = conversationsRef.current
      .map((c) => c.recipientDbId)
      .filter((id): id is string => !!id && UUID_RE.test(id));
    if (knownIds.length > 0) {
      setTimeout(() => socketService.queryPresence(knownIds), 600);
    }

    return () => {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, effectiveUserId]);

  // Disconnect socket on logout (token cleared)
  useEffect(() => {
    if (!token && socketService.isConnected()) {
      socketService.disconnect();
      sentReceiptsRef.current.clear();
    }
  }, [token]);

  // ─── Presence heartbeat every 30s ────────────────────────────────────────

  useEffect(() => {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const interval = setInterval(() => {
      const ids = conversationsRef.current
        .map((c) => c.recipientDbId)
        .filter((id): id is string => !!id && UUID_RE.test(id));
      if (ids.length > 0) socketService.queryPresence(ids);
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Socket event handlers — registered once, never per-screen
  // ─────────────────────────────────────────────────────────────────────────

  const _handleConnect = useCallback(() => {
    // Re-query presence on reconnect — only real DB UUIDs
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const ids = conversationsRef.current
      .map((c) => c.recipientDbId)
      .filter((id): id is string => !!id && UUID_RE.test(id));
    if (ids.length > 0) socketService.queryPresence(ids);
  }, []);

  const _handleDisconnect = useCallback((_reason: string) => {}, []);

  const _handleIncomingMessage = useCallback((payload: IncomingMessage) => {
    const myDbId = (authUserIdRef.current ?? '').toLowerCase();

    // Echo guard — drop our own messages that bounce back from the server
    if (myDbId && payload.senderId.toLowerCase() === myDbId) return;

    // Dedup guard — if serverMessageId already in any conv bucket, skip
    const allMsgs = messagesMapRef.current;
    for (const msgs of Object.values(allMsgs)) {
      if (msgs.some((m) => m.id === payload.serverMessageId)) return;
    }

    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    // Always use the server-provided conversationId directly — both parties share the same conv row
    const convId = payload.conversationId;

    const senderUsernameClean = payload.senderUsername
      ? `@${payload.senderUsername.replace(/^@+/, '')}`
      : undefined;
    const senderDisplayName = payload.senderName || payload.senderUsername || 'Contact';

    const resolvedTitle = getResolvedDisplayName(
      {
        username: senderUsernameClean,
        name: payload.senderName,
        phone: payload.senderPhone,
        userId: payload.senderId,
      },
      senderDisplayName,
    );

    const resolvedAvatar = payload.senderAvatarUrl
      ? apiService.getResolvedMediaUrl(payload.senderAvatarUrl)
      : undefined;

    const incomingMsg: ChatMessage = {
      id: payload.serverMessageId,
      conversationId: convId,
      text: payload.text || '',
      isMe: false,
      time: timeStr,
      status: 'DELIVERED',
      createdAtMs: payload.createdAt ? new Date(payload.createdAt).getTime() : Date.now(),
      createdAt: payload.createdAt || now.toISOString(),
      imagePath: payload.imagePath,
      location: payload.location,
      isStarred: false,
    };

    dispatch(appendMessage({ conversationId: convId, message: incomingMsg }));

    const isUserLooking = activeConvIdRef.current === convId;

    // Update or create conversation list entry
    const existingConv = conversationsRef.current.find(
      (c) => c.id === convId || (c.recipientDbId && c.recipientDbId === payload.senderId),
    );
    if (existingConv) {
      _updateLastMessageInternal(
        existingConv.id,
        payload.text || '📷 Photo',
        !isUserLooking,
        false,
        'DELIVERED',
      );
    } else {
      const matched = getResolvedContact({
        username: senderUsernameClean,
        phone: payload.senderPhone,
        userId: payload.senderId,
      });
      dispatch(
        addConvRedux({
          id: convId,
          title: resolvedTitle,
          username: senderUsernameClean || (matched?.username ? matched.username : undefined),
          recipientDbId: payload.senderId,
          avatarUrl:
            resolvedAvatar ||
            (matched?.avatarUrl ? apiService.getResolvedMediaUrl(matched.avatarUrl) : undefined),
          phone: payload.senderPhone || matched?.phone,
          lastMessage: payload.text || '📷 Photo',
          time: timeStr,
          lastMessageIsMe: false,
          lastMessageStatus: 'DELIVERED',
          unread: isUserLooking ? '0' : '1',
          avatar: resolvedTitle[0]?.toUpperCase() ?? 'C',
          isOnline: true,
        }),
      );
    }

    // Send receipt exactly once
    const receiptStatus = isUserLooking ? 'READ' : 'DELIVERED';
    const receiptKey = `${incomingMsg.id}_${receiptStatus}`;
    if (!sentReceiptsRef.current.has(receiptKey)) {
      sentReceiptsRef.current.add(receiptKey);
      socketService.sendReceipt(incomingMsg.id, convId, receiptStatus);
    }
  }, []);

  const _handleMessageAck = useCallback((ack: MessageAck) => {
    if (ack.error) {
      // Mark message as failed
      dispatch(
        updateMessageStatus({
          messageId: ack.clientMessageId, // use clientMessageId as messageId for lookup
          clientMessageId: ack.clientMessageId,
          status: 'FAILED',
        }),
      );
      return;
    }
    // Reconcile optimistic bubble: clientMessageId → confirmed serverMessageId + SENT status
    dispatch(
      updateMessageStatus({
        messageId: ack.serverMessageId,
        clientMessageId: ack.clientMessageId,
        status: 'SENT',
      }),
    );
  }, []);

  const _handleReceiptUpdate = useCallback((receipt: ReceiptUpdate) => {
    dispatch(
      updateMessageStatus({
        conversationId: receipt.conversationId,
        messageId: receipt.serverMessageId,
        clientMessageId: receipt.clientMessageId,
        status: receipt.status === 'READ' ? 'READ' : 'DELIVERED',
      }),
    );
  }, []);

  const _handlePresenceUpdate = useCallback((presence: PresenceUpdate) => {
    setPresenceMap((prev) => ({
      ...prev,
      [presence.userId]: {
        isOnline: presence.isOnline,
        lastSeen: presence.isOnline ? null : presence.lastSeen,
      },
    }));

    dispatch(
      setConversations(
        conversationsRef.current.map((c) => {
          if ((c as any).recipientDbId === presence.userId || c.id === presence.userId) {
            return { ...c, isOnline: presence.isOnline };
          }
          return c;
        }),
      ),
    );
  }, []);

  const _handlePresenceResult = useCallback(
    (data: { presences: Record<string, { isOnline: boolean; lastSeen: string | null }> }) => {
      const mapped: Record<string, { isOnline: boolean; lastSeen: string | null }> = {};
      for (const [k, v] of Object.entries(data.presences)) {
        mapped[k] = { isOnline: Boolean(v?.isOnline), lastSeen: v?.lastSeen ?? null };
      }
      setPresenceMap((prev) => ({ ...prev, ...mapped }));
    },
    [],
  );

  const _handleTypingUpdate = useCallback(
    (data: { conversationId: string; senderId: string; isTyping: boolean }) => {
      const { conversationId, senderId, isTyping } = data;
      const keys = [conversationId, senderId].filter(Boolean);

      setTypingMap((prev) => {
        const next = { ...prev };
        for (const k of keys) {
          if (isTyping) {
            next[k] = true;
          } else {
            delete next[k];
          }
        }
        return next;
      });

      if (isTyping) {
        for (const k of keys) {
          const existingTimer = typingTimersRef.current.get(k);
          if (existingTimer) clearTimeout(existingTimer);
          const timer = setTimeout(() => {
            setTypingMap((prev) => {
              const next = { ...prev };
              delete next[k];
              return next;
            });
            typingTimersRef.current.delete(k);
          }, 3500);
          typingTimersRef.current.set(k, timer);
        }
      }
    },
    [],
  );

  const isUserTyping = useCallback(
    (conversationId?: string, senderId?: string): boolean => {
      if (conversationId && typingMap[conversationId]) return true;
      if (senderId && typingMap[senderId]) return true;
      return false;
    },
    [typingMap],
  );

  const _handleMessageDeleted = useCallback(
    (data: { messageId: string; conversationId: string }) => {
      dispatch(
        updateMessageStatus({
          conversationId: data.conversationId,
          messageId: data.messageId,
          status: 'DELETED' as any,
        }),
      );
    },
    [],
  );

  const _handleReactionUpdate = useCallback(
    (data: { conversationId: string; messageId: string; emoji: string; senderId: string }) => {
      const myDbId = (authUserIdRef.current ?? '').toLowerCase();
      const isMe = myDbId ? (data.senderId || '').toLowerCase() === myDbId : false;
      dispatch(
        toggleReactionRedux({
          conversationId: data.conversationId,
          messageId: data.messageId,
          emoji: data.emoji,
          senderIsMe: isMe,
        }),
      );
    },
    [dispatch],
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  const syncServerConversations = async () => {
    const tok = tokenRef.current;
    if (!tok) return;
    try {
      const serverConvs = await apiService.fetchUserConversations(tok);
      if (!Array.isArray(serverConvs) || serverConvs.length === 0) return;

      const myDbId = (
        authUserIdRef.current ||
        extractUserIdFromToken(tok) ||
        (authProfile as any)?.id ||
        (userProfileRef.current as any)?.id ||
        ''
      ).toLowerCase();
      const myUsername = (userProfileRef.current.username || authProfile?.username || '')
        .toLowerCase()
        .replace(/^@+/, '');
      const myPhone = (userProfileRef.current.phone || authPhone || authProfile?.phone || '')
        .replace(/\D/g, '')
        .slice(-10);

      const currentMap = new Map<string, ConversationItem>(
        conversationsRef.current.map((c) => [c.id, c]),
      );

      for (const sc of serverConvs) {
        // Find other member strictly excluding myself
        let otherMember = sc.members?.find((m: any) => {
          const mUid = (m.user?.id ?? '').toLowerCase();
          const mUsername = (m.user?.username ?? '').toLowerCase().replace(/^@+/, '');
          const mPhone = (m.user?.phoneNumber ?? '').replace(/\D/g, '').slice(-10);

          if (myDbId && mUid === myDbId) return false;
          if (myUsername && mUsername === myUsername) return false;
          if (myPhone && mPhone === myPhone) return false;
          return true;
        });

        if (!otherMember && sc.members && sc.members.length > 1) {
          otherMember =
            sc.members.find((m: any) => (m.user?.id ?? '').toLowerCase() !== myDbId) ||
            sc.members[1];
        }

        const otherName =
          otherMember?.user?.displayName || otherMember?.user?.username || sc.title || 'Chat';
        const otherUsername = otherMember?.user?.username
          ? `@${otherMember.user.username.replace(/^@+/, '')}`
          : undefined;
        const otherPhone = otherMember?.user?.phoneNumber;
        const otherDbId: string | undefined = otherMember?.user?.id;
        const otherAvatar = otherMember?.user?.avatarUrl
          ? apiService.getResolvedMediaUrl(otherMember.user.avatarUrl)
          : undefined;

        const resolvedTitle = getResolvedDisplayName(
          { username: otherUsername, name: otherName, phone: otherPhone },
          otherName,
        );
        const matchedContact = getResolvedContact({
          username: otherUsername,
          name: otherName,
          phone: otherPhone,
        });

        const lastMsgObj = sc.messages?.[0];
        let lastMsgText = 'Tap to chat';
        let lastMsgTime = '';
        let lastMsgStatus = undefined;
        let lastMsgIsMe = undefined;
        if (lastMsgObj) {
          const ct = lastMsgObj.ciphertexts as any;
          lastMsgText =
            ct?.text ||
            (lastMsgObj.type === 'IMAGE'
              ? '📷 Photo'
              : lastMsgObj.type === 'LOCATION'
                ? '📍 Location'
                : 'Message');
          if (lastMsgObj.createdAt) {
            const d = new Date(lastMsgObj.createdAt);
            lastMsgTime = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
          }
          lastMsgStatus = lastMsgObj.status;
          lastMsgIsMe = myDbId ? (lastMsgObj.senderId || '').toLowerCase() === myDbId : false;
        }

        // Clean up duplicate local optimistic items for this same person
        for (const [key, item] of Array.from(currentMap.entries())) {
          if (key === sc.id) continue;
          const matchByRecipient = otherDbId && item.recipientDbId === otherDbId;
          const matchByUsername =
            otherUsername &&
            item.username &&
            item.username.toLowerCase().replace(/^@+/, '') ===
              otherUsername.toLowerCase().replace(/^@+/, '');
          const matchByPhone =
            otherPhone &&
            item.phone &&
            item.phone.replace(/\D/g, '').slice(-10) === otherPhone.replace(/\D/g, '').slice(-10);

          if (matchByRecipient || matchByUsername || matchByPhone) {
            // Migrate messages from old temporary conversation to sc.id
            const oldMsgs = messagesMapRef.current[key] || [];
            if (oldMsgs.length > 0) {
              const targetMsgs = messagesMapRef.current[sc.id] || [];
              const combined = new Map<string, ChatMessage>();
              for (const m of [...oldMsgs, ...targetMsgs]) {
                if (m?.id) combined.set(m.id, { ...m, conversationId: sc.id });
              }
              const sorted = Array.from(combined.values()).sort(
                (a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0),
              );
              dispatch(setMessagesForConversation({ conversationId: sc.id, messages: sorted }));
            }
            dispatch(removeConversation({ conversationId: key }));
            currentMap.delete(key);
          }
        }

        const existing = currentMap.get(sc.id);
        const msgs = messagesMapRef.current[sc.id] || [];
        const localLastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : undefined;

        const finalLastMsgIsMe =
          lastMsgObj !== undefined
            ? lastMsgIsMe
            : localLastMsg !== undefined
              ? localLastMsg.isMe
              : (existing?.lastMessageIsMe ?? false);

        const finalLastMsgStatus =
          lastMsgObj !== undefined
            ? lastMsgStatus
            : localLastMsg !== undefined
              ? localLastMsg.status
              : existing?.lastMessageStatus;

        currentMap.set(sc.id, {
          id: sc.id,
          title: resolvedTitle,
          username: otherUsername,
          recipientDbId: otherDbId,
          avatarUrl: otherAvatar || matchedContact?.avatarUrl || existing?.avatarUrl,
          phone: otherPhone || matchedContact?.phone || existing?.phone,
          about: otherMember?.user?.about || matchedContact?.about || existing?.about,
          lastMessage: lastMsgObj ? lastMsgText : existing?.lastMessage || lastMsgText,
          time: lastMsgObj && lastMsgTime ? lastMsgTime : existing?.time || lastMsgTime,
          lastMessageStatus: finalLastMsgStatus,
          lastMessageIsMe: finalLastMsgIsMe,
          unread: existing?.unread || '0',
          avatar: resolvedTitle[0]?.toUpperCase() ?? 'C',
          isOnline: isUserOnline(otherDbId),
        } as ConversationItem);
      }

      dispatch(setConversations(Array.from(currentMap.values())));

      // Query presence immediately after conversations are loaded with real UUIDs
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const recipientIds = Array.from(currentMap.values())
        .map((c) => c.recipientDbId)
        .filter((id): id is string => !!id && UUID_RE.test(id));
      if (recipientIds.length > 0 && socketService.isConnected()) {
        socketService.queryPresence(recipientIds);
      }
    } catch {}
  };

  const loadHistoricalMessagesForConversation = async (conversationId: string) => {
    const tok = tokenRef.current;
    if (!tok || !conversationId) return;
    try {
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      let targetConvId = conversationId;
      if (!UUID_RE.test(conversationId)) {
        const conv = conversationsRef.current.find((c) => c.id === conversationId);
        if (conv?.recipientDbId) {
          const resolved = await _resolveConvId(conversationId, conv.recipientDbId);
          if (resolved) targetConvId = resolved;
        }
      }

      const serverMsgs = await apiService.fetchHistoricalMessages(tok, targetConvId);
      if (!Array.isArray(serverMsgs) || serverMsgs.length === 0) return;

      const myDbId = (authUserIdRef.current || extractUserIdFromToken(tok) || '').toLowerCase();

      const formatted: ChatMessage[] = serverMsgs.map((m: any) => {
        const ct = m.ciphertexts || {};
        const senderLow = (m.senderId || '').toLowerCase();
        const isMe = myDbId ? senderLow === myDbId : false;
        const d = new Date(m.createdAt);
        const timeStr = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;

        return {
          id: m.id,
          conversationId: targetConvId,
          text: ct.text || '',
          time: timeStr,
          isMe: Boolean(isMe),
          status: m.status === 'READ' ? 'READ' : m.status === 'DELIVERED' ? 'DELIVERED' : 'SENT',
          createdAtMs: new Date(m.createdAt).getTime(),
          createdAt: m.createdAt,
          imagePath: ct.imagePath ? apiService.getResolvedMediaUrl(ct.imagePath) : undefined,
          location: ct.location,
          isStarred: false,
        } as ChatMessage;
      });

      // Merge: server wins on ID collision
      const localMsgs =
        messagesMapRef.current[targetConvId] || messagesMapRef.current[conversationId] || [];
      const merged = new Map<string, ChatMessage>();
      for (const msg of [...localMsgs, ...formatted]) {
        if (msg?.id) merged.set(msg.id, msg);
      }
      const sorted = Array.from(merged.values()).sort(
        (a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0),
      );
      dispatch(setMessagesForConversation({ conversationId: targetConvId, messages: sorted }));
      if (targetConvId !== conversationId) {
        dispatch(setMessagesForConversation({ conversationId, messages: sorted }));
      }

      if (activeConvIdRef.current === targetConvId || activeConvIdRef.current === conversationId) {
        for (const msg of sorted) {
          if (!msg.isMe && msg.status !== 'READ') {
            const key = `${msg.id}_READ`;
            if (!sentReceiptsRef.current.has(key)) {
              sentReceiptsRef.current.add(key);
              socketService.sendReceipt(msg.id, targetConvId, 'READ');
            }
          }
        }
      }
    } catch {}
  };

  // ─── conversationId UUID cache ───────────────────────────────────────────
  // Maps local string IDs → real DB UUID conversationIds to avoid repeated API calls.
  const convUUIDCacheRef = useRef<Map<string, string>>(new Map());

  /**
   * Resolve a guaranteed DB-UUID conversationId.
   * If the supplied conversationId is already a UUID → use it.
   * Otherwise call getOrCreateDirect on the backend to get the real UUID.
   * Result is cached so subsequent sends are instant.
   */
  const _resolveConvId = useCallback(
    async (localConvId: string, recipientDbId?: string): Promise<string | null> => {
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (UUID_RE.test(localConvId)) return localConvId;

      // Check cache first
      const cached = convUUIDCacheRef.current.get(localConvId);
      if (cached) return cached;

      // Need a recipientDbId to create the conversation
      if (!recipientDbId || !UUID_RE.test(recipientDbId)) return null;

      const tok = tokenRef.current;
      if (!tok) return null;

      const result = await apiService.getOrCreateDirectConversation(tok, recipientDbId);
      if (!result?.id) return null;

      // Cache mapping: localConvId → real UUID
      convUUIDCacheRef.current.set(localConvId, result.id);

      // Also update the conversation in Redux with the real UUID
      const existing = conversationsRef.current.find((c) => c.id === localConvId);
      if (existing && existing.id !== result.id) {
        // Add the UUID-keyed version, remove the old string-keyed one
        dispatch(addConvRedux({ ...existing, id: result.id, recipientDbId }));
        dispatch(removeConversation({ conversationId: localConvId }));
        // Migrate messages
        const msgs = messagesMapRef.current[localConvId] || [];
        if (msgs.length > 0) {
          dispatch(setMessagesForConversation({ conversationId: result.id, messages: msgs }));
        }
      }

      return result.id;
    },
    [dispatch],
  );

  const isUserOnline = (userId?: string): boolean => {
    if (!userId) return false;
    return Boolean(presenceMap[userId]?.isOnline);
  };

  const getLastSeen = (userId?: string): string | null | undefined => {
    if (!userId) return undefined;
    return presenceMap[userId]?.lastSeen;
  };

  const queryPresence = (userIds: string[]) => socketService.queryPresence(userIds);

  const updateUserProfile = useCallback(
    (profile: Partial<UserProfile>) => {
      setUserProfile((prev) => {
        const updated = { ...prev, ...profile };
        userProfileRef.current = updated;
        safeStorage.setItem('@whatsapp_connect_user_profile', JSON.stringify(updated));
        safeStorage.setItem(AUTH_STORAGE_KEYS.USER_PROFILE, JSON.stringify(updated));
        dispatch(profileUpdatedSuccess(updated));
        const tok = tokenRef.current;
        if (tok) {
          apiService.updateProfile(tok, updated).catch(() => {});
        }
        return updated;
      });
    },
    [dispatch],
  );

  // ─── Message sending ──────────────────────────────────────────────────────

  const addMessage = (
    conversationId: string,
    text: string,
    isMe = true,
    imagePath?: string,
    location?: { lat: number; lng: number; label?: string },
    receiverId?: string,
    contactTitle?: string,
    contactUsername?: string,
  ) => {
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    const clientMessageId = `cmid_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const resolvedTitle = getResolvedDisplayName(
      { username: contactUsername || receiverId, name: contactTitle },
      contactTitle || receiverId || conversationId,
    );

    // Optimistic message shown instantly with SENDING state
    const newMsg: ChatMessage = {
      id: clientMessageId,
      conversationId: conversationId,
      text,
      isMe,
      time: timeStr,
      status: 'SENDING',
      createdAtMs: Date.now(),
      createdAt: now.toISOString(),
      imagePath,
      location,
      isStarred: false,
    };

    dispatch(appendMessage({ conversationId, message: newMsg }));

    // Update or create conversation entry
    const existingConv = conversationsRef.current.find((c) => c.id === conversationId);
    if (existingConv) {
      _updateLastMessageInternal(
        conversationId,
        text || (imagePath ? '📷 Photo' : location ? '📍 Location' : ''),
        false,
        true,
        'SENDING',
      );
    } else {
      const matched = getResolvedContact({
        username: contactUsername || receiverId,
        name: contactTitle,
      });
      dispatch(
        addConvRedux({
          id: conversationId,
          title: resolvedTitle,
          username: contactUsername || (receiverId ? `@${receiverId}` : undefined),
          recipientDbId: receiverId,
          avatarUrl: matched?.avatarUrl,
          phone: matched?.phone,
          lastMessage: text || (imagePath ? '📷 Photo' : location ? '📍 Location' : ''),
          time: timeStr,
          lastMessageIsMe: true,
          lastMessageStatus: 'SENDING',
          unread: '0',
          avatar: resolvedTitle[0]?.toUpperCase() ?? 'C',
          isOnline: isUserOnline(receiverId),
        }),
      );
    }

    // Async: resolve real UUID conversationId then emit over socket
    if (isMe && receiverId) {
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!UUID_RE.test(receiverId)) {
        // receiverId is not a UUID — cannot send
        dispatch(
          updateMessageStatus({
            messageId: clientMessageId,
            clientMessageId,
            status: 'FAILED',
          }),
        );
        return;
      }

      _resolveConvId(conversationId, receiverId).then((realConvId) => {
        if (!realConvId) {
          // Could not resolve conversation UUID — mark message failed
          dispatch(
            updateMessageStatus({ messageId: clientMessageId, clientMessageId, status: 'FAILED' }),
          );
          return;
        }

        // If the conv was migrated to a new UUID, re-attach the message
        if (realConvId !== conversationId) {
          dispatch(
            appendMessage({
              conversationId: realConvId,
              message: { ...newMsg, conversationId: realConvId },
            }),
          );
        }

        socketService.sendMessage({
          clientMessageId,
          conversationId: realConvId,
          receiverId,
          text,
          imagePath,
          location,
        });
      });
    }
  };

  const updateMessageUploadProgress = (
    messageId: string,
    uploadProgress: number,
    isUploading: boolean,
    imagePath?: string,
  ) => {
    dispatch(updateMessageProgress({ messageId, uploadProgress, isUploading, imagePath }));
  };

  const toggleStarMessage = (conversationId: string, messageId: string): boolean => {
    dispatch(toggleStarRedux({ conversationId, messageId }));
    const msg = (messagesMap[conversationId] || []).find((m) => m.id === messageId);
    return msg ? !msg.isStarred : true;
  };

  const reactToMessage = (
    conversationId: string,
    messageId: string,
    emoji: string,
    receiverId?: string,
  ) => {
    dispatch(
      toggleReactionRedux({
        conversationId,
        messageId,
        emoji,
        senderIsMe: true,
      }),
    );
    socketService.sendReaction(conversationId, messageId, emoji, receiverId);
  };

  const _updateLastMessageInternal = (
    conversationId: string,
    text: string,
    incrementUnread = false,
    isMe = false,
    status?: string,
  ) => {
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    dispatch(
      setConversations(
        conversationsRef.current.map((c) => {
          if (c.id === conversationId) {
            const currentUnread = parseInt(c.unread || '0', 10);
            return {
              ...c,
              lastMessage: text,
              time: timeStr,
              lastMessageIsMe: isMe,
              lastMessageStatus: (status ||
                c.lastMessageStatus ||
                (isMe ? 'SENT' : 'DELIVERED')) as any,
              unread: incrementUnread ? String(currentUnread + 1) : '0',
            };
          }
          return c;
        }),
      ),
    );
  };

  const updateLastMessage = _updateLastMessageInternal;

  const addConversation = (
    title: string,
    username?: string,
    customId?: string,
    recipientDbId?: string,
    avatarUrl?: string,
    phone?: string,
    about?: string,
  ) => {
    const myId = authUserIdRef.current || userProfile.username || userProfile.phone || 'me';
    const target = username || title;
    const convId = customId || getDeterministicConversationId(myId, target);
    const resolvedTitle = getResolvedDisplayName({ username, name: title }, title);

    const exists = conversations.find(
      (c) =>
        c.id === convId ||
        (customId && c.id === customId) ||
        (recipientDbId && c.recipientDbId === recipientDbId) ||
        (username && c.username?.toLowerCase() === username.toLowerCase()),
    );
    if (exists) {
      if (recipientDbId && !exists.recipientDbId) {
        dispatch(
          addConvRedux({
            ...exists,
            recipientDbId,
            avatarUrl: avatarUrl || exists.avatarUrl,
            phone: phone || exists.phone,
          }),
        );
      }
      return;
    }

    dispatch(
      addConvRedux({
        id: convId,
        title: resolvedTitle,
        username: username || `@${resolvedTitle.toLowerCase().replace(/\s+/g, '_')}`,
        recipientDbId: recipientDbId,
        avatarUrl: avatarUrl,
        phone: phone,
        about: about,
        lastMessage: 'Tap to start chatting',
        time: '',
        unread: '0',
        avatar: resolvedTitle[0]?.toUpperCase() ?? 'C',
        isOnline: false,
      }),
    );
  };

  const markConversationRead = (conversationId: string) => {
    dispatch(markAllMessagesRead({ conversationId }));
    const msgs = messagesMapRef.current[conversationId] || [];
    for (const msg of msgs) {
      if (!msg.isMe && msg.status !== 'READ') {
        const key = `${msg.id}_READ`;
        if (!sentReceiptsRef.current.has(key)) {
          sentReceiptsRef.current.add(key);
          socketService.sendReceipt(msg.id, conversationId, 'READ');
        }
      }
    }
  };

  const openChatRoom = (conversationId: string) => {
    dispatch(setActiveConversationId(conversationId));
    socketService.openChat(conversationId);
    markConversationRead(conversationId);
    loadHistoricalMessagesForConversation(conversationId);

    // Always query presence when opening a chat room.
    // At this point recipientDbId may or may not be available — query both ways.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const conv = conversationsRef.current.find((c) => c.id === conversationId);
    const idsToQuery: string[] = [];
    if (conv?.recipientDbId && UUID_RE.test(conv.recipientDbId)) {
      idsToQuery.push(conv.recipientDbId);
    }
    if (UUID_RE.test(conversationId)) {
      idsToQuery.push(conversationId);
    }
    if (idsToQuery.length > 0) {
      setTimeout(() => socketService.queryPresence([...new Set(idsToQuery)]), 200);
    }
  };

  const closeChatRoom = (conversationId: string) => {
    dispatch(setActiveConversationId(null));
    socketService.closeChat(conversationId);
  };

  const deleteConversation = (conversationId: string, aliasIds?: string[]) => {
    const conv = conversations.find((c) => c.id === conversationId);
    const cleanUser = conv?.username ? conv.username.replace(/^@+/, '') : '';
    const myId = (
      authUserIdRef.current ||
      userProfile.username ||
      userProfile.phone ||
      'me'
    ).replace(/^@+/, '');
    const canonical = getDeterministicConversationId(myId, cleanUser || conversationId);
    const allAliases = [conversationId, canonical, `conv_${cleanUser}`, ...(aliasIds || [])].filter(
      Boolean,
    );

    dispatch(removeConversation({ conversationId, aliasIds: allAliases }));

    const tok = tokenRef.current;
    if (tok) {
      apiService.deleteConversation(tok, conversationId).catch(() => {});
      if (canonical !== conversationId)
        apiService.deleteConversation(tok, canonical).catch(() => {});
    }
  };

  const clearMessages = (conversationId: string, aliasIds?: string[]) => {
    const conv = conversations.find((c) => c.id === conversationId);
    const cleanUser = conv?.username ? conv.username.replace(/^@+/, '') : '';
    const myId = (
      authUserIdRef.current ||
      userProfile.username ||
      userProfile.phone ||
      'me'
    ).replace(/^@+/, '');
    const canonical = getDeterministicConversationId(myId, cleanUser || conversationId);
    const allAliases = [conversationId, canonical, `conv_${cleanUser}`, ...(aliasIds || [])].filter(
      Boolean,
    );

    dispatch(clearConversationMessages({ conversationId, aliasIds: allAliases }));

    const tok = tokenRef.current;
    if (tok) {
      apiService.clearChat(tok, conversationId).catch(() => {});
      if (canonical !== conversationId) apiService.clearChat(tok, canonical).catch(() => {});
    }
  };

  return (
    <ChatContext.Provider
      value={{
        userProfile,
        updateUserProfile,
        conversations,
        messagesMap,
        presenceMap,
        typingMap,
        isUserOnline,
        getLastSeen,
        isUserTyping,
        queryPresence,
        syncServerConversations,
        loadHistoricalMessagesForConversation,
        addMessage,
        updateMessageUploadProgress,
        addConversation,
        deleteConversation,
        clearMessages,
        updateLastMessage,
        toggleStarMessage,
        reactToMessage,
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
