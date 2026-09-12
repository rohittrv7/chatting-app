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

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../store';
import {
  setConversations,
  addConversation as addConvRedux,
  setMessagesForConversation,
  appendMessage,
  updateMessageStatus,
  updateMessageProgress,
  updateMessageMediaDownloaded as updateMessageMediaDownloadedRedux,
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
import { deleteLocalConversation } from '../db/localDb';
import { useToast } from './ToastContext';
import { soundService } from '../services/soundService';
import * as FileSystem from 'expo-file-system/legacy';
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
import { callService } from '../services/callService';
import { e2eCryptoService } from '../services/e2eCryptoService';
import { notificationService } from '../services/notificationService';
import nacl from 'tweetnacl';
import { arrayBufferToBase64, base64ToArrayBuffer } from '../services/signalProtocolStore';
import {
  upsertMessage as dbUpsertMessage,
  updateMessageStatus as dbUpdateMessageStatus,
  upsertConversation as dbUpsertConversation,
  setMessageLocalMediaPath,
} from '../db/localDb';

const globalLoadedHistoricalConvs = new Set<string>();
const globalLoadingHistoricalConvs = new Set<string>();

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
    location?: {
      lat: number;
      lng: number;
      label?: string;
      isLive?: boolean;
      liveDurationMinutes?: number;
      expiresAt?: string;
      isLiveEnded?: boolean;
      accuracy?: number;
    },
    receiverId?: string,
    contactTitle?: string,
    contactUsername?: string,
    document?: { uri: string; name: string; size?: number | string; mimeType?: string },
    contactPayload?: { name: string; phone: string; username?: string },
  ) => void;
  sendMediaMessage: (params: {
    conversationId: string;
    mediaUri: string;
    base64Data?: string;
    fileName?: string;
    mimeType?: string;
    fileSize?: number;
    caption?: string;
    receiverId: string;
    contactTitle?: string;
    contactUsername?: string;
  }) => Promise<string>;
  sendAudioMessage: (params: {
    conversationId: string;
    audioUri: string;
    durationSeconds: number;
    receiverId: string;
    contactTitle?: string;
    contactUsername?: string;
  }) => Promise<string>;
  updateMessageUploadProgress: (
    messageId: string,
    uploadProgress: number,
    isUploading: boolean,
    imagePath?: string,
  ) => void;
  updateMessageMediaDownloaded: (
    messageId: string,
    imagePath?: string,
    isDownloaded?: boolean,
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
  resendMessage: (conversationId: string, messageId: string) => void;
  markConversationRead: (conversationId: string) => void;
  openChatRoom: (conversationId: string) => void;
  closeChatRoom: (conversationId: string) => void;
  blockedUserIds: string[];
  blockedByUserIds: string[];
  isUserBlocked: (targetUserId?: string) => boolean;
  isBlockedBy: (targetUserId?: string) => boolean;
  blockUser: (targetUserId: string) => Promise<void>;
  unblockUser: (targetUserId: string) => Promise<void>;
  secureStorageError: string | null;
  retrySecureStorageInit: () => Promise<void>;
  addCallLogMessage: (
    conversationId: string,
    callType: 'audio' | 'video',
    callStatus: 'completed' | 'missed' | 'declined',
    durationSeconds: number,
    isCaller: boolean,
  ) => void;
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
  sendMediaMessage: async () => '',
  sendAudioMessage: async () => '',
  updateMessageUploadProgress: () => {},
  updateMessageMediaDownloaded: () => {},
  addConversation: () => {},
  deleteConversation: () => {},
  clearMessages: () => {},
  updateLastMessage: () => {},
  toggleStarMessage: () => false,
  reactToMessage: () => {},
  resendMessage: () => {},
  markConversationRead: () => {},
  openChatRoom: () => {},
  closeChatRoom: () => {},
  blockedUserIds: [],
  blockedByUserIds: [],
  isUserBlocked: () => false,
  isBlockedBy: () => false,
  blockUser: async () => {},
  unblockUser: async () => {},
  secureStorageError: null,
  retrySecureStorageInit: async () => {},
  addCallLogMessage: () => {},
});

// ─── Split Lightweight Contexts ───────────────────────────────────────────────
// PERF FIX: presenceMap and typingMap are split into their own contexts so that
// presence heartbeats (every 30s) and typing events (every keystroke) only cause
// re-renders in components that actually subscribe to them — not the entire app tree.

interface PresenceContextType {
  presenceMap: Record<string, { isOnline: boolean; lastSeen?: string | null }>;
  isUserOnline: (userId?: string) => boolean;
  getLastSeen: (userId?: string) => string | null | undefined;
}

interface TypingContextType {
  typingMap: Record<string, boolean>;
  isUserTyping: (conversationId?: string, senderId?: string) => boolean;
}

export const PresenceContext = createContext<PresenceContextType>({
  presenceMap: {},
  isUserOnline: () => false,
  getLastSeen: () => undefined,
});

