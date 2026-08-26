import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  TextInput,
  ActivityIndicator,
  Platform,
  Image,
  BackHandler,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useChat } from '../context/ChatContext';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import {
  ArrowLeft,
  RefreshCw,
  Search,
  ShieldAlert,
  UserPlus,
  MessageSquare,
  Share2,
  Sparkles,
  Users,
  X,
} from 'lucide-react-native';
import {
  fetchDeviceContacts,
  syncContactsWithServer,
  inviteContact,
  DeviceContact,
  requestContactsPermission,
  getDeterministicConversationId,
} from '../services/contactsService';
import { apiService } from '../services/apiService';
import { devInspector } from '../services/devInspectorService';

type Props = NativeStackScreenProps<RootStackParamList, 'Contacts'>;

export const ContactsScreen: React.FC<Props> = ({ navigation }) => {
  const { userProfile, addConversation, isUserOnline } = useChat();
  const { themeMode, colors } = useTheme();
  const { showToast } = useToast();
  const token = useSelector((state: RootState) => state.auth.token);

  const [registeredContacts, setRegisteredContacts] = useState<DeviceContact[]>([]);
  const [unregisteredContacts, setUnregisteredContacts] = useState<DeviceContact[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasPermission, setHasPermission] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const searchInputRef = useRef<TextInput>(null);

  const loadContacts = async (forceRefresh = false) => {
    setIsLoading(true);
    const result = await fetchDeviceContacts(forceRefresh);
    setHasPermission(result.granted);

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
    setIsLoading(false);
  };

  useEffect(() => {
    devInspector.logUi('ContactsScreen', 'mount', 'Select Contact Screen opened');
    loadContacts(false);
    return () => {
      devInspector.logUi('ContactsScreen', 'unmount', 'Select Contact Screen closed');
    };
  }, []);

  const handleStartChat = (contact: DeviceContact) => {
    const myIdentifier = userProfile.username || userProfile.phone || 'me';
    const targetIdentifier = contact.username || contact.phone || contact.userId || contact.name;
    const convId = getDeterministicConversationId(myIdentifier, targetIdentifier);
    addConversation(contact.name, contact.username || contact.phone, convId);
    navigation.navigate('Chat', {
      conversationId: convId,
      title: contact.name,
    });
  };

  const handleInvite = async (contact: DeviceContact) => {
    showToast(`Sending invite to ${contact.name}...`, 'info');
    await inviteContact(contact.phone, contact.name);
  };

  const handleRequestPermission = async () => {
    const granted = await requestContactsPermission();
    if (granted) {
      loadContacts(true);
    }
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

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q || q.length < 2 || !token) {
      setServerSearchResults([]);
      return;
    }

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
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, token, registeredContacts]);

  const query = searchQuery.toLowerCase().trim();

  const filteredRegistered = registeredContacts.filter(
    (c) =>
      c.name.toLowerCase().includes(query) ||
      c.phone.toLowerCase().includes(query) ||
      (c.username && c.username.toLowerCase().includes(query)),
  );

  const filteredUnregistered = unregisteredContacts.filter(
    (c) =>
      c.name.toLowerCase().includes(query) ||
      c.phone.toLowerCase().includes(query) ||
      (c.username && c.username.toLowerCase().includes(query)),
  );

  type ContactListItem =
    | { type: 'header_registered'; count: number }
    | { type: 'contact_registered'; data: DeviceContact }
    | { type: 'header_server'; count: number }
    | {
        type: 'contact_server';
        data: { id: string; name: string; username?: string; about?: string; avatarUrl?: string };
      }
    | { type: 'header_unregistered'; count: number }
    | { type: 'contact_unregistered'; data: DeviceContact };

  const listItems: ContactListItem[] = [];
  if (serverSearchResults.length > 0) {
    listItems.push({ type: 'header_server', count: serverSearchResults.length });
    serverSearchResults.forEach((u) => listItems.push({ type: 'contact_server', data: u }));
  }

  if (filteredRegistered.length > 0) {
    listItems.push({ type: 'header_registered', count: filteredRegistered.length });
    filteredRegistered.forEach((c) => listItems.push({ type: 'contact_registered', data: c }));
  }

  if (filteredUnregistered.length > 0) {
    listItems.push({ type: 'header_unregistered', count: filteredUnregistered.length });
    filteredUnregistered.forEach((c) => listItems.push({ type: 'contact_unregistered', data: c }));
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <StatusBar
        barStyle={themeMode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.bg}
      />

      {/* Top Header Bar */}
      <View style={[styles.header, { borderBottomColor: colors.cardBorder }]}>
        <TouchableOpacity
          style={[styles.backBtn, { backgroundColor: colors.surface }]}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
        >
          <ArrowLeft size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Select Contact</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {hasPermission
              ? `${registeredContacts.length} on app • ${unregisteredContacts.length} to invite`
              : 'Permission required'}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.refreshBtn, { backgroundColor: colors.surface }]}
          onPress={() => loadContacts(true)}
        >
          <RefreshCw size={18} color={colors.primaryIndigo} />
        </TouchableOpacity>
      </View>

      {/* Search Input Bar */}
      {hasPermission && (
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => searchInputRef.current?.focus()}
          style={[
            styles.searchBoxWrapper,
            { backgroundColor: colors.surface, borderColor: colors.cardBorder },
          ]}
        >
          <Search size={18} color={colors.textSecondary} style={{ marginRight: 8 }} />
          <TextInput
            ref={searchInputRef}
            style={[styles.searchInput, { color: colors.textPrimary }]}
            placeholder="Search contacts by name or phone..."
            placeholderTextColor={colors.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
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
      )}

      {/* Body Content */}
      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.primaryIndigo} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Syncing & discovering contacts on app...
          </Text>
        </View>
      ) : !hasPermission ? (
        <View style={styles.centerContainer}>
          <View
            style={[
              styles.permissionIconCircle,
              { backgroundColor: colors.surface, borderColor: colors.cardBorder },
            ]}
          >
            <ShieldAlert size={36} color={colors.primaryIndigo} />
          </View>
          <Text style={[styles.permissionTitle, { color: colors.textPrimary }]}>
            Contacts Access Required
          </Text>
          <Text style={[styles.permissionSubtitle, { color: colors.textSecondary }]}>
            Please grant access to your phone contacts to see who is using the app and who you can
            invite.
          </Text>
          <TouchableOpacity
            style={[styles.grantBtn, { backgroundColor: colors.primaryIndigo }]}
            onPress={handleRequestPermission}
          >
            <UserPlus size={18} color="#FFF" style={{ marginRight: 8 }} />
            <Text style={styles.grantBtnText}>Grant Contacts Permission</Text>
          </TouchableOpacity>
        </View>
      ) : listItems.length === 0 ? (
        <View style={styles.centerContainer}>
          <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>No Contacts Found</Text>
          <Text style={[styles.permissionSubtitle, { color: colors.textSecondary }]}>
            {searchQuery
              ? `No contacts match "${searchQuery}"`
              : 'No contacts found on this device.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={listItems}
          keyExtractor={(item, index) =>
            item.type.startsWith('header_')
              ? `${item.type}_${index}`
              : `${item.type}_${'data' in item ? item.data.id : index}`
          }
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            if (item.type === 'header_registered') {
              return (
                <View style={styles.sectionHeader}>
                  <View
                    style={[
                      styles.badgePill,
                      { backgroundColor: colors.surface, borderColor: colors.primaryIndigo },
                    ]}
                  >
                    <Sparkles size={13} color={colors.primaryIndigo} />
                    <Text style={[styles.badgeText, { color: colors.primaryIndigo }]}>
                      Contacts on App ({item.count})
                    </Text>
                  </View>
                </View>
              );
            }

            if (item.type === 'header_unregistered') {
              return (
                <View style={[styles.sectionHeader, { marginTop: 22 }]}>
                  <View
                    style={[
                      styles.badgePill,
                      { backgroundColor: colors.surface, borderColor: colors.cardBorder },
                    ]}
                  >
                    <Users size={13} color={colors.textSecondary} />
                    <Text style={[styles.badgeText, { color: colors.textSecondary }]}>
                      Invite to Chat ({item.count})
                    </Text>
                  </View>
                </View>
              );
            }

            if (item.type === 'header_server') {
              return (
                <View style={[styles.sectionHeader, { marginTop: 22 }]}>
                  <View
                    style={[
                      styles.badgePill,
                      { backgroundColor: colors.surface, borderColor: '#8B5CF6' },
                    ]}
                  >
                    <Sparkles size={13} color="#8B5CF6" />
                    <Text style={[styles.badgeText, { color: '#8B5CF6' }]}>
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
                    styles.contactCard,
                    styles.registeredCard,
                    { backgroundColor: colors.surface, borderColor: colors.primaryIndigo },
                  ]}
                  activeOpacity={0.85}
                  onPress={() =>
                    handleStartChat({
                      id: user.id,
                      name: user.name,
                      username: user.username,
                      phone: '',
                      isRegistered: true,
                      userId: user.id,
                      avatarUrl: user.avatarUrl,
                    })
                  }
                >
                  {user.avatarUrl ? (
                    <Image
                      source={{ uri: apiService.getResolvedMediaUrl(user.avatarUrl) }}
                      style={styles.avatarImg}
                    />
                  ) : (
                    <View style={[styles.avatar, { backgroundColor: colors.primaryIndigo }]}>
                      <Text style={[styles.avatarLetter, { color: '#FFF' }]}>
                        {user.name ? user.name[0].toUpperCase() : '?'}
                      </Text>
                    </View>
                  )}

                  <View style={{ flex: 1, marginLeft: 14 }}>
                    <View style={styles.nameRow}>
                      <Text style={[styles.contactName, { color: colors.textPrimary }]}>
                        {user.name}
                      </Text>
                      {isUserOnline(user.username) || isUserOnline(user.id) ? (
                        <View style={[styles.activeDot, { backgroundColor: '#10B981' }]} />
                      ) : (
                        <View style={[styles.offlineDotSmall, { backgroundColor: '#475569' }]}>
                          <Text
                            style={{ color: '#FFF', fontSize: 6, fontWeight: '900', lineHeight: 7 }}
                          >
                            ✕
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text
                      style={[styles.contactAbout, { color: colors.primaryIndigo }]}
                      numberOfLines={1}
                    >
                      {user.username
                        ? `@${user.username.replace(/^@+/, '')}`
                        : user.about || 'Registered User'}
                    </Text>
                  </View>

                  {/* Chat Action Button */}
                  <TouchableOpacity
                    style={[styles.chatBtn, { backgroundColor: colors.primaryIndigo }]}
                    onPress={() =>
                      handleStartChat({
                        id: user.id,
                        name: user.name,
                        username: user.username,
                        phone: '',
                        isRegistered: true,
                        userId: user.id,
                        avatarUrl: user.avatarUrl,
                      })
                    }
                  >
                    <MessageSquare size={16} color="#FFF" style={{ marginRight: 5 }} />
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
                    styles.contactCard,
                    styles.registeredCard,
                    { backgroundColor: colors.surface, borderColor: colors.primaryIndigo },
                  ]}
                  activeOpacity={0.85}
                  onPress={() => handleStartChat(contact)}
                >
                  {contact.avatarUrl ? (
                    <Image
                      source={{ uri: apiService.getResolvedMediaUrl(contact.avatarUrl) }}
                      style={styles.avatarImg}
                    />
                  ) : (
                    <View style={[styles.avatar, { backgroundColor: colors.primaryIndigo }]}>
                      <Text style={[styles.avatarLetter, { color: '#FFF' }]}>
                        {contact.name ? contact.name[0].toUpperCase() : '?'}
                      </Text>
                    </View>
                  )}

                  <View style={{ flex: 1, marginLeft: 14 }}>
                    <View style={styles.nameRow}>
                      <Text style={[styles.contactName, { color: colors.textPrimary }]}>
                        {contact.name}
                      </Text>
                      {isUserOnline(contact.username) ||
                      isUserOnline(contact.userId) ||
                      isUserOnline(contact.phone) ||
                      isUserOnline(contact.name) ? (
                        <View style={[styles.activeDot, { backgroundColor: '#10B981' }]} />
                      ) : (
                        <View style={[styles.offlineDotSmall, { backgroundColor: '#475569' }]}>
                          <Text
                            style={{ color: '#FFF', fontSize: 6, fontWeight: '900', lineHeight: 7 }}
                          >
                            ✕
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text
                      style={[styles.contactAbout, { color: colors.primaryIndigo }]}
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
                    onPress={() => handleStartChat(contact)}
                  >
                    <MessageSquare size={16} color="#FFF" style={{ marginRight: 5 }} />
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
                    styles.contactCard,
                    { backgroundColor: colors.surface, borderColor: colors.cardBorder },
                  ]}
                >
                  <View style={[styles.avatar, { backgroundColor: colors.cardBorder }]}>
                    <Text style={[styles.avatarLetter, { color: colors.textSecondary }]}>
                      {contact.name ? contact.name[0].toUpperCase() : '?'}
                    </Text>
                  </View>

                  <View style={{ flex: 1, marginLeft: 14 }}>
                    <Text style={[styles.contactName, { color: colors.textPrimary }]}>
                      {contact.name}
                    </Text>
                    <Text style={[styles.contactPhone, { color: colors.textSecondary }]}>
                      Not on WhatsApp Connect
                    </Text>
                  </View>

                  {/* Invite Button */}
                  <TouchableOpacity
                    style={[styles.inviteBtn, { borderColor: colors.primaryIndigo }]}
                    onPress={() => handleInvite(contact)}
                  >
                    <Share2 size={14} color={colors.primaryIndigo} style={{ marginRight: 5 }} />
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
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  backBtn: {
    padding: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 12,
    marginTop: 1,
  },
  refreshBtn: {
    padding: 8,
    borderRadius: 20,
  },
  searchBoxWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 8,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 44,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    height: '100%',
    fontSize: 14,
    paddingVertical: 0,
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
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
  },
  permissionIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
  },
  permissionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  permissionSubtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  grantBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
  },
  grantBtnText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '600',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  sectionHeader: {
    marginVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  badgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 16,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 6,
  },
  contactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    borderWidth: 1,
  },
  registeredCard: {
    borderWidth: 1.5,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 3,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarImg: {
    width: 46,
    height: 46,
    borderRadius: 23,
  },
  avatarLetter: {
    fontSize: 17,
    fontWeight: '700',
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
  offlineDotSmall: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginLeft: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  contactName: {
    fontSize: 15,
    fontWeight: '700',
  },
  contactAbout: {
    fontSize: 12,
    marginTop: 2,
  },
  contactPhone: {
    fontSize: 11,
    marginTop: 2,
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
});
