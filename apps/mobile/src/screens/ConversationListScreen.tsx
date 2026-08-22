import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  ScrollView,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
  BackHandler,
  Animated,
  RefreshControl,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { RootStackParamList } from '../types';
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
} from 'lucide-react-native';
import {
  fetchDeviceContacts,
  syncContactsWithServer,
  inviteContact,
  DeviceContact,
  requestContactsPermission,
} from '../services/contactsService';
import { requestAllAppPermissions } from '../services/permissionsService';
import { AppLogo } from '../components/AppLogo';
import { apiService } from '../services/apiService';
import { devInspector } from '../services/devInspectorService';
import { LogoutConfirmModal } from '../components/LogoutConfirmModal';

type Props = NativeStackScreenProps<RootStackParamList, 'MainTabs'>;

export const ConversationListScreen: React.FC<Props> = ({ navigation }) => {
  const dispatch = useDispatch();
  const { conversations, addConversation, userProfile } = useChat();
  const { themeMode, colors, setThemeMode } = useTheme();
  const { showToast } = useToast();
  const token = useSelector((state: RootState) => state.auth.token);
  const [showLogoutModal, setShowLogoutModal] = useState<boolean>(false);

  const [isRefreshingChats, setIsRefreshingChats] = useState<boolean>(false);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const shimmerAnim = useRef(new Animated.Value(0)).current;

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
    devInspector.logUi('MainTabs', 'tab_switch', `Tab: ${['Chats', 'Calls', 'People', 'Settings'][idx]}`);
  };
  const [selectedFilter, setSelectedFilter] = useState<string>('All'); // 'All', 'Unread'
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [registeredContacts, setRegisteredContacts] = useState<DeviceContact[]>([]);
  const [unregisteredContacts, setUnregisteredContacts] = useState<DeviceContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState<boolean>(false);
  const [hasContactsPermission, setHasContactsPermission] = useState<boolean>(false);
  const [peopleSearchQuery, setPeopleSearchQuery] = useState<string>('');
  const peopleInputRef = useRef<TextInput>(null);
  const chatsInputRef = useRef<TextInput>(null);

  const loadContacts = async (forceRefresh = false) => {
    setContactsLoading(true);
    const result = await fetchDeviceContacts(forceRefresh);
    setHasContactsPermission(result.granted);

    if (result.granted && result.contacts.length > 0) {
      const syncRes = await syncContactsWithServer(result.contacts, token || undefined, forceRefresh);
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
    // Only load contacts once when user first opens People tab
    if (selectedBottomNav === 2 && registeredContacts.length === 0 && !contactsLoading) {
      loadContacts(false);
    }
  }, [selectedBottomNav]);

  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        if (selectedBottomNav !== 0) {
          handleTabPress(0);
          return true;
        }
        return false;
      };

      const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => subscription.remove();
    }, [selectedBottomNav])
  );

  const handleGrantPermission = async () => {
    const granted = await requestContactsPermission();
    if (granted) {
      loadContacts();
    }
  };

  const handleStartChatWithContact = (contact: DeviceContact) => {
    const cleanHandle = (contact.username || contact.phone || contact.name).replace(/^@+/, '');
    const convId = `conv_${contact.userId || cleanHandle}`;
    addConversation(contact.name, contact.username || contact.phone, convId);
    navigation.navigate('Chat', { conversationId: convId, title: contact.name });
  };

  const filteredConversations = useMemo(() => {
    return conversations.filter((item) => {
      if (selectedFilter === 'Unread' && item.unread === '0') return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          item.title.toLowerCase().includes(q) ||
          (item.username && item.username.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [conversations, selectedFilter, searchQuery]);

  const handleInviteContact = async (contact: DeviceContact) => {
    showToast(`Sending invite to ${contact.name}...`, 'info');
    await inviteContact(contact.phone, contact.name);
  };

  const [serverSearchResults, setServerSearchResults] = useState<
    Array<{
      id: string;
      name: string;
      username?: string;
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
        <TouchableOpacity style={styles.avatarWrapper} onPress={() => setSelectedBottomNav(3)}>
          <View
            style={[
              styles.headerAvatar,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            <Text style={[styles.headerAvatarLetter, { color: colors.primaryIndigo }]}>
              {userProfile.name ? userProfile.name[0].toUpperCase() : 'R'}
            </Text>
          </View>
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

      {/* Conversation List */}
      {filteredConversations.length === 0 ? (
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

            return (
              <TouchableOpacity
                style={[
                  styles.chatCard,
                  { backgroundColor: colors.surface, borderColor: colors.cardBorder },
                ]}
                activeOpacity={0.8}
                onPress={() =>
                  navigation.navigate('Chat', { conversationId: item.id, title: item.title })
                }
              >
                <View style={styles.cardAvatarWrapper}>
                  <View
                    style={[
                      styles.cardAvatar,
                      { backgroundColor: item.groupBg || colors.cardBorder },
                    ]}
                  >
                    <Text style={[styles.avatarLetter, { color: colors.primaryIndigo }]}>
                      {item.avatar}
                    </Text>
                  </View>
                  {item.isOnline && (
                    <View style={[styles.onlineBadgeCard, { borderColor: colors.surface }]} />
                  )}
                </View>

                <View style={styles.cardContent}>
                  <View style={styles.cardHeaderRow}>
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <Text
                        style={[styles.cardTitle, { color: colors.textPrimary }]}
                        numberOfLines={1}
                      >
                        {item.title.startsWith('1787') || /^\d{10,}$/.test(item.title)
                          ? (item.username ? item.username.replace(/^@+/, '') : 'Priya Sharma')
                          : item.title}
                      </Text>
                      {item.username && (
                        <Text style={[styles.cardUsername, { color: colors.primaryIndigo }]}>
                          {item.username}
                        </Text>
                      )}
                    </View>
                    <Text style={[styles.cardTime, { color: colors.textSecondary }]}>
                      {item.time}
                    </Text>
                  </View>

                  <View style={styles.cardSubtitleRow}>
                    <Text
                      style={[styles.cardSubtitle, { color: colors.textSecondary }]}
                      numberOfLines={1}
                    >
                      {item.lastMessage}
                    </Text>
                    {isMuted ? (
                      <BellOff size={16} color={colors.textSecondary} />
                    ) : isUnread ? (
                      <View style={styles.unreadBadge}>
                        <Text style={styles.unreadText}>{item.unread}</Text>
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
  const renderCallsTab = () => (
    <View style={{ flex: 1 }}>
      <View style={styles.topHeader}>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Calls</Text>
      </View>

      <View style={styles.emptyChatsContainer}>
        <View
          style={[
            styles.emptyIconCircle,
            { backgroundColor: colors.surface, borderColor: colors.cardBorder },
          ]}
        >
          <PhoneCall size={36} color={colors.primaryIndigo} />
        </View>
        <Text style={[styles.emptyChatsTitle, { color: colors.textPrimary }]}>No Recent Calls</Text>
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
    </View>
  );

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
                      <View style={[styles.activeDot, { backgroundColor: '#10B981' }]} />
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
                  <View style={[styles.avatarBox, { backgroundColor: colors.primaryIndigo }]}>
                    <Text style={[styles.avatarLetter, { color: '#FFF' }]}>
                      {contact.name ? contact.name[0].toUpperCase() : '?'}
                    </Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <View style={styles.nameRow}>
                      <Text
                        style={[styles.callName, { color: colors.textPrimary }]}
                        numberOfLines={1}
                      >
                        {contact.name}
                      </Text>
                      <View style={[styles.activeDot, { backgroundColor: '#10B981' }]} />
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
            <View style={[styles.profileAvatar, { backgroundColor: colors.primaryIndigo }]}>
              <Text style={styles.profileAvatarText}>
                {userProfile.name ? userProfile.name[0].toUpperCase() : 'R'}
              </Text>
            </View>
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
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
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
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0,
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
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#22C55E',
    borderWidth: 2,
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
});