export const TypingContext = createContext<TypingContextType>({
  typingMap: {},
  isUserTyping: () => false,
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const dispatch = useDispatch();
  const { showToast } = useToast();
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
  const [blockedUserIds, setBlockedUserIds] = useState<string[]>([]);
  const [blockedByUserIds, setBlockedByUserIds] = useState<string[]>([]);
  const [secureStorageError, setSecureStorageError] = useState<string | null>(null);
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
  /** In-flight and rate-limiting guards to prevent API storms */
  const isSyncingConvsRef = useRef(false);
  const lastConvsSyncTimeRef = useRef(0);
  const loadedHistoricalConvsRef = useRef<Set<string>>(new Set());
  const loadingHistoricalConvsRef = useRef<Set<string>>(new Set());
  /**
   * Guards to prevent the [token] useEffect storm on every token rotation.
   *
   * - hasInitializedRef: true once the first login sync (conversations + contacts +
   *   notifications) has been completed. Subsequent token updates (e.g. silent refresh
   *   every 15 min) MUST NOT repeat these calls — they flood the backend with
   *   simultaneous GET /conversations + POST /keys/register + GET /auth/users/blocked
   *   which triggers 429 ThrottlerException.
   *
   * - hasRegisteredKeysRef: true once E2EE nacl.box public key has been successfully
   *   uploaded to /keys/register. Key material doesn't change during a session —
   *   re-registering on every token refresh is wasted bandwidth and causes 422/429.
   *
   * - prevTokenRef: stores the previous token to detect true login (null→value)
   *   vs. silent refresh (value→different-value). Only null→value should trigger full init.
   */
  const hasInitializedRef = useRef(false);
  const hasRegisteredKeysRef = useRef(false);
  const prevTokenRef = useRef<string | null>(null);

  conversationsRef.current = conversations;
  activeConvIdRef.current = activeConversationId;
  userProfileRef.current = userProfile;
  tokenRef.current = token;
  messagesMapRef.current = messagesMap;
  authUserIdRef.current = effectiveUserId;

  // ─── Fetch initial Blocked Users list from server on login ───────────────
  // Only fetch once per login session (null → value token transition).
  // Subsequent blocked/unblocked changes arrive via socket events (user:blocked,
  // user:unblocked) which are already handled below — no need to re-fetch on
  // every silent token refresh.
  useEffect(() => {
    if (!token) {
      // Token cleared = logout → reset guard so next login re-fetches
      hasInitializedRef.current = false;
      hasRegisteredKeysRef.current = false;
      prevTokenRef.current = null;
      return;
    }
    // Only fire on true login (previous token was null/empty)
    const isFirstLogin = !prevTokenRef.current;
    prevTokenRef.current = token;
    if (!isFirstLogin) return;

    apiService
      .getBlockedUsers(token)
      .then((users) => {
        if (Array.isArray(users)) {
          setBlockedUserIds(users.map((u) => u.id));
        }
      })
      .catch(() => {});
  }, [token, effectiveUserId]);

  const retrySecureStorageInit = useCallback(async () => {
    setSecureStorageError(null);
  }, []);

  // ─── Real-Time Block / Unblock Socket Listener ───────────────────────────
  useEffect(() => {
    const onUserBlocked = (data: { blockerId?: string; blockedId?: string }) => {
      if (data.blockedId) {
        setBlockedUserIds((prev) => Array.from(new Set([...prev, data.blockedId!])));
      }
      if (data.blockerId) {
        setBlockedByUserIds((prev) => Array.from(new Set([...prev, data.blockerId!])));
      }
    };

    const onUserUnblocked = (data: { blockerId?: string; blockedId?: string }) => {
      if (data.blockedId) {
        setBlockedUserIds((prev) => prev.filter((id) => id !== data.blockedId));
      }
      if (data.blockerId) {
        setBlockedByUserIds((prev) => prev.filter((id) => id !== data.blockerId));
      }
    };

    const onDeviceAdded = (_data: { userId: string; deviceId: number }) => {};

    const onConversationDeleted = async (data: {
      conversationId?: string;
      reason?: string;
      expenseTitle?: string;
    }) => {
      if (data?.conversationId) {
        await deleteLocalConversation(data.conversationId);
        dispatch(removeConversation({ conversationId: data.conversationId }));
        showToast(
          data.expenseTitle
            ? `Split group "${data.expenseTitle}" settled and auto-removed.`
            : 'Temporary split group was removed.',
          'info',
          4000,
        );
      }
    };

    const onExpenseSettled = (_data: {
      expenseId?: string;
      conversationId?: string;
      autoDeleteAt?: string;
    }) => {
      showToast('This split is settled — the group will auto-delete in 24 hours', 'success', 5000);
    };

    socketService.on('user:blocked', onUserBlocked);
    socketService.on('user:unblocked', onUserUnblocked);
    socketService.on('device:added' as any, onDeviceAdded);
    socketService.on('conversation:deleted' as any, onConversationDeleted);
    socketService.on('expense:settled' as any, onExpenseSettled);

    return () => {
      socketService.off('user:blocked', onUserBlocked);
      socketService.off('user:unblocked', onUserUnblocked);
      socketService.off('device:added' as any, onDeviceAdded);
      socketService.off('conversation:deleted' as any, onConversationDeleted);
      socketService.off('expense:settled' as any, onExpenseSettled);
    };
  }, [dispatch, showToast]);

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

  // ─── On login: sync server conversations, contacts + register E2EE keys ──
  // GUARD: hasInitializedRef ensures this only runs on true login (token goes
  // from null/undefined → a real value). Silent token refreshes (value → new value)
  // must NOT re-trigger this — that causes a 429 storm of simultaneous API calls
  // to /conversations, /keys/register, /auth/users/blocked within milliseconds.

  useEffect(() => {
    if (!token) return;

    // prevTokenRef tracks the previous value. If it was already a non-empty string,
    // this is a token rotation not a fresh login — skip expensive init calls.
    const wasAlreadyLoggedIn = hasInitializedRef.current;
    if (wasAlreadyLoggedIn) {
      // On token rotation we only need to ensure the socket reconnects (handled
      // by the [token, effectiveUserId] effect below). Nothing else needed.
      return;
    }

    // Mark initialized so subsequent token changes skip this block.
    hasInitializedRef.current = true;

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

    // Register E2EE nacl.box public key once per app session — key material doesn't
    // change during a session so re-registering on every token refresh is wasteful.
    if (!hasRegisteredKeysRef.current) {
      hasRegisteredKeysRef.current = true;
      e2eCryptoService.registerPublicKeyWithBackend(token).catch(() => {});
    }

    // Initialize push notifications — request permission, get FCM token, upload to backend
    notificationService.init(token).catch(() => {});
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
      notificationService.cleanup();
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

  // ─── conversationId UUID cache ───────────────────────────────────────────
  const convUUIDCacheRef = useRef<Map<string, string>>(new Map());

  const _resolveConvId = useCallback(
    async (localConvId: string, recipientDbId?: string): Promise<string | null> => {
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (UUID_RE.test(localConvId)) return localConvId;

      const cached = convUUIDCacheRef.current.get(localConvId);
      if (cached) return cached;

      if (!recipientDbId || !UUID_RE.test(recipientDbId)) return null;

      const tok = tokenRef.current;
      if (!tok) return null;

      const result = await apiService.getOrCreateDirectConversation(tok, recipientDbId);
      if (!result?.id) return null;

      convUUIDCacheRef.current.set(localConvId, result.id);

      const existing = conversationsRef.current.find((c) => c.id === localConvId);
      if (existing && existing.id !== result.id) {
        dispatch(addConvRedux({ ...existing, id: result.id, recipientDbId }));
        dispatch(removeConversation({ conversationId: localConvId }));
        const msgs = messagesMapRef.current[localConvId] || [];
        if (msgs.length > 0) {
          dispatch(setMessagesForConversation({ conversationId: result.id, messages: msgs }));
        }
      }

      return result.id;
    },
    [dispatch],
  );

  const flushPendingMessages = useCallback(async () => {
    const allMsgsMap = messagesMapRef.current;
    const convs = conversationsRef.current;
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    for (const [cId, msgs] of Object.entries(allMsgsMap)) {
      if (!Array.isArray(msgs)) continue;
      const pending = msgs.filter(
        (m) => m.isMe && (m.status === 'SENDING' || m.status === 'FAILED'),
      );
      if (pending.length === 0) continue;

      const conv = convs.find((c) => c.id === cId);
      let receiverId = conv?.recipientDbId;
      if (!receiverId || !UUID_RE.test(receiverId)) {
        const handle = (conv?.username || conv?.title || '').replace(/^@+/, '');
        const tok = tokenRef.current;
        if (handle && tok) {
          try {
            const results = await apiService.searchUsers(tok, handle);
            const match =
              results.find(
                (u: any) =>
                  (u.username &&
                    u.username.toLowerCase().replace(/^@+/, '') === handle.toLowerCase()) ||
                  (u.name && u.name.toLowerCase() === handle.toLowerCase()),
              ) || results[0];
            if (match?.id && UUID_RE.test(match.id)) {
              receiverId = match.id;
              if (conv) conv.recipientDbId = match.id;
            }
          } catch (_) {}
        }
      }
      if (!receiverId || !UUID_RE.test(receiverId)) continue;

      for (const msg of pending) {
        try {
          const realConvId = await _resolveConvId(msg.conversationId || cId, receiverId);
          if (realConvId) {
            dispatch(
              updateMessageStatus({
                conversationId: cId,
                messageId: msg.id,
                clientMessageId: msg.id,
                status: 'SENDING',
              }),
            );
            socketService.sendMessage({
              clientMessageId: msg.id,
              conversationId: realConvId,
              receiverId,
              text: msg.text,
              imagePath: msg.imagePath,
              location: msg.location,
            });
          }
        } catch {}
      }
    }
  }, [dispatch, _resolveConvId]);

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

    // Auto-retry sending pending/unsent messages on reconnect
    flushPendingMessages();
  }, [flushPendingMessages]);

  const _handleDisconnect = useCallback((_reason: string) => {}, []);

  const _handleIncomingMessage = useCallback(async (payload: IncomingMessage) => {
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

    // ── E2EE: Decrypt incoming message text using nacl.box ───────────────
    // If ciphertexts contains e2e fields (ciphertext + nonce + senderPublicKey),
    // decrypt using our private key. Falls back to plaintext for legacy messages.
    let finalDecryptedText = payload.text || '';
    if (!finalDecryptedText && payload.ciphertexts) {
      if (typeof payload.ciphertexts === 'object' && !Array.isArray(payload.ciphertexts)) {
        const ct = payload.ciphertexts as any;
        if (ct.ciphertext && ct.nonce) {
          // E2EE message — decrypt with sender's public key
          const senderPubKey = ct.senderPublicKey || null;
          finalDecryptedText = await e2eCryptoService.decryptMessage(
            ct.ciphertext,
            ct.nonce,
            senderPubKey,
          );
        } else {
          finalDecryptedText = ct.text || ct.caption || '';
        }
      } else if (Array.isArray(payload.ciphertexts)) {
        finalDecryptedText = payload.ciphertexts[0]?.ciphertext || '';
      }
    }
    // Backward compatibility for existing encrypted attachment JSON payload:
    let attachmentCrypto: { fileKey: string; fileNonce: string } | undefined;
    try {
      if (finalDecryptedText && finalDecryptedText.startsWith('{"isEncryptedAttachment":true')) {
        const parsed = JSON.parse(finalDecryptedText);
        finalDecryptedText = parsed.caption || '';
        if (parsed.fileKey && parsed.fileNonce) {
          attachmentCrypto = {
            fileKey: parsed.fileKey,
            fileNonce: parsed.fileNonce,
          };
        }
      }
    } catch (_) {}

    // Detect Voice/Audio message
    const isAudioMsg =
      payload.type === 'AUDIO' ||
      (payload.ciphertexts &&
        typeof payload.ciphertexts === 'object' &&
        (payload.ciphertexts as any).type === 'AUDIO');

    const audioUrl = isAudioMsg
      ? (payload.ciphertexts as any)?.audioPath || payload.imagePath
      : undefined;
    const audioDuration = isAudioMsg
      ? (payload.ciphertexts as any)?.durationSeconds ||
        ((payload as any).mediaSize ? parseFloat((payload as any).mediaSize) : 0)
      : undefined;

    if (
      isAudioMsg &&
      (payload.ciphertexts as any)?.fileKey &&
      (payload.ciphertexts as any)?.fileNonce
    ) {
      attachmentCrypto = {
        fileKey: (payload.ciphertexts as any).fileKey,
        fileNonce: (payload.ciphertexts as any).fileNonce,
      };
    }

    const durationStr = audioDuration
      ? `${Math.floor(audioDuration / 60)}:${(Math.floor(audioDuration) % 60).toString().padStart(2, '0')}`
      : '0:00';

    const incomingMsg: ChatMessage = {
      id: payload.serverMessageId,
      conversationId: convId,
      text: finalDecryptedText,
      ciphertexts: payload.ciphertexts,
      attachmentCrypto,
      isMe: false,
      time: timeStr,
      status: 'DELIVERED',
      createdAtMs: payload.createdAt ? new Date(payload.createdAt).getTime() : Date.now(),
      createdAt: payload.createdAt || now.toISOString(),
      type:
        payload.type === 'SYSTEM'
          ? 'SYSTEM'
          : payload.type === 'EXPENSE'
            ? 'EXPENSE'
            : isAudioMsg
              ? 'AUDIO'
              : payload.imagePath
                ? 'IMAGE'
                : payload.location
                  ? 'LOCATION'
                  : payload.document
                    ? 'DOCUMENT'
                    : payload.contact
                      ? 'CONTACT'
                      : 'TEXT',
      imagePath: isAudioMsg ? undefined : payload.imagePath,
      audioPath: audioUrl,
      audioDurationSeconds: audioDuration,
      mediaSize: isAudioMsg ? durationStr : (payload as any).mediaSize || (payload as any).fileSize,
      isDownloaded: false,
      location: payload.location,
      document: payload.document,
      contact: payload.contact,
      isStarred: false,
    };

    const previewSnippet =
      finalDecryptedText ||
      (isAudioMsg
        ? '🎤 Voice message'
        : payload.imagePath
          ? '📷 Photo'
          : payload.document
            ? `📄 ${payload.document.name || 'Document'}`
            : payload.contact
              ? `👤 Contact: ${payload.contact.name}`
              : payload.location
                ? '📍 Location'
                : 'Message');

    // 1. Dispatch to canonical server conversationId ONLY.
    // PERF FIX: Previously dispatched appendMessage 3 times for same message —
    // once to convId, once to existingConv.id (if different), once to payload.senderId.
    // Each dispatch triggers a reducer run + scheduled AsyncStorage write.
    // Now: single dispatch. UI de-duplication handles display across alias IDs.
    dispatch(appendMessage({ conversationId: convId, message: incomingMsg }));

    // ── WatermelonDB: persist message + conversation locally (fire-and-forget) ──
    // This is the local-first write — server relay has already cleared ciphertexts,
    // so this device's local DB becomes the permanent record of this message.
    (async () => {
      try {
        // Ensure conversation row exists before writing message (FK reference)
        await dbUpsertConversation({
          serverId: convId,
          type: 'DIRECT',
          title: resolvedTitle,
          avatarUrl: resolvedAvatar,
          recipientDbId: payload.senderId,
          recipientUsername: senderUsernameClean,
          recipientPhone: payload.senderPhone,
          lastMessageText: previewSnippet,
          lastMessageAt: incomingMsg.createdAtMs,
          lastMessageIsMe: false,
          lastMessageStatus: 'DELIVERED',
        });

        await dbUpsertMessage({
          serverId: incomingMsg.id,
          clientMessageId: incomingMsg.id, // incoming messages use serverId as clientMessageId
          conversationServerId: convId,
          senderId: payload.senderId,
          senderName: payload.senderName || undefined,
          senderAvatar: resolvedAvatar,
          isMe: false,
          text: finalDecryptedText || undefined,
          type: incomingMsg.type || 'TEXT',
          status: 'DELIVERED',
          imagePath: isAudioMsg ? audioUrl : payload.imagePath || undefined,
          mediaSize: isAudioMsg
            ? audioDuration
              ? String(audioDuration)
              : undefined
            : incomingMsg.mediaSize || undefined,
          attachmentFileKey: attachmentCrypto?.fileKey,
          attachmentFileNonce: attachmentCrypto?.fileNonce,
          locationJson: payload.location ? JSON.stringify(payload.location) : undefined,
          documentJson: payload.document ? JSON.stringify(payload.document) : undefined,
          contactJson: payload.contact ? JSON.stringify(payload.contact) : undefined,
          createdAtMs: incomingMsg.createdAtMs,
        });
      } catch (dbErr) {
        // Never let a DB write failure affect the real-time message flow
        console.warn('[WatermelonDB] Failed to persist incoming message:', dbErr);
      }
    })();

    // 2. Find any matching existing conversation by ID or recipientDbId
    const existingConv = conversationsRef.current.find(
      (c) => c.id === convId || (c.recipientDbId && c.recipientDbId === payload.senderId),
    );

    const isUserLooking =
      activeConvIdRef.current === convId ||
      (existingConv ? activeConvIdRef.current === existingConv.id : false);

    // 🎵 WhatsApp Style Notification Sounds:
    // If inside chat -> play gentle in-chat pop sound
    // If outside chat -> play melodic alert notification ringtone + haptics
    if (isUserLooking) {
      soundService.playInChatReceiveSound();
    } else {
      soundService.playNotificationTone();
    }

    // Update or create conversation list entry
    if (existingConv) {
      _updateLastMessageInternal(
        existingConv.id,
        previewSnippet,
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
      // WatermelonDB: mark as FAILED
      dbUpdateMessageStatus(ack.clientMessageId, 'FAILED').catch(() => {});
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
    // WatermelonDB: promote clientMessageId → serverId, mark SENT
    dbUpdateMessageStatus(ack.clientMessageId, 'SENT', ack.serverMessageId).catch(() => {});
  }, []);

  const _handleReceiptUpdate = useCallback((receipt: ReceiptUpdate) => {
    const newStatus = receipt.status === 'READ' ? 'READ' : 'DELIVERED';
    dispatch(
      updateMessageStatus({
        conversationId: receipt.conversationId,
        messageId: receipt.serverMessageId,
        clientMessageId: receipt.clientMessageId,
        status: newStatus,
      }),
    );
    // WatermelonDB: update delivery/read status
    if (receipt.serverMessageId) {
      dbUpdateMessageStatus(receipt.serverMessageId, newStatus).catch(() => {});
    }
    if (receipt.clientMessageId && receipt.clientMessageId !== receipt.serverMessageId) {
      dbUpdateMessageStatus(receipt.clientMessageId, newStatus).catch(() => {});
    }
  }, []);

  const _handlePresenceUpdate = useCallback((presence: PresenceUpdate) => {
    // PERF FIX: Only update presenceMap (lightweight object merge).
    // Previously this also called dispatch(setConversations(conversations.map())) which
    // rebuilt the ENTIRE conversations array on every single presence ping — causing a
    // full re-render of ConversationListScreen + every conversation row every 30 seconds.
    // isUserOnline() reads directly from presenceMap, so the UI updates without rebuilding
    // the conversations array. The isOnline field in ConversationItem is now derived at
    // render time via isUserOnline() rather than embedded in the store.
    setPresenceMap((prev) => {
      const next = { ...prev };
      next[presence.userId] = {
        isOnline: presence.isOnline,
        lastSeen: presence.isOnline ? null : presence.lastSeen,
      };
      return next;
    });
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

  const syncServerConversations = async (force = false) => {
    const tok = tokenRef.current;
    if (!tok) return;
    const now = Date.now();
    if (!force && (isSyncingConvsRef.current || now - lastConvsSyncTimeRef.current < 60000)) {
      return;
    }
    isSyncingConvsRef.current = true;
    try {
      const serverConvs = await apiService.fetchUserConversations(tok);
      lastConvsSyncTimeRef.current = Date.now();
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
          otherMember?.user?.displayName ||
          otherMember?.user?.username ||
          // Never use sc.title for DIRECT conversations — the DB stores the enum
          // string 'DIRECT' in the title column for 1:1 chats (title is only
          // meaningful for GROUP conversations). Falling through to 'Chat' is safer.
          (sc.type !== 'DIRECT' ? sc.title : null) ||
          'Chat';
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
          const extractedCtText =
            typeof ct?.text === 'string' && ct.text
              ? ct.text
              : Array.isArray(ct) && ct[0]?.ciphertext
                ? ct[0].ciphertext
                : typeof ct?.content === 'string' && ct.content
                  ? ct.content
                  : '';
          lastMsgText =
            lastMsgObj.text ||
            extractedCtText ||
            (lastMsgObj.type === 'IMAGE'
              ? '📷 Photo'
              : lastMsgObj.type === 'LOCATION'
                ? '📍 Location'
                : lastMsgObj.type === 'DOCUMENT'
                  ? '📄 Document'
                  : lastMsgObj.type === 'CONTACT'
                    ? '👤 Contact'
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

        // Also persist clean title & recipient details to local DB
        dbUpsertConversation({
          serverId: sc.id,
          type: sc.type || 'DIRECT',
          title: resolvedTitle && resolvedTitle !== 'DIRECT' ? resolvedTitle : undefined,
          avatarUrl: otherAvatar || matchedContact?.avatarUrl,
          recipientDbId: otherDbId,
          recipientUsername: otherUsername,
          recipientPhone: otherPhone,
          lastMessageText: lastMsgObj ? lastMsgText : existing?.lastMessage,
          lastMessageAt: lastMsgObj?.createdAt
            ? new Date(lastMsgObj.createdAt).getTime()
            : undefined,
          lastMessageIsMe: finalLastMsgIsMe,
          lastMessageStatus: finalLastMsgStatus,
        }).catch(() => {});
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
    } catch {
    } finally {
      isSyncingConvsRef.current = false;
    }
  };

  const loadHistoricalMessagesForConversation = async (conversationId: string, force = false) => {
    const tok = tokenRef.current;
    if (!tok || !conversationId) return;

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let targetConvId = conversationId;
    if (!UUID_RE.test(conversationId)) {
      const conv = conversationsRef.current.find((c) => c.id === conversationId);
      if (conv?.recipientDbId) {
        const resolved = await _resolveConvId(conversationId, conv.recipientDbId);
        if (resolved) targetConvId = resolved;
      }
    }

    if (!force) {
      if (
        globalLoadingHistoricalConvs.has(conversationId) ||
        globalLoadingHistoricalConvs.has(targetConvId) ||
        globalLoadedHistoricalConvs.has(conversationId) ||
        globalLoadedHistoricalConvs.has(targetConvId)
      ) {
        return;
      }
      const existingLocal =
        messagesMapRef.current[conversationId] || messagesMapRef.current[targetConvId];
      if (existingLocal && existingLocal.length > 0) {
        globalLoadedHistoricalConvs.add(conversationId);
        globalLoadedHistoricalConvs.add(targetConvId);
        return;
      }
    }

    globalLoadingHistoricalConvs.add(conversationId);
    globalLoadingHistoricalConvs.add(targetConvId);
    try {
      const serverMsgs = await apiService.fetchHistoricalMessages(tok, targetConvId);
      globalLoadedHistoricalConvs.add(conversationId);
      globalLoadedHistoricalConvs.add(targetConvId);

      if (!Array.isArray(serverMsgs) || serverMsgs.length === 0) return;

      const myDbId = (authUserIdRef.current || extractUserIdFromToken(tok) || '').toLowerCase();

      const formatted: ChatMessage[] = await Promise.all(
        serverMsgs.map(async (m: any) => {
          const senderLow = (m.senderId || '').toLowerCase();
          const isMe = myDbId ? senderLow === myDbId : false;
          const d = new Date(m.createdAt);
          const timeStr = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;

          const ct = m.ciphertexts || {};
          let decryptedText =
            typeof m.text === 'string' && m.text
              ? m.text
              : typeof ct?.text === 'string' && ct.text
                ? ct.text
                : Array.isArray(m.ciphertexts) && m.ciphertexts[0]?.ciphertext
                  ? m.ciphertexts[0].ciphertext
                  : typeof ct?.content === 'string'
                    ? ct.content
                    : '';

          // E2EE: decrypt historical message if it has nacl.box ciphertext + nonce
          if (!isMe && ct.ciphertext && ct.nonce) {
            const senderPubKey = ct.senderPublicKey || null;
            decryptedText = await e2eCryptoService.decryptMessage(
              ct.ciphertext,
              ct.nonce,
              senderPubKey,
            );
          }

          let finalDecryptedText = decryptedText;
          let attachmentCrypto: { fileKey: string; fileNonce: string } | undefined;
          try {
            if (decryptedText && decryptedText.startsWith('{"isEncryptedAttachment":true')) {
              const parsed = JSON.parse(decryptedText);
              finalDecryptedText = parsed.caption || '';
              if (parsed.fileKey && parsed.fileNonce) {
                attachmentCrypto = {
                  fileKey: parsed.fileKey,
                  fileNonce: parsed.fileNonce,
                };
              }
            }
          } catch (_) {}

          return {
            id: m.id,
            conversationId: targetConvId,
            text: finalDecryptedText,
            ciphertexts: m.ciphertexts,
            attachmentCrypto,
            time: timeStr,
            isMe: Boolean(isMe),
            status: m.status === 'READ' ? 'READ' : m.status === 'DELIVERED' ? 'DELIVERED' : 'SENT',
            createdAtMs: new Date(m.createdAt).getTime(),
            createdAt: m.createdAt,
            imagePath: ct.imagePath ? apiService.getResolvedMediaUrl(ct.imagePath) : undefined,
            location: ct.location,
            isStarred: false,
          } as ChatMessage;
        }),
      );

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
    } catch {
    } finally {
      globalLoadingHistoricalConvs.delete(conversationId);
      globalLoadingHistoricalConvs.delete(targetConvId);
    }
  };

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
        return updated;
      });

      const updated = { ...userProfileRef.current, ...profile };
      userProfileRef.current = updated;
      safeStorage.setItem('@whatsapp_connect_user_profile', JSON.stringify(updated));
      safeStorage.setItem(AUTH_STORAGE_KEYS.USER_PROFILE, JSON.stringify(updated));
      dispatch(profileUpdatedSuccess(updated));
      const tok = tokenRef.current;
      if (tok) {
        apiService.updateProfile(tok, updated).catch(() => {});
      }
    },
    [dispatch],
  );

  // ─── Message sending ──────────────────────────────────────────────────────

  const addMessage = (
    conversationId: string,
    text: string,
    isMe = true,
    imagePath?: string,
    location?: {
      lat: number;
      lng: number;
      label?: string;
      isLive?: boolean;
      liveDurationMinutes?: number;
      expiresAt?: string;
      isLiveEnded?: boolean;
      accuracy?: number;
    },
    receiverId?: string,
    contactTitle?: string,
    contactUsername?: string,
    document?: { uri: string; name: string; size?: number | string; mimeType?: string },
    contactPayload?: { name: string; phone: string; username?: string },
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
      document,
      contact: contactPayload,
      isStarred: false,
    };

    const snippet =
      text ||
      (imagePath
        ? '📷 Photo'
        : document
          ? `📄 ${document.name || 'Document'}`
          : contactPayload
            ? `👤 Contact: ${contactPayload.name}`
            : location
              ? location.isLive
                ? '📡 Live Location'
                : '📍 Location'
              : '');

    dispatch(appendMessage({ conversationId, message: newMsg }));

    // ── WatermelonDB: persist optimistic outgoing message ──────────────────
    (async () => {
      try {
        await dbUpsertConversation({
          serverId: conversationId,
          type: 'DIRECT',
          title:
            resolvedTitle && resolvedTitle !== 'DIRECT'
              ? resolvedTitle
              : contactTitle || contactUsername || undefined,
          recipientDbId: receiverId,
          recipientUsername: contactUsername,
          lastMessageText: snippet || text,
          lastMessageAt: newMsg.createdAtMs,
          lastMessageIsMe: true,
          lastMessageStatus: 'SENDING',
        });
        await dbUpsertMessage({
          clientMessageId,
          conversationServerId: conversationId,
          senderId: authUserIdRef.current || 'me',
          isMe: true,
          text: text || undefined,
          type: document ? 'DOCUMENT' : contactPayload ? 'CONTACT' : location ? 'LOCATION' : 'TEXT',
          status: 'SENDING',
          locationJson: location ? JSON.stringify(location) : undefined,
          documentJson: document ? JSON.stringify(document) : undefined,
          contactJson: contactPayload ? JSON.stringify(contactPayload) : undefined,
          createdAtMs: newMsg.createdAtMs!,
        });
      } catch (dbErr) {
        console.warn('[WatermelonDB] Failed to persist outgoing message:', dbErr);
      }
    })();

    if (isMe) {
      soundService.playMessageSentSound();
    }

    // Update or create conversation entry
    const existingConv = conversationsRef.current.find((c) => c.id === conversationId);
    if (existingConv) {
      _updateLastMessageInternal(conversationId, snippet, false, true, 'SENDING');
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
          lastMessage: snippet,
          time: timeStr,
          lastMessageIsMe: true,
          lastMessageStatus: 'SENDING',
          unread: '0',
          avatar: resolvedTitle[0]?.toUpperCase() ?? 'C',
          isOnline: isUserOnline(receiverId),
        }),
      );
    }

    // Async: resolve real receiverId & conversation UUID, then emit over socket
    if (isMe) {
      (async () => {
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        let effectiveReceiverId = receiverId && UUID_RE.test(receiverId) ? receiverId : undefined;

        // 1. Check if recipientDbId is already known on this conversation
        if (!effectiveReceiverId) {
          const conv = conversationsRef.current.find((c) => c.id === conversationId);
          if (conv?.recipientDbId && UUID_RE.test(conv.recipientDbId)) {
            effectiveReceiverId = conv.recipientDbId;
          }
        }

        // 2. If conversationId is a server UUID, fetch conversation members to find recipient
        const tok = tokenRef.current;
        if (!effectiveReceiverId && tok) {
          if (UUID_RE.test(conversationId)) {
            try {
              const details = await apiService.fetchConversationById(tok, conversationId);
              const myUid = (authUserIdRef.current || '').toLowerCase();
              const other = details?.members?.find(
                (m: any) => (m.userId || m.user?.id || '').toLowerCase() !== myUid,
              );
              const foundId = other?.userId || other?.user?.id;
              if (foundId && UUID_RE.test(foundId)) {
                effectiveReceiverId = foundId;
              }
            } catch (_) {}
          }

          // 3. Fallback: Search user by username, name, or handle
          if (!effectiveReceiverId) {
            const handle = (contactUsername || contactTitle || receiverId || '').replace(/^@+/, '');
            if (handle) {
              try {
                const results = await apiService.searchUsers(tok, handle);
                const match =
                  results.find(
                    (u: any) =>
                      (u.username &&
                        u.username.toLowerCase().replace(/^@+/, '') === handle.toLowerCase()) ||
                      (u.phoneNumber &&
                        u.phoneNumber.replace(/\D/g, '') === handle.replace(/\D/g, '')) ||
                      (u.name && u.name.toLowerCase() === handle.toLowerCase()),
                  ) || results[0];
                if (match?.id && UUID_RE.test(match.id)) {
                  effectiveReceiverId = match.id;
                }
              } catch (_) {}
            }
          }
        }

        if (!effectiveReceiverId || !UUID_RE.test(effectiveReceiverId)) {
          console.warn('⚠️ [ChatContext] Could not resolve receiverId UUID for:', clientMessageId);
          dispatch(
            updateMessageStatus({
              conversationId,
              messageId: clientMessageId,
              clientMessageId,
              status: 'FAILED',
            }),
          );
          return;
        }

        // Cache recipientDbId back to local conversation so subsequent messages don't need re-lookup
        const conv = conversationsRef.current.find((c) => c.id === conversationId);
        if (conv && !conv.recipientDbId) {
          conv.recipientDbId = effectiveReceiverId;
          dbUpsertConversation({
            serverId: conversationId,
            recipientDbId: effectiveReceiverId,
          }).catch(() => {});
        }

        const realConvId = await _resolveConvId(conversationId, effectiveReceiverId);
        if (!realConvId) {
          dispatch(
            updateMessageStatus({ messageId: clientMessageId, clientMessageId, status: 'FAILED' }),
          );
          return;
        }

        if (realConvId !== conversationId) {
          dispatch(
            appendMessage({
              conversationId: realConvId,
              message: { ...newMsg, conversationId: realConvId },
            }),
          );
        }

        // E2EE encryption with recipient public key
        let msgCiphertexts: any = { text: text ?? '' };
        try {
          const myPubKey = await e2eCryptoService.getMyPublicKey();
          const recipientPubKey = await e2eCryptoService.getRecipientPublicKey(
            effectiveReceiverId,
            tokenRef.current || undefined,
          );
          if (recipientPubKey && myPubKey) {
            const encrypted = await e2eCryptoService.encryptMessage(text ?? '', recipientPubKey);
            if (encrypted) {
              msgCiphertexts = {
                ciphertext: encrypted.ciphertext,
                nonce: encrypted.nonce,
                senderPublicKey: myPubKey,
              };
            }
          }
        } catch (_encErr) {
          msgCiphertexts = { text: text ?? '' };
        }

        socketService.sendMessage({
          clientMessageId,
          conversationId: realConvId,
          receiverId: effectiveReceiverId,
          text: text ?? '',
          ciphertexts: msgCiphertexts,
          imagePath,
          location,
          document,
          contact: contactPayload,
        });
      })().catch((err) => {
        console.warn('⚠️ [ChatContext] Error sending message:', err);
      });

      // Timeout: if message is still SENDING after 15s, mark it FAILED so user sees Retry button
      setTimeout(() => {
        const curMsgs = messagesMapRef.current[conversationId] || [];
        const cur = curMsgs.find((m) => m.id === clientMessageId);
        if (cur && cur.status === 'SENDING') {
          dispatch(
            updateMessageStatus({
              conversationId,
              messageId: clientMessageId,
              clientMessageId,
              status: 'FAILED',
            }),
          );
        }
      }, 15000);
    }
  };

  const sendMediaMessage = async (params: {
    conversationId: string;
    mediaUri: string;
    base64Data?: string;
    fileName?: string;
    mimeType?: string;
    fileSize?: number;
    caption?: string;
    receiverId: string;
    contactTitle?: string;
    contactUsername?: string;
  }): Promise<string> => {
    const {
      conversationId,
      mediaUri,
      caption = '',
      receiverId,
      contactTitle,
      contactUsername,
      fileSize,
    } = params;

    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    const clientMessageId = `cmid_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    let formattedSize = '52 kB';
    if (fileSize) {
      formattedSize =
        fileSize > 1024 * 1024
          ? `${(fileSize / (1024 * 1024)).toFixed(1)} MB`
          : `${Math.round(fileSize / 1024)} kB`;
    }

    const resolvedTitle = getResolvedDisplayName(
      { username: contactUsername || receiverId, name: contactTitle },
      contactTitle || receiverId || conversationId,
    );

    // 1. Optimistic message displayed INSTANTLY with local URI preview so user never sees a blank box
    const newMsg: ChatMessage = {
      id: clientMessageId,
      conversationId,
      text: caption,
      isMe: true,
      time: timeStr,
      status: 'SENDING',
      createdAtMs: Date.now(),
      createdAt: now.toISOString(),
      imagePath: mediaUri, // Local preview on sender's device!
      mediaSize: formattedSize,
      isUploading: true,
      uploadProgress: 20,
      isStarred: false,
    };

    dispatch(appendMessage({ conversationId, message: newMsg }));
    soundService.playMessageSentSound();

    _updateLastMessageInternal(conversationId, caption || '📷 Photo', false, true, 'SENDING');

    // ── WatermelonDB: persist optimistic media message ─────────────────────
    (async () => {
      try {
        await dbUpsertConversation({
          serverId: conversationId,
          type: 'DIRECT',
          recipientDbId: receiverId,
          lastMessageText: caption || '📷 Photo',
          lastMessageAt: newMsg.createdAtMs,
          lastMessageIsMe: true,
          lastMessageStatus: 'SENDING',
        });
        await dbUpsertMessage({
          clientMessageId,
          conversationServerId: conversationId,
          senderId: authUserIdRef.current || 'me',
          isMe: true,
          text: caption || undefined,
          type: 'IMAGE',
          status: 'SENDING',
          imagePath: mediaUri, // local preview URI until upload completes
          mediaSize: formattedSize,
          isUploading: true,
          uploadProgress: 20,
          createdAtMs: newMsg.createdAtMs!,
        });
      } catch (dbErr) {
        console.warn('[WatermelonDB] Failed to persist media message:', dbErr);
      }
    })();

    // 2. Perform background upload
    (async () => {
      try {
        let base64 = params.base64Data;
        if (!base64 && mediaUri) {
          try {
            base64 = await FileSystem.readAsStringAsync(mediaUri, {
              encoding: FileSystem.EncodingType.Base64,
            });
          } catch (_) {}
        }

        const token = await safeStorage.getItem('@chat_token');
        if (!token || !base64) {
          throw new Error('No auth token or base64 data available');
        }

        // 🔐 Symmetric Attachment Encryption (XSalsa20-Poly1305 AEAD):
        // 1. Generate random per-file 32-byte symmetric key and 24-byte nonce
        const fileKey = nacl.randomBytes(32);
        const fileNonce = nacl.randomBytes(24);
        const rawFileBytes = new Uint8Array(base64ToArrayBuffer(base64));
        const encryptedFileBytes = nacl.secretbox(rawFileBytes, fileNonce, fileKey);
        const encryptedBase64 = arrayBufferToBase64(encryptedFileBytes);

        dispatch(
          updateMessageProgress({
            messageId: clientMessageId,
            uploadProgress: 50,
            isUploading: true,
          }),
        );

        // 2. Upload the ENCRYPTED ciphertext to storage — server NEVER sees plaintext media bytes!
        const uploadRes = await apiService.uploadMediaFile(
          token,
          encryptedBase64,
          params.fileName || `enc_photo_${Date.now()}.bin`,
          'application/octet-stream',
        );

        if (!uploadRes.success || !uploadRes.url) {
          throw new Error('Upload failed from server');
        }

        // Upload succeeded! Update message state with remote URL and transition to SENDING
        // (clears any previous FAILED state from a prior attempt)
        dispatch(
          updateMessageStatus({
            conversationId,
            messageId: clientMessageId,
            clientMessageId,
            status: 'SENDING',
          }),
        );
        dispatch(
          updateMessageProgress({
            messageId: clientMessageId,
            uploadProgress: 100,
            isUploading: false,
            imagePath: uploadRes.url,
          }),
        );

        // WatermelonDB: update with remote URL + encryption keys
        dbUpdateMessageStatus(
          clientMessageId,
          'SENDING',
          undefined,
          uploadRes.url,
          false,
          100,
        ).catch(() => {});

        // 3. Package symmetric file key + nonce and send via socket
        const realConvId = await _resolveConvId(conversationId, receiverId);
        if (realConvId) {
          socketService.sendMessage({
            clientMessageId,
            conversationId: realConvId,
            receiverId,
            text: caption || '',
            ciphertexts: {
              text: caption || '',
              imagePath: uploadRes.url,
              mediaSize: formattedSize,
              // Include encryption keys so receiver can decrypt the attachment
              fileKey: arrayBufferToBase64(fileKey),
              fileNonce: arrayBufferToBase64(fileNonce),
            },
            imagePath: uploadRes.url,
            mediaSize: formattedSize,
          });
        } else {
          // Even if conv resolution fails, upload already succeeded — mark not-uploading
          // so the X cancel icon disappears and the thumbnail is visible
          dispatch(
            updateMessageProgress({
              messageId: clientMessageId,
              uploadProgress: 100,
              isUploading: false,
            }),
          );
        }
      } catch (err) {
        console.warn('Media upload failed:', err);
        dispatch(
          updateMessageProgress({
            messageId: clientMessageId,
            uploadProgress: 0,
            isUploading: false,
          }),
        );
        dispatch(
          updateMessageStatus({
            conversationId,
            messageId: clientMessageId,
            clientMessageId,
            status: 'FAILED',
          }),
        );
      }
    })();

    // Safety timeout: if message is still uploading/sending after 45s, mark as failed
    // so the X icon never stays stuck permanently
    setTimeout(() => {
      const curMsgs = messagesMapRef.current[conversationId] || [];
      const cur = curMsgs.find((m) => m.id === clientMessageId);
      if (cur && (cur.isUploading || cur.status === 'SENDING')) {
        dispatch(
          updateMessageProgress({
            messageId: clientMessageId,
            uploadProgress: 0,
            isUploading: false,
          }),
        );
        dispatch(
          updateMessageStatus({
            conversationId,
            messageId: clientMessageId,
            clientMessageId,
            status: 'FAILED',
          }),
        );
      }
    }, 45000);

    return clientMessageId;
  };

  const sendAudioMessage = async (params: {
    conversationId: string;
    audioUri: string;
    durationSeconds: number;
    receiverId: string;
    contactTitle?: string;
    contactUsername?: string;
  }): Promise<string> => {
    const { conversationId, audioUri, durationSeconds, receiverId, contactTitle, contactUsername } =
      params;

    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    const clientMessageId = `cmid_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const durationMins = Math.floor(durationSeconds / 60);
    const durationSecs = Math.floor(durationSeconds % 60);
    const durationFormatted = `${durationMins}:${durationSecs.toString().padStart(2, '0')}`;

    // 1. Optimistic message displayed INSTANTLY with local audioUri
    const newMsg: ChatMessage = {
      id: clientMessageId,
      conversationId,
      text: '',
      type: 'AUDIO',
      audioPath: audioUri,
      audioDurationSeconds: durationSeconds,
      mediaSize: durationFormatted,
      isMe: true,
      time: timeStr,
      status: 'SENDING',
      createdAtMs: Date.now(),
      createdAt: now.toISOString(),
      isUploading: true,
      uploadProgress: 20,
      isStarred: false,
    };

    dispatch(appendMessage({ conversationId, message: newMsg }));
    soundService.playMessageSentSound();

    _updateLastMessageInternal(conversationId, '🎤 Voice message', false, true, 'SENDING');

    // Persist to local SQLite
    (async () => {
      try {
        await dbUpsertConversation({
          serverId: conversationId,
          type: 'DIRECT',
          recipientDbId: receiverId,
          lastMessageText: '🎤 Voice message',
          lastMessageAt: newMsg.createdAtMs,
          lastMessageIsMe: true,
          lastMessageStatus: 'SENDING',
        });
        await dbUpsertMessage({
          clientMessageId,
          conversationServerId: conversationId,
          senderId: authUserIdRef.current || 'me',
          isMe: true,
          type: 'AUDIO',
          status: 'SENDING',
          imagePath: audioUri,
          localMediaPath: audioUri,
          mediaSize: String(durationSeconds),
          isUploading: true,
          uploadProgress: 20,
          createdAtMs: newMsg.createdAtMs!,
        });
      } catch (dbErr) {
        console.warn('[SQLite] Failed to persist optimistic audio message:', dbErr);
      }
    })();

    // 2. Perform background upload & encryption
    (async () => {
      try {
        const base64 = await FileSystem.readAsStringAsync(audioUri, {
          encoding: FileSystem.EncodingType.Base64,
        });

        const token = await safeStorage.getItem('@chat_token');
        if (!token || !base64) {
          throw new Error('No auth token or base64 data available');
        }

        // 🔐 Symmetric Audio Encryption (XSalsa20-Poly1305 AEAD):
        const fileKey = nacl.randomBytes(32);
        const fileNonce = nacl.randomBytes(24);
        const rawFileBytes = new Uint8Array(base64ToArrayBuffer(base64));
        const encryptedFileBytes = nacl.secretbox(rawFileBytes, fileNonce, fileKey);
        const encryptedBase64 = arrayBufferToBase64(encryptedFileBytes);

        dispatch(
          updateMessageProgress({
            messageId: clientMessageId,
            uploadProgress: 50,
            isUploading: true,
          }),
        );

        // Upload encrypted audio file
        const uploadRes = await apiService.uploadMediaFile(
          token,
          encryptedBase64,
          `voice_${Date.now()}.bin`,
          'application/octet-stream',
        );

        if (!uploadRes.success || !uploadRes.url) {
          throw new Error('Audio upload failed on server');
        }

        dispatch(
          updateMessageStatus({
            conversationId,
            messageId: clientMessageId,
            clientMessageId,
            status: 'SENDING',
          }),
        );
        dispatch(
          updateMessageProgress({
            messageId: clientMessageId,
            uploadProgress: 100,
            isUploading: false,
          }),
        );

        // Update local DB
        dbUpdateMessageStatus(
          clientMessageId,
          'SENDING',
          undefined,
          uploadRes.url,
          false,
          100,
        ).catch(() => {});

        // Send via socket
        const realConvId = await _resolveConvId(conversationId, receiverId);
        if (realConvId) {
          socketService.sendMessage({
            clientMessageId,
            conversationId: realConvId,
            receiverId,
            type: 'AUDIO',
            mediaSize: String(durationSeconds),
            ciphertexts: {
              type: 'AUDIO',
              audioPath: uploadRes.url,
              durationSeconds,
              fileKey: arrayBufferToBase64(fileKey),
              fileNonce: arrayBufferToBase64(fileNonce),
            },
            imagePath: uploadRes.url,
          });
        }
      } catch (err) {
        console.warn('Voice message upload failed:', err);
        dispatch(
          updateMessageProgress({
            messageId: clientMessageId,
            uploadProgress: 0,
            isUploading: false,
          }),
        );
        dispatch(
          updateMessageStatus({
            conversationId,
            messageId: clientMessageId,
            clientMessageId,
            status: 'FAILED',
          }),
        );
      }
    })();

    return clientMessageId;
  };

  const updateMessageUploadProgress = (
    messageId: string,
    uploadProgress: number,
    isUploading: boolean,
    imagePath?: string,
  ) => {
    dispatch(updateMessageProgress({ messageId, uploadProgress, isUploading, imagePath }));
  };

  const updateMessageMediaDownloaded = (
    messageId: string,
    imagePath?: string,
    isDownloaded = true,
  ) => {
    dispatch(updateMessageMediaDownloadedRedux({ messageId, imagePath, isDownloaded }));
    // WatermelonDB: store the local file:// path so re-downloads are skipped on next launch
    if (imagePath && isDownloaded) {
      setMessageLocalMediaPath(messageId, imagePath).catch(() => {});
    }
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

  const resendMessage = (conversationId: string, messageId: string) => {
    const msgs = messagesMapRef.current[conversationId] || [];
    const msg = msgs.find((m) => m.id === messageId);
    if (!msg) return;

    const conv = conversationsRef.current.find((c) => c.id === conversationId);
    const receiverId = conv?.recipientDbId;
    if (!receiverId) return;

    dispatch(
      updateMessageStatus({
        conversationId,
        messageId,
        clientMessageId: messageId,
        status: 'SENDING',
      }),
    );

    (async () => {
      let finalImagePath = msg.imagePath;
      if (
        finalImagePath &&
        (finalImagePath.startsWith('file://') || finalImagePath.startsWith('/'))
      ) {
        try {
          dispatch(updateMessageProgress({ messageId, uploadProgress: 30, isUploading: true }));
          const token = await safeStorage.getItem('@chat_token');
          const base64 = await FileSystem.readAsStringAsync(finalImagePath, {
            encoding: FileSystem.EncodingType.Base64,
          });
          if (token && base64) {
            // FIX: Encrypt before re-upload — matches the original sendMediaMessage flow.
            // Previously sent plaintext base64 with hardcoded 'image/jpeg' which:
            //  (a) failed magic-bytes check for non-JPEG files (PNG, WebP, etc.)
            //  (b) exposed unencrypted media bytes to the server
            const fileKey = nacl.randomBytes(32);
            const fileNonce = nacl.randomBytes(24);
            const rawBytes = new Uint8Array(base64ToArrayBuffer(base64));
            const encryptedBytes = nacl.secretbox(rawBytes, fileNonce, fileKey);
            const encryptedBase64 = arrayBufferToBase64(encryptedBytes);

            // Derive fileName with correct extension from local URI
            const uriLower = finalImagePath.toLowerCase();
            const detectedExt = uriLower.includes('.png')
              ? 'png'
              : uriLower.includes('.gif')
                ? 'gif'
                : uriLower.includes('.webp')
                  ? 'webp'
                  : 'jpg';

            const uploadRes = await apiService.uploadMediaFile(
              token,
              encryptedBase64,
              `enc_photo_${Date.now()}.bin`,
              // Always 'application/octet-stream' for encrypted content —
              // backend explicitly allows this for authenticated encrypted uploads
              'application/octet-stream',
            );
            if (uploadRes.success && uploadRes.url) {
              finalImagePath = uploadRes.url;
              // Clear FAILED state immediately — upload succeeded, waiting for socket ack
              dispatch(
                updateMessageStatus({
                  conversationId,
                  messageId,
                  clientMessageId: messageId,
                  status: 'SENDING',
                }),
              );
              dispatch(
                updateMessageProgress({
                  messageId,
                  uploadProgress: 100,
                  isUploading: false,
                  imagePath: finalImagePath,
                }),
              );
            } else {
              throw new Error('Re-upload failed');
            }
          }
        } catch (e) {
          console.warn('Retry media upload failed:', e);
          dispatch(updateMessageProgress({ messageId, uploadProgress: 0, isUploading: false }));
          dispatch(
            updateMessageStatus({
              conversationId,
              messageId,
              clientMessageId: messageId,
              status: 'FAILED',
            }),
          );
          return;
        }
      }

      const realConvId = await _resolveConvId(conversationId, receiverId);
      if (realConvId) {
        socketService.sendMessage({
          clientMessageId: msg.id,
          conversationId: realConvId,
          receiverId,
          text: msg.text || '',
          ciphertexts: {
            text: msg.text || '',
            imagePath: finalImagePath,
            mediaSize: msg.mediaSize,
            location: msg.location,
          },
          imagePath: finalImagePath,
          mediaSize: msg.mediaSize,
          location: msg.location,
        });

        setTimeout(() => {
          const curMsgs = messagesMapRef.current[conversationId] || [];
          const cur = curMsgs.find((m) => m.id === messageId);
          if (cur && cur.status === 'SENDING') {
            dispatch(
              updateMessageStatus({
                conversationId,
                messageId,
                clientMessageId: messageId,
                status: 'FAILED',
              }),
            );
          }
        }, 12000);
      } else {
        dispatch(
          updateMessageStatus({
            conversationId,
            messageId,
            clientMessageId: messageId,
            status: 'FAILED',
          }),
        );
      }
    })();
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
    const list = [...conversationsRef.current];
    const idx = list.findIndex((c) => c.id === conversationId);

    if (idx >= 0) {
      const conv = list[idx];
      const currentUnread = parseInt(conv.unread || '0', 10);
      const updatedConv = {
        ...conv,
        lastMessage: text,
        time: timeStr,
        lastMessageIsMe: isMe,
        lastMessageStatus: (status ||
          conv.lastMessageStatus ||
          (isMe ? 'SENT' : 'DELIVERED')) as any,
        unread: incrementUnread ? String(currentUnread + 1) : '0',
      };
      // Move to top of the list
      list.splice(idx, 1);
      list.unshift(updatedConv);
      dispatch(setConversations(list));
    }
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

    // Only fetch historical messages from server if not already in local memory/state
    const localMsgs = messagesMapRef.current[conversationId];
    if (!localMsgs || localMsgs.length === 0) {
      loadHistoricalMessagesForConversation(conversationId);
    }

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

  // ─── Block & Unblock Methods ─────────────────────────────────────────────

  const isUserBlocked = useCallback(
    (targetUserId?: string): boolean => {
      if (!targetUserId) return false;
      return blockedUserIds.includes(targetUserId);
    },
    [blockedUserIds],
  );

  const isBlockedBy = useCallback(
    (targetUserId?: string): boolean => {
      if (!targetUserId) return false;
      return blockedByUserIds.includes(targetUserId);
    },
    [blockedByUserIds],
  );

  const blockUser = useCallback(async (targetUserId: string) => {
    if (!targetUserId) return;
    setBlockedUserIds((prev) => Array.from(new Set([...prev, targetUserId])));
    socketService.emit('user:block', { targetUserId });
    const tok = tokenRef.current;
    if (tok) {
      await apiService.blockUser(tok, targetUserId).catch(() => {});
    }
  }, []);

  const unblockUser = useCallback(
    async (targetUserId: string) => {
      if (!targetUserId) return;
      setBlockedUserIds((prev) => prev.filter((id) => id !== targetUserId));
      socketService.emit('user:unblock', { targetUserId });
      const tok = tokenRef.current;
      if (tok) {
        await apiService.unblockUser(tok, targetUserId).catch(() => {});
      }

      // 🔄 Auto-resend any pending/queued messages that were held while blocked!
      const currentMsgs = messagesMapRef.current;
      for (const [convId, msgs] of Object.entries(currentMsgs)) {
        const conv = conversationsRef.current.find((c) => c.id === convId);
        if (conv && (conv.recipientDbId === targetUserId || conv.id === targetUserId)) {
          for (const msg of msgs) {
            if (msg.isMe && (msg.status === 'SENDING' || msg.status === 'FAILED')) {
              resendMessage(convId, msg.id);
            }
          }
        }
      }
    },
    [resendMessage],
  );

  // ─── In-Chat WhatsApp-Style Call Log Message ─────────────────────────────

  const addCallLogMessage = useCallback(
    (
      conversationId: string,
      callType: 'audio' | 'video',
      callStatus: 'completed' | 'missed' | 'declined',
      durationSeconds: number,
      isCaller: boolean,
      callId?: string,
    ) => {
      const msgId = callId ? `call_log_${callId}` : `call_log_${Date.now()}`;
      const currentMsgs = messagesMapRef.current[conversationId] || [];
      if (currentMsgs.some((m) => m.id === msgId)) return;

      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      const callText =
        callStatus === 'missed'
          ? `Missed ${callType} call`
          : callStatus === 'declined'
            ? `Declined ${callType} call`
            : `${callType === 'video' ? 'Video' : 'Voice'} call (${Math.floor(durationSeconds / 60)}:${(durationSeconds % 60).toString().padStart(2, '0')})`;

      const newMsg: ChatMessage = {
        id: msgId,
        conversationId,
        text: callText,
        isMe: isCaller,
        time: timeStr,
        status: 'READ',
        createdAtMs: Date.now(),
        callLog: {
          callType,
          status: callStatus,
          durationSeconds,
          isCaller,
        },
      };

      dispatch(appendMessage({ conversationId, message: newMsg }));
      dispatch(
        setConversations(
          conversationsRef.current.map((c) =>
            c.id === conversationId ? { ...c, lastMessage: callText, time: timeStr } : c,
          ),
        ),
      );
    },
    [dispatch],
  );

  // Hook callService to log calls into chats automatically
  useEffect(() => {
    return callService.onCallCompleted((log) => {
      if (log.conversationId) {
        addCallLogMessage(
          log.conversationId,
          log.callType,
          log.status,
          log.durationSeconds,
          log.isCaller,
          log.callId,
        );
      }
    });
  }, [addCallLogMessage]);

  // ─── Memoized context values ────────────────────────────────────────────────
  // PERF FIX: Without useMemo, every setState in this Provider (e.g. setTypingMap from
  // a typing event) creates a new value={} object literal → ALL useChat() consumers
  // re-render even if the data they care about hasn't changed.
  //
  // With three separate memoized contexts:
  // - presenceValue only changes when presenceMap changes (every ~30s)
  // - typingValue only changes when typingMap changes (on typing events)
  // - chatValue only changes when conversations/messages/profile changes
  // Each screen subscribes only to what it needs.

  const presenceValue = useMemo<PresenceContextType>(
    () => ({ presenceMap, isUserOnline, getLastSeen }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [presenceMap],
  );

  const typingValue = useMemo<TypingContextType>(
    () => ({ typingMap, isUserTyping }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [typingMap],
  );

  const chatValue = useMemo<ChatContextType>(
    () => ({
      userProfile,
      updateUserProfile,
      conversations,
      messagesMap,
      // Keep presenceMap/typingMap in main context too for backward compat
      presenceMap,
      typingMap,
      isUserOnline,
      getLastSeen,
      isUserTyping,
      queryPresence,
      syncServerConversations,
      loadHistoricalMessagesForConversation,
      addMessage,
      sendMediaMessage,
      sendAudioMessage,
      updateMessageUploadProgress,
      updateMessageMediaDownloaded,
      addConversation,
      deleteConversation,
      clearMessages,
      updateLastMessage,
      toggleStarMessage,
      reactToMessage,
      resendMessage,
      markConversationRead,
      openChatRoom,
      closeChatRoom,
      blockedUserIds,
      blockedByUserIds,
      isUserBlocked,
      isBlockedBy,
      blockUser,
      unblockUser,
      addCallLogMessage,
      secureStorageError,
      retrySecureStorageInit,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      userProfile,
      conversations,
      messagesMap,
      blockedUserIds,
      blockedByUserIds,
      secureStorageError,
      // Stable callbacks (useCallback with []) are excluded — they never change.
      // presenceMap/typingMap are intentionally omitted here because they have their
      // own contexts above. Including them would defeat the split-context optimization.
    ],
  );

  return (
    <ChatContext.Provider value={chatValue}>
      <PresenceContext.Provider value={presenceValue}>
        <TypingContext.Provider value={typingValue}>{children}</TypingContext.Provider>
      </PresenceContext.Provider>
    </ChatContext.Provider>
  );
};

export const useChat = () => useContext(ChatContext);

// Lightweight hooks — subscribe ONLY to presence or typing state.
// Use these in components that need online status or typing indicators
// to avoid re-rendering when unrelated chat state changes.
export const usePresence = () => useContext(PresenceContext);
export const useTyping = () => useContext(TypingContext);

/**
 * Register the navigation callback for push notification deep-linking.
 * Call this once from your root navigator component after it has mounted.
 * Example: notificationNavigationHandler((screen, params) => navigation.navigate(screen, params))
 */
export function notificationNavigationHandler(
  cb: (screen: string, params: Record<string, any>) => void,
): void {
  notificationService.setNavigationHandler(cb);
}
