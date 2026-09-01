import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  StatusBar,
  ScrollView,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
  BackHandler,
  Animated,
  RefreshControl,
  Modal,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { RootStackParamList, ConversationItem } from '../types';
import { useChat } from '../context/ChatContext';
import { useTheme } from '../context/ThemeContext';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../store';
import { useToast } from '../context/ToastContext';
import { logout } from '../store/authSlice';
import {
  Search,
  Plus,
  X,
  User,
  Users,
  BellOff,
  MessageSquare,
  Phone,
  Video,
  Info,
  Settings as SettingsIcon,
  Lock,
  PhoneCall,
  UserPlus,
  RefreshCw,
  UserCheck,
  ShieldAlert,
  Sun,
  Moon,
  Camera,
  QrCode,
  Bell,
  HardDrive,
  HelpCircle,
  ChevronRight,
  Share2,
  Sparkles,
  LogOut,
  Trash2,
  Eraser,
  Check,
  CheckCheck,
  Clock,
  ArrowLeft,
  ShieldCheck,
  MoreVertical,
  UserX,
  Edit2,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
} from 'lucide-react-native';
import {
  fetchDeviceContacts,
  syncContactsWithServer,
  inviteContact,
  DeviceContact,
  requestContactsPermission,
  getDeterministicConversationId,
  getResolvedDisplayName,
  getResolvedContact,
} from '../services/contactsService';
import { requestAllAppPermissions } from '../services/permissionsService';
import { AppLogo } from '../components/AppLogo';
import { SmartAvatar } from '../components/SmartAvatar';
import { apiService } from '../services/apiService';
import { devInspector } from '../services/devInspectorService';
import { LogoutConfirmModal } from '../components/LogoutConfirmModal';
import { TypingDots } from '../components/TypingIndicator';
import { safeStorage } from '../services/storageHelper';
import { AUTH_STORAGE_KEYS } from '../store/authSlice';
import { callHistoryService, CallLogItem } from '../services/callHistoryService';
import { callService } from '../services/callService';

const formatChatTime = (timeStr?: string) => {
  if (!timeStr) return '';
  if (/^\d{1,2}:\d{2}$/.test(timeStr)) {
    const [h, m] = timeStr.split(':').map(Number);
    const ampm = h >= 12 ? 'pm' : 'am';
    const h12 = h % 12 || 12;
    return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
  }
  try {
    const d = new Date(timeStr);
    if (!isNaN(d.getTime())) {
      const now = new Date();
      const isToday = d.toDateString() === now.toDateString();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const isYesterday = d.toDateString() === yesterday.toDateString();

      if (isToday) {
        return d
          .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })
          .toLowerCase();
      }
      if (isYesterday) return 'Yesterday';
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  } catch {}
  return timeStr;
};

type Props = NativeStackScreenProps<RootStackParamList, 'MainTabs'>;

