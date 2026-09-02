import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
  Modal,
  Image,
  ScrollView,
  Dimensions,
  Platform,
  KeyboardAvoidingView,
  Linking,
  Keyboard,
  Animated,
  PanResponder,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, ChatMessage } from '../types';
import { useChat } from '../context/ChatContext';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Contacts from 'expo-contacts';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';

let Location: any = null;
try {
  Location = require('expo-location');
} catch (_) {}

import { socketService } from '../services/socket';
import { apiService } from '../services/apiService';
import { callService } from '../services/callService';
import { SmartAvatar } from '../components/SmartAvatar';
import { getResolvedDisplayName, getResolvedContact } from '../services/contactsService';
import {
  ArrowLeft,
  Phone,
  Video,
  MoreVertical,
  Plus,
  Smile,
  Mic,
  Send,
  FileText,
  MapPin,
  Check,
  CheckCheck,
  X,
  Star,
  Download,
  Share2,
  ZoomIn,
  ShieldCheck,
  User,
  Trash2,
  Eraser,
  Image as ImageIcon,
  Reply,
  RotateCcw,
  Contact as ContactIcon,
  Search,
  ExternalLink,
  MessageSquare,
  Navigation,
  Radio,
  Clock,
  LocateFixed,
  StopCircle,
  Compass,
  ShieldAlert,
  Ban,
} from 'lucide-react-native';

type Props = NativeStackScreenProps<RootStackParamList, 'Chat'>;

const QUICK_REACTIONS = ['❤️', '😂', '👍', '😮', '😢', '🙏'];
import { TypingBubble } from '../components/TypingIndicator';

const EMOJI_LIST = [
  '😊',
  '😂',
  '🔥',
  '👍',
  '❤️',
  '🙏',
  '🎉',
  '🚀',
  '✨',
  '😍',
  '😎',
  '🙌',
  '💯',
  '👏',
  '🤔',
  '🥳',
  '🤝',
  '💪',
  '⭐',
  '💡',
  '👋',
  '🥰',
  '🤩',
  '😇',
  '🫡',
  '💖',
  '⚡',
  '🎯',
  '🌟',
  '🇮🇳',
];

export interface PendingMedia {
  uri: string;
  name: string;
  base64?: string;
}

interface SwipeableBubbleProps {
  children: React.ReactNode;
  isMe: boolean;
  onSwipeReply: () => void;
  colors: any;
}

const SwipeableBubble: React.FC<SwipeableBubbleProps> = ({
  children,
  isMe,
  onSwipeReply,
  colors,
}) => {
  const panX = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return (
          Math.abs(gestureState.dx) > 12 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy)
        );
      },
      onPanResponderMove: (_, gestureState) => {
        const maxDrag = 65;
        let dx = gestureState.dx;
        if (dx > maxDrag) dx = maxDrag + (dx - maxDrag) * 0.2;
        if (dx < -maxDrag) dx = -maxDrag + (dx + maxDrag) * 0.2;
        panX.setValue(dx);
      },
      onPanResponderRelease: (_, gestureState) => {
        if (Math.abs(gestureState.dx) > 35) {
          onSwipeReply();
        }
        Animated.spring(panX, {
          toValue: 0,
          useNativeDriver: true,
          bounciness: 6,
        }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(panX, {
          toValue: 0,
          useNativeDriver: true,
        }).start();
      },
    }),
  ).current;

  return (
    <View style={{ position: 'relative', width: '100%' }}>
      {/* Reply indicator behind bubble */}
      <Animated.View
        style={{
          position: 'absolute',
          top: '50%',
          marginTop: -16,
          [isMe ? 'right' : 'left']: 12,
          width: 32,
          height: 32,
          borderRadius: 16,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.cardBorder,
          justifyContent: 'center',
          alignItems: 'center',
          opacity: panX.interpolate({
            inputRange: [-50, -18, 0, 18, 50],
            outputRange: [1, 0.6, 0, 0.6, 1],
          }),
          transform: [
            {
              scale: panX.interpolate({
                inputRange: [-50, -18, 0, 18, 50],
                outputRange: [1, 0.7, 0.3, 0.7, 1],
              }),
            },
          ],
        }}
      >
        <Reply size={16} color={colors.primaryIndigo} />
      </Animated.View>

      <Animated.View {...panResponder.panHandlers} style={{ transform: [{ translateX: panX }] }}>
        {children}
      </Animated.View>
    </View>
  );
};

const isSameCalendarDay = (d1: Date, d2: Date) =>
  d1.getFullYear() === d2.getFullYear() &&
  d1.getMonth() === d2.getMonth() &&
  d1.getDate() === d2.getDate();

function formatChatDateSeparator(timestamp?: number | string | Date): string {
  if (!timestamp) return 'Today';
  const msgDate = new Date(timestamp);
  if (isNaN(msgDate.getTime())) return 'Today';

  const today = new Date();
  if (isSameCalendarDay(msgDate, today)) {
    return 'Today';
  }

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (isSameCalendarDay(msgDate, yesterday)) {
    return 'Yesterday';
  }

  const diffTime = today.getTime() - msgDate.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  if (diffDays >= 2 && diffDays < 7) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[msgDate.getDay()];
  }

  if (msgDate.getFullYear() === today.getFullYear()) {
    return `${msgDate.getDate()} ${months[msgDate.getMonth()]}`;
  }
  return `${msgDate.getDate()} ${months[msgDate.getMonth()]} ${msgDate.getFullYear()}`;
}

function shouldShowDateSeparator(currentMsg: ChatMessage, previousMsg?: ChatMessage): boolean {
  if (!previousMsg) return true;

  const curDate = new Date(currentMsg.createdAtMs || currentMsg.createdAt || Date.now());
  const prevDate = new Date(previousMsg.createdAtMs || previousMsg.createdAt || Date.now());

  if (isNaN(curDate.getTime()) || isNaN(prevDate.getTime())) return false;

  return !isSameCalendarDay(curDate, prevDate);
}

