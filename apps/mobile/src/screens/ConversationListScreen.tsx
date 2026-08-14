import React, { useState, useEffect, useRef } from 'react';
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
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useChat } from '../context/ChatContext';
import { useTheme } from '../context/ThemeContext';
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
} from 'lucide-react-native';
import {
  fetchDeviceContacts,
  DeviceContact,
  requestContactsPermission,
} from '../services/contactsService';
import { requestAllAppPermissions } from '../services/permissionsService';
import { AppLogo } from '../components/AppLogo';

type Props = NativeStackScreenProps<RootStackParamList, 'MainTabs'>;

export const ConversationListScreen: React.FC<Props> = ({ navigation }) => {
  const { conversations, addConversation, userProfile } = useChat();
  const { themeMode, colors, setThemeMode } = useTheme();

  const [selectedBottomNav, setSelectedBottomNav] = useState<number>(0); // 0: Chats, 1: Calls, 2: People, 3: Settings
  const horizontalScrollRef = useRef<ScrollView>(null);
  const { width: screenWidth } = useWindowDimensions();

  const handleTabPress = (idx: number) => {
    setSelectedBottomNav(idx);
    horizontalScrollRef.current?.scrollTo({ x: idx * screenWidth, animated: true });
  };
  const [selectedFilter, setSelectedFilter] = useState<string>('All'); // 'All', 'Unread'
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Device contacts state for People tab
  const [deviceContacts, setDeviceContacts] = useState<DeviceContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState<boolean>(false);
  const [hasContactsPermission, setHasContactsPermission] = useState<boolean>(false);
  const [peopleSearchQuery, setPeopleSearchQuery] = useState<string>('');

  const loadContacts = async () => {
    setContactsLoading(true);
    const result = await fetchDeviceContacts();
    setHasContactsPermission(result.granted);
    setDeviceContacts(result.contacts);
    setContactsLoading(false);
  };

  useEffect(() => {
    requestAllAppPermissions();
    loadContacts();
  }, []);

  const handleGrantPermission = async () => {
    const granted = await requestContactsPermission();
    if (granted) {
      loadContacts();
    }
  };

  const handleStartChatWithContact = (contactName: string, username?: string) => {
    addConversation(contactName, username);
    navigation.navigate('Chat', { conversationId: `conv_${Date.now()}`, title: contactName });
  };

  const filteredConversations = conversations.filter((item) => {
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

  const filteredPeople = deviceContacts.filter((c) => {
    const q = peopleSearchQuery.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.phone.toLowerCase().includes(q) ||
      (c.username && c.username.toLowerCase().includes(q))
    );
  });

  // 💬 CHATS TAB (Dynamic Pure Deep Black / Light Theme)
  const renderChatsTab = () => (
    <View style={{ flex: 1 }}>
      {/* Top Header Bar */}
      <View style={styles.topHeaderRow}>
        <TouchableOpacity
          style={styles.avatarWrapper}
          onPress={() => setSelectedBottomNav(3)}
        >
          <View style={[styles.headerAvatar, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
            <Text style={[styles.headerAvatarLetter, { color: colors.primaryIndigo }]}>
              {userProfile.name ? userProfile.name[0].toUpperCase() : 'R'}
            </Text>
          </View>
          <View style={[styles.onlineBadge, { borderColor: colors.bg }]} />
        </TouchableOpacity>

        {isSearching ? (
          <View style={[styles.searchInputWrapper, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
            <TextInput
              style={[styles.searchInput, { color: colors.textPrimary }]}
              placeholder="Search by name or @username..."
              placeholderTextColor={colors.textSecondary}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoFocus
            />
          </View>
        ) : (
          <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Chats</Text>
        )}

        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity
            style={[styles.circleIconBtn, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}
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

      {/* Conversation List */}
      <FlatList
        data={filteredConversations}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContainer}
        renderItem={({ item }) => {
          const isUnread = item.unread !== '0';
          const isMuted = item.isMuted === true;

          return (
            <TouchableOpacity
              style={[styles.chatCard, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}
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
                {item.isOnline && <View style={[styles.onlineBadgeCard, { borderColor: colors.surface }]} />}
              </View>

              <View style={styles.cardContent}>
                <View style={styles.cardHeaderRow}>
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text style={[styles.cardTitle, { color: colors.textPrimary }]} numberOfLines={1}>
                      {item.title}
                    </Text>
                    {item.username && (
                      <Text style={[styles.cardUsername, { color: colors.primaryIndigo }]}>
                        {item.username}
                      </Text>
                    )}
                  </View>
                  <Text style={[styles.cardTime, { color: colors.textSecondary }]}>{item.time}</Text>
                </View>

                <View style={styles.cardSubtitleRow}>
                  <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
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
    </View>
  );

  // 📞 CALLS TAB
  const renderCallsTab = () => (
    <View style={{ flex: 1 }}>
      <View style={styles.topHeader}>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Calls</Text>
      </View>

      <View style={styles.filterRow}>
        {['All', 'Missed', 'Contacts'].map((pill, idx) => (
          <TouchableOpacity
            key={pill}
            style={[
              styles.filterPill,
              {
                backgroundColor: idx === 0 ? colors.primaryIndigo : colors.surface,
                borderColor: idx === 0 ? colors.primaryIndigo : colors.cardBorder,
              },
            ]}
          >
            <Text
              style={[
                styles.filterPillText,
                { color: idx === 0 ? '#FFF' : colors.textSecondary },
                idx === 0 && styles.filterPillTextActive,
              ]}
            >
              {pill}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10 }}>
        {[
          { name: 'Alex Morgan', username: '@alex_morgan', time: '↗ 9:30 AM', isMissed: false },
          { name: 'Sara Johnson', username: '@sara_j', time: '❌ Yesterday', isMissed: true },
          { name: 'Michael Smith', username: '@michael_s', time: '↗ Tuesday', isMissed: false },
          { name: 'Emily Davis', username: '@emily_d', time: '↗ Monday', isMissed: false },
        ].map((call, index) => (
          <View
            key={index}
            style={[styles.callCard, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}
          >
            <View style={[styles.avatarBox, { backgroundColor: colors.cardBorder }]}>
              <Text style={[styles.avatarLetter, { color: colors.textPrimary }]}>{call.name[0]}</Text>
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.callName, { color: colors.textPrimary }]}>{call.name}</Text>
              <Text style={[styles.contactHandle, { color: colors.primaryIndigo }]}>{call.username}</Text>
              <Text style={call.isMissed ? styles.missedTime : [styles.callTime, { color: colors.textSecondary }]}>
                {call.time}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.callIconBtn}
              activeOpacity={0.7}
              onPress={() =>
                navigation.navigate('Call', {
                  callId: `call_${index}`,
                  targetUserId: call.name,
                  isCaller: true,
                  isVideo: false,
                })
              }
            >
              <Phone size={18} color={colors.primaryIndigo} />
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    </View>
  );

  // 👥 PEOPLE TAB (Real Phone Contacts Sync + Instagram Username Search)
  const renderPeopleTab = () => (
    <View style={{ flex: 1 }}>
      <View style={styles.topHeaderRow}>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>People</Text>
        <TouchableOpacity
          style={[styles.circleIconBtn, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}
          onPress={loadContacts}
        >
          <RefreshCw size={18} color={colors.primaryIndigo} />
        </TouchableOpacity>
      </View>

      {/* Sync Banner Card */}
      <TouchableOpacity
        style={[styles.syncBannerCard, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}
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
              ? `${deviceContacts.length} contacts synced from phone`
              : 'Tap to sync phone contacts'}
          </Text>
        </View>
      </TouchableOpacity>

      {/* Search Input Bar */}
      {hasContactsPermission && (
        <View style={[styles.peopleSearchBox, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
          <Search size={18} color={colors.textSecondary} style={{ marginRight: 8 }} />
          <TextInput
            style={[styles.searchInput, { color: colors.textPrimary }]}
            placeholder="Search by name, phone or @username..."
            placeholderTextColor={colors.textSecondary}
            value={peopleSearchQuery}
            onChangeText={setPeopleSearchQuery}
          />
        </View>
      )}

      {/* Contacts List or Permission View */}
      {contactsLoading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={colors.primaryIndigo} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Syncing contacts...</Text>
        </View>
      ) : !hasContactsPermission ? (
        <View style={styles.centerBox}>
          <View style={[styles.permissionCircle, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
            <ShieldAlert size={36} color={colors.primaryIndigo} />
          </View>
          <Text style={[styles.permTitle, { color: colors.textPrimary }]}>Contacts Permission Required</Text>
          <Text style={[styles.permDesc, { color: colors.textSecondary }]}>
            Allow chatting system to access your device contacts so you can message your friends.
          </Text>
          <TouchableOpacity style={styles.grantBtn} onPress={handleGrantPermission}>
            <UserPlus size={18} color="#FFF" style={{ marginRight: 8 }} />
            <Text style={styles.grantBtnText}>Allow Contacts Access</Text>
          </TouchableOpacity>
        </View>
      ) : filteredPeople.length === 0 ? (
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
          data={filteredPeople}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 20 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.contactItem, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}
              activeOpacity={0.8}
              onPress={() => handleStartChatWithContact(item.name, item.username)}
            >
              <View style={[styles.avatarBox, { backgroundColor: colors.cardBorder }]}>
                <Text style={[styles.avatarLetter, { color: colors.primaryIndigo }]}>
                  {item.name ? item.name[0].toUpperCase() : '?'}
                </Text>
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.callName, { color: colors.textPrimary }]}>{item.name}</Text>
                <Text style={[styles.contactHandle, { color: colors.primaryIndigo }]}>{item.username}</Text>
                <Text style={[styles.callTime, { color: colors.textSecondary }]}>{item.phone}</Text>
              </View>
              <UserCheck size={18} color={colors.primaryIndigo} />
            </TouchableOpacity>
          )}
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

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 24 }}>
        {/* 👤 Instagram/WhatsApp Style Profile Card */}
        <TouchableOpacity
          style={[styles.profileCard, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('EditProfile')}
        >
          <View style={styles.profileAvatarWrapper}>
            <View style={[styles.profileAvatar, { backgroundColor: colors.primaryIndigo }]}>
              <Text style={styles.profileAvatarText}>
                {userProfile.name ? userProfile.name[0].toUpperCase() : 'R'}
              </Text>
            </View>
            <View style={[styles.cameraBadge, { backgroundColor: colors.primaryIndigo, borderColor: colors.surface }]}>
              <Camera size={11} color="#FFF" />
            </View>
          </View>

          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={[styles.profileName, { color: colors.textPrimary }]}>{userProfile.name}</Text>
            <Text style={[styles.profileHandle, { color: colors.primaryIndigo }]}>{userProfile.username}</Text>
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
        <View style={[styles.themeCardBox, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
          <Text style={[styles.themeBoxLabel, { color: colors.textSecondary }]}>SELECT APP THEME</Text>
          <View style={styles.themeToggleRow}>
            {/* Pure Deep Black Dark Mode Option */}
            <TouchableOpacity
              style={[
                styles.themeChoiceBtn,
                { backgroundColor: themeMode === 'dark' ? colors.primaryIndigo : colors.cardBorder },
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
                { backgroundColor: themeMode === 'light' ? colors.primaryIndigo : colors.cardBorder },
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
        ].map((setting, idx) => {
          const IconComp = setting.icon;
          return (
            <TouchableOpacity
              key={idx}
              style={[styles.settingRowItem, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}
              activeOpacity={0.8}
              onPress={() => navigation.navigate(setting.screen as any)}
            >
              <View style={[styles.settingIconBadge, { backgroundColor: setting.iconBg }]}>
                <IconComp size={20} color={colors.primaryIndigo} />
              </View>
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={[styles.settingItemTitle, { color: colors.textPrimary }]}>{setting.title}</Text>
                <Text style={[styles.settingItemSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
                  {setting.subtitle}
                </Text>
              </View>
              <ChevronRight size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <StatusBar
        barStyle={themeMode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.bg}
      />

      {/* Swipeable Main Tabs Container */}
      <ScrollView
        ref={horizontalScrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={(e) => {
          const pageIndex = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
          if (pageIndex !== selectedBottomNav && pageIndex >= 0 && pageIndex <= 3) {
            setSelectedBottomNav(pageIndex);
          }
        }}
        onMomentumScrollEnd={(e) => {
          const pageIndex = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
          if (pageIndex !== selectedBottomNav && pageIndex >= 0 && pageIndex <= 3) {
            setSelectedBottomNav(pageIndex);
          }
        }}
        style={{ flex: 1 }}
      >
        <View style={{ width: screenWidth, flex: 1 }}>{renderChatsTab()}</View>
        <View style={{ width: screenWidth, flex: 1 }}>{renderCallsTab()}</View>
        <View style={{ width: screenWidth, flex: 1 }}>{renderPeopleTab()}</View>
        <View style={{ width: screenWidth, flex: 1 }}>{renderSettingsTab()}</View>
      </ScrollView>

      {/* Dynamic Bottom Navigation Bar */}
      <View style={[styles.bottomBar, { backgroundColor: colors.bottomBarBg, borderTopColor: colors.cardBorder }]}>
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
    justifyContent: 'center',
    marginRight: 10,
    borderWidth: 1,
  },
  searchInput: {
    fontSize: 14,
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
    height: 42,
    borderWidth: 1,
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
  // Profile Card Styles
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
});