export const ConversationListScreen: React.FC<Props> = ({ navigation }) => {
  const dispatch = useDispatch();
  const {
    conversations,
    addConversation,
    deleteConversation,
    clearMessages,
    markConversationRead,
    userProfile,
    isUserOnline,
    isUserTyping,
    queryPresence,
    syncServerConversations,
  } = useChat();
  const { themeMode, colors, setThemeMode } = useTheme();
  const { showToast } = useToast();
  const token = useSelector((state: RootState) => state.auth.token);
  const messagesMap = useSelector((state: RootState) => state.chat.messagesMap);
  const [showLogoutModal, setShowLogoutModal] = useState<boolean>(false);
  const [selectedChatForAction, setSelectedChatForAction] = useState<ConversationItem | null>(null);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState<boolean>(false);

  const [isRefreshingChats, setIsRefreshingChats] = useState<boolean>(false);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const queryAllPresences = () => {
      const handles = conversations.flatMap((c) =>
        [c.recipientDbId, c.id, c.username].filter(Boolean),
      ) as string[];
      if (handles.length > 0) {
        queryPresence(handles);
      }
    };

    queryAllPresences();
    const interval = setInterval(queryAllPresences, 10_000);
    return () => clearInterval(interval);
  }, [conversations, queryPresence]);

  const handleConfirmLogout = () => {
    setShowLogoutModal(false);
    dispatch(logout());
    showToast('Logged out successfully', 'info');
    navigation.reset({
      index: 0,
      routes: [{ name: 'PhoneAuth' }],
    });
  };

  const handleRefreshChats = () => {
    setIsRefreshingChats(true);
    syncServerConversations().catch(() => {});
    Animated.timing(slideAnim, {
      toValue: 1,
      duration: 250,
      useNativeDriver: false,
    }).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: false,
        }),
        Animated.timing(shimmerAnim, {
          toValue: 0,
          duration: 800,
          useNativeDriver: false,
        }),
      ]),
    ).start();

    setTimeout(() => {
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: false,
      }).start(() => {
        setIsRefreshingChats(false);
        showToast('Chats updated', 'success', 1200);
      });
    }, 1200);
  };

  const [selectedBottomNav, setSelectedBottomNav] = useState<number>(0); // 0: Chats, 1: Calls, 2: People, 3: Settings

  const handleTabPress = (idx: number) => {
    setSelectedBottomNav(idx);
    devInspector.logUi(
      'MainTabs',
      'tab_switch',
      `Tab: ${['Chats', 'Calls', 'People', 'Settings'][idx]}`,
    );
  };
  const [selectedFilter, setSelectedFilter] = useState<string>('All'); // 'All', 'Unread'
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedAvatarProfile, setSelectedAvatarProfile] = useState<ConversationItem | null>(null);
  const [selectedFullScreenAvatar, setSelectedFullScreenAvatar] = useState<ConversationItem | null>(
    null,
  );
  const [selectedInfoProfile, setSelectedInfoProfile] = useState<ConversationItem | null>(null);

  const [callLogs, setCallLogs] = useState<CallLogItem[]>(callHistoryService.getLogs());
  const [registeredContacts, setRegisteredContacts] = useState<DeviceContact[]>([]);
  const [unregisteredContacts, setUnregisteredContacts] = useState<DeviceContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState<boolean>(false);
  const [hasContactsPermission, setHasContactsPermission] = useState<boolean>(false);
  const [peopleSearchQuery, setPeopleSearchQuery] = useState<string>('');
  const peopleInputRef = useRef<TextInput>(null);
  const chatsInputRef = useRef<TextInput>(null);

  useEffect(() => {
    const unsub = callHistoryService.subscribe((logs) => {
      setCallLogs(logs);
    });
    return unsub;
  }, []);

  const loadContacts = async (forceRefresh = false) => {
    setContactsLoading(true);
    const result = await fetchDeviceContacts(forceRefresh);
    setHasContactsPermission(result.granted);

    if (result.granted && result.contacts.length > 0) {
      const syncRes = await syncContactsWithServer(
        result.contacts,
        token || undefined,
        forceRefresh,
      );
      const myDigits = (userProfile.phone || '').replace(/\D/g, '').slice(-10);
      const myUsername = (userProfile.username || '').toLowerCase().replace(/^@+/, '');

      const isMe = (c: DeviceContact) => {
        const cDigits = (c.phone || '').replace(/\D/g, '').slice(-10);
        const cUsername = (c.username || '').toLowerCase().replace(/^@+/, '');
        if (myDigits && cDigits && myDigits === cDigits) {
          return true;
        }
        if (myUsername && cUsername && myUsername === cUsername) {
          return true;
        }
        return false;
      };

      const dedupe = (list: DeviceContact[]) => {
        const seen = new Set<string>();
        return list.filter((c) => {
          const key = c.userId || (c.phone ? c.phone.replace(/\D/g, '').slice(-10) : c.name);
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      };

      setRegisteredContacts(dedupe(syncRes.registered.filter((c) => !isMe(c))));
      setUnregisteredContacts(dedupe(syncRes.unregistered.filter((c) => !isMe(c))));
    } else {
      setRegisteredContacts([]);
      setUnregisteredContacts([]);
    }
    setContactsLoading(false);
  };

  useEffect(() => {
    // Auto-load and sync contacts on launch / whenever token is ready
    if (token) {
      loadContacts(false);
    }
  }, [token]);

  useEffect(() => {
    // When user switches to People tab, ensure contacts are synced if empty
    if (selectedBottomNav === 2 && registeredContacts.length === 0 && !contactsLoading) {
      loadContacts(false);
    }
  }, [selectedBottomNav]);

  const isNavigatedToChatRef = useRef(false);
  const isSearchingRef = useRef(isSearching);
  isSearchingRef.current = isSearching;
  const searchQueryRef = useRef(searchQuery);
  searchQueryRef.current = searchQuery;

  useFocusEffect(
    useCallback(() => {
      // Auto-clear search ONLY when returning back from Chat or Contacts
      if (isNavigatedToChatRef.current) {
        setSearchQuery('');
        setIsSearching(false);
        setChatsServerUsers([]);
        isNavigatedToChatRef.current = false;
      }

      syncServerConversations().catch(() => {});

      const onBackPress = () => {
        if (isSearchingRef.current || searchQueryRef.current) {
          setSearchQuery('');
          setIsSearching(false);
          setChatsServerUsers([]);
          return true;
        }
        if (selectedBottomNav !== 0) {
          handleTabPress(0);
          return true;
        }
        return false;
      };

      const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => subscription.remove();
    }, [selectedBottomNav]),
  );

  const handleGrantPermission = async () => {
    const granted = await requestContactsPermission();
    if (granted) {
      loadContacts();
    }
  };

  const handleStartChatWithContact = (contact: DeviceContact) => {
    isNavigatedToChatRef.current = true;

    // Check if conversation already exists in conversations list
    const targetDbId = contact.userId;
    const targetUsername = contact.username ? `@${contact.username.replace(/^@+/, '')}` : undefined;
    const targetPhone = contact.phone;
    const cleanPhone = targetPhone ? targetPhone.replace(/\D/g, '').slice(-10) : '';

    const existing = conversations.find((c) => {
      if (targetDbId && (c.id === targetDbId || c.recipientDbId === targetDbId)) return true;
      if (
        targetUsername &&
        c.username &&
        c.username.toLowerCase().replace(/^@+/, '') ===
          targetUsername.toLowerCase().replace(/^@+/, '')
      )
        return true;
      if (cleanPhone && c.phone && c.phone.replace(/\D/g, '').slice(-10) === cleanPhone)
        return true;
      return false;
    });

    if (existing) {
      if (targetDbId && !existing.recipientDbId) {
        addConversation(
          existing.title || contact.name,
          existing.username || targetUsername,
          existing.id,
          targetDbId,
          contact.avatarUrl || existing.avatarUrl,
          contact.phone || existing.phone,
          contact.about || existing.about,
        );
      }
      navigation.navigate('Chat', {
        conversationId: existing.id,
        title: existing.title || contact.name,
        username: existing.username || contact.username,
        avatarUrl: existing.avatarUrl || contact.avatarUrl,
        phone: existing.phone || contact.phone,
        recipientDbId: targetDbId || existing.recipientDbId,
      });
      return;
    }

    const myIdentifier = (userProfile.username || userProfile.phone || 'me').replace(/^@+/, '');
    const targetIdentifier = contact.username || contact.phone || contact.userId || contact.name;
    const convId = getDeterministicConversationId(myIdentifier, targetIdentifier);
    addConversation(
      contact.name,
      contact.username || contact.phone,
      convId,
      contact.userId,
      contact.avatarUrl,
      contact.phone,
    );
    navigation.navigate('Chat', {
      conversationId: convId,
      title: contact.name,
      username: contact.username,
      avatarUrl: contact.avatarUrl,
      phone: contact.phone,
      recipientDbId: contact.userId,
    });
  };

  const handleDirectStartChat = (queryOrUser: string | any) => {
    isNavigatedToChatRef.current = true;

    const isObj = typeof queryOrUser === 'object' && queryOrUser !== null;
    const targetName = isObj
      ? queryOrUser.name || queryOrUser.displayName || 'User'
      : queryOrUser.replace(/^@+/, '');
    const targetUsername = isObj
      ? queryOrUser.username
      : queryOrUser.startsWith('@')
        ? queryOrUser
        : `@${queryOrUser}`;
    const targetPhone = isObj ? queryOrUser.phoneNumber : undefined;
    const targetAvatar = isObj ? queryOrUser.avatarUrl : undefined;
    const targetDbId = isObj ? queryOrUser.id : undefined;
    const targetAbout = isObj ? queryOrUser.about : undefined;

    // If conversation already exists, navigate to it directly
    const existing = conversations.find((c) => {
      if (targetDbId && (c.id === targetDbId || c.recipientDbId === targetDbId)) return true;
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

    if (existing) {
      if (targetDbId && !existing.recipientDbId) {
        addConversation(
          existing.title || targetName,
          existing.username || targetUsername,
          existing.id,
          targetDbId,
          targetAvatar || existing.avatarUrl,
          targetPhone || existing.phone,
          targetAbout || existing.about,
        );
      }
      navigation.navigate('Chat', {
        conversationId: existing.id,
        title: existing.title || targetName,
        username: existing.username || targetUsername,
        avatarUrl: existing.avatarUrl || targetAvatar,
        phone: existing.phone || targetPhone,
        recipientDbId: targetDbId || existing.recipientDbId,
      });
      return;
    }

    const myIdentifier = (userProfile.username || userProfile.phone || 'me').replace(/^@+/, '');
    const convId = getDeterministicConversationId(myIdentifier, targetUsername || targetName);

    addConversation(
      targetName,
      targetUsername,
      convId,
      targetDbId,
      targetAvatar,
      targetPhone,
      targetAbout,
    );
    navigation.navigate('Chat', {
      conversationId: convId,
      title: targetName,
      username: targetUsername,
      avatarUrl: targetAvatar,
      phone: targetPhone,
      recipientDbId: targetDbId,
    });
  };

  const [chatsServerUsers, setChatsServerUsers] = useState<
    Array<{
      id: string;
      name: string;
      username?: string;
      phoneNumber?: string;
      about?: string;
      avatarUrl?: string;
      isRegistered: boolean;
    }>
  >([]);
  const [isSearchingChatsServer, setIsSearchingChatsServer] = useState<boolean>(false);

  // Helper to render sent/delivered/read status ticks on outside chat cards
  const renderMessageStatusIcon = (item: ConversationItem) => {
    const msgs = messagesMap[item.id] || [];
    const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : undefined;
    const isMe =
      lastMsg !== undefined
        ? lastMsg.isMe
        : item.lastMessageIsMe !== undefined
          ? item.lastMessageIsMe
          : false;

    // Only show delivery/read checkmarks if the last message was sent by ME
    if (!isMe) return null;

    const status = item.lastMessageStatus || lastMsg?.status || 'SENT';

    if (status === 'SENDING') {
      return <Clock size={13} color={colors.textSecondary} style={{ marginRight: 4 }} />;
    }
    if (status === 'READ') {
      return <CheckCheck size={15} color="#38BDF8" style={{ marginRight: 4 }} />;
    }
    if (status === 'DELIVERED') {
      return <CheckCheck size={15} color={colors.textSecondary} style={{ marginRight: 4 }} />;
    }
    // SENT or SERVER_RECEIVED
    return <Check size={15} color={colors.textSecondary} style={{ marginRight: 4 }} />;
  };

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q || q.length < 1) {
      setChatsServerUsers([]);
      setIsSearchingChatsServer(false);
      return;
    }

    // Check if query matches any existing local conversation first
    const hasLocalMatch = conversations.some((item) => {
      const cleanQ = q.toLowerCase().replace(/^@+/, '');
      const cleanPhone = cleanQ.replace(/\D/g, '');
      return (
        item.title.toLowerCase().includes(cleanQ) ||
        (item.username && item.username.toLowerCase().replace(/^@+/, '').includes(cleanQ)) ||
        (cleanPhone && item.phone && item.phone.replace(/\D/g, '').includes(cleanPhone))
      );
    });

    setIsSearchingChatsServer(true);
    // If no local match, run DB search faster (220ms), otherwise with gentle debounce (450ms)
    const delay = hasLocalMatch ? 450 : 220;
    const timer = setTimeout(async () => {
      try {
        const currentToken = token || (await safeStorage.getItem(AUTH_STORAGE_KEYS.TOKEN)) || '';
        const results = await apiService.searchUsers(currentToken, q);
        setChatsServerUsers(results);
      } catch (e) {
        setChatsServerUsers([]);
      } finally {
        setIsSearchingChatsServer(false);
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [searchQuery, token, conversations]);

  const filteredConversations = useMemo(() => {
    const list = conversations.filter((item) => {
      if (selectedFilter === 'Unread' && item.unread === '0') return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim().replace(/^@+/, '');
        const cleanPhone = q.replace(/\D/g, '');
        return (
          item.title.toLowerCase().includes(q) ||
          (item.username && item.username.toLowerCase().replace(/^@+/, '').includes(q)) ||
          (cleanPhone && item.phone && item.phone.replace(/\D/g, '').includes(cleanPhone))
        );
      }
      return true;
    });

    // Ensure the most recently active chat is always at the very top
    return list.slice().sort((a, b) => {
      const msgsA = messagesMap[a.id] || [];
      const msgsB = messagesMap[b.id] || [];
      const lastMsgA = msgsA[msgsA.length - 1];
      const lastMsgB = msgsB[msgsB.length - 1];
      const timeA =
        lastMsgA?.createdAtMs || (lastMsgA?.createdAt ? new Date(lastMsgA.createdAt).getTime() : 0);
      const timeB =
        lastMsgB?.createdAtMs || (lastMsgB?.createdAt ? new Date(lastMsgB.createdAt).getTime() : 0);
      if (timeA && timeB && timeA !== timeB) {
        return timeB - timeA;
      }
      return 0;
    });
  }, [conversations, messagesMap, selectedFilter, searchQuery]);

  const handleInviteContact = async (contact: DeviceContact) => {
    showToast(`Sending invite to ${contact.name}...`, 'info');
    await inviteContact(contact.phone, contact.name);
  };

  const [serverSearchResults, setServerSearchResults] = useState<
    Array<{
      id: string;
      name: string;
      username?: string;
      phoneNumber?: string;
      about?: string;
      avatarUrl?: string;
      isRegistered: boolean;
    }>
  >([]);
  const [isSearchingServer, setIsSearchingServer] = useState<boolean>(false);

  useEffect(() => {
    const q = peopleSearchQuery.trim();
    if (!q || q.length < 2 || !token) {
      setServerSearchResults([]);
      setIsSearchingServer(false);
      return;
    }

    setIsSearchingServer(true);
    const timer = setTimeout(async () => {
      const results = await apiService.searchUsers(token, q);
      const localIds = new Set(registeredContacts.map((c) => c.userId).filter(Boolean));
      const localUsernames = new Set(
        registeredContacts
          .map((c) => (c.username || '').toLowerCase().replace(/^@+/, ''))
          .filter(Boolean),
      );

      const uniqueServerUsers = results.filter(
        (u) =>
          !localIds.has(u.id) &&
          !localUsernames.has((u.username || '').toLowerCase().replace(/^@+/, '')),
      );
      setServerSearchResults(uniqueServerUsers);
      setIsSearchingServer(false);
    }, 300);

    return () => clearTimeout(timer);
  }, [peopleSearchQuery, token, registeredContacts]);

  const peopleListItems = useMemo(() => {
    const peopleQuery = peopleSearchQuery.toLowerCase().trim();
    const filteredRegistered = registeredContacts.filter(
      (c) =>
        c.name.toLowerCase().includes(peopleQuery) ||
        c.phone.toLowerCase().includes(peopleQuery) ||
        (c.username && c.username.toLowerCase().includes(peopleQuery)),
    );
    const filteredUnregistered = unregisteredContacts.filter(
      (c) =>
        c.name.toLowerCase().includes(peopleQuery) ||
        c.phone.toLowerCase().includes(peopleQuery) ||
        (c.username && c.username.toLowerCase().includes(peopleQuery)),
    );

    type PeopleListItem =
      | { type: 'header_registered'; count: number }
      | { type: 'contact_registered'; data: DeviceContact }
      | { type: 'header_server'; count: number }
      | {
          type: 'contact_server';
          data: { id: string; name: string; username?: string; about?: string };
        }
      | { type: 'header_unregistered'; count: number }
      | { type: 'contact_unregistered'; data: DeviceContact };

    const items: PeopleListItem[] = [];
    if (filteredRegistered.length > 0) {
      items.push({ type: 'header_registered', count: filteredRegistered.length });
      filteredRegistered.forEach((c) => items.push({ type: 'contact_registered', data: c }));
    }
    if (serverSearchResults.length > 0) {
      items.push({ type: 'header_server', count: serverSearchResults.length });
      serverSearchResults.forEach((u) => items.push({ type: 'contact_server', data: u }));
    }
    if (filteredUnregistered.length > 0) {
      items.push({ type: 'header_unregistered', count: filteredUnregistered.length });
      filteredUnregistered.forEach((c) => items.push({ type: 'contact_unregistered', data: c }));
    }
    return items;
  }, [registeredContacts, unregisteredContacts, serverSearchResults, peopleSearchQuery]);

  // 💬 CHATS TAB (Dynamic Pure Deep Black / Light Theme)
  const renderChatsTab = () => (
    <View style={{ flex: 1 }}>
      {/* Top Header Bar */}
      <View style={styles.topHeaderRow}>
        <TouchableOpacity
          style={styles.avatarWrapper}
          activeOpacity={0.8}
          onPress={() => {
            setSelectedFullScreenAvatar({
              id: 'my_profile',
              title: userProfile.name || 'My Profile',
              username: userProfile.username,
              phone: userProfile.phone,
              avatarUrl: userProfile.avatarUrl,
              groupBg: colors.primaryIndigo,
            } as any);
          }}
        >
          <SmartAvatar
            avatarUrl={userProfile.avatarUrl}
            name={userProfile.name}
            username={userProfile.username}
            size={38}
          />
          <View style={[styles.onlineBadge, { borderColor: colors.bg }]} />
        </TouchableOpacity>

        {isSearching ? (
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => chatsInputRef.current?.focus()}
            style={[
              styles.searchInputWrapper,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            <TextInput
              ref={chatsInputRef}
              style={[styles.searchInput, { color: colors.textPrimary }]}
              placeholder="Search by name or @username..."
              placeholderTextColor={colors.textSecondary}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoFocus
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity
                onPress={() => setSearchQuery('')}
                style={styles.clearSearchBtn}
                activeOpacity={0.7}
                hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
              >
                <View style={[styles.clearIconCircle, { backgroundColor: colors.cardBorder }]}>
                  <X size={12} color={colors.textPrimary} />
                </View>
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        ) : (
          <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Chats</Text>
        )}

        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity
            style={[
              styles.circleIconBtn,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
            onPress={() => {
              setIsSearching(!isSearching);
              if (isSearching) setSearchQuery('');
            }}
          >
            {isSearching ? (
              <X size={18} color={colors.textPrimary} />
            ) : (
              <Search size={18} color={colors.textPrimary} />
            )}
          </TouchableOpacity>
          <View style={{ width: 10 }} />
          <TouchableOpacity
            style={styles.plusIconBtn}
            onPress={() => navigation.navigate('Contacts')}
          >
            <Plus size={20} color="#FFF" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Filter Pills Row */}
      <View style={styles.filterRow}>
        {['All', 'Unread'].map((pill) => {
          const isSelected = selectedFilter === pill;
          return (
            <TouchableOpacity
              key={pill}
              style={[
                styles.filterPill,
                {
                  backgroundColor: isSelected ? colors.primaryIndigo : colors.surface,
                  borderColor: isSelected ? colors.primaryIndigo : colors.cardBorder,
                },
              ]}
              onPress={() => setSelectedFilter(pill)}
            >
              <Text
                style={[
                  styles.filterPillText,
                  { color: isSelected ? '#FFF' : colors.textSecondary },
                  isSelected && styles.filterPillTextActive,
                ]}
              >
                {pill}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* 🚀 Instagram Style Sliding Progress Bar / Loading Strip */}
      <Animated.View
        style={[
          styles.instaSlideLoaderWrapper,
          {
            maxHeight: slideAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 36],
            }),
            opacity: slideAnim,
            marginBottom: slideAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 10],
            }),
          },
        ]}
      >
        <View
          style={[
            styles.instaSlideLoaderPill,
            { backgroundColor: colors.surface, borderColor: colors.cardBorder },
          ]}
        >
          <ActivityIndicator size="small" color={colors.primaryIndigo} style={{ marginRight: 8 }} />
          <Text style={[styles.instaSlideLoaderText, { color: colors.textSecondary }]}>
            Updating chats...
          </Text>
          <Animated.View
            style={[
              styles.instaSlideProgressBar,
              {
                backgroundColor: colors.primaryIndigo,
                width: shimmerAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['15%', '95%'],
                }),
              },
            ]}
          />
        </View>
      </Animated.View>

      {/* Conversation List & Global Search Results */}
      {searchQuery.trim().length > 0 ? (
        <ScrollView
          contentContainerStyle={styles.listContainer}
          keyboardShouldPersistTaps="handled"
        >
          {/* Server / Global Users Searching Indicator */}
          {isSearchingChatsServer && (
            <View style={styles.searchLoadingRow}>
              <ActivityIndicator
                size="small"
                color={colors.primaryIndigo}
                style={{ marginRight: 8 }}
              />
              <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                Searching registered users...
              </Text>
            </View>
          )}

          {/* 1. Server / Global Registered Users Found in Database */}
          {chatsServerUsers.length > 0 && (
            <View style={{ marginBottom: 14 }}>
              <Text style={[styles.searchSectionHeader, { color: colors.primaryIndigo }]}>
                REGISTERED USERS ({chatsServerUsers.length})
              </Text>
              {chatsServerUsers.map((user) => (
                <TouchableOpacity
                  key={user.id}
                  style={[
                    styles.chatCard,
                    { backgroundColor: colors.surface, borderColor: colors.cardBorder },
                  ]}
                  activeOpacity={0.85}
                  onPress={() => handleDirectStartChat(user)}
                >
                  <View style={styles.cardAvatarWrapper}>
                    <SmartAvatar
                      avatarUrl={user.avatarUrl}
                      name={user.name}
                      username={user.username}
                      size={52}
                      groupBg={colors.cardBorder}
                    />
                  </View>

                  <View style={styles.cardContent}>
                    <View style={styles.cardHeaderRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
                          {user.name}
                        </Text>
                        {user.username && (
                          <Text style={[styles.cardUsername, { color: colors.primaryIndigo }]}>
                            {user.username}
                          </Text>
                        )}
                      </View>
                      {(() => {
                        const myUser = (userProfile.username || '')
                          .toLowerCase()
                          .replace(/^@+/, '');
                        const myPhone = (userProfile.phone || '').replace(/\D/g, '').slice(-10);
                        const uClean = (user.username || '').toLowerCase().replace(/^@+/, '');
                        const uPhone = (user.phoneNumber || '').replace(/\D/g, '').slice(-10);
                        const isMe =
                          (uClean && myUser && uClean === myUser) ||
                          (uPhone && myPhone && uPhone === myPhone);

                        return isMe ? (
                          <View
                            style={[
                              styles.directSearchBadge,
                              { backgroundColor: '#475569', marginLeft: 8 },
                            ]}
                          >
                            <Text style={styles.directSearchBadgeText}>You</Text>
                          </View>
                        ) : (
                          <TouchableOpacity
                            style={[
                              styles.directSearchBadge,
                              { backgroundColor: '#10B981', marginLeft: 8 },
                            ]}
                            onPress={() => handleDirectStartChat(user)}
                          >
                            <Text style={styles.directSearchBadgeText}>Chat</Text>
                          </TouchableOpacity>
                        );
                      })()}
                    </View>
                    <Text
                      style={[styles.cardSubtitle, { color: colors.textSecondary, marginTop: 4 }]}
                      numberOfLines={1}
                    >
                      {user.about || 'Available on WhatsApp'}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Local Conversations Found */}
          {filteredConversations.length > 0 && (
            <View>
              <Text style={[styles.searchSectionHeader, { color: colors.textSecondary }]}>
                EXISTING CONVERSATIONS ({filteredConversations.length})
              </Text>
              {filteredConversations.map((item) => {
                const isUnread = item.unread !== '0';
                const isMuted = item.isMuted === true;
                const isTyping = Boolean(
                  isUserTyping(item.id, item.recipientDbId) ||
                  (item.username && isUserTyping(undefined, item.username.replace(/^@+/, ''))),
                );

                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[
                      styles.chatCard,
                      { backgroundColor: colors.surface, borderColor: colors.cardBorder },
                    ]}
                    activeOpacity={0.8}
                    onPress={() => {
                      isNavigatedToChatRef.current = true;
                      const resolvedContact = getResolvedContact({
                        userId: item.recipientDbId,
                        username: item.username,
                        phone: item.phone,
                        name: item.title,
                      });
                      const rawAvatar = item.avatarUrl || resolvedContact?.avatarUrl;
                      const effectiveAvatarUrl =
                        rawAvatar && !rawAvatar.startsWith('file://')
                          ? apiService.getResolvedMediaUrl(rawAvatar)
                          : rawAvatar;

                      navigation.navigate('Chat', {
                        conversationId: item.id,
                        title: item.title,
                        username: item.username,
                        avatarUrl: effectiveAvatarUrl,
                        phone: item.phone,
                        recipientDbId: item.recipientDbId,
                      });
                    }}
                    onLongPress={() => setSelectedChatForAction(item)}
                    delayLongPress={280}
                  >
                    <TouchableOpacity
                      style={styles.cardAvatarWrapper}
                      activeOpacity={0.7}
                      onPress={(e) => {
                        e.stopPropagation();
                        setSelectedAvatarProfile(item);
                      }}
                    >
                      {(() => {
                        const resolvedContact = getResolvedContact({
                          userId: item.recipientDbId,
                          username: item.username,
                          phone: item.phone,
                          name: item.title,
                        });
                        const effectiveAvatarUrl = item.avatarUrl || resolvedContact?.avatarUrl;

                        return (
                          <SmartAvatar
                            avatarUrl={effectiveAvatarUrl}
                            name={item.title}
                            username={item.username}
                            size={52}
                            groupBg={item.groupBg}
                          />
                        );
                      })()}
                      {isUserOnline(item.recipientDbId) ||
                      isUserOnline(item.username) ||
                      isUserOnline(item.id) ||
                      isUserOnline(item.title) ? (
                        <View
                          style={[
                            styles.onlineBadgeCard,
                            { backgroundColor: '#10B981', borderColor: colors.surface },
                          ]}
                        />
                      ) : (
                        <View
                          style={[
                            styles.offlineBadgeCard,
                            { backgroundColor: '#374151', borderColor: colors.surface },
                          ]}
                        />
                      )}
                    </TouchableOpacity>

                    <View style={styles.cardContent}>
                      <View style={styles.cardHeaderRow}>
                        <View style={{ flex: 1, marginRight: 8 }}>
                          <Text
                            style={[styles.cardTitle, { color: colors.textPrimary }]}
                            numberOfLines={1}
                          >
                            {getResolvedDisplayName(
                              { username: item.username, name: item.title },
                              item.title,
                            )}
                          </Text>
                          {item.username && (
                            <Text style={[styles.cardUsername, { color: colors.primaryIndigo }]}>
                              {item.username}
                            </Text>
                          )}
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <Text
                            style={[
                              styles.cardTime,
                              { color: colors.textSecondary, marginRight: 4 },
                            ]}
                          >
                            {formatChatTime(item.time)}
                          </Text>
                          <TouchableOpacity
                            style={styles.cardMenuBtn}
                            hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }}
                            onPress={() => setSelectedChatForAction(item)}
                          >
                            <MoreVertical size={16} color={colors.textSecondary} />
                          </TouchableOpacity>
                        </View>
                      </View>

                      <View style={styles.cardSubtitleRow}>
                        {isTyping ? (
                          <View
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              flex: 1,
                              marginRight: 8,
                            }}
                          >
                            <Text
                              style={{
                                color: '#10B981',
                                fontSize: 13,
                                fontWeight: '700',
                                marginRight: 4,
                              }}
                            >
                              typing...
                            </Text>
                            <TypingDots color="#10B981" dotSize={4} />
                          </View>
                        ) : (
                          <View
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              flex: 1,
                              marginRight: 8,
                            }}
                          >
                            {renderMessageStatusIcon(item)}
                            <Text
                              style={[
                                styles.cardSubtitle,
                                { color: colors.textSecondary, flex: 1, marginRight: 0 },
                              ]}
                              numberOfLines={1}
                            >
                              {item.lastMessage}
                            </Text>
                          </View>
                        )}
                        {isMuted ? (
                          <BellOff size={16} color={colors.textSecondary} />
                        ) : isUnread ? (
                          <View style={[styles.unreadBadge, { minWidth: 20 }]}>
                            <Text style={styles.unreadText}>
                              {parseInt(item.unread, 10) > 99 ? '99+' : item.unread}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* 3. Empty State When No Registered Users or Chats Match Query */}
          {filteredConversations.length === 0 &&
            chatsServerUsers.length === 0 &&
            !isSearchingChatsServer && (
              <View style={styles.emptySearchContainer}>
                <View
                  style={[
                    styles.emptySearchIconCircle,
                    { backgroundColor: colors.surface, borderColor: colors.cardBorder },
                  ]}
                >
                  <UserX size={34} color={colors.textSecondary} />
                </View>
                <Text style={[styles.emptySearchTitle, { color: colors.textPrimary }]}>
                  No user found
                </Text>
                <Text style={[styles.emptySearchDesc, { color: colors.textSecondary }]}>
                  No registered account matches "{searchQuery.trim()}". Make sure the username or
                  phone number is correct.
                </Text>
              </View>
            )}
        </ScrollView>
      ) : filteredConversations.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyChatsContainer}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshingChats}
              onRefresh={handleRefreshChats}
              tintColor={colors.primaryIndigo}
              colors={[colors.primaryIndigo]}
            />
          }
        >
          <View
            style={[
              styles.emptyIconCircle,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            <MessageSquare size={36} color={colors.primaryIndigo} />
          </View>
          <Text style={[styles.emptyChatsTitle, { color: colors.textPrimary }]}>
            No Conversations Yet
          </Text>
          <Text style={[styles.emptyChatsDesc, { color: colors.textSecondary }]}>
            Connect and chat securely with your contacts. Tap below to start your first
            conversation!
          </Text>
          <TouchableOpacity
            style={[styles.emptyStartChatBtn, { backgroundColor: colors.primaryIndigo }]}
            onPress={() => navigation.navigate('Contacts')}
          >
            <Plus size={18} color="#FFF" style={{ marginRight: 8 }} />
            <Text style={styles.emptyStartChatBtnText}>Start New Chat</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : (
        <FlatList
          data={filteredConversations}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContainer}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshingChats}
              onRefresh={handleRefreshChats}
              tintColor={colors.primaryIndigo}
              colors={[colors.primaryIndigo]}
            />
          }
          renderItem={({ item }) => {
            const isUnread = item.unread !== '0';
            const isMuted = item.isMuted === true;
            const isTyping = Boolean(
              isUserTyping(item.id, item.recipientDbId) ||
              (item.username && isUserTyping(undefined, item.username.replace(/^@+/, ''))),
            );

            return (
              <TouchableOpacity
                style={[
                  styles.chatCard,
                  { backgroundColor: colors.surface, borderColor: colors.cardBorder },
                ]}
                activeOpacity={0.8}
                onPress={() => {
                  isNavigatedToChatRef.current = true;
                  navigation.navigate('Chat', {
                    conversationId: item.id,
                    title: item.title,
                    username: item.username,
                    avatarUrl: item.avatarUrl,
                    phone: item.phone,
                    recipientDbId: item.recipientDbId,
                  });
                }}
                onLongPress={() => setSelectedChatForAction(item)}
                delayLongPress={280}
              >
                <TouchableOpacity
                  style={styles.cardAvatarWrapper}
                  activeOpacity={0.7}
                  onPress={(e) => {
                    e.stopPropagation();
                    setSelectedAvatarProfile(item);
                  }}
                >
                  <SmartAvatar
                    avatarUrl={item.avatarUrl}
                    name={item.title}
                    username={item.username}
                    size={48}
                    groupBg={item.groupBg || colors.cardBorder}
                  />
                  {isUserOnline(item.recipientDbId) ||
                  isUserOnline(item.username) ||
                  isUserOnline(item.id) ||
                  isUserOnline(item.title) ? (
                    <View
                      style={[
                        styles.onlineBadgeCard,
                        { backgroundColor: '#10B981', borderColor: colors.surface },
                      ]}
                    />
                  ) : (
                    <View
                      style={[
                        styles.offlineBadgeCard,
                        { backgroundColor: '#374151', borderColor: colors.surface },
                      ]}
                    />
                  )}
                </TouchableOpacity>

                <View style={styles.cardContent}>
                  <View style={styles.cardHeaderRow}>
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <Text
                        style={[styles.cardTitle, { color: colors.textPrimary }]}
                        numberOfLines={1}
                      >
                        {getResolvedDisplayName(
                          { username: item.username, name: item.title },
                          item.title,
                        )}
                      </Text>
                      {item.username && (
                        <Text style={[styles.cardUsername, { color: colors.primaryIndigo }]}>
                          {item.username}
                        </Text>
                      )}
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text
                        style={[styles.cardTime, { color: colors.textSecondary, marginRight: 4 }]}
                      >
                        {formatChatTime(item.time)}
                      </Text>
                      <TouchableOpacity
                        style={styles.cardMenuBtn}
                        hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }}
                        onPress={() => setSelectedChatForAction(item)}
                      >
                        <MoreVertical size={16} color={colors.textSecondary} />
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.cardSubtitleRow}>
                    {isTyping ? (
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          flex: 1,
                          marginRight: 8,
                        }}
                      >
                        <Text
                          style={{
                            color: '#10B981',
                            fontSize: 13,
                            fontWeight: '700',
                            marginRight: 4,
                          }}
                        >
                          typing...
                        </Text>
                        <TypingDots color="#10B981" dotSize={4} />
                      </View>
                    ) : (
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          flex: 1,
                          marginRight: 8,
                        }}
                      >
                        {renderMessageStatusIcon(item)}
                        <Text
                          style={[
                            styles.cardSubtitle,
                            { color: colors.textSecondary, flex: 1, marginRight: 0 },
                          ]}
                          numberOfLines={1}
                        >
                          {item.lastMessage}
                        </Text>
                      </View>
                    )}
                    {isMuted ? (
                      <BellOff size={16} color={colors.textSecondary} />
                    ) : isUnread ? (
                      <View style={[styles.unreadBadge, { minWidth: 20 }]}>
                        <Text style={styles.unreadText}>
                          {parseInt(item.unread, 10) > 99 ? '99+' : item.unread}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );

  // 📞 CALLS TAB
  const renderCallsTab = () => {
    const formatCallLogTime = (timestamp: number) => {
      const date = new Date(timestamp);
      const now = new Date();
      const isToday = date.toDateString() === now.toDateString();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const isYesterday = date.toDateString() === yesterday.toDateString();

      const h = date.getHours();
      const m = date.getMinutes();
      const ampm = h >= 12 ? 'pm' : 'am';
      const h12 = h % 12 || 12;
      const timeStr = `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;

      if (isToday) return `Today, ${timeStr}`;
      if (isYesterday) return `Yesterday, ${timeStr}`;
      const months = [
        'Jan',
        'Feb',
        'Mar',
        'Apr',
        'May',
        'Jun',
        'Jul',
        'Aug',
        'Sep',
        'Oct',
        'Nov',
        'Dec',
      ];
      return `${date.getDate()} ${months[date.getMonth()]}, ${timeStr}`;
    };

    const formatCallLogDuration = (seconds: number) => {
      if (!seconds || seconds <= 0) return '';
      if (seconds < 60) return `• ${seconds}s`;
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      return s > 0 ? `• ${m}m ${s}s` : `• ${m}m`;
    };

    const handleStartCallFromLog = (log: CallLogItem) => {
      const session = callService.startCall({
        targetUserId: log.targetUserId,
        targetUserName: log.targetUserName,
        targetUserAvatar: log.targetUserAvatar,
        callType: log.callType,
        myUserId: (userProfile as any)?.userId || userProfile?.phone || 'me',
        myName: userProfile?.name,
      });
      navigation.navigate('Call', {
        callId: session.callId,
        targetUserId: log.targetUserName || log.targetUserId,
        isCaller: true,
        isVideo: log.callType === 'video',
      });
    };

    return (
      <View style={{ flex: 1 }}>
        <View style={styles.topHeaderRow}>
          <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Calls</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {callLogs.length > 0 && (
              <TouchableOpacity
                style={[
                  styles.circleIconBtn,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.cardBorder,
                    marginRight: 8,
                  },
                ]}
                onPress={() => {
                  callHistoryService.clearHistory();
                  showToast('Call history cleared', 'info');
                }}
              >
                <Trash2 size={18} color="#EF4444" />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[
                styles.circleIconBtn,
                { backgroundColor: colors.surface, borderColor: colors.cardBorder },
              ]}
              onPress={() => navigation.navigate('Contacts')}
            >
              <Plus size={20} color={colors.primaryIndigo} />
            </TouchableOpacity>
          </View>
        </View>

        {callLogs.length === 0 ? (
          <View style={styles.emptyChatsContainer}>
            <View
              style={[
                styles.emptyIconCircle,
                { backgroundColor: colors.surface, borderColor: colors.cardBorder },
              ]}
            >
              <PhoneCall size={36} color={colors.primaryIndigo} />
            </View>
            <Text style={[styles.emptyChatsTitle, { color: colors.textPrimary }]}>
              No Recent Calls
            </Text>
            <Text style={[styles.emptyChatsDesc, { color: colors.textSecondary }]}>
              Make crystal-clear, end-to-end encrypted audio and video calls directly with your
              contacts.
            </Text>
            <TouchableOpacity
              style={[styles.emptyStartChatBtn, { backgroundColor: colors.primaryIndigo }]}
              onPress={() => navigation.navigate('Contacts')}
            >
              <Phone size={18} color="#FFF" style={{ marginRight: 8 }} />
              <Text style={styles.emptyStartChatBtnText}>Start a Call</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={callLogs}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
            showsVerticalScrollIndicator={false}
            renderItem={({ item: log }) => {
              const isMissed = log.direction === 'missed' || log.status === 'missed';
              const isOutgoing = log.direction === 'outgoing';
              const nameInitial = log.targetUserName ? log.targetUserName[0].toUpperCase() : 'C';

              return (
                <TouchableOpacity
                  activeOpacity={0.7}
                  style={[
                    styles.chatCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.cardBorder,
                      marginBottom: 8,
                      paddingVertical: 12,
                      paddingHorizontal: 14,
                      borderRadius: 18,
                    },
                  ]}
                  onPress={() => handleStartCallFromLog(log)}
                >
                  {/* Left Avatar */}
                  <View style={{ marginRight: 12 }}>
                    {log.targetUserAvatar ? (
                      <SmartAvatar
                        avatarUrl={log.targetUserAvatar}
                        size={48}
                        name={log.targetUserName}
                      />
                    ) : (
                      <View
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: 24,
                          backgroundColor: isMissed ? '#EF4444' : '#4F46E5',
                          justifyContent: 'center',
                          alignItems: 'center',
                        }}
                      >
                        <Text style={{ color: '#FFF', fontSize: 18, fontWeight: '800' }}>
                          {nameInitial}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Center Details */}
                  <View style={{ flex: 1, justifyContent: 'center' }}>
                    <Text
                      style={[
                        {
                          color: isMissed ? '#EF4444' : colors.textPrimary,
                          fontSize: 16,
                          fontWeight: '700',
                        },
                      ]}
                      numberOfLines={1}
                    >
                      {log.targetUserName || log.targetUserId}
                    </Text>

                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
                      {isMissed ? (
                        <PhoneMissed size={14} color="#EF4444" style={{ marginRight: 5 }} />
                      ) : isOutgoing ? (
                        <PhoneOutgoing size={14} color="#10B981" style={{ marginRight: 5 }} />
                      ) : (
                        <PhoneIncoming size={14} color="#3B82F6" style={{ marginRight: 5 }} />
                      )}

                      <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                        {formatCallLogTime(log.timestamp)}{' '}
                        {log.durationSeconds > 0 ? formatCallLogDuration(log.durationSeconds) : ''}
                      </Text>
                    </View>
                  </View>

                  {/* Right Action Call Button */}
                  <TouchableOpacity
                    style={{
                      padding: 10,
                      borderRadius: 20,
                      backgroundColor: colors.cardBorder,
                      marginLeft: 8,
                    }}
                    onPress={() => handleStartCallFromLog(log)}
                  >
                    {log.callType === 'video' ? (
                      <Video size={20} color={colors.primaryIndigo} />
                    ) : (
                      <Phone size={19} color={colors.primaryIndigo} />
                    )}
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            }}
          />
        )}
      </View>
    );
  };

  // 👥 PEOPLE TAB (Real Phone Contacts Sync with Chat & Invite Actions)
  const renderPeopleTab = () => (
    <View style={{ flex: 1 }}>
      <View style={styles.topHeaderRow}>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>People</Text>
        <TouchableOpacity
          style={[
            styles.circleIconBtn,
            { backgroundColor: colors.surface, borderColor: colors.cardBorder },
          ]}
          onPress={() => loadContacts(true)}
        >
          <RefreshCw size={18} color={colors.primaryIndigo} />
        </TouchableOpacity>
      </View>

      {/* Sync Banner Card */}
      <TouchableOpacity
        style={[
          styles.syncBannerCard,
          { backgroundColor: colors.surface, borderColor: colors.cardBorder },
        ]}
        activeOpacity={0.8}
        onPress={() => navigation.navigate('Contacts')}
      >
        <View style={[styles.settingIconBox, { backgroundColor: colors.cardBorder }]}>
          <UserPlus size={20} color={colors.primaryIndigo} />
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={[styles.settingTitle, { color: colors.textPrimary }]}>Phone Contacts</Text>
          <Text style={[styles.settingSubtitle, { color: colors.textSecondary }]}>
            {hasContactsPermission
              ? `${registeredContacts.length} on app • ${unregisteredContacts.length} to invite`
              : 'Tap to sync phone contacts'}
          </Text>
        </View>
      </TouchableOpacity>

      {/* Search Input Bar */}
      {hasContactsPermission && (
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => peopleInputRef.current?.focus()}
          style={[
            styles.peopleSearchBox,
            { backgroundColor: colors.surface, borderColor: colors.cardBorder },
          ]}
        >
          <Search size={18} color={colors.textSecondary} style={{ marginRight: 8 }} />
          <TextInput
            ref={peopleInputRef}
            style={[styles.searchInput, { color: colors.textPrimary }]}
            placeholder="Search by name, phone or @username..."
            placeholderTextColor={colors.textSecondary}
            value={peopleSearchQuery}
            onChangeText={setPeopleSearchQuery}
            returnKeyType="search"
          />
          {peopleSearchQuery.length > 0 && (
            <TouchableOpacity
              onPress={() => setPeopleSearchQuery('')}
              style={styles.clearSearchBtn}
              activeOpacity={0.7}
              hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
            >
              <View style={[styles.clearIconCircle, { backgroundColor: colors.cardBorder }]}>
                <X size={12} color={colors.textPrimary} />
              </View>
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      )}

      {/* Contacts List or Permission View */}
      {contactsLoading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={colors.primaryIndigo} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Syncing contacts on server...
          </Text>
        </View>
      ) : !hasContactsPermission ? (
        <View style={styles.centerBox}>
          <View
            style={[
              styles.permissionCircle,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            <ShieldAlert size={36} color={colors.primaryIndigo} />
          </View>
          <Text style={[styles.permTitle, { color: colors.textPrimary }]}>
            Contacts Permission Required
          </Text>
          <Text style={[styles.permDesc, { color: colors.textSecondary }]}>
            Allow chatting system to access your device contacts so you can message your friends.
          </Text>
          <TouchableOpacity style={styles.grantBtn} onPress={handleGrantPermission}>
            <UserPlus size={18} color="#FFF" style={{ marginRight: 8 }} />
            <Text style={styles.grantBtnText}>Allow Contacts Access</Text>
          </TouchableOpacity>
        </View>
      ) : peopleListItems.length === 0 ? (
        <View style={styles.centerBox}>
          <Text style={[styles.permTitle, { color: colors.textPrimary }]}>No Contacts Found</Text>
          <Text style={[styles.permDesc, { color: colors.textSecondary }]}>
            {peopleSearchQuery
              ? `No contact matches "${peopleSearchQuery}"`
              : 'No contacts found on your phone.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={peopleListItems}
          keyExtractor={(item, index) =>
            item.type.startsWith('header_')
              ? `${item.type}_${index}`
              : `${item.type}_${'data' in item ? item.data.id : index}`
          }
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 24 }}
          renderItem={({ item }) => {
            if (item.type === 'header_registered') {
              return (
                <View style={styles.peopleSectionHeader}>
                  <View
                    style={[
                      styles.peopleBadgePill,
                      { backgroundColor: colors.surface, borderColor: colors.primaryIndigo },
                    ]}
                  >
                    <Sparkles size={13} color={colors.primaryIndigo} />
                    <Text style={[styles.peopleBadgeText, { color: colors.primaryIndigo }]}>
                      Contacts on App ({item.count})
                    </Text>
                  </View>
                </View>
              );
            }

            if (item.type === 'header_unregistered') {
              return (
                <View style={[styles.peopleSectionHeader, { marginTop: 18 }]}>
                  <View
                    style={[
                      styles.peopleBadgePill,
                      { backgroundColor: colors.surface, borderColor: colors.cardBorder },
                    ]}
                  >
                    <Users size={13} color={colors.textSecondary} />
                    <Text style={[styles.peopleBadgeText, { color: colors.textSecondary }]}>
                      Invite to Chat ({item.count})
                    </Text>
                  </View>
                </View>
              );
            }

            if (item.type === 'header_server') {
              return (
                <View style={[styles.peopleSectionHeader, { marginTop: 18 }]}>
                  <View
                    style={[
                      styles.peopleBadgePill,
                      { backgroundColor: colors.surface, borderColor: '#8B5CF6' },
                    ]}
                  >
                    <Sparkles size={13} color="#8B5CF6" />
                    <Text style={[styles.peopleBadgeText, { color: '#8B5CF6' }]}>
                      Global App Users Found ({item.count})
                    </Text>
                  </View>
                </View>
              );
            }

            if (item.type === 'contact_server') {
              const user = item.data;
              return (
                <TouchableOpacity
                  style={[
                    styles.contactItem,
                    styles.registeredContactCard,
                    { backgroundColor: colors.surface, borderColor: colors.primaryIndigo },
                  ]}
                  activeOpacity={0.8}
                  onPress={() =>
                    handleStartChatWithContact({
                      id: user.id,
                      name: user.name,
                      username: user.username,
                      phone: '',
                      isRegistered: true,
                      userId: user.id,
                    })
                  }
                >
                  <View style={[styles.avatarBox, { backgroundColor: colors.primaryIndigo }]}>
                    <Text style={[styles.avatarLetter, { color: '#FFF' }]}>
                      {user.name ? user.name[0].toUpperCase() : '?'}
                    </Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <View style={styles.nameRow}>
                      <Text
                        style={[styles.callName, { color: colors.textPrimary }]}
                        numberOfLines={1}
                      >
                        {user.name}
                      </Text>
                      {isUserOnline(user.username) || isUserOnline(user.id) ? (
                        <View style={[styles.activeDot, { backgroundColor: '#10B981' }]} />
                      ) : (
                        <View style={[styles.activeDot, { backgroundColor: '#374151' }]} />
                      )}
                    </View>
                    <Text
                      style={[styles.contactHandle, { color: colors.primaryIndigo }]}
                      numberOfLines={1}
                    >
                      {user.username
                        ? `@${user.username.replace(/^@+/, '')}`
                        : user.about || 'Platform User'}
                    </Text>
                  </View>

                  {/* Chat Action Button */}
                  <TouchableOpacity
                    style={[styles.chatBtn, { backgroundColor: colors.primaryIndigo }]}
                    onPress={() =>
                      handleStartChatWithContact({
                        id: user.id,
                        name: user.name,
                        username: user.username,
                        phone: '',
                        isRegistered: true,
                        userId: user.id,
                      })
                    }
                  >
                    <MessageSquare size={15} color="#FFF" style={{ marginRight: 5 }} />
                    <Text style={styles.chatBtnText}>Chat</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            }

            if (item.type === 'contact_registered') {
              const contact = item.data;
              return (
                <TouchableOpacity
                  style={[
                    styles.contactItem,
                    styles.registeredContactCard,
                    { backgroundColor: colors.surface, borderColor: colors.primaryIndigo },
                  ]}
                  activeOpacity={0.8}
                  onPress={() => handleStartChatWithContact(contact)}
                >
                  {contact.avatarUrl ? (
                    <Image
                      source={{ uri: contact.avatarUrl }}
                      style={styles.cardAvatarImage}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={[styles.avatarBox, { backgroundColor: colors.primaryIndigo }]}>
                      <Text style={[styles.avatarLetter, { color: '#FFF' }]}>
                        {contact.name ? contact.name[0].toUpperCase() : '?'}
                      </Text>
                    </View>
                  )}
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <View style={styles.nameRow}>
                      <Text
                        style={[styles.callName, { color: colors.textPrimary }]}
                        numberOfLines={1}
                      >
                        {contact.name}
                      </Text>
                      {isUserOnline(contact.username) ||
                      isUserOnline(contact.userId) ||
                      isUserOnline(contact.phone) ||
                      isUserOnline(contact.name) ? (
                        <View style={[styles.activeDot, { backgroundColor: '#10B981' }]} />
                      ) : (
                        <View style={[styles.activeDot, { backgroundColor: '#374151' }]} />
                      )}
                    </View>
                    <Text
                      style={[styles.contactHandle, { color: colors.primaryIndigo }]}
                      numberOfLines={1}
                    >
                      {contact.username
                        ? `@${contact.username.replace(/^@+/, '')}`
                        : contact.about || 'Available'}
                    </Text>
                  </View>

                  {/* Chat Action Button */}
                  <TouchableOpacity
                    style={[styles.chatBtn, { backgroundColor: colors.primaryIndigo }]}
                    onPress={() => handleStartChatWithContact(contact)}
                  >
                    <MessageSquare size={15} color="#FFF" style={{ marginRight: 5 }} />
                    <Text style={styles.chatBtnText}>Chat</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            }

            if (item.type === 'contact_unregistered') {
              const contact = item.data;
              return (
                <View
                  style={[
                    styles.contactItem,
                    { backgroundColor: colors.surface, borderColor: colors.cardBorder },
                  ]}
                >
                  <View style={[styles.avatarBox, { backgroundColor: colors.cardBorder }]}>
                    <Text style={[styles.avatarLetter, { color: colors.textSecondary }]}>
                      {contact.name ? contact.name[0].toUpperCase() : '?'}
                    </Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text
                      style={[styles.callName, { color: colors.textPrimary }]}
                      numberOfLines={1}
                    >
                      {contact.name}
                    </Text>
                    <Text
                      style={[styles.callTime, { color: colors.textSecondary }]}
                      numberOfLines={1}
                    >
                      Not on WhatsApp Connect
                    </Text>
                  </View>

                  {/* Invite Button */}
                  <TouchableOpacity
                    style={[styles.inviteBtn, { borderColor: colors.primaryIndigo }]}
                    onPress={() => handleInviteContact(contact)}
                  >
                    <Share2 size={13} color={colors.primaryIndigo} style={{ marginRight: 4 }} />
                    <Text style={[styles.inviteBtnText, { color: colors.primaryIndigo }]}>
                      Invite
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            }

            return null;
          }}
        />
      )}
    </View>
  );

  // ⚙️ SETTINGS TAB (Optimized Instagram / WhatsApp Style Profile & Settings)
  const renderSettingsTab = () => (
    <View style={{ flex: 1 }}>
      {/* Top Header */}
      <View style={styles.topHeader}>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Settings</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 24 }}
      >
        {/* 👤 Instagram/WhatsApp Style Profile Card */}
        <TouchableOpacity
          style={[
            styles.profileCard,
            { backgroundColor: colors.surface, borderColor: colors.cardBorder },
          ]}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('EditProfile')}
        >
          <View style={styles.profileAvatarWrapper}>
            {userProfile.avatarUrl ? (
              <Image
                source={{ uri: apiService.getResolvedMediaUrl(userProfile.avatarUrl) }}
                style={styles.profileAvatarImage}
              />
            ) : (
              <View style={[styles.profileAvatar, { backgroundColor: colors.primaryIndigo }]}>
                <Text style={styles.profileAvatarText}>
                  {userProfile.name ? userProfile.name[0].toUpperCase() : 'R'}
                </Text>
              </View>
            )}
            <View
              style={[
                styles.cameraBadge,
                { backgroundColor: colors.primaryIndigo, borderColor: colors.surface },
              ]}
            >
              <Camera size={11} color="#FFF" />
            </View>
          </View>

          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={[styles.profileName, { color: colors.textPrimary }]}>
              {userProfile.name}
            </Text>
            <Text style={[styles.profileHandle, { color: colors.primaryIndigo }]}>
              {userProfile.username}
            </Text>
            <Text style={[styles.profileStatus, { color: colors.textSecondary }]} numberOfLines={1}>
              {userProfile.status}
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.qrCodeBtn, { backgroundColor: colors.cardBorder }]}
            onPress={() => navigation.navigate('QrCode')}
          >
            <QrCode size={20} color={colors.primaryIndigo} />
          </TouchableOpacity>
        </TouchableOpacity>

        {/* Quick Appearance / Theme Card */}
        <View
          style={[
            styles.themeCardBox,
            { backgroundColor: colors.surface, borderColor: colors.cardBorder },
          ]}
        >
          <Text style={[styles.themeBoxLabel, { color: colors.textSecondary }]}>
            SELECT APP THEME
          </Text>
          <View style={styles.themeToggleRow}>
            {/* Pure Deep Black Dark Mode Option */}
            <TouchableOpacity
              style={[
                styles.themeChoiceBtn,
                {
                  backgroundColor: themeMode === 'dark' ? colors.primaryIndigo : colors.cardBorder,
                },
              ]}
              onPress={() => setThemeMode('dark')}
              activeOpacity={0.8}
            >
              <Moon size={16} color={themeMode === 'dark' ? '#FFF' : colors.textSecondary} />
              <Text
                style={[
                  styles.themeChoiceText,
                  { color: themeMode === 'dark' ? '#FFF' : colors.textSecondary },
                ]}
              >
                Pure Black 🌙
              </Text>
            </TouchableOpacity>

            {/* Light Mode Option */}
            <TouchableOpacity
              style={[
                styles.themeChoiceBtn,
                {
                  backgroundColor: themeMode === 'light' ? colors.primaryIndigo : colors.cardBorder,
                },
              ]}
              onPress={() => setThemeMode('light')}
              activeOpacity={0.8}
            >
              <Sun size={16} color={themeMode === 'light' ? '#FFF' : colors.textSecondary} />
              <Text
                style={[
                  styles.themeChoiceText,
                  { color: themeMode === 'light' ? '#FFF' : colors.textSecondary },
                ]}
              >
                Light Mode ☀️
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Organized Setting Categories List */}
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>PREFERENCES</Text>

        {[
          {
            title: 'Account',
            subtitle: 'Security, 2-step verification, change number',
            icon: User,
            iconBg: 'rgba(99, 102, 241, 0.12)',
            screen: 'AccountSettings',
          },
          {
            title: 'Privacy',
            subtitle: 'Block contacts, last seen, read receipts',
            icon: Lock,
            iconBg: 'rgba(16, 185, 129, 0.12)',
            screen: 'PrivacySettings',
          },
          {
            title: 'Chats & Theme',
            subtitle: 'Wallpaper, chat history, theme mode',
            icon: MessageSquare,
            iconBg: 'rgba(168, 85, 247, 0.12)',
            screen: 'ChatSettings',
          },
          {
            title: 'Call Settings',
            subtitle: 'Silence unknown callers, data usage',
            icon: PhoneCall,
            iconBg: 'rgba(59, 130, 246, 0.12)',
            screen: 'CallSettings',
          },
          {
            title: 'Notifications',
            subtitle: 'Message, group & call tones',
            icon: Bell,
            iconBg: 'rgba(245, 158, 11, 0.12)',
            screen: 'NotificationSettings',
          },
          {
            title: 'Storage & Data',
            subtitle: 'Network usage, auto-download',
            icon: HardDrive,
            iconBg: 'rgba(236, 72, 153, 0.12)',
            screen: 'StorageSettings',
          },
          {
            title: 'Help & Support',
            subtitle: 'Help center, contact us, privacy policy',
            icon: HelpCircle,
            iconBg: 'rgba(14, 165, 233, 0.12)',
            screen: 'HelpSettings',
          },
          {
            title: '🛠️ Developer Live Inspector',
            subtitle: 'Live API Telemetry, Redis Caching & UI Performance',
            icon: Sparkles,
            iconBg: 'rgba(99, 102, 241, 0.18)',
            onPress: () => devInspector.setVisible(true),
          },
        ].map((setting: any, idx) => {
          const IconComp = setting.icon;
          return (
            <TouchableOpacity
              key={idx}
              style={[
                styles.settingRowItem,
                { backgroundColor: colors.surface, borderColor: colors.cardBorder },
              ]}
              activeOpacity={0.8}
              onPress={() => {
                if (setting.onPress) {
                  setting.onPress();
                } else if (setting.screen) {
                  navigation.navigate(setting.screen as any);
                }
              }}
            >
              <View style={[styles.settingIconBadge, { backgroundColor: setting.iconBg }]}>
                <IconComp size={20} color={colors.primaryIndigo} />
              </View>
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={[styles.settingItemTitle, { color: colors.textPrimary }]}>
                  {setting.title}
                </Text>
                <Text
                  style={[styles.settingItemSubtitle, { color: colors.textSecondary }]}
                  numberOfLines={1}
                >
                  {setting.subtitle}
                </Text>
              </View>
              <ChevronRight size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          );
        })}

        {/* Log Out Option Card */}
        <TouchableOpacity
          style={[
            styles.settingRowItem,
            {
              backgroundColor: colors.surface,
              borderColor: 'rgba(239, 68, 68, 0.3)',
              marginTop: 14,
            },
          ]}
          activeOpacity={0.8}
          onPress={() => setShowLogoutModal(true)}
        >
          <View style={[styles.settingIconBadge, { backgroundColor: 'rgba(239, 68, 68, 0.12)' }]}>
            <LogOut size={20} color="#EF4444" />
          </View>
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={[styles.settingItemTitle, { color: '#EF4444' }]}>Log Out</Text>
            <Text
              style={[styles.settingItemSubtitle, { color: colors.textSecondary }]}
              numberOfLines={1}
            >
              Sign out from this device
            </Text>
          </View>
          <ChevronRight size={18} color="#EF4444" />
        </TouchableOpacity>
      </ScrollView>
    </View>
  );

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.bg }]}
      edges={['top', 'left', 'right']}
    >
      <StatusBar
        barStyle={themeMode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.bg}
      />

      {/* Instant Tab Switching Container (Zero-lag active tab rendering) */}
      <View style={{ flex: 1 }}>
        {selectedBottomNav === 0 && renderChatsTab()}
        {selectedBottomNav === 1 && renderCallsTab()}
        {selectedBottomNav === 2 && renderPeopleTab()}
        {selectedBottomNav === 3 && renderSettingsTab()}
      </View>

      <LogoutConfirmModal
        visible={showLogoutModal}
        userName={userProfile.name}
        onCancel={() => setShowLogoutModal(false)}
        onConfirm={handleConfirmLogout}
      />

      {/* WhatsApp-Style Chat Action Modal (Long Press on Chat Card) */}
      <Modal
        visible={!!selectedChatForAction && !showDeleteConfirmModal}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedChatForAction(null)}
      >
        <TouchableOpacity
          style={styles.actionModalOverlay}
          activeOpacity={1}
          onPress={() => setSelectedChatForAction(null)}
        >
          <View
            style={[
              styles.actionModalCard,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            {/* Header info */}
            <View style={styles.actionModalHeader}>
              <View style={[styles.actionAvatar, { backgroundColor: colors.cardBorder }]}>
                <Text style={[styles.actionAvatarText, { color: colors.primaryIndigo }]}>
                  {selectedChatForAction?.avatar || 'C'}
                </Text>
              </View>
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text
                  style={[styles.actionChatTitle, { color: colors.textPrimary }]}
                  numberOfLines={1}
                >
                  {selectedChatForAction
                    ? getResolvedDisplayName(
                        {
                          username: selectedChatForAction.username,
                          name: selectedChatForAction.title,
                        },
                        selectedChatForAction.title,
                      )
                    : ''}
                </Text>
                {selectedChatForAction?.username && (
                  <Text style={[styles.actionChatUsername, { color: colors.primaryIndigo }]}>
                    {selectedChatForAction.username}
                  </Text>
                )}
              </View>
            </View>

            <View style={[styles.actionDivider, { backgroundColor: colors.cardBorder }]} />

            {/* Mark as Read */}
            <TouchableOpacity
              style={styles.actionRow}
              onPress={() => {
                if (selectedChatForAction) {
                  markConversationRead(selectedChatForAction.id);
                  showToast('Marked as read', 'info', 1200);
                }
                setSelectedChatForAction(null);
              }}
            >
              <CheckCheck size={20} color={colors.primaryIndigo} />
              <Text style={[styles.actionRowText, { color: colors.textPrimary }]}>
                Mark as Read
              </Text>
            </TouchableOpacity>

            {/* Clear Messages */}
            <TouchableOpacity
              style={styles.actionRow}
              onPress={() => {
                if (selectedChatForAction) {
                  clearMessages(selectedChatForAction.id);
                  showToast('Chat cleared', 'info', 1500);
                }
                setSelectedChatForAction(null);
              }}
            >
              <Eraser size={20} color="#F59E0B" />
              <Text style={[styles.actionRowText, { color: colors.textPrimary }]}>
                Clear Messages
              </Text>
            </TouchableOpacity>

            {/* Delete Chat */}
            <TouchableOpacity
              style={styles.actionRow}
              onPress={() => {
                setShowDeleteConfirmModal(true);
              }}
            >
              <Trash2 size={20} color="#EF4444" />
              <Text style={[styles.actionRowText, { color: '#EF4444', fontWeight: '700' }]}>
                Delete Chat
              </Text>
            </TouchableOpacity>

            <View style={[styles.actionDivider, { backgroundColor: colors.cardBorder }]} />

            {/* Cancel Button */}
            <TouchableOpacity
              style={styles.actionCancelBtn}
              onPress={() => setSelectedChatForAction(null)}
            >
              <Text style={[styles.actionCancelText, { color: colors.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        visible={showDeleteConfirmModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setShowDeleteConfirmModal(false);
          setSelectedChatForAction(null);
        }}
      >
        <View style={styles.confirmModalOverlay}>
          <View
            style={[
              styles.confirmModalCard,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            <View style={styles.confirmIconCircle}>
              <Trash2 size={28} color="#EF4444" />
            </View>
            <Text style={[styles.confirmModalTitle, { color: colors.textPrimary }]}>
              Delete this chat?
            </Text>
            <Text style={[styles.confirmModalDesc, { color: colors.textSecondary }]}>
              Messages will be permanently deleted from this device for{' '}
              <Text style={{ fontWeight: '700', color: colors.textPrimary }}>
                {selectedChatForAction
                  ? getResolvedDisplayName(
                      {
                        username: selectedChatForAction.username,
                        name: selectedChatForAction.title,
                      },
                      selectedChatForAction.title,
                    )
                  : 'this contact'}
              </Text>
              .
            </Text>

            <View style={styles.confirmModalButtons}>
              <TouchableOpacity
                style={[
                  styles.confirmBtnSecondary,
                  { backgroundColor: colors.bg, borderColor: colors.cardBorder },
                ]}
                onPress={() => {
                  setShowDeleteConfirmModal(false);
                  setSelectedChatForAction(null);
                }}
              >
                <Text style={[styles.confirmBtnSecondaryText, { color: colors.textPrimary }]}>
                  Cancel
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.confirmBtnDanger, { backgroundColor: '#EF4444' }]}
                onPress={() => {
                  if (selectedChatForAction) {
                    deleteConversation(selectedChatForAction.id);
                    showToast('Chat deleted', 'success', 1500);
                  }
                  setShowDeleteConfirmModal(false);
                  setSelectedChatForAction(null);
                }}
              >
                <Text style={styles.confirmBtnDangerText}>Delete Chat</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 🖼️ WhatsApp Quick Profile Picture Modal on Avatar Click */}
      <Modal
        visible={!!selectedAvatarProfile}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedAvatarProfile(null)}
      >
        <TouchableOpacity
          style={styles.avatarModalBackdrop}
          activeOpacity={1}
          onPress={() => setSelectedAvatarProfile(null)}
        >
          <View
            style={[
              styles.avatarModalCard,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
            onStartShouldSetResponder={() => true}
          >
            {/* Header with Name */}
            <View style={styles.avatarModalHeader}>
              <Text
                style={[styles.avatarModalTitle, { color: colors.textPrimary }]}
                numberOfLines={1}
              >
                {selectedAvatarProfile
                  ? getResolvedDisplayName(
                      {
                        username: selectedAvatarProfile.username,
                        name: selectedAvatarProfile.title,
                        phone: selectedAvatarProfile.phone,
                      },
                      selectedAvatarProfile.title,
                    )
                  : ''}
              </Text>
              <TouchableOpacity
                onPress={() => setSelectedAvatarProfile(null)}
                style={styles.avatarModalCloseBtn}
              >
                <X size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Big Profile Photo */}
            <View style={styles.avatarModalImageContainer}>
              <TouchableOpacity
                activeOpacity={0.9}
                style={{ width: '100%', height: '100%' }}
                onPress={() => {
                  const p = selectedAvatarProfile;
                  setSelectedAvatarProfile(null);
                  if (p) setSelectedFullScreenAvatar(p);
                }}
              >
                <SmartAvatar
                  avatarUrl={selectedAvatarProfile?.avatarUrl}
                  name={selectedAvatarProfile?.title}
                  username={selectedAvatarProfile?.username}
                  size={280}
                  borderRadius={0}
                  style={styles.avatarModalImage}
                  textStyle={styles.avatarModalPlaceholderLetter}
                  groupBg={selectedAvatarProfile?.groupBg || colors.primaryIndigo}
                />
              </TouchableOpacity>
            </View>

            {/* Quick WhatsApp Action Buttons */}
            <View style={[styles.avatarModalActions, { borderTopColor: colors.cardBorder }]}>
              <TouchableOpacity
                style={styles.avatarModalActionBtn}
                onPress={() => {
                  const p = selectedAvatarProfile;
                  setSelectedAvatarProfile(null);
                  if (p) navigation.navigate('Chat', { conversationId: p.id, title: p.title });
                }}
              >
                <MessageSquare size={22} color={colors.primaryIndigo} />
                <Text style={[styles.avatarModalActionText, { color: colors.primaryIndigo }]}>
                  Message
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.avatarModalActionBtn}
                onPress={() => {
                  const p = selectedAvatarProfile;
                  setSelectedAvatarProfile(null);
                  if (p) {
                    const session = callService.startCall({
                      targetUserId: (p as any).recipientId || (p as any).participantId || p.title,
                      targetUserName: p.title,
                      targetUserAvatar: p.avatarUrl,
                      callType: 'audio',
                      myUserId: (userProfile as any)?.userId || userProfile?.phone || 'me',
                      myName: userProfile?.name,
                      myAvatar: userProfile?.avatarUrl,
                      conversationId: p.id,
                    });
                    navigation.navigate('Call', {
                      callId: session.callId,
                      targetUserId: p.title,
                      isCaller: true,
                      isVideo: false,
                    });
                  }
                }}
              >
                <Phone size={22} color="#10B981" />
                <Text style={[styles.avatarModalActionText, { color: '#10B981' }]}>Audio</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.avatarModalActionBtn}
                onPress={() => {
                  const p = selectedAvatarProfile;
                  setSelectedAvatarProfile(null);
                  if (p) {
                    const session = callService.startCall({
                      targetUserId: (p as any).recipientId || (p as any).participantId || p.title,
                      targetUserName: p.title,
                      targetUserAvatar: p.avatarUrl,
                      callType: 'video',
                      myUserId: (userProfile as any)?.userId || userProfile?.phone || 'me',
                      myName: userProfile?.name,
                      myAvatar: userProfile?.avatarUrl,
                      conversationId: p.id,
                    });
                    navigation.navigate('Call', {
                      callId: session.callId,
                      targetUserId: p.title,
                      isCaller: true,
                      isVideo: true,
                    });
                  }
                }}
              >
                <Video size={22} color="#8B5CF6" />
                <Text style={[styles.avatarModalActionText, { color: '#8B5CF6' }]}>Video</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.avatarModalActionBtn}
                onPress={() => {
                  const p = selectedAvatarProfile;
                  setSelectedAvatarProfile(null);
                  if (p) setSelectedInfoProfile(p);
                }}
              >
                <Info size={22} color={colors.textSecondary} />
                <Text style={[styles.avatarModalActionText, { color: colors.textSecondary }]}>
                  Info
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 🖼️ WhatsApp Style Fullscreen Profile Photo Viewer */}
      <Modal
        visible={!!selectedFullScreenAvatar}
        transparent={false}
        animationType="fade"
        onRequestClose={() => setSelectedFullScreenAvatar(null)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
          <StatusBar barStyle="light-content" backgroundColor="#000" />
          {(() => {
            const isMyProfile = selectedFullScreenAvatar?.id === 'my_profile';
            const title = isMyProfile
              ? 'My Profile Photo'
              : selectedFullScreenAvatar
                ? getResolvedDisplayName(
                    {
                      username: selectedFullScreenAvatar.username,
                      name: selectedFullScreenAvatar.title,
                      phone: selectedFullScreenAvatar.phone,
                    },
                    selectedFullScreenAvatar.title,
                  )
                : 'Profile Photo';

            return (
              <>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    backgroundColor: '#111',
                  }}
                >
                  <TouchableOpacity
                    onPress={() => setSelectedFullScreenAvatar(null)}
                    style={{ padding: 6 }}
                  >
                    <ArrowLeft size={24} color="#FFF" />
                  </TouchableOpacity>
                  <Text
                    style={{
                      color: '#FFF',
                      fontSize: 17,
                      fontWeight: '700',
                      flex: 1,
                      textAlign: 'center',
                      marginHorizontal: 8,
                    }}
                    numberOfLines={1}
                  >
                    {title}
                  </Text>
                  {isMyProfile ? (
                    <TouchableOpacity
                      onPress={() => {
                        setSelectedFullScreenAvatar(null);
                        navigation.navigate('EditProfile');
                      }}
                      style={{ padding: 6 }}
                    >
                      <Edit2 size={20} color="#38BDF8" />
                    </TouchableOpacity>
                  ) : (
                    <View style={{ width: 36 }} />
                  )}
                </View>
                <View
                  style={{
                    flex: 1,
                    justifyContent: 'center',
                    alignItems: 'center',
                    backgroundColor: '#000',
                    padding: 16,
                  }}
                >
                  <SmartAvatar
                    avatarUrl={selectedFullScreenAvatar?.avatarUrl}
                    name={selectedFullScreenAvatar?.title}
                    username={selectedFullScreenAvatar?.username}
                    size={280}
                    borderRadius={140}
                    groupBg={selectedFullScreenAvatar?.groupBg || colors.primaryIndigo}
                    textColor="#FFF"
                    textStyle={{ fontSize: 96, fontWeight: '800' }}
                  />
                </View>
              </>
            );
          })()}
        </SafeAreaView>
      </Modal>

      {/* 👤 Contact Info Screen Modal (Opened on Info button click) */}
      <Modal
        visible={!!selectedInfoProfile}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setSelectedInfoProfile(null)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
          <StatusBar
            barStyle={themeMode === 'dark' ? 'light-content' : 'dark-content'}
            backgroundColor={colors.bg}
          />
          {/* Header */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 16,
              paddingVertical: 14,
              borderBottomWidth: 1,
              borderBottomColor: colors.cardBorder,
              backgroundColor: colors.surface,
            }}
          >
            <TouchableOpacity onPress={() => setSelectedInfoProfile(null)} style={{ padding: 4 }}>
              <ArrowLeft size={24} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text
              style={{
                fontSize: 18,
                fontWeight: '800',
                color: colors.textPrimary,
              }}
            >
              Contact Info
            </Text>
            <View style={{ width: 32 }} />
          </View>

          <ScrollView
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingTop: 18,
              paddingBottom: 40,
            }}
          >
            {/* Hero */}
            <View style={{ alignItems: 'center', marginBottom: 20 }}>
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => {
                  const p = selectedInfoProfile;
                  setSelectedInfoProfile(null);
                  if (p) setSelectedFullScreenAvatar(p);
                }}
              >
                {selectedInfoProfile?.avatarUrl ? (
                  <Image
                    source={{
                      uri: apiService.getResolvedMediaUrl(selectedInfoProfile.avatarUrl),
                    }}
                    style={{
                      width: 100,
                      height: 100,
                      borderRadius: 50,
                      marginBottom: 12,
                    }}
                    resizeMode="cover"
                  />
                ) : (
                  <View
                    style={{
                      width: 100,
                      height: 100,
                      borderRadius: 50,
                      backgroundColor: selectedInfoProfile?.groupBg || colors.primaryIndigo,
                      justifyContent: 'center',
                      alignItems: 'center',
                      marginBottom: 12,
                    }}
                  >
                    <Text style={{ fontSize: 40, fontWeight: '800', color: '#FFF' }}>
                      {selectedInfoProfile
                        ? (
                            getResolvedDisplayName(
                              {
                                username: selectedInfoProfile.username,
                                name: selectedInfoProfile.title,
                              },
                              selectedInfoProfile.title,
                            )[0] || 'U'
                          ).toUpperCase()
                        : 'U'}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>

              <Text
                style={{
                  fontSize: 22,
                  fontWeight: '800',
                  color: colors.textPrimary,
                  textAlign: 'center',
                }}
              >
                {selectedInfoProfile
                  ? getResolvedDisplayName(
                      {
                        username: selectedInfoProfile.username,
                        name: selectedInfoProfile.title,
                        phone: selectedInfoProfile.phone,
                      },
                      selectedInfoProfile.title,
                    )
                  : ''}
              </Text>

              {selectedInfoProfile?.username ? (
                <Text
                  style={{
                    fontSize: 15,
                    fontWeight: '600',
                    color: colors.primaryIndigo,
                    marginTop: 3,
                  }}
                >
                  {selectedInfoProfile.username.startsWith('@')
                    ? selectedInfoProfile.username
                    : `@${selectedInfoProfile.username}`}
                </Text>
              ) : null}

              {selectedInfoProfile?.phone ? (
                <Text
                  style={{
                    fontSize: 13,
                    color: colors.textSecondary,
                    marginTop: 2,
                  }}
                >
                  {selectedInfoProfile.phone}
                </Text>
              ) : null}

              <Text
                style={{
                  fontSize: 13,
                  fontWeight: '600',
                  color: isUserOnline(selectedInfoProfile?.recipientDbId)
                    ? '#10B981'
                    : colors.textSecondary,
                  marginTop: 6,
                }}
              >
                {isUserOnline(selectedInfoProfile?.recipientDbId) ? 'Online' : 'Offline'}
              </Text>
            </View>

            {/* Action Buttons (Message, Audio, Video) */}
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 12,
                marginBottom: 20,
              }}
            >
              <TouchableOpacity
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingVertical: 12,
                  borderRadius: 14,
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.cardBorder,
                }}
                onPress={() => {
                  const p = selectedInfoProfile;
                  setSelectedInfoProfile(null);
                  if (p)
                    navigation.navigate('Chat', {
                      conversationId: p.id,
                      title: p.title,
                    });
                }}
              >
                <MessageSquare size={18} color={colors.primaryIndigo} style={{ marginRight: 6 }} />
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: '700',
                    color: colors.primaryIndigo,
                  }}
                >
                  Message
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingVertical: 12,
                  borderRadius: 14,
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.cardBorder,
                  marginRight: 10,
                }}
                onPress={() => {
                  const p = selectedInfoProfile;
                  setSelectedInfoProfile(null);
                  if (p) {
                    const session = callService.startCall({
                      targetUserId: (p as any).recipientId || (p as any).participantId || p.title,
                      targetUserName: p.title,
                      targetUserAvatar: p.avatarUrl,
                      callType: 'audio',
                      myUserId: (userProfile as any)?.userId || userProfile?.phone || 'me',
                      myName: userProfile?.name,
                      myAvatar: userProfile?.avatarUrl,
                      conversationId: p.id,
                    });
                    navigation.navigate('Call', {
                      callId: session.callId,
                      targetUserId: p.title,
                      isCaller: true,
                      isVideo: false,
                    });
                  }
                }}
              >
                <Phone size={18} color="#10B981" style={{ marginRight: 6 }} />
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#10B981' }}>Audio</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingVertical: 12,
                  borderRadius: 14,
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.cardBorder,
                }}
                onPress={() => {
                  const p = selectedInfoProfile;
                  setSelectedInfoProfile(null);
                  if (p) {
                    const session = callService.startCall({
                      targetUserId: (p as any).recipientId || (p as any).participantId || p.title,
                      targetUserName: p.title,
                      targetUserAvatar: p.avatarUrl,
                      callType: 'video',
                      myUserId: (userProfile as any)?.userId || userProfile?.phone || 'me',
                      myName: userProfile?.name,
                      myAvatar: userProfile?.avatarUrl,
                      conversationId: p.id,
                    });
                    navigation.navigate('Call', {
                      callId: session.callId,
                      targetUserId: p.title,
                      isCaller: true,
                      isVideo: true,
                    });
                  }
                }}
              >
                <Video size={18} color="#8B5CF6" style={{ marginRight: 6 }} />
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#8B5CF6' }}>Video</Text>
              </TouchableOpacity>
            </View>

            {/* Encryption Verified Card */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                padding: 16,
                borderRadius: 16,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.cardBorder,
                marginBottom: 14,
              }}
            >
              <ShieldCheck size={22} color="#10B981" style={{ marginRight: 12 }} />
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: '700',
                    color: colors.textPrimary,
                  }}
                >
                  Encryption Verified
                </Text>
                <Text
                  style={{
                    fontSize: 12,
                    color: colors.textSecondary,
                    marginTop: 2,
                  }}
                >
                  Messages and calls are end-to-end encrypted.
                </Text>
              </View>
            </View>

            {/* Clear Messages Action */}
            <TouchableOpacity
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                padding: 16,
                borderRadius: 16,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.cardBorder,
                marginBottom: 12,
              }}
              onPress={() => {
                if (selectedInfoProfile) {
                  clearMessages(selectedInfoProfile.id);
                  showToast('Chat cleared', 'info', 1500);
                }
                setSelectedInfoProfile(null);
              }}
            >
              <Eraser size={20} color="#F59E0B" style={{ marginRight: 12 }} />
              <Text
                style={{
                  fontSize: 15,
                  fontWeight: '700',
                  color: colors.textPrimary,
                }}
              >
                Clear Chat Messages
              </Text>
            </TouchableOpacity>

            {/* Delete Chat Action */}
            <TouchableOpacity
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                padding: 16,
                borderRadius: 16,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: 'rgba(239, 68, 68, 0.3)',
              }}
              onPress={() => {
                const p = selectedInfoProfile;
                setSelectedInfoProfile(null);
                if (p) {
                  setSelectedChatForAction(p);
                  setShowDeleteConfirmModal(true);
                }
              }}
            >
              <Trash2 size={20} color="#EF4444" style={{ marginRight: 12 }} />
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#EF4444' }}>
                Delete Entire Chat
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Dynamic Bottom Navigation Bar */}
      <View
        style={[
          styles.bottomBar,
          { backgroundColor: colors.bottomBarBg, borderTopColor: colors.cardBorder },
        ]}
      >
        {[
          { label: 'Chats', icon: MessageSquare },
          { label: 'Calls', icon: Phone },
          { label: 'People', icon: Users },
          { label: 'Settings', icon: SettingsIcon },
        ].map((nav, idx) => {
          const isSelected = selectedBottomNav === idx;
          const IconComponent = nav.icon;
          const activeColor = colors.primaryIndigo;
          const inactiveColor = colors.textSecondary;

          return (
            <TouchableOpacity
              key={nav.label}
              style={styles.navItem}
              onPress={() => handleTabPress(idx)}
            >
              <IconComponent size={22} color={isSelected ? activeColor : inactiveColor} />
              <Text
                style={[
                  styles.navLabel,
                  { color: isSelected ? activeColor : inactiveColor },
                  isSelected && styles.navLabelActive,
                ]}
              >
                {nav.label}
              </Text>
              <View style={[styles.navIndicator, isSelected && styles.navIndicatorActive]} />
            </TouchableOpacity>
          );
        })}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    flex: 1,
  },
  avatarWrapper: {
    position: 'relative',
    marginRight: 12,
  },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  headerAvatarImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  headerAvatarLetter: {
    fontSize: 16,
    fontWeight: '800',
  },
  onlineBadge: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#22C55E',
    borderWidth: 2,
  },
  searchInputWrapper: {
    flex: 1,
    height: 40,
    borderRadius: 20,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 10,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    height: '100%',
    fontSize: 14,
    paddingVertical: 0,
  },
  circleIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  plusIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#6366F1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  filterPill: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 10,
    borderWidth: 1,
  },
  filterPillText: {
    fontSize: 14,
    fontWeight: '500',
  },
  filterPillTextActive: {
    fontWeight: '700',
  },
  listContainer: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 16,
  },
  chatCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 10,
    borderWidth: 1,
  },
  cardAvatarWrapper: {
    position: 'relative',
  },
  cardAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarLetter: {
    fontSize: 18,
    fontWeight: '700',
  },
  onlineBadgeCard: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 11,
    height: 11,
    borderRadius: 5.5,
    backgroundColor: '#22C55E',
    borderWidth: 2,
  },
  offlineBadgeCard: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 11,
    height: 11,
    borderRadius: 5.5,
    borderWidth: 2,
  },
  offlineDotSmall: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    marginLeft: 6,
  },
  cardContent: {
    flex: 1,
    marginLeft: 12,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  cardUsername: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 1,
  },
  cardTime: {
    fontSize: 12,
  },
  cardMenuBtn: {
    padding: 4,
    marginLeft: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardSubtitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  cardSubtitle: {
    fontSize: 14,
    flex: 1,
    marginRight: 8,
  },
  unreadBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#6366F1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  unreadText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFF',
  },
  topHeader: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 10,
  },
  callCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 10,
    borderWidth: 1,
  },
  avatarBox: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  callName: {
    fontSize: 16,
    fontWeight: '700',
  },
  contactHandle: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 1,
  },
  callTime: {
    fontSize: 12,
    marginTop: 2,
  },
  missedTime: {
    fontSize: 12,
    color: '#EF4444',
    marginTop: 2,
  },
  callIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  syncBannerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginHorizontal: 16,
    marginBottom: 10,
    borderWidth: 1,
  },
  peopleSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 44,
    borderWidth: 1,
  },
  clearSearchBtn: {
    padding: 6,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 6,
  },
  clearIconCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 8,
    borderWidth: 1,
  },
  centerBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 14,
  },
  permissionCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
    borderWidth: 1,
  },
  permTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  permDesc: {
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 18,
  },
  grantBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#6366F1',
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 22,
  },
  grantBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
  // People Tab Section & Action Styles
  peopleSectionHeader: {
    marginVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  peopleBadgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 16,
    borderWidth: 1,
  },
  peopleBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 6,
  },
  registeredContactCard: {
    borderWidth: 1.5,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 3,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  activeDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    marginLeft: 6,
  },
  chatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  chatBtnText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700',
  },
  inviteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1.2,
  },
  inviteBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 22,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
  },
  profileAvatarWrapper: {
    position: 'relative',
  },
  profileAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileAvatarImage: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  profileAvatarText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFF',
  },
  cameraBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
  },
  profileName: {
    fontSize: 18,
    fontWeight: '800',
  },
  profileHandle: {
    fontSize: 13,
    fontWeight: '700',
    marginTop: 1,
  },
  profileStatus: {
    fontSize: 12,
    marginTop: 2,
  },
  qrCodeBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Theme Card Styles
  themeCardBox: {
    borderRadius: 20,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
  },
  themeBoxLabel: {
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 10,
    letterSpacing: 0.6,
  },
  themeToggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  themeChoiceBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    borderRadius: 14,
    marginHorizontal: 4,
  },
  themeChoiceText: {
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 6,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 10,
    letterSpacing: 0.6,
    marginLeft: 4,
  },
  settingRowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 10,
    borderWidth: 1,
  },
  settingIconBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingItemTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  settingItemSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  settingIconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  settingSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  bottomBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 24 : 14,
    borderTopWidth: 1,
  },
  navItem: {
    alignItems: 'center',
    flex: 1,
  },
  navLabel: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },
  navLabelActive: {
    fontWeight: '700',
  },
  navIndicator: {
    height: 3,
    width: 0,
    backgroundColor: '#6366F1',
    borderRadius: 2,
    marginTop: 4,
  },
  navIndicatorActive: {
    width: 16,
  },
  emptyChatsContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 36,
    paddingBottom: 40,
  },
  emptyIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1,
  },
  emptyChatsTitle: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 10,
    textAlign: 'center',
  },
  emptyChatsDesc: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 26,
  },
  emptyStartChatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 24,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  emptyStartChatBtnText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
  },
  instaSlideLoaderWrapper: {
    paddingHorizontal: 16,
    overflow: 'hidden',
  },
  instaSlideLoaderPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  instaSlideLoaderText: {
    fontSize: 11,
    fontWeight: '700',
  },
  instaSlideProgressBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    height: 2,
    borderRadius: 1,
  },
  // WhatsApp-style Action Sheet Modal
  actionModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
    padding: 16,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
  },
  actionModalCard: {
    borderRadius: 24,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 10,
  },
  actionModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  actionAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionAvatarText: {
    fontSize: 18,
    fontWeight: '800',
  },
  actionChatTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  actionChatUsername: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  actionDivider: {
    height: 1,
    width: '100%',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
  },
  actionRowText: {
    fontSize: 15,
    fontWeight: '600',
    marginLeft: 14,
  },
  actionCancelBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
  },
  actionCancelText: {
    fontSize: 15,
    fontWeight: '700',
  },
  // Delete Confirmation Modal
  confirmModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  confirmModalCard: {
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
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  confirmModalTitle: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  confirmModalDesc: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 24,
  },
  confirmModalButtons: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
  },
  confirmBtnSecondary: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnSecondaryText: {
    fontSize: 14,
    fontWeight: '700',
  },
  confirmBtnDanger: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  confirmBtnDangerText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
  },
  cardAvatarImage: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  avatarModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  avatarModalCard: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 10,
  },
  avatarModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  avatarModalTitle: {
    fontSize: 17,
    fontWeight: '700',
    flex: 1,
    marginRight: 8,
  },
  avatarModalCloseBtn: {
    padding: 4,
  },
  avatarModalImageContainer: {
    width: '100%',
    height: 280,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarModalImage: {
    width: '100%',
    height: '100%',
  },
  avatarModalPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarModalPlaceholderLetter: {
    fontSize: 84,
    fontWeight: '800',
    color: '#FFF',
  },
  avatarModalActions: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingVertical: 10,
    justifyContent: 'space-around',
  },
  avatarModalActionBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  avatarModalActionText: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },
  directSearchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 14,
    borderWidth: 1.5,
  },
  directSearchIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  directSearchTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  directSearchSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  directSearchBadge: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    marginLeft: 8,
  },
  directSearchBadgeText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
  },
  searchSectionHeader: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginBottom: 8,
    marginTop: 10,
    marginLeft: 4,
  },
  searchLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 6,
    marginBottom: 8,
  },
  emptySearchContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  emptySearchIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    marginBottom: 16,
  },
  emptySearchTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  emptySearchDesc: {
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 280,
  },
});