export const ChatScreen: React.FC<Props> = ({ route, navigation }) => {
  const { conversationId, title } = route.params;

  const {
    conversations,
    messagesMap,
    addMessage,
    updateMessageUploadProgress,
    updateMessageMediaDownloaded,
    toggleStarMessage,
    reactToMessage,
    resendMessage,
    deleteConversation,
    clearMessages,
    openChatRoom,
    closeChatRoom,
    addConversation,
    isUserOnline,
    getLastSeen,
    queryPresence,
    userProfile,
    isUserTyping,
    isUserBlocked,
    isBlockedBy,
    blockUser,
    unblockUser,
  } = useChat();

  const { themeMode, colors } = useTheme();
  const { showToast } = useToast();
  const authUserId = useSelector(
    (state: RootState) => (state.auth as any).userId as string | undefined,
  );
  const token = useSelector((state: RootState) => state.auth.token);

  // ── Resolve conversation metadata ─────────────────────────────────────────
  const currentConv = conversations.find((c) => c.id === conversationId);
  const matchedContact = getResolvedContact({
    username: currentConv?.username || (route.params as any)?.username,
    name: currentConv?.title || title,
    phone: currentConv?.phone || (route.params as any)?.phone,
  });
  const resolvedDisplayName = getResolvedDisplayName(
    {
      username: currentConv?.username || (route.params as any)?.username,
      name: currentConv?.title || title,
    },
    title,
  );

  // Local state for dynamically resolved recipient DB UUID
  const [resolvedRecipientId, setResolvedRecipientId] = useState<string | undefined>(
    currentConv?.recipientDbId || (route.params as any)?.recipientDbId,
  );

  const recipientDbId: string | undefined =
    currentConv?.recipientDbId || (route.params as any)?.recipientDbId || resolvedRecipientId;
  const targetAvatarUrl =
    currentConv?.avatarUrl || (route.params as any)?.avatarUrl || matchedContact?.avatarUrl;
  const targetUsername =
    currentConv?.username ||
    (route.params as any)?.username ||
    (matchedContact?.username ? `@${matchedContact.username.replace(/^@+/, '')}` : undefined);
  const targetPhone = currentConv?.phone || (route.params as any)?.phone || matchedContact?.phone;

  // Auto-resolve recipient UUID from server if missing on mount
  useEffect(() => {
    if (!recipientDbId) {
      const handle = (
        currentConv?.username ||
        (route.params as any)?.username ||
        currentConv?.phone ||
        (route.params as any)?.phone ||
        title
      )?.replace(/^@+/, '');

      if (handle && token) {
        apiService
          .searchUsers(token, handle)
          .then((results) => {
            const match =
              results.find(
                (u) =>
                  (u.username &&
                    u.username.toLowerCase().replace(/^@+/, '') === handle.toLowerCase()) ||
                  (u.phoneNumber &&
                    u.phoneNumber.replace(/\D/g, '') === handle.replace(/\D/g, '')) ||
                  (u.name && u.name.toLowerCase() === title.toLowerCase()),
              ) || results[0];

            if (match?.id) {
              setResolvedRecipientId(match.id);
              addConversation(
                currentConv?.title || title,
                currentConv?.username || (route.params as any)?.username,
                conversationId,
                match.id,
                match.avatarUrl,
                match.phoneNumber,
              );
            }
          })
          .catch(() => {});
      }
    }
  }, [conversationId, recipientDbId, token]);

  // ── Presence ──────────────────────────────────────────────────────────────
  const effectiveRecipientId =
    recipientDbId || (route.params as any)?.recipientDbId || currentConv?.recipientDbId;

  const isTargetOnline = isUserOnline(effectiveRecipientId);
  const lastSeenStr = getLastSeen(effectiveRecipientId);

  const formatLastSeen = (raw?: string | null) => {
    if (!raw) return 'Offline';
    try {
      const d = new Date(raw);
      if (isNaN(d.getTime())) return 'Offline';
      const now = new Date();
      const isToday = d.toDateString() === now.toDateString();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const isYesterday = d.toDateString() === yesterday.toDateString();
      const timeStr = d.toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
      if (isToday) return `Last seen today at ${timeStr}`;
      if (isYesterday) return `Last seen yesterday at ${timeStr}`;
      return `Last seen ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${timeStr}`;
    } catch {
      return 'Offline';
    }
  };

  const lastSeenLabel = isTargetOnline ? 'Online' : formatLastSeen(lastSeenStr);

  // ── Block Status ──────────────────────────────────────────────────────────
  const isBlockedByMe = isUserBlocked(effectiveRecipientId || recipientDbId || conversationId);
  const isBlockedByThem = isBlockedBy(effectiveRecipientId || recipientDbId || conversationId);

  const displayAvatarUrl = isBlockedByMe || isBlockedByThem ? undefined : targetAvatarUrl;
  const displayStatus =
    isBlockedByMe || isBlockedByThem ? '' : isTargetOnline ? 'Online' : lastSeenLabel;

  const handleToggleBlock = async () => {
    const targetId = effectiveRecipientId || recipientDbId || conversationId;
    if (!targetId) return;
    if (isBlockedByMe) {
      await unblockUser(targetId);
      showToast('Contact unblocked 🔓', 'success', 1500);
    } else {
      await blockUser(targetId);
      showToast('Contact blocked 🚫', 'info', 1500);
    }
  };

  // ── State ─────────────────────────────────────────────────────────────────
  const [inputText, setInputText] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [isRemoteTyping, setIsRemoteTyping] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [pendingMediaList, setPendingMediaList] = useState<PendingMedia[]>([]);
  const [mediaCaption, setMediaCaption] = useState('');
  const [selectedPhotoMsg, setSelectedPhotoMsg] = useState<ChatMessage | null>(null);
  const [reactingToMsg, setReactingToMsg] = useState<ChatMessage | null>(null);
  const [showUserProfileModal, setShowUserProfileModal] = useState(false);
  const [showMoreMenuModal, setShowMoreMenuModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const [isSendingLocation, setIsSendingLocation] = useState(false);
  const [showLocationPickerModal, setShowLocationPickerModal] = useState(false);
  const [selectedLiveDuration, setSelectedLiveDuration] = useState<number>(60); // 15, 60, 480 mins
  const [liveLocationComment, setLiveLocationComment] = useState('');
  const [currentGpsData, setCurrentGpsData] = useState<{
    lat: number;
    lng: number;
    label: string;
    accuracy?: number;
  } | null>(null);
  const [isLoadingGps, setIsLoadingGps] = useState(false);
  const [stoppedLiveMsgIds, setStoppedLiveMsgIds] = useState<Record<string, boolean>>({});
  const [showContactPickerModal, setShowContactPickerModal] = useState(false);
  const [availablePhoneContacts, setAvailablePhoneContacts] = useState<
    Array<{ id: string; name: string; phone: string }>
  >([]);
  const [contactSearchQuery, setContactSearchQuery] = useState('');
  const [isLoadingContacts, setIsLoadingContacts] = useState(false);

  const flatListRef = useRef<FlatList>(null);
  const textInputRef = useRef<TextInput>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSentRef = useRef(false);
  const lastTypingPingTimeRef = useRef(0);

  const recipientDbIdRef = useRef(effectiveRecipientId);
  recipientDbIdRef.current = effectiveRecipientId;
  const currentConvRef = useRef(currentConv);
  currentConvRef.current = currentConv;

  // ── Mount / unmount ───────────────────────────────────────────────────────
  useEffect(() => {
    openChatRoom(conversationId);

    // Register typing callback just for this screen
    const prevCbs = (socketService as any).callbacks ?? {};
    (socketService as any).callbacks = {
      ...prevCbs,
      onTypingUpdate: (data: { conversationId: string; senderId: string; isTyping: boolean }) => {
        const effectiveTargetId = recipientDbIdRef.current;
        const senderMatch =
          effectiveTargetId &&
          (data.senderId === effectiveTargetId ||
            data.senderId?.toLowerCase() === effectiveTargetId?.toLowerCase());
        const convMatch =
          data.conversationId === conversationId ||
          (data.conversationId &&
            conversationId &&
            (data.conversationId.includes(conversationId) ||
              conversationId.includes(data.conversationId)));

        if (!senderMatch && !convMatch) return;

        if (data.isTyping) {
          setIsRemoteTyping(true);
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = setTimeout(() => setIsRemoteTyping(false), 4000);
        } else {
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
          setIsRemoteTyping(false);
        }
      },
    };

    return () => {
      closeChatRoom(conversationId);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (typingDebounceTimerRef.current) clearTimeout(typingDebounceTimerRef.current);
      const cbs = (socketService as any).callbacks ?? {};
      (socketService as any).callbacks = { ...cbs, onTypingUpdate: undefined };
    };
  }, [conversationId]);

  // Query presence when recipient ID is resolved without remounting chat room
  useEffect(() => {
    if (effectiveRecipientId) {
      queryPresence([effectiveRecipientId]);
    }
  }, [effectiveRecipientId]);

  // ── Messages sorted (Merged across primary conversationId and matched aliases) ───
  const matchedExistingConv = useMemo(() => {
    return conversations.find((c) => {
      if (c.id === conversationId) return true;
      if (effectiveRecipientId && c.recipientDbId === effectiveRecipientId) return true;
      if (
        targetUsername &&
        c.username &&
        c.username.toLowerCase().replace(/^@+/, '') ===
          targetUsername.toLowerCase().replace(/^@+/, '')
      )
        return true;
      if (
        targetPhone &&
        c.phone &&
        c.phone.replace(/\D/g, '').slice(-10) === targetPhone.replace(/\D/g, '').slice(-10)
      )
        return true;
      return false;
    });
  }, [conversations, conversationId, effectiveRecipientId, targetUsername, targetPhone]);

  const resolvedConvId = matchedExistingConv?.id || conversationId;

  const roomMessages = useMemo(() => {
    const msgsPrimary = messagesMap[conversationId] || [];
    const msgsResolved = resolvedConvId !== conversationId ? messagesMap[resolvedConvId] || [] : [];
    const msgsRecipient =
      effectiveRecipientId &&
      effectiveRecipientId !== conversationId &&
      effectiveRecipientId !== resolvedConvId
        ? messagesMap[effectiveRecipientId] || []
        : [];

    const combined = [...msgsPrimary, ...msgsResolved, ...msgsRecipient];
    // Dedup by id
    const seen = new Map<string, ChatMessage>();
    for (const m of combined) {
      if (m?.id) seen.set(m.id, m);
    }
    return Array.from(seen.values()).sort((a, b) => {
      const tA = a.createdAtMs || (a.createdAt ? new Date(a.createdAt).getTime() : 0);
      const tB = b.createdAtMs || (b.createdAt ? new Date(b.createdAt).getTime() : 0);
      return tA - tB;
    });
  }, [messagesMap, conversationId, resolvedConvId, effectiveRecipientId]);

  // ── Scroll to bottom on new messages ──────────────────────────────────────
  useEffect(() => {
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
  }, [roomMessages.length]);

  useEffect(() => {
    const sub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 120),
    );
    return () => sub.remove();
  }, []);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleSendMessage = useCallback(async () => {
    const text = inputText.trim();
    if (!text) return;

    let targetId =
      recipientDbId || (route.params as any)?.recipientDbId || currentConv?.recipientDbId;
    if (!targetId && token) {
      const handle = (
        currentConv?.username ||
        (route.params as any)?.username ||
        currentConv?.phone ||
        (route.params as any)?.phone ||
        title
      )?.replace(/^@+/, '');

      if (handle) {
        try {
          const results = await apiService.searchUsers(token, handle);
          const match =
            results.find(
              (u) =>
                (u.username &&
                  u.username.toLowerCase().replace(/^@+/, '') === handle.toLowerCase()) ||
                (u.phoneNumber && u.phoneNumber.replace(/\D/g, '') === handle.replace(/\D/g, '')) ||
                (u.name && u.name.toLowerCase() === title.toLowerCase()),
            ) || results[0];
          if (match?.id) {
            targetId = match.id;
            setResolvedRecipientId(match.id);
          }
        } catch (e) {}
      }
    }

    addMessage(
      conversationId,
      text,
      true,
      undefined,
      undefined,
      targetId,
      resolvedDisplayName,
      currentConv?.username || (route.params as any)?.username,
    );
    setInputText('');
    setReplyTo(null);
    setShowEmojiPicker(false);
    setShowAttachMenu(false);
    // Stop typing indicator immediately on send
    if (typingDebounceTimerRef.current) clearTimeout(typingDebounceTimerRef.current);
    if (targetId) {
      lastTypingSentRef.current = false;
      socketService.sendTyping(conversationId, targetId, false);
    }
  }, [
    inputText,
    recipientDbId,
    conversationId,
    token,
    currentConv,
    title,
    resolvedDisplayName,
    route.params,
  ]);

  const handleInputChange = useCallback(
    (text: string) => {
      setInputText(text);
      const effectiveTargetId =
        recipientDbId || (route.params as any)?.recipientDbId || currentConv?.recipientDbId;
      if (!effectiveTargetId) return;

      if (text.length > 0) {
        const now = Date.now();
        // Send typing heartbeat if not sent yet OR if last sent was > 1800ms ago
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
      } else if (text.length === 0 && lastTypingSentRef.current) {
        if (typingDebounceTimerRef.current) clearTimeout(typingDebounceTimerRef.current);
        lastTypingSentRef.current = false;
        lastTypingPingTimeRef.current = 0;
        socketService.sendTyping(conversationId, effectiveTargetId, false);
      }
    },
    [recipientDbId, conversationId, currentConv, route.params],
  );

  const handleKeyPress = useCallback(
    (e: any) => {
      if (e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
        e.preventDefault?.();
        handleSendMessage();
      }
    },
    [handleSendMessage],
  );

  const handlePickImage = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        showToast('Photo library permission required', 'warning');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        quality: 0.7,
        base64: true,
      });
      if (!result.canceled && result.assets?.length > 0) {
        setPendingMediaList(
          result.assets.map((a, i) => ({
            uri: a.uri,
            name: a.fileName || `photo_${i + 1}.jpg`,
            base64: a.base64 || undefined,
          })),
        );
        setMediaCaption('');
      }
    } catch {
      showToast('Could not select image', 'error');
    }
  };

  const [downloadingMediaIds, setDownloadingMediaIds] = useState<Set<string>>(new Set());

  const handleDownloadMedia = async (msg: ChatMessage) => {
    if (!msg.imagePath || downloadingMediaIds.has(msg.id)) return;
    setDownloadingMediaIds((prev) => new Set(prev).add(msg.id));
    try {
      const remoteUrl = apiService.getResolvedMediaUrl(msg.imagePath);
      const filename = `photo_${msg.id}_${Date.now()}.jpg`;
      const localUri = `${FileSystem.cacheDirectory}${filename}`;
      const result = await FileSystem.downloadAsync(remoteUrl, localUri);
      if (result.status === 200) {
        updateMessageMediaDownloaded(msg.id, result.uri, true);
        showToast('Photo downloaded', 'success');
      } else {
        showToast('Download failed', 'error');
      }
    } catch {
      showToast('Could not download photo', 'error');
    } finally {
      setDownloadingMediaIds((prev) => {
        const next = new Set(prev);
        next.delete(msg.id);
        return next;
      });
    }
  };

  const handleSendMediaPreview = () => {
    if (!pendingMediaList.length || !recipientDbId) return;
    const list = [...pendingMediaList];
    const cap = mediaCaption.trim();
    setPendingMediaList([]);
    setMediaCaption('');

    list.forEach(async (media, idx) => {
      const captionToUse = idx === 0 ? cap : '';

      // 1. Instantly add optimistic message to chat with local URI and instant preview
      addMessage(
        conversationId,
        captionToUse,
        true,
        media.uri,
        undefined,
        recipientDbId,
        resolvedDisplayName,
      );

      // 2. Perform background upload
      let base64Data = media.base64;
      if (!base64Data && media.uri) {
        try {
          base64Data = await FileSystem.readAsStringAsync(media.uri, {
            encoding: FileSystem.EncodingType.Base64,
          });
        } catch {}
      }

      if (token && base64Data) {
        try {
          await apiService.uploadMediaFile(
            token,
            base64Data,
            media.name || `photo_${Date.now()}.jpg`,
            'image/jpeg',
          );
        } catch {}
      }
    });
  };

  const handlePickDocument = async () => {
    setShowAttachMenu(false);
    if (!recipientDbId) {
      showToast('Recipient info missing', 'error');
      return;
    }
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        type: '*/*',
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const doc = result.assets[0];
        let base64Data = '';
        try {
          base64Data = await FileSystem.readAsStringAsync(doc.uri, {
            encoding: FileSystem.EncodingType.Base64,
          });
        } catch {}

        let remoteDocUrl = doc.uri;
        if (token && base64Data) {
          const uploadRes = await apiService.uploadMediaFile(
            token,
            base64Data,
            doc.name,
            doc.mimeType || 'application/octet-stream',
          );
          if (uploadRes.success && uploadRes.url) {
            remoteDocUrl = uploadRes.url;
          }
        }

        const sizeFormatted = doc.size
          ? doc.size > 1024 * 1024
            ? `${(doc.size / (1024 * 1024)).toFixed(1)} MB`
            : `${Math.round(doc.size / 1024)} KB`
          : undefined;

        addMessage(
          conversationId,
          '',
          true,
          undefined,
          undefined,
          recipientDbId,
          resolvedDisplayName,
          undefined,
          {
            uri: remoteDocUrl,
            name: doc.name,
            size: sizeFormatted,
            mimeType: doc.mimeType,
          },
        );
        showToast('Document sent 📄', 'success', 1500);
      }
    } catch (e) {
      console.warn('Document picker error:', e);
      showToast('Could not pick document', 'error');
    }
  };

  const handleOpenContactPicker = async () => {
    setShowAttachMenu(false);
    setShowContactPickerModal(true);
    setIsLoadingContacts(true);
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status === 'granted') {
        const { data } = await Contacts.getContactsAsync({
          fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails],
          sort: Contacts.SortTypes.FirstName,
        });
        if (data && data.length > 0) {
          const formatted = data
            .filter((c) => c.phoneNumbers && c.phoneNumbers.length > 0)
            .map((c) => ({
              id: c.id,
              name: c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Contact',
              phone: c.phoneNumbers![0].number || '',
            }));
          setAvailablePhoneContacts(formatted);
        }
      }
    } catch (e) {
      console.warn('Contacts picker error:', e);
    } finally {
      setIsLoadingContacts(false);
    }
  };

  const handleSendSelectedContact = (contact: {
    name: string;
    phone: string;
    username?: string;
  }) => {
    setShowContactPickerModal(false);
    if (!recipientDbId) {
      showToast('Recipient info missing', 'error');
      return;
    }
    addMessage(
      conversationId,
      '',
      true,
      undefined,
      undefined,
      recipientDbId,
      resolvedDisplayName,
      undefined,
      undefined,
      contact,
    );
    showToast('Contact shared 👤', 'success', 1500);
  };

  const handleOpenLocationPicker = async () => {
    setShowAttachMenu(false);
    if (!Location) {
      showToast('expo-location not installed', 'warning');
      return;
    }
    if (!recipientDbId) {
      showToast('Recipient info missing', 'error');
      return;
    }
    setShowLocationPickerModal(true);
    setIsLoadingGps(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        showToast('Location permission required', 'warning');
        setIsLoadingGps(false);
        return;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy?.Balanced ?? 4,
      });
      const lat = loc.coords.latitude;
      const lng = loc.coords.longitude;
      let label = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      try {
        const [geo] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
        if (geo) {
          label = [geo.name, geo.street, geo.subregion || geo.city, geo.region]
            .filter(Boolean)
            .slice(0, 3)
            .join(', ');
        }
      } catch {}
      setCurrentGpsData({
        lat,
        lng,
        label,
        accuracy: loc.coords.accuracy ? Math.round(loc.coords.accuracy) : undefined,
      });
    } catch {
      showToast('Could not fetch GPS coordinates', 'error');
    } finally {
      setIsLoadingGps(false);
    }
  };

  const handleSendCurrentLocation = () => {
    if (!currentGpsData || !recipientDbId) {
      showToast('Location not ready', 'warning');
      return;
    }
    setShowLocationPickerModal(false);
    addMessage(
      conversationId,
      '',
      true,
      undefined,
      {
        lat: currentGpsData.lat,
        lng: currentGpsData.lng,
        label: currentGpsData.label,
        accuracy: currentGpsData.accuracy,
        isLive: false,
      },
      recipientDbId,
      resolvedDisplayName,
    );
    showToast('Current Location sent 📍', 'success', 1500);
  };

  const handleSendLiveLocation = () => {
    if (!currentGpsData || !recipientDbId) {
      showToast('Location not ready', 'warning');
      return;
    }
    const expiresAt = new Date(Date.now() + selectedLiveDuration * 60 * 1000).toISOString();
    const comment = liveLocationComment.trim();
    setShowLocationPickerModal(false);
    setLiveLocationComment('');

    addMessage(
      conversationId,
      comment,
      true,
      undefined,
      {
        lat: currentGpsData.lat,
        lng: currentGpsData.lng,
        label: currentGpsData.label,
        isLive: true,
        liveDurationMinutes: selectedLiveDuration,
        expiresAt,
        accuracy: currentGpsData.accuracy,
      },
      recipientDbId,
      resolvedDisplayName,
    );
    showToast(`Live Location shared (${selectedLiveDuration}m) 📡`, 'success', 2000);
  };

  const handleStopLiveLocation = (msgId: string) => {
    setStoppedLiveMsgIds((prev) => ({ ...prev, [msgId]: true }));
    showToast('Live location sharing stopped', 'info', 1500);
  };

  const handleDownloadPhoto = async (uri?: string) => {
    if (!uri) return;
    try {
      const resolved = apiService.getResolvedMediaUrl(uri);
      let localUri = resolved;
      if (resolved.startsWith('data:image')) {
        const cleanB64 = resolved.replace(/^data:[^;]+;base64,/, '');
        const tempPath = `${FileSystem.cacheDirectory}photo_${Date.now()}.jpg`;
        await FileSystem.writeAsStringAsync(tempPath, cleanB64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        localUri = tempPath;
      } else if (resolved.startsWith('http://') || resolved.startsWith('https://')) {
        const rawName = resolved.split('/').pop() || `photo_${Date.now()}.jpg`;
        const cleanFilename = rawName.split('?')[0] || `photo_${Date.now()}.jpg`;
        const res = await FileSystem.downloadAsync(
          resolved,
          `${FileSystem.cacheDirectory}${cleanFilename}`,
        );
        localUri = res.uri;
      }
      try {
        const { status } = await MediaLibrary.requestPermissionsAsync(true);
        if (status === 'granted') {
          const asset = await MediaLibrary.createAssetAsync(localUri);
          if (asset) {
            showToast('Saved to gallery 📸', 'success', 2500);
            return;
          }
        }
      } catch (mlErr) {
        console.warn('MediaLibrary save error:', mlErr);
      }

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(localUri, {
          mimeType: 'image/jpeg',
          dialogTitle: 'Save Photo to Device',
        });
      } else {
        showToast('Could not save photo to gallery', 'error');
      }
    } catch {
      showToast('Could not save photo', 'error');
    }
  };

  const handleOpenDocument = async (docUri?: string, docName?: string) => {
    if (!docUri) return;
    try {
      const resolved = apiService.getResolvedMediaUrl(docUri);
      let localUri = resolved;
      if (resolved.startsWith('http://') || resolved.startsWith('https://')) {
        const rawName = docName || resolved.split('/').pop() || `doc_${Date.now()}`;
        const cleanFilename = rawName.split('?')[0];
        const res = await FileSystem.downloadAsync(
          resolved,
          `${FileSystem.cacheDirectory}${cleanFilename}`,
        );
        localUri = res.uri;
      }
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(localUri);
      } else {
        Linking.openURL(resolved).catch(() => {});
      }
    } catch {
      Linking.openURL(apiService.getResolvedMediaUrl(docUri)).catch(() => {});
    }
  };

  const handleSharePhoto = async (uri?: string) => {
    if (!uri) return;
    try {
      const resolved = apiService.getResolvedMediaUrl(uri);
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(resolved);
    } catch {}
  };

  const handleReact = (msg: ChatMessage, emoji: string) => {
    setReactingToMsg(null);
    reactToMessage(conversationId, msg.id, emoji, recipientDbId);
  };

  const handleTriggerCall = async (callType: 'audio' | 'video') => {
    let targetId =
      effectiveRecipientId ||
      recipientDbId ||
      (route.params as any)?.recipientDbId ||
      currentConv?.recipientDbId;

    if (!targetId && token) {
      const handle = (
        currentConv?.username ||
        (route.params as any)?.username ||
        currentConv?.phone ||
        (route.params as any)?.phone ||
        title
      )?.replace(/^@+/, '');

      if (handle) {
        try {
          const results = await apiService.searchUsers(token, handle);
          const match =
            results.find(
              (u) =>
                (u.username &&
                  u.username.toLowerCase().replace(/^@+/, '') === handle.toLowerCase()) ||
                (u.phoneNumber && u.phoneNumber.replace(/\D/g, '') === handle.replace(/\D/g, '')) ||
                (u.name && u.name.toLowerCase() === title.toLowerCase()),
            ) || results[0];
          if (match?.id) {
            targetId = match.id;
            setResolvedRecipientId(match.id);
          }
        } catch (e) {}
      }
    }

    const finalTargetId = targetId || title;
    const session = callService.startCall({
      targetUserId: finalTargetId,
      targetUserName: resolvedDisplayName || title,
      targetUserAvatar: currentConv?.avatarUrl,
      callType,
      myUserId: authUserId,
      myName: userProfile?.name,
      myAvatar: userProfile?.avatarUrl,
      conversationId,
    });
    navigation.navigate('Call', {
      callId: session.callId,
      targetUserId: finalTargetId,
      targetUserName: resolvedDisplayName || title,
      isCaller: true,
      isVideo: callType === 'video',
    });
  };

  // ── Bubble renderer ────────────────────────────────────────────────────────
  const renderBubble = useCallback(
    ({ item: msg, index }: { item: ChatMessage; index: number }) => {
      const isMe = msg.isMe;
      const prevMsg = index > 0 ? roomMessages[index - 1] : undefined;
      const showDateHeader = shouldShowDateSeparator(msg, prevMsg);
      const dateHeaderText = showDateHeader
        ? formatChatDateSeparator(msg.createdAtMs || msg.createdAt)
        : '';

      const statusIcon = () => {
        if (!isMe) return null;
        if (msg.status === 'SENDING')
          return (
            <ActivityIndicator size={10} color="rgba(255,255,255,0.6)" style={{ marginLeft: 4 }} />
          );
        if (msg.status === 'FAILED')
          return (
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => resendMessage(conversationId, msg.id)}
              style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 4 }}
            >
              <RotateCcw size={12} color="#EF4444" />
              <Text style={{ color: '#EF4444', fontSize: 10, fontWeight: '700', marginLeft: 2 }}>
                Retry
              </Text>
            </TouchableOpacity>
          );
        if (msg.status === 'READ')
          return <CheckCheck size={14} color="#38BDF8" style={{ marginLeft: 4 }} />;
        if (msg.status === 'DELIVERED')
          return <CheckCheck size={14} color="rgba(255,255,255,0.85)" style={{ marginLeft: 4 }} />;
        return <Check size={14} color="rgba(255,255,255,0.6)" style={{ marginLeft: 4 }} />;
      };

      const activeReactions = msg.reactions
        ? Object.entries(msg.reactions).filter(([_, count]) => count > 0)
        : [];

      return (
        <View key={msg.id || `msg_${index}`} style={styles.bubbleRowContainer}>
          {/* 🌟 Dynamic WhatsApp-Style Date Separator Badge */}
          {showDateHeader ? (
            <View style={styles.dateDivider}>
              <View
                style={[
                  styles.dateBadgePill,
                  {
                    backgroundColor: themeMode === 'dark' ? '#1E293B' : '#E2E8F0',
                    borderColor: colors.cardBorder,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.dateText,
                    {
                      color: themeMode === 'dark' ? '#94A3B8' : '#475569',
                    },
                  ]}
                >
                  {dateHeaderText}
                </Text>
              </View>
            </View>
          ) : null}

          <SwipeableBubble
            isMe={isMe}
            onSwipeReply={() => {
              setReplyTo(msg);
              textInputRef.current?.focus();
            }}
            colors={colors}
          >
            <View
              style={[
                styles.bubbleWrapper,
                isMe ? styles.bubbleWrapperMe : styles.bubbleWrapperOther,
              ]}
            >
              <TouchableOpacity
                activeOpacity={0.85}
                onLongPress={() => setReactingToMsg(msg)}
                style={[
                  styles.bubble,
                  isMe
                    ? styles.bubbleMe
                    : [
                        styles.bubbleOther,
                        { backgroundColor: colors.surface, borderColor: colors.cardBorder },
                      ],
                ]}
              >
                {/* Reply quote */}
                {msg.replyTo && (
                  <View
                    style={[
                      styles.replyQuote,
                      { borderLeftColor: isMe ? 'rgba(255,255,255,0.6)' : colors.primaryIndigo },
                    ]}
                  >
                    <Text
                      style={[
                        styles.replyQuoteText,
                        { color: isMe ? 'rgba(255,255,255,0.8)' : colors.primaryIndigo },
                      ]}
                      numberOfLines={1}
                    >
                      {msg.replyTo.isMe ? 'You' : resolvedDisplayName}
                    </Text>
                    <Text
                      style={[
                        styles.replyQuoteBody,
                        { color: isMe ? 'rgba(255,255,255,0.7)' : colors.textSecondary },
                      ]}
                      numberOfLines={2}
                    >
                      {msg.replyTo.imagePath ? '📷 Photo' : msg.replyTo.text}
                    </Text>
                  </View>
                )}

                {/* 📞 WhatsApp-Style In-Chat Call Log Item */}
                {msg.callLog ? (
                  <View style={styles.callLogBubbleContent}>
                    <View
                      style={[
                        styles.callLogIconCircle,
                        {
                          backgroundColor:
                            msg.callLog.status === 'missed'
                              ? 'rgba(239, 68, 68, 0.15)'
                              : 'rgba(16, 185, 129, 0.15)',
                        },
                      ]}
                    >
                      {msg.callLog.callType === 'video' ? (
                        <Video
                          size={18}
                          color={msg.callLog.status === 'missed' ? '#EF4444' : '#10B981'}
                        />
                      ) : (
                        <Phone
                          size={18}
                          color={msg.callLog.status === 'missed' ? '#EF4444' : '#10B981'}
                        />
                      )}
                    </View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text
                        style={[
                          styles.callLogTitleText,
                          { color: isMe ? '#FFF' : colors.textPrimary },
                          msg.callLog.status === 'missed' && { color: '#EF4444' },
                        ]}
                      >
                        {msg.callLog.status === 'missed'
                          ? `Missed ${msg.callLog.callType} call`
                          : msg.callLog.status === 'declined'
                            ? `Declined ${msg.callLog.callType} call`
                            : `${msg.callLog.callType === 'video' ? 'Video' : 'Voice'} call (${Math.floor((msg.callLog.durationSeconds || 0) / 60)}:${((msg.callLog.durationSeconds || 0) % 60).toString().padStart(2, '0')})`}
                      </Text>
                      <Text
                        style={[
                          styles.callLogSubtext,
                          { color: isMe ? 'rgba(255,255,255,0.7)' : colors.textSecondary },
                        ]}
                      >
                        {msg.callLog.status === 'missed'
                          ? 'Tap to call back'
                          : msg.callLog.isCaller
                            ? 'Outgoing'
                            : 'Incoming'}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.callLogCallBackBtn}
                      onPress={() => handleTriggerCall(msg.callLog?.callType || 'audio')}
                      activeOpacity={0.8}
                    >
                      {msg.callLog.callType === 'video' ? (
                        <Video size={16} color="#38BDF8" />
                      ) : (
                        <Phone size={16} color="#10B981" />
                      )}
                    </TouchableOpacity>
                  </View>
                ) : null}

                {/* Image */}
                {msg.imagePath ? (
                  <View style={styles.imageBubbleWrapper}>
                    {isMe ||
                    msg.isDownloaded ||
                    (typeof msg.imagePath === 'string' && msg.imagePath.startsWith('file://')) ? (
                      <TouchableOpacity
                        activeOpacity={0.9}
                        onPress={() => setSelectedPhotoMsg(msg)}
                        style={styles.imageBubbleTouch}
                      >
                        <Image
                          source={{ uri: apiService.getResolvedMediaUrl(msg.imagePath) }}
                          style={styles.chatImageBubble}
                          resizeMode="cover"
                        />
                        {msg.isUploading ? (
                          <View style={styles.uploadProgressOverlay}>
                            <ActivityIndicator size="small" color="#FFF" />
                            <Text style={styles.uploadProgressText}>
                              {msg.uploadProgress ?? 45}%
                            </Text>
                          </View>
                        ) : (
                          <View style={styles.imageOverlayBadge}>
                            <ZoomIn size={13} color="#FFF" />
                          </View>
                        )}
                      </TouchableOpacity>
                    ) : (
                      /* 📥 WhatsApp-Style Receiver Download Tile */
                      <TouchableOpacity
                        activeOpacity={0.85}
                        onPress={() => handleDownloadMedia(msg)}
                        style={styles.receiverMediaDownloadCard}
                      >
                        <Image
                          source={{ uri: apiService.getResolvedMediaUrl(msg.imagePath) }}
                          style={[styles.chatImageBubble, { opacity: 0.25 }]}
                          resizeMode="cover"
                          blurRadius={10}
                        />
                        <View style={styles.downloadCenterOverlay}>
                          <View style={styles.downloadCircleBtn}>
                            {downloadingMediaIds.has(msg.id) ? (
                              <ActivityIndicator size="small" color="#FFF" />
                            ) : (
                              <Download size={20} color="#FFF" />
                            )}
                          </View>
                          <View style={styles.mediaSizeBadge}>
                            <Text style={styles.mediaSizeText}>
                              {msg.mediaSize || 'Photo • Tap to Download'}
                            </Text>
                          </View>
                        </View>
                      </TouchableOpacity>
                    )}
                  </View>
                ) : null}

                {/* Document attachment */}
                {msg.document ? (
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => handleOpenDocument(msg.document?.uri, msg.document?.name)}
                    style={[
                      styles.docBubbleWrapper,
                      { backgroundColor: isMe ? 'rgba(255,255,255,0.15)' : colors.cardBorder },
                    ]}
                  >
                    <View
                      style={[
                        styles.docIconBox,
                        {
                          backgroundColor: isMe
                            ? 'rgba(255,255,255,0.25)'
                            : 'rgba(99,102,241,0.15)',
                        },
                      ]}
                    >
                      <FileText size={22} color={isMe ? '#FFF' : colors.primaryIndigo} />
                    </View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text
                        style={[styles.docNameText, { color: isMe ? '#FFF' : colors.textPrimary }]}
                        numberOfLines={1}
                      >
                        {msg.document.name || 'Document'}
                      </Text>
                      <Text
                        style={[
                          styles.docSubText,
                          { color: isMe ? 'rgba(255,255,255,0.7)' : colors.textSecondary },
                        ]}
                      >
                        {msg.document.size || 'Tap to open'}
                      </Text>
                    </View>
                    <Download
                      size={16}
                      color={isMe ? '#FFF' : colors.textSecondary}
                      style={{ marginLeft: 6 }}
                    />
                  </TouchableOpacity>
                ) : null}

                {/* Contact attachment */}
                {msg.contact ? (
                  <View
                    style={[
                      styles.contactBubbleWrapper,
                      { backgroundColor: isMe ? 'rgba(255,255,255,0.15)' : colors.cardBorder },
                    ]}
                  >
                    <View style={styles.contactBubbleHeader}>
                      <View
                        style={[
                          styles.contactAvatarBox,
                          {
                            backgroundColor: isMe
                              ? 'rgba(255,255,255,0.25)'
                              : 'rgba(99,102,241,0.15)',
                          },
                        ]}
                      >
                        <User size={20} color={isMe ? '#FFF' : colors.primaryIndigo} />
                      </View>
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text
                          style={[
                            styles.contactNameText,
                            { color: isMe ? '#FFF' : colors.textPrimary },
                          ]}
                          numberOfLines={1}
                        >
                          {msg.contact.name}
                        </Text>
                        <Text
                          style={[
                            styles.contactPhoneText,
                            { color: isMe ? 'rgba(255,255,255,0.7)' : colors.textSecondary },
                          ]}
                          numberOfLines={1}
                        >
                          {msg.contact.phone}
                        </Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      style={[
                        styles.contactMessageBtn,
                        { borderTopColor: isMe ? 'rgba(255,255,255,0.2)' : colors.cardBorder },
                      ]}
                      onPress={() => {
                        navigation.push('Chat', {
                          conversationId: `direct_${msg.contact?.phone || msg.contact?.name}`,
                          title: msg.contact?.name || 'Contact',
                          phone: msg.contact?.phone,
                        });
                      }}
                    >
                      <MessageSquare
                        size={14}
                        color={isMe ? '#FFF' : colors.primaryIndigo}
                        style={{ marginRight: 6 }}
                      />
                      <Text
                        style={[
                          styles.contactMessageBtnText,
                          { color: isMe ? '#FFF' : colors.primaryIndigo },
                        ]}
                      >
                        Message
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : null}

                {/* Stylish Location attachment */}
                {msg.location ? (
                  <View
                    style={[
                      styles.stylishLocationCard,
                      {
                        backgroundColor: isMe ? 'rgba(0,0,0,0.18)' : colors.surface,
                        borderColor: isMe ? 'rgba(255,255,255,0.2)' : colors.cardBorder,
                      },
                    ]}
                  >
                    {/* Visual Map Banner */}
                    <TouchableOpacity
                      activeOpacity={0.9}
                      onPress={() => {
                        const { lat, lng } = msg.location!;
                        const url =
                          Platform.OS === 'ios'
                            ? `maps://?q=${lat},${lng}`
                            : `geo:${lat},${lng}?q=${lat},${lng}`;
                        Linking.openURL(url).catch(() =>
                          Linking.openURL(`https://maps.google.com/?q=${lat},${lng}`),
                        );
                      }}
                      style={[
                        styles.locationMapBanner,
                        {
                          backgroundColor: msg.location.isLive
                            ? 'rgba(16,185,129,0.18)'
                            : 'rgba(59,130,246,0.18)',
                        },
                      ]}
                    >
                      {/* Radar rings / map effect */}
                      <View style={styles.mapGridPattern}>
                        <View
                          style={[
                            styles.mapRadarRing,
                            {
                              width: 90,
                              height: 90,
                              borderColor: msg.location.isLive
                                ? 'rgba(16,185,129,0.25)'
                                : 'rgba(59,130,246,0.25)',
                            },
                          ]}
                        />
                        <View
                          style={[
                            styles.mapRadarRing,
                            {
                              width: 52,
                              height: 52,
                              borderColor: msg.location.isLive
                                ? 'rgba(16,185,129,0.45)'
                                : 'rgba(59,130,246,0.45)',
                            },
                          ]}
                        />
                        <View
                          style={[
                            styles.mapPinCenterCircle,
                            {
                              backgroundColor: msg.location.isLive ? '#10B981' : '#3B82F6',
                            },
                          ]}
                        >
                          {msg.location.isLive ? (
                            <Radio size={18} color="#FFF" />
                          ) : (
                            <MapPin size={18} color="#FFF" />
                          )}
                        </View>
                      </View>

                      {/* Floating Badge */}
                      <View
                        style={[
                          styles.locationTypeBadge,
                          {
                            backgroundColor: msg.location.isLive
                              ? stoppedLiveMsgIds[msg.id] || msg.location.isLiveEnded
                                ? 'rgba(100,116,139,0.85)'
                                : '#10B981'
                              : 'rgba(15,23,42,0.75)',
                          },
                        ]}
                      >
                        {msg.location.isLive &&
                        !stoppedLiveMsgIds[msg.id] &&
                        !msg.location.isLiveEnded ? (
                          <View style={styles.livePulseDot} />
                        ) : (
                          <LocateFixed size={11} color="#FFF" style={{ marginRight: 4 }} />
                        )}
                        <Text style={styles.locationTypeBadgeText}>
                          {msg.location.isLive
                            ? stoppedLiveMsgIds[msg.id] || msg.location.isLiveEnded
                              ? 'LIVE ENDED'
                              : 'LIVE LOCATION'
                            : 'CURRENT GPS'}
                        </Text>
                      </View>
                    </TouchableOpacity>

                    {/* Content Section */}
                    <View style={styles.locationCardBody}>
                      <Text
                        style={[
                          styles.locationCardTitle,
                          { color: isMe ? '#FFF' : colors.textPrimary },
                        ]}
                        numberOfLines={2}
                      >
                        {msg.location.label ||
                          `Lat: ${msg.location.lat.toFixed(4)}, Lng: ${msg.location.lng.toFixed(4)}`}
                      </Text>

                      {msg.location.isLive ? (
                        <View style={styles.liveTimerRow}>
                          <Clock
                            size={12}
                            color={isMe ? 'rgba(255,255,255,0.7)' : colors.textSecondary}
                            style={{ marginRight: 4 }}
                          />
                          <Text
                            style={[
                              styles.liveTimerText,
                              {
                                color: isMe ? 'rgba(255,255,255,0.75)' : colors.textSecondary,
                              },
                            ]}
                          >
                            {stoppedLiveMsgIds[msg.id] || msg.location.isLiveEnded
                              ? 'Live sharing ended'
                              : msg.location.expiresAt
                                ? `Live until ${new Date(msg.location.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}`
                                : `Live for ${msg.location.liveDurationMinutes || 60}m`}
                          </Text>
                        </View>
                      ) : (
                        <Text
                          style={[
                            styles.locationAccuracyText,
                            { color: isMe ? 'rgba(255,255,255,0.7)' : colors.textSecondary },
                          ]}
                        >
                          {msg.location.accuracy
                            ? `Accurate to ~${msg.location.accuracy}m`
                            : 'Exact GPS coordinates'}
                        </Text>
                      )}
                    </View>

                    {/* Action Bar */}
                    <View
                      style={[
                        styles.locationActionBar,
                        { borderTopColor: isMe ? 'rgba(255,255,255,0.15)' : colors.cardBorder },
                      ]}
                    >
                      <TouchableOpacity
                        style={styles.locationActionBtn}
                        onPress={() => {
                          const { lat, lng } = msg.location!;
                          const url =
                            Platform.OS === 'ios'
                              ? `maps://?q=${lat},${lng}`
                              : `geo:${lat},${lng}?q=${lat},${lng}`;
                          Linking.openURL(url).catch(() =>
                            Linking.openURL(`https://maps.google.com/?q=${lat},${lng}`),
                          );
                        }}
                      >
                        <Navigation
                          size={13}
                          color={isMe ? '#FFF' : colors.primaryIndigo}
                          style={{ marginRight: 5 }}
                        />
                        <Text
                          style={[
                            styles.locationActionBtnText,
                            { color: isMe ? '#FFF' : colors.primaryIndigo },
                          ]}
                        >
                          {msg.location.isLive ? 'Track Live Route' : 'Open in Maps'}
                        </Text>
                      </TouchableOpacity>

                      {isMe &&
                        msg.location.isLive &&
                        !stoppedLiveMsgIds[msg.id] &&
                        !msg.location.isLiveEnded && (
                          <TouchableOpacity
                            style={[
                              styles.locationActionBtn,
                              {
                                borderLeftWidth: 1,
                                borderLeftColor: isMe
                                  ? 'rgba(255,255,255,0.15)'
                                  : colors.cardBorder,
                              },
                            ]}
                            onPress={() => handleStopLiveLocation(msg.id)}
                          >
                            <StopCircle size={13} color="#EF4444" style={{ marginRight: 4 }} />
                            <Text style={[styles.locationActionBtnText, { color: '#EF4444' }]}>
                              Stop
                            </Text>
                          </TouchableOpacity>
                        )}
                    </View>
                  </View>
                ) : null}

                {/* Message text */}
                {msg.text?.trim() ? (
                  <Text style={[styles.msgText, { color: isMe ? '#FFF' : colors.textPrimary }]}>
                    {msg.text}
                  </Text>
                ) : null}

                {/* Footer: time + ticks */}
                <View style={styles.bubbleFooter}>
                  {msg.isStarred && (
                    <Star size={11} color="#FBBF24" fill="#FBBF24" style={{ marginRight: 4 }} />
                  )}
                  <Text
                    style={[
                      styles.timeText,
                      { color: isMe ? 'rgba(255,255,255,0.7)' : colors.textSecondary },
                    ]}
                  >
                    {msg.time}
                  </Text>
                  {statusIcon()}
                </View>

                {/* 🌟 WhatsApp Style Floating Reaction Badge */}
                {activeReactions.length > 0 && (
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => setReactingToMsg(msg)}
                    style={[
                      styles.whatsappReactionPill,
                      isMe ? styles.whatsappReactionPillMe : styles.whatsappReactionPillOther,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.cardBorder,
                      },
                    ]}
                  >
                    {activeReactions.map(([emoji]) => (
                      <Text key={emoji} style={styles.whatsappReactionEmoji}>
                        {emoji}
                      </Text>
                    ))}
                    {activeReactions.reduce((acc, [_, count]) => acc + count, 0) > 1 && (
                      <Text style={[styles.whatsappReactionCount, { color: colors.textSecondary }]}>
                        {activeReactions.reduce((acc, [_, count]) => acc + count, 0)}
                      </Text>
                    )}
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            </View>
          </SwipeableBubble>
        </View>
      );
    },
    [
      colors,
      themeMode,
      roomMessages,
      resolvedDisplayName,
      conversationId,
      recipientDbId,
      reactToMessage,
      resendMessage,
    ],
  );

  // ══════════════════════════════════════════════════════════════════════════
  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.bg }]}
      edges={['top', 'bottom', 'left', 'right']}
    >
      <StatusBar
        barStyle={themeMode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.bg}
      />

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <View
        style={[
          styles.header,
          { backgroundColor: colors.surface, borderBottomColor: colors.cardBorder },
        ]}
      >
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <ArrowLeft size={22} color={colors.textPrimary} />
          </TouchableOpacity>

          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}
            onPress={() => setShowUserProfileModal(true)}
            activeOpacity={0.7}
          >
            <View style={styles.avatarWrapper}>
              <SmartAvatar
                avatarUrl={displayAvatarUrl}
                name={resolvedDisplayName}
                size={40}
                groupBg={colors.cardBorder}
              />
              {!isBlockedByMe && !isBlockedByThem && (
                <View
                  style={[
                    styles.presenceDot,
                    {
                      backgroundColor: isTargetOnline ? '#10B981' : '#6B7280',
                      borderColor: colors.surface,
                    },
                  ]}
                />
              )}
            </View>
            <View style={{ marginLeft: 10, flex: 1 }}>
              <Text style={[styles.headerTitle, { color: colors.textPrimary }]} numberOfLines={1}>
                {resolvedDisplayName}
              </Text>
              {displayStatus ? (
                <Text
                  style={{
                    fontSize: 12,
                    color:
                      isTargetOnline ||
                      isRemoteTyping ||
                      isUserTyping(conversationId, effectiveRecipientId)
                        ? '#10B981'
                        : colors.textSecondary,
                    fontWeight:
                      isRemoteTyping || isUserTyping(conversationId, effectiveRecipientId)
                        ? '700'
                        : isTargetOnline
                          ? '600'
                          : '400',
                  }}
                >
                  {isRemoteTyping || isUserTyping(conversationId, effectiveRecipientId)
                    ? 'typing...'
                    : displayStatus}
                </Text>
              ) : null}
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.actionBtn} onPress={() => handleTriggerCall('audio')}>
            <Phone size={20} color={colors.primaryIndigo} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={() => handleTriggerCall('video')}>
            <Video size={22} color={colors.primaryIndigo} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={() => setShowMoreMenuModal(true)}>
            <MoreVertical size={20} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        {/* ── Message list ────────────────────────────────────────────── */}
        <FlatList
          ref={flatListRef}
          data={roomMessages}
          keyExtractor={(item) => item.id}
          renderItem={renderBubble}
          contentContainerStyle={[
            styles.messageList,
            { flexGrow: 1, justifyContent: roomMessages.length > 0 ? 'flex-end' : 'flex-start' },
          ]}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
          onLayout={() => flatListRef.current?.scrollToEnd({ animated: false })}
          keyboardShouldPersistTaps="handled"
        />

        {/* ── Sticky Typing Bubble ──────────────────────────────────────── */}
        {(isRemoteTyping ||
          isUserTyping(conversationId, effectiveRecipientId) ||
          (effectiveRecipientId && isUserTyping(undefined, effectiveRecipientId))) && (
          <View style={{ paddingHorizontal: 12, paddingBottom: 4 }}>
            <TypingBubble
              backgroundColor={colors.surface}
              borderColor={colors.cardBorder}
              dotColor="#10B981"
            />
          </View>
        )}

        {/* ── Reply preview bar ───────────────────────────────────────── */}
        {replyTo && (
          <View
            style={[
              styles.replyBar,
              { backgroundColor: colors.surface, borderTopColor: colors.cardBorder },
            ]}
          >
            <View style={[styles.replyBarAccent, { backgroundColor: colors.primaryIndigo }]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.replyBarName, { color: colors.primaryIndigo }]}>
                {replyTo.isMe ? 'You' : resolvedDisplayName}
              </Text>
              <Text
                style={[styles.replyBarText, { color: colors.textSecondary }]}
                numberOfLines={1}
              >
                {replyTo.imagePath ? '📷 Photo' : replyTo.text}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setReplyTo(null)} style={{ padding: 8 }}>
              <X size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        )}

        {/* ── Emoji picker ─────────────────────────────────────────────── */}
        {showEmojiPicker && (
          <View
            style={[
              styles.emojiPickerContainer,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 10, paddingVertical: 8 }}
            >
              {EMOJI_LIST.map((emoji, i) => (
                <TouchableOpacity
                  key={i}
                  style={styles.emojiItem}
                  onPress={() => setInputText((p) => p + emoji)}
                >
                  <Text style={styles.emojiText}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* ── Attach tray ──────────────────────────────────────────────── */}
        {showAttachMenu && (
          <View
            style={[
              styles.attachTray,
              { backgroundColor: colors.surface, borderTopColor: colors.cardBorder },
            ]}
          >
            <TouchableOpacity
              style={styles.attachItem}
              onPress={() => {
                setShowAttachMenu(false);
                handlePickImage();
              }}
            >
              <View style={[styles.attachIcon, { backgroundColor: 'rgba(99,102,241,0.12)' }]}>
                <ImageIcon size={22} color={colors.primaryIndigo} />
              </View>
              <Text style={[styles.attachLabel, { color: colors.textSecondary }]}>Photo</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.attachItem} onPress={handlePickDocument}>
              <View style={[styles.attachIcon, { backgroundColor: 'rgba(59,130,246,0.12)' }]}>
                <FileText size={22} color="#3B82F6" />
              </View>
              <Text style={[styles.attachLabel, { color: colors.textSecondary }]}>Document</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.attachItem} onPress={handleOpenContactPicker}>
              <View style={[styles.attachIcon, { backgroundColor: 'rgba(236,72,153,0.12)' }]}>
                <ContactIcon size={22} color="#EC4899" />
              </View>
              <Text style={[styles.attachLabel, { color: colors.textSecondary }]}>Contact</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.attachItem} onPress={handleOpenLocationPicker}>
              <View style={[styles.attachIcon, { backgroundColor: 'rgba(16,185,129,0.12)' }]}>
                <MapPin size={22} color="#10B981" />
              </View>
              <Text style={[styles.attachLabel, { color: colors.textSecondary }]}>Location</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Input bar / Blocked Banner ────────────────────────────────── */}
        {isBlockedByMe ? (
          <View
            style={[
              styles.blockedBannerContainer,
              { backgroundColor: colors.surface, borderTopColor: colors.cardBorder },
            ]}
          >
            <ShieldAlert size={20} color="#EF4444" style={{ marginRight: 8 }} />
            <Text style={[styles.blockedBannerText, { color: colors.textSecondary }]}>
              You blocked this contact. Tap to unblock.
            </Text>
            <TouchableOpacity
              onPress={handleToggleBlock}
              style={[styles.unblockBannerBtn, { backgroundColor: colors.primaryIndigo }]}
              activeOpacity={0.8}
            >
              <Text style={styles.unblockBannerBtnText}>Unblock</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View
            style={[
              styles.inputBarContainer,
              { backgroundColor: colors.surface, borderTopColor: colors.cardBorder },
            ]}
          >
            <TouchableOpacity
              style={[styles.plusBtn, { backgroundColor: colors.cardBorder }]}
              onPress={() => setShowAttachMenu((v) => !v)}
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
                value={inputText}
                onChangeText={handleInputChange}
                onKeyPress={handleKeyPress}
                returnKeyType="send"
                onSubmitEditing={handleSendMessage}
                blurOnSubmit={false}
                multiline
              />
              <TouchableOpacity
                style={{ padding: 4, marginRight: 6 }}
                onPress={() => setShowEmojiPicker(!showEmojiPicker)}
              >
                <Smile
                  size={20}
                  color={showEmojiPicker ? colors.primaryIndigo : colors.textSecondary}
                />
              </TouchableOpacity>
            </View>

            {inputText.trim().length > 0 ? (
              <TouchableOpacity
                style={[styles.sendBtn, { backgroundColor: colors.primaryIndigo }]}
                onPress={handleSendMessage}
              >
                <Send size={18} color="#FFF" />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[styles.sendBtn, { backgroundColor: colors.cardBorder }]}>
                <Mic size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
        )}
      </KeyboardAvoidingView>

      {/* ── Quick Reaction picker modal ───────────────────────────────── */}
      <Modal
        visible={!!reactingToMsg}
        transparent
        animationType="fade"
        onRequestClose={() => setReactingToMsg(null)}
      >
        <TouchableOpacity
          style={styles.reactOverlay}
          activeOpacity={1}
          onPress={() => setReactingToMsg(null)}
        >
          <View
            style={[
              styles.reactPicker,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            {QUICK_REACTIONS.map((emoji) => (
              <TouchableOpacity
                key={emoji}
                style={styles.reactEmojiBtn}
                onPress={() => reactingToMsg && handleReact(reactingToMsg, emoji)}
              >
                <Text style={styles.reactEmoji}>{emoji}</Text>
              </TouchableOpacity>
            ))}
            {reactingToMsg?.isMe && (
              <TouchableOpacity
                style={[
                  styles.reactEmojiBtn,
                  { borderLeftWidth: 1, borderLeftColor: colors.cardBorder },
                ]}
                onPress={() => {
                  setReactingToMsg(null);
                  if (reactingToMsg) {
                    toggleStarMessage(conversationId, reactingToMsg.id);
                    showToast('Starred ⭐', 'info', 1000);
                  }
                }}
              >
                <Star size={20} color="#FBBF24" fill="#FBBF24" />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.reactEmojiBtn]}
              onPress={() => {
                if (reactingToMsg) setReplyTo(reactingToMsg);
                setReactingToMsg(null);
              }}
            >
              <Reply size={18} color={colors.primaryIndigo} />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Photo send preview ────────────────────────────────────────── */}
      <Modal visible={pendingMediaList.length > 0} animationType="slide" transparent={false}>
        <SafeAreaView style={[styles.previewModalContainer, { backgroundColor: colors.bg }]}>
          <View style={[styles.previewHeader, { backgroundColor: colors.surface }]}>
            <TouchableOpacity
              onPress={() => setPendingMediaList([])}
              style={styles.previewCloseBtn}
            >
              <X size={24} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={[styles.previewTitle, { color: colors.textPrimary }]}>
              {pendingMediaList.length > 1
                ? `Send ${pendingMediaList.length} Photos`
                : 'Send Photo'}
            </Text>
            <View style={{ width: 24 }} />
          </View>
          <View style={styles.previewContent}>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ alignItems: 'center' }}
            >
              {pendingMediaList.map((media, idx) => (
                <View
                  key={idx}
                  style={{
                    width: Dimensions.get('window').width - 32,
                    height: '100%',
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}
                >
                  <Image
                    source={{ uri: media.uri }}
                    style={styles.fullscreenPreviewImage}
                    resizeMode="contain"
                  />
                </View>
              ))}
            </ScrollView>
          </View>
          <View
            style={[
              styles.previewFooterRow,
              { backgroundColor: colors.surface, borderTopColor: colors.cardBorder },
            ]}
          >
            <View
              style={[
                styles.captionInputWrapper,
                { backgroundColor: colors.inputBg, borderColor: colors.cardBorder },
              ]}
            >
              <TextInput
                style={[styles.captionTextInput, { color: colors.textPrimary }]}
                placeholder="Add a caption..."
                placeholderTextColor={colors.textSecondary}
                value={mediaCaption}
                onChangeText={setMediaCaption}
                returnKeyType="send"
                onSubmitEditing={handleSendMediaPreview}
              />
            </View>
            <TouchableOpacity
              style={[styles.previewSendBtn, { backgroundColor: colors.primaryIndigo }]}
              onPress={handleSendMediaPreview}
            >
              <Send size={20} color="#FFF" style={{ marginLeft: 2 }} />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      {/* ── Full screen photo viewer ──────────────────────────────────── */}
      <Modal
        visible={!!selectedPhotoMsg}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedPhotoMsg(null)}
      >
        <SafeAreaView style={styles.photoViewerContainer}>
          <StatusBar barStyle="light-content" backgroundColor="#000" />
          <View style={styles.photoViewerHeader}>
            <TouchableOpacity
              style={styles.viewerHeaderBtn}
              onPress={() => setSelectedPhotoMsg(null)}
            >
              <ArrowLeft size={22} color="#FFF" />
            </TouchableOpacity>
            <View style={styles.viewerHeaderCenter}>
              <Text style={styles.viewerSenderText} numberOfLines={1}>
                {selectedPhotoMsg?.isMe ? 'You' : resolvedDisplayName}
              </Text>
              <Text style={styles.viewerTimeText}>{selectedPhotoMsg?.time || 'Today'}</Text>
            </View>
            <View style={styles.viewerHeaderActions}>
              <TouchableOpacity
                style={styles.viewerActionBtn}
                onPress={() => handleDownloadPhoto(selectedPhotoMsg?.imagePath)}
              >
                <Download size={22} color="#FFF" />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.viewerActionBtn}
                onPress={() => handleSharePhoto(selectedPhotoMsg?.imagePath)}
              >
                <Share2 size={20} color="#FFF" />
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.photoViewerBody}>
            {selectedPhotoMsg?.imagePath && (
              <Image
                source={{ uri: selectedPhotoMsg.imagePath }}
                style={styles.photoViewerFullImage}
                resizeMode="contain"
              />
            )}
          </View>
          {selectedPhotoMsg?.text ? (
            <View style={styles.photoViewerFooter}>
              <Text style={styles.photoViewerCaption}>{selectedPhotoMsg.text}</Text>
            </View>
          ) : null}
        </SafeAreaView>
      </Modal>

      {/* ── User profile modal ────────────────────────────────────────── */}
      <Modal
        visible={showUserProfileModal}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setShowUserProfileModal(false)}
      >
        <SafeAreaView style={[styles.profileModalContainer, { backgroundColor: colors.bg }]}>
          <View
            style={[
              styles.profileModalHeader,
              { backgroundColor: colors.surface, borderBottomColor: colors.cardBorder },
            ]}
          >
            <TouchableOpacity
              onPress={() => setShowUserProfileModal(false)}
              style={styles.profileCloseBtn}
            >
              <ArrowLeft size={24} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={[styles.profileModalTitle, { color: colors.textPrimary }]}>
              Contact Info
            </Text>
            <View style={{ width: 32 }} />
          </View>
          <ScrollView contentContainerStyle={styles.profileModalContent}>
            <View style={styles.profileHeroSection}>
              <SmartAvatar
                avatarUrl={targetAvatarUrl}
                name={resolvedDisplayName}
                size={100}
                groupBg={colors.cardBorder}
                textStyle={{ fontSize: 42 }}
              />
              <Text style={[styles.profileHeroName, { color: colors.textPrimary }]}>
                {resolvedDisplayName}
              </Text>
              {targetUsername ? (
                <Text
                  style={{
                    fontSize: 14,
                    color: colors.primaryIndigo,
                    fontWeight: '600',
                    marginTop: 3,
                  }}
                >
                  {targetUsername.startsWith('@') ? targetUsername : `@${targetUsername}`}
                </Text>
              ) : null}
              {targetPhone ? (
                <Text
                  style={{
                    fontSize: 13,
                    color: colors.textSecondary,
                    marginTop: 2,
                  }}
                >
                  {targetPhone}
                </Text>
              ) : null}
              <Text
                style={[
                  styles.profileHeroStatus,
                  {
                    color: isTargetOnline ? '#10B981' : colors.textSecondary,
                    marginTop: 4,
                  },
                ]}
              >
                {lastSeenLabel}
              </Text>
            </View>
            <View style={styles.profileActionsRow}>
              <TouchableOpacity
                style={[
                  styles.profileActionBox,
                  { backgroundColor: colors.surface, borderColor: colors.cardBorder },
                ]}
                onPress={() => {
                  setShowUserProfileModal(false);
                  handleTriggerCall('audio');
                }}
              >
                <Phone size={22} color={colors.primaryIndigo} />
                <Text style={[styles.profileActionText, { color: colors.textPrimary }]}>Audio</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.profileActionBox,
                  { backgroundColor: colors.surface, borderColor: colors.cardBorder },
                ]}
                onPress={() => {
                  setShowUserProfileModal(false);
                  handleTriggerCall('video');
                }}
              >
                <Video size={22} color={colors.primaryIndigo} />
                <Text style={[styles.profileActionText, { color: colors.textPrimary }]}>Video</Text>
              </TouchableOpacity>
            </View>
            <View
              style={[
                styles.profileCard,
                { backgroundColor: colors.surface, borderColor: colors.cardBorder },
              ]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <ShieldCheck size={24} color="#10B981" />
                <View style={{ marginLeft: 12, flex: 1 }}>
                  <Text style={[styles.profileSecurityTitle, { color: colors.textPrimary }]}>
                    Encryption Verified
                  </Text>
                  <Text style={[styles.profileSecurityDesc, { color: colors.textSecondary }]}>
                    Messages are end-to-end encrypted.
                  </Text>
                </View>
              </View>
            </View>
            <View
              style={[
                styles.profileCard,
                { backgroundColor: colors.surface, borderColor: colors.cardBorder, marginTop: 14 },
              ]}
            >
              <TouchableOpacity
                style={styles.profileActionRowItem}
                onPress={() => {
                  setShowUserProfileModal(false);
                  handleToggleBlock();
                }}
              >
                {isBlockedByMe ? (
                  <ShieldCheck size={20} color="#10B981" />
                ) : (
                  <Ban size={20} color="#EF4444" />
                )}
                <Text
                  style={[
                    styles.profileActionRowText,
                    { color: isBlockedByMe ? '#10B981' : '#EF4444', fontWeight: '700' },
                  ]}
                >
                  {isBlockedByMe ? 'Unblock Contact' : 'Block Contact'}
                </Text>
              </TouchableOpacity>
              <View style={[styles.profileActionDivider, { backgroundColor: colors.cardBorder }]} />
              <TouchableOpacity
                style={styles.profileActionRowItem}
                onPress={() => {
                  setShowUserProfileModal(false);
                  setShowClearModal(true);
                }}
              >
                <Eraser size={20} color="#F59E0B" />
                <Text style={[styles.profileActionRowText, { color: colors.textPrimary }]}>
                  Clear Chat Messages
                </Text>
              </TouchableOpacity>
              <View style={[styles.profileActionDivider, { backgroundColor: colors.cardBorder }]} />
              <TouchableOpacity
                style={styles.profileActionRowItem}
                onPress={() => {
                  setShowUserProfileModal(false);
                  setShowDeleteModal(true);
                }}
              >
                <Trash2 size={20} color="#EF4444" />
                <Text
                  style={[styles.profileActionRowText, { color: '#EF4444', fontWeight: '700' }]}
                >
                  Delete Entire Chat
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* ── 3-dots menu ───────────────────────────────────────────────── */}
      <Modal
        visible={showMoreMenuModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMoreMenuModal(false)}
      >
        <TouchableOpacity
          style={styles.menuOverlay}
          activeOpacity={1}
          onPress={() => setShowMoreMenuModal(false)}
        >
          <View
            style={[
              styles.menuDropdown,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setShowMoreMenuModal(false);
                setShowUserProfileModal(true);
              }}
            >
              <User size={18} color={colors.primaryIndigo} />
              <Text style={[styles.menuItemText, { color: colors.textPrimary }]}>Contact Info</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setShowMoreMenuModal(false);
                handleToggleBlock();
              }}
            >
              {isBlockedByMe ? (
                <ShieldCheck size={18} color="#10B981" />
              ) : (
                <Ban size={18} color="#EF4444" />
              )}
              <Text
                style={[
                  styles.menuItemText,
                  { color: isBlockedByMe ? '#10B981' : '#EF4444', fontWeight: '700' },
                ]}
              >
                {isBlockedByMe ? 'Unblock Contact' : 'Block Contact'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setShowMoreMenuModal(false);
                setShowClearModal(true);
              }}
            >
              <Eraser size={18} color="#F59E0B" />
              <Text style={[styles.menuItemText, { color: colors.textPrimary }]}>Clear Chat</Text>
            </TouchableOpacity>
            <View style={[styles.menuDivider, { backgroundColor: colors.cardBorder }]} />
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setShowMoreMenuModal(false);
                setShowDeleteModal(true);
              }}
            >
              <Trash2 size={18} color="#EF4444" />
              <Text style={[styles.menuItemText, { color: '#EF4444', fontWeight: '700' }]}>
                Delete Chat
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Clear chat confirm ────────────────────────────────────────── */}
      <Modal
        visible={showClearModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowClearModal(false)}
      >
        <View style={styles.confirmOverlay}>
          <View
            style={[
              styles.confirmCard,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            <View style={[styles.confirmIconCircle, { backgroundColor: 'rgba(245,158,11,0.12)' }]}>
              <Eraser size={28} color="#F59E0B" />
            </View>
            <Text style={[styles.confirmTitle, { color: colors.textPrimary }]}>
              Clear chat messages?
            </Text>
            <Text style={[styles.confirmDesc, { color: colors.textSecondary }]}>
              All messages in this chat will be cleared from your device.
            </Text>
            <View style={styles.confirmButtons}>
              <TouchableOpacity
                style={[
                  styles.confirmBtnCancel,
                  { backgroundColor: colors.bg, borderColor: colors.cardBorder },
                ]}
                onPress={() => setShowClearModal(false)}
              >
                <Text style={[styles.confirmBtnCancelText, { color: colors.textPrimary }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtnAction, { backgroundColor: '#F59E0B' }]}
                onPress={() => {
                  clearMessages(conversationId);
                  setShowClearModal(false);
                  showToast('Chat cleared', 'info', 1500);
                }}
              >
                <Text style={styles.confirmBtnActionText}>Clear</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Delete chat confirm ───────────────────────────────────────── */}
      <Modal
        visible={showDeleteModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDeleteModal(false)}
      >
        <View style={styles.confirmOverlay}>
          <View
            style={[
              styles.confirmCard,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            <View style={[styles.confirmIconCircle, { backgroundColor: 'rgba(239,68,68,0.12)' }]}>
              <Trash2 size={28} color="#EF4444" />
            </View>
            <Text style={[styles.confirmTitle, { color: colors.textPrimary }]}>
              Delete this chat?
            </Text>
            <Text style={[styles.confirmDesc, { color: colors.textSecondary }]}>
              This conversation and all messages will be permanently deleted.
            </Text>
            <View style={styles.confirmButtons}>
              <TouchableOpacity
                style={[
                  styles.confirmBtnCancel,
                  { backgroundColor: colors.bg, borderColor: colors.cardBorder },
                ]}
                onPress={() => setShowDeleteModal(false)}
              >
                <Text style={[styles.confirmBtnCancelText, { color: colors.textPrimary }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtnAction, { backgroundColor: '#EF4444' }]}
                onPress={() => {
                  deleteConversation(conversationId);
                  setShowDeleteModal(false);
                  showToast('Chat deleted', 'success', 1500);
                  navigation.goBack();
                }}
              >
                <Text style={styles.confirmBtnActionText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Contact Picker Modal ───────────────────────────────────────── */}
      <Modal
        visible={showContactPickerModal}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setShowContactPickerModal(false)}
      >
        <SafeAreaView
          style={[styles.container, { backgroundColor: colors.bg }]}
          edges={['top', 'bottom', 'left', 'right']}
        >
          <StatusBar
            barStyle={themeMode === 'dark' ? 'light-content' : 'dark-content'}
            backgroundColor={colors.bg}
          />
          <View
            style={[
              styles.header,
              { backgroundColor: colors.surface, borderBottomColor: colors.cardBorder },
            ]}
          >
            <View style={styles.headerLeft}>
              <TouchableOpacity
                onPress={() => setShowContactPickerModal(false)}
                style={styles.backBtn}
              >
                <ArrowLeft size={24} color={colors.textPrimary} />
              </TouchableOpacity>
              <View>
                <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>
                  Select Contact
                </Text>
                <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
                  {availablePhoneContacts.length} contacts found
                </Text>
              </View>
            </View>
          </View>

          <View
            style={[
              styles.contactSearchBox,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            <Search size={18} color={colors.textSecondary} style={{ marginRight: 8 }} />
            <TextInput
              style={[styles.contactSearchInput, { color: colors.textPrimary }]}
              placeholder="Search by name or number..."
              placeholderTextColor={colors.textSecondary}
              value={contactSearchQuery}
              onChangeText={setContactSearchQuery}
            />
            {contactSearchQuery ? (
              <TouchableOpacity onPress={() => setContactSearchQuery('')}>
                <X size={16} color={colors.textSecondary} />
              </TouchableOpacity>
            ) : null}
          </View>

          {isLoadingContacts ? (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
              <ActivityIndicator size="large" color={colors.primaryIndigo} />
              <Text style={{ marginTop: 12, color: colors.textSecondary }}>
                Loading contacts...
              </Text>
            </View>
          ) : (
            <FlatList
              data={availablePhoneContacts.filter(
                (c) =>
                  !contactSearchQuery ||
                  c.name.toLowerCase().includes(contactSearchQuery.toLowerCase()) ||
                  c.phone.includes(contactSearchQuery),
              )}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.contactListItem, { borderBottomColor: colors.cardBorder }]}
                  onPress={() => handleSendSelectedContact({ name: item.name, phone: item.phone })}
                >
                  <View
                    style={[styles.contactItemAvatar, { backgroundColor: colors.primaryIndigo }]}
                  >
                    <Text style={styles.contactItemAvatarText}>
                      {item.name[0]?.toUpperCase() || 'C'}
                    </Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={[styles.contactItemName, { color: colors.textPrimary }]}>
                      {item.name}
                    </Text>
                    <Text style={[styles.contactItemPhone, { color: colors.textSecondary }]}>
                      {item.phone}
                    </Text>
                  </View>
                  <Send size={16} color={colors.primaryIndigo} />
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={{ padding: 32, alignItems: 'center' }}>
                  <Text style={{ color: colors.textSecondary }}>No contacts found</Text>
                </View>
              }
            />
          )}
        </SafeAreaView>
      </Modal>

      {/* ── Location Picker Modal ───────────────────────────────────────── */}
      <Modal
        visible={showLocationPickerModal}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setShowLocationPickerModal(false)}
      >
        <SafeAreaView
          style={[styles.container, { backgroundColor: colors.bg }]}
          edges={['top', 'bottom', 'left', 'right']}
        >
          <StatusBar
            barStyle={themeMode === 'dark' ? 'light-content' : 'dark-content'}
            backgroundColor={colors.bg}
          />
          <View
            style={[
              styles.header,
              { backgroundColor: colors.surface, borderBottomColor: colors.cardBorder },
            ]}
          >
            <View style={styles.headerLeft}>
              <TouchableOpacity
                onPress={() => setShowLocationPickerModal(false)}
                style={styles.backBtn}
              >
                <ArrowLeft size={24} color={colors.textPrimary} />
              </TouchableOpacity>
              <View>
                <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>
                  Share Location
                </Text>
                <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
                  {isLoadingGps ? 'Fetching GPS fix...' : 'Select Location Type'}
                </Text>
              </View>
            </View>
          </View>

          <ScrollView contentContainerStyle={styles.locationModalScroll}>
            {/* GPS Status Banner */}
            <View
              style={[
                styles.gpsStatusCard,
                { backgroundColor: colors.surface, borderColor: colors.cardBorder },
              ]}
            >
              <View
                style={[
                  styles.gpsStatusIconCircle,
                  {
                    backgroundColor: isLoadingGps
                      ? 'rgba(245,158,11,0.12)'
                      : 'rgba(16,185,129,0.12)',
                  },
                ]}
              >
                {isLoadingGps ? (
                  <ActivityIndicator size="small" color="#F59E0B" />
                ) : (
                  <Compass size={24} color="#10B981" />
                )}
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.gpsStatusTitle, { color: colors.textPrimary }]}>
                  {isLoadingGps ? 'Locating device...' : 'GPS Signal Ready'}
                </Text>
                <Text
                  style={[styles.gpsStatusSubtitle, { color: colors.textSecondary }]}
                  numberOfLines={2}
                >
                  {isLoadingGps
                    ? 'Acquiring satellite coordinates...'
                    : currentGpsData?.label || 'GPS coordinates detected'}
                </Text>
                {currentGpsData?.accuracy ? (
                  <Text style={[styles.gpsAccuracyText, { color: '#10B981' }]}>
                    ● Accurate to ~{currentGpsData.accuracy} meters
                  </Text>
                ) : null}
              </View>
            </View>

            {/* Option 1: Share Current Location */}
            <TouchableOpacity
              activeOpacity={0.8}
              disabled={isLoadingGps}
              onPress={handleSendCurrentLocation}
              style={[
                styles.locationOptionCard,
                { backgroundColor: colors.surface, borderColor: colors.cardBorder },
              ]}
            >
              <View
                style={[
                  styles.locationOptionIconCircle,
                  { backgroundColor: 'rgba(59,130,246,0.12)' },
                ]}
              >
                <MapPin size={24} color="#3B82F6" />
              </View>
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={[styles.locationOptionTitle, { color: colors.textPrimary }]}>
                  Send Current Location
                </Text>
                <Text style={[styles.locationOptionDesc, { color: colors.textSecondary }]}>
                  Share your fixed snapshot coordinates
                </Text>
              </View>
              <Send size={18} color="#3B82F6" />
            </TouchableOpacity>

            {/* Option 2: Share Live Location */}
            <View
              style={[
                styles.liveLocationContainerCard,
                { backgroundColor: colors.surface, borderColor: colors.cardBorder },
              ]}
            >
              <View style={styles.liveLocationHeaderRow}>
                <View
                  style={[
                    styles.locationOptionIconCircle,
                    { backgroundColor: 'rgba(16,185,129,0.15)' },
                  ]}
                >
                  <Radio size={24} color="#10B981" />
                </View>
                <View style={{ flex: 1, marginLeft: 14 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={[styles.locationOptionTitle, { color: colors.textPrimary }]}>
                      Share Live Location
                    </Text>
                    <View style={styles.livePillBadge}>
                      <Text style={styles.livePillBadgeText}>LIVE</Text>
                    </View>
                  </View>
                  <Text style={[styles.locationOptionDesc, { color: colors.textSecondary }]}>
                    Track your route continuously in real time
                  </Text>
                </View>
              </View>

              <Text style={[styles.durationSectionLabel, { color: colors.textSecondary }]}>
                SHARE LIVE DURATION
              </Text>

              {/* Duration selector chips */}
              <View style={styles.durationRow}>
                {[
                  { label: '15 Minutes', mins: 15 },
                  { label: '1 Hour', mins: 60 },
                  { label: '8 Hours', mins: 480 },
                ].map((item) => {
                  const isSelected = selectedLiveDuration === item.mins;
                  return (
                    <TouchableOpacity
                      key={item.mins}
                      onPress={() => setSelectedLiveDuration(item.mins)}
                      style={[
                        styles.durationChip,
                        {
                          backgroundColor: isSelected
                            ? '#10B981'
                            : themeMode === 'dark'
                              ? 'rgba(255,255,255,0.06)'
                              : '#F1F5F9',
                          borderColor: isSelected ? '#10B981' : colors.cardBorder,
                        },
                      ]}
                    >
                      <Clock
                        size={14}
                        color={isSelected ? '#FFF' : colors.textSecondary}
                        style={{ marginRight: 5 }}
                      />
                      <Text
                        style={[
                          styles.durationChipText,
                          {
                            color: isSelected ? '#FFF' : colors.textPrimary,
                            fontWeight: isSelected ? '700' : '500',
                          },
                        ]}
                      >
                        {item.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Optional Comment */}
              <TextInput
                style={[
                  styles.liveCommentInput,
                  {
                    backgroundColor: themeMode === 'dark' ? 'rgba(255,255,255,0.04)' : '#F8FAFC',
                    borderColor: colors.cardBorder,
                    color: colors.textPrimary,
                  },
                ]}
                placeholder="Add a comment... (optional)"
                placeholderTextColor={colors.textSecondary}
                value={liveLocationComment}
                onChangeText={setLiveLocationComment}
              />

              {/* Share Live Button */}
              <TouchableOpacity
                activeOpacity={0.85}
                disabled={isLoadingGps}
                onPress={handleSendLiveLocation}
                style={styles.shareLiveBtn}
              >
                <Radio size={18} color="#FFF" style={{ marginRight: 8 }} />
                <Text style={styles.shareLiveBtnText}>
                  Start Live Sharing (
                  {selectedLiveDuration >= 60
                    ? `${selectedLiveDuration / 60} hr`
                    : `${selectedLiveDuration} min`}
                  )
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  backBtn: { padding: 4, marginRight: 6 },
  avatarWrapper: { position: 'relative' },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerAvatarImage: { width: 40, height: 40, borderRadius: 20 },
  avatarLetter: { fontSize: 16, fontWeight: '700' },
  presenceDot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
  },
  headerTitle: { fontSize: 16, fontWeight: '700' },
  headerSubtitle: { fontSize: 12, marginTop: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actionBtn: { padding: 6 },
  bubbleRowContainer: { width: '100%' },
  dateDivider: {
    alignItems: 'center',
    marginVertical: 12,
    width: '100%',
  },
  dateBadgePill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 3,
    elevation: 2,
  },
  dateText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  messageList: { paddingHorizontal: 14, paddingVertical: 16, paddingBottom: 8 },
  bubbleWrapper: {
    marginVertical: 3,
    flexDirection: 'row',
    alignItems: 'flex-end',
    position: 'relative',
  },
  bubbleWrapperMe: { justifyContent: 'flex-end' },
  bubbleWrapperOther: { justifyContent: 'flex-start' },
  bubble: {
    maxWidth: '78%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  bubbleMe: { backgroundColor: '#6366F1', borderBottomRightRadius: 4 },
  bubbleOther: { borderBottomLeftRadius: 4, borderWidth: 1 },
  msgText: { fontSize: 15, lineHeight: 21, marginTop: 2 },
  bubbleFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 4,
  },
  timeText: { fontSize: 11 },
  // Reply quote
  replyQuote: { borderLeftWidth: 3, paddingLeft: 8, marginBottom: 6, borderRadius: 2 },
  replyQuoteText: { fontSize: 12, fontWeight: '700', marginBottom: 2 },
  replyQuoteBody: { fontSize: 12 },
  // Reply bar above input
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
  },
  replyBarAccent: { width: 3, height: '100%', borderRadius: 2, marginRight: 10 },
  replyBarName: { fontSize: 13, fontWeight: '700', marginBottom: 2 },
  replyBarText: { fontSize: 13 },
  // Reply button beside bubble
  replyBtn: { position: 'absolute', top: '50%', padding: 4, opacity: 0.6 },
  // Reactions
  reactionsRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4, gap: 4 },
  reactionBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 12,
  },
  reactionEmoji: { fontSize: 14 },
  reactionCount: { fontSize: 11, marginLeft: 3 },
  // Reaction picker
  reactOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  reactPicker: {
    flexDirection: 'row',
    borderRadius: 40,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  reactEmojiBtn: { padding: 8 },
  reactEmoji: { fontSize: 26 },
  // Image bubble
  imageBubbleWrapper: { position: 'relative', borderRadius: 14, overflow: 'hidden' },
  imageBubbleTouch: { position: 'relative', borderRadius: 14, overflow: 'hidden' },
  chatImageBubble: { width: 220, height: 160, borderRadius: 14 },
  receiverMediaDownloadCard: {
    width: 220,
    height: 160,
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#1E293B',
    justifyContent: 'center',
    alignItems: 'center',
  },
  downloadCenterOverlay: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  downloadCircleBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#10B981',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 4,
  },
  mediaSizeBadge: {
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  mediaSizeText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
  },
  uploadProgressOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 14,
  },
  uploadProgressText: { color: '#FFF', fontSize: 12, fontWeight: '700', marginTop: 6 },
  imageOverlayBadge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 10,
  },
  // Location
  locationBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 10,
    marginBottom: 4,
    minWidth: 180,
  },
  locationLabel: { fontSize: 14, fontWeight: '600', lineHeight: 19 },
  locationCoords: { fontSize: 11, marginTop: 2 },
  // Emoji picker
  emojiPickerContainer: { borderTopWidth: 1, height: 52 },
  emojiItem: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emojiText: { fontSize: 24 },
  // Attach tray
  attachTray: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderTopWidth: 1,
    gap: 24,
  },
  attachItem: { alignItems: 'center', gap: 6 },
  attachIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
  },
  attachLabel: { fontSize: 12, fontWeight: '500' },
  // Input bar
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
  textInput: { flex: 1, fontSize: 15, paddingVertical: 4, maxHeight: 100 },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Media preview modal
  previewModalContainer: { flex: 1 },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  previewCloseBtn: { padding: 4 },
  previewTitle: { fontSize: 18, fontWeight: '700' },
  previewContent: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 16 },
  fullscreenPreviewImage: { width: '100%', height: '100%' },
  previewFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
  },
  captionInputWrapper: {
    flex: 1,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    marginRight: 12,
  },
  captionTextInput: { fontSize: 15 },
  previewSendBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Photo viewer
  photoViewerContainer: { flex: 1, backgroundColor: '#000' },
  photoViewerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(0,0,0,0.75)',
    zIndex: 10,
  },
  viewerHeaderBtn: { padding: 8, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.1)' },
  viewerHeaderCenter: { flex: 1, marginLeft: 14 },
  viewerSenderText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  viewerTimeText: { color: '#94A3B8', fontSize: 12 },
  viewerHeaderActions: { flexDirection: 'row', alignItems: 'center' },
  viewerActionBtn: {
    padding: 8,
    marginLeft: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  photoViewerBody: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  photoViewerFullImage: { width: '100%', height: '100%' },
  photoViewerFooter: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: 'rgba(0,0,0,0.75)',
  },
  photoViewerCaption: { color: '#FFF', fontSize: 15, textAlign: 'center' },
  // Profile modal
  profileModalContainer: { flex: 1 },
  profileModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  profileCloseBtn: { padding: 6 },
  profileModalTitle: { fontSize: 18, fontWeight: '700' },
  profileModalContent: { paddingHorizontal: 20, paddingVertical: 24, alignItems: 'center' },
  profileHeroSection: { alignItems: 'center', marginBottom: 24 },
  profileBigAvatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  profileBigAvatarImage: { width: 100, height: 100, borderRadius: 50, marginBottom: 14 },
  profileBigAvatarLetter: { fontSize: 40, fontWeight: '800' },
  profileHeroName: { fontSize: 22, fontWeight: '800', marginBottom: 4 },
  profileHeroStatus: { fontSize: 14 },
  profileActionsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    width: '100%',
    marginBottom: 24,
  },
  profileActionBox: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  profileActionText: { fontSize: 13, fontWeight: '700', marginTop: 6 },
  profileCard: { width: '100%', padding: 16, borderRadius: 18, borderWidth: 1, marginBottom: 16 },
  profileSecurityTitle: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  profileSecurityDesc: { fontSize: 13, lineHeight: 18 },
  profileActionRowItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  profileActionRowText: { fontSize: 15, fontWeight: '600', marginLeft: 12 },
  profileActionDivider: { height: 1, width: '100%', marginVertical: 4 },
  // Menu dropdown
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 50 : 60,
    paddingRight: 16,
  },
  menuDropdown: {
    width: 190,
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  menuItemText: { fontSize: 14, fontWeight: '600', marginLeft: 12 },
  menuDivider: { height: 1, marginVertical: 4 },
  // Confirm modals
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  confirmCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 12,
  },
  confirmIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  confirmTitle: { fontSize: 18, fontWeight: '800', marginBottom: 8, textAlign: 'center' },
  confirmDesc: { fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 24 },
  confirmButtons: { flexDirection: 'row', width: '100%', gap: 12 },
  confirmBtnCancel: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnCancelText: { fontSize: 14, fontWeight: '700' },
  confirmBtnAction: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  confirmBtnActionText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  whatsappReactionPill: {
    position: 'absolute',
    bottom: -10,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 14,
    borderWidth: 1.5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 3,
    elevation: 3,
    zIndex: 10,
  },
  whatsappReactionPillMe: {
    right: 8,
  },
  whatsappReactionPillOther: {
    left: 8,
  },
  whatsappReactionEmoji: {
    fontSize: 13,
    marginHorizontal: 1,
  },
  whatsappReactionCount: {
    fontSize: 11,
    fontWeight: '700',
    marginLeft: 3,
  },
  // Document bubble styles
  docBubbleWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 14,
    marginBottom: 4,
    maxWidth: 280,
  },
  docIconBox: {
    width: 42,
    height: 42,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  docNameText: {
    fontSize: 14,
    fontWeight: '700',
  },
  docSubText: {
    fontSize: 12,
    marginTop: 2,
  },
  // Contact bubble styles
  contactBubbleWrapper: {
    padding: 10,
    borderRadius: 14,
    marginBottom: 4,
    minWidth: 220,
    maxWidth: 280,
  },
  contactBubbleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  contactAvatarBox: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
  },
  contactNameText: {
    fontSize: 15,
    fontWeight: '700',
  },
  contactPhoneText: {
    fontSize: 12,
    marginTop: 2,
  },
  contactMessageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 8,
    borderTopWidth: 1,
  },
  contactMessageBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  // Contact picker modal styles
  contactSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  contactSearchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 2,
  },
  contactListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
  },
  contactItemAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: 'center',
    alignItems: 'center',
  },
  contactItemAvatarText: {
    color: '#FFF',
    fontSize: 17,
    fontWeight: '800',
  },
  contactItemName: {
    fontSize: 15,
    fontWeight: '700',
  },
  contactItemPhone: {
    fontSize: 13,
    marginTop: 2,
  },
  // Stylish Location Card styles
  stylishLocationCard: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 4,
    minWidth: 240,
    maxWidth: 290,
  },
  locationMapBanner: {
    height: 110,
    width: '100%',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  mapGridPattern: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mapRadarRing: {
    position: 'absolute',
    borderRadius: 100,
    borderWidth: 1.5,
  },
  mapPinCenterCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 4,
  },
  locationTypeBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  livePulseDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#FFF',
    marginRight: 5,
  },
  locationTypeBadgeText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  locationCardBody: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  locationCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 19,
  },
  liveTimerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  liveTimerText: {
    fontSize: 12,
    fontWeight: '600',
  },
  locationAccuracyText: {
    fontSize: 12,
    marginTop: 3,
  },
  locationActionBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
  },
  locationActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
  },
  locationActionBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  // Location Picker Modal styles
  locationModalScroll: {
    padding: 16,
    paddingBottom: 36,
  },
  gpsStatusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 16,
  },
  gpsStatusIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gpsStatusTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  gpsStatusSubtitle: {
    fontSize: 13,
    marginTop: 2,
    lineHeight: 18,
  },
  gpsAccuracyText: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 3,
  },
  locationOptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 16,
  },
  locationOptionIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  locationOptionTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  locationOptionDesc: {
    fontSize: 13,
    marginTop: 2,
    lineHeight: 18,
  },
  liveLocationContainerCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
  },
  liveLocationHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  livePillBadge: {
    backgroundColor: '#10B981',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 8,
  },
  livePillBadgeText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '800',
  },
  durationSectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  durationRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  durationChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  durationChipText: {
    fontSize: 13,
  },
  liveCommentInput: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 16,
  },
  shareLiveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#10B981',
    paddingVertical: 14,
    borderRadius: 14,
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  shareLiveBtnText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
  },
  // ── Call Log Bubble Styles ──────────────────────────────────────────────
  callLogBubbleContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 6,
    minWidth: 210,
  },
  callLogIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
  },
  callLogTitleText: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  callLogSubtext: {
    fontSize: 11,
    marginTop: 2,
    fontWeight: '500',
  },
  callLogCallBackBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  // ── Blocked Banner Styles ───────────────────────────────────────────────
  blockedBannerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
  },
  blockedBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
  unblockBannerBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    marginLeft: 12,
  },
  unblockBannerBtnText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
