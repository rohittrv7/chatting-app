import React, { useState, useEffect } from 'react';
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
} from 'lucide-react-native';
import {
  fetchDeviceContacts,
  syncContactsWithServer,
  inviteContact,
  DeviceContact,
  requestContactsPermission,
} from '../services/contactsService';

type Props = NativeStackScreenProps<RootStackParamList, 'Contacts'>;

export const ContactsScreen: React.FC<Props> = ({ navigation }) => {
  const { addConversation } = useChat();
  const { themeMode, colors } = useTheme();
  const { showToast } = useToast();
  const token = useSelector((state: RootState) => state.auth.token);

  const [registeredContacts, setRegisteredContacts] = useState<DeviceContact[]>([]);
  const [unregisteredContacts, setUnregisteredContacts] = useState<DeviceContact[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasPermission, setHasPermission] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  const loadContacts = async () => {
    setIsLoading(true);
    const result = await fetchDeviceContacts();
    setHasPermission(result.granted);

    if (result.granted && result.contacts.length > 0) {
      const syncRes = await syncContactsWithServer(result.contacts, token || undefined);
      setRegisteredContacts(syncRes.registered);
      setUnregisteredContacts(syncRes.unregistered);
    } else {
      setRegisteredContacts([]);
      setUnregisteredContacts([]);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    loadContacts();
  }, [token]);

  const handleStartChat = (contact: DeviceContact) => {
    addConversation(contact.name, contact.username);
    navigation.navigate('Chat', {
      conversationId: `conv_${contact.userId || Date.now()}`,
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
      loadContacts();
    }
  };

  const query = searchQuery.toLowerCase().trim();

  const filteredRegistered = registeredContacts.filter(
    (c) =>
      c.name.toLowerCase().includes(query) ||
      c.phone.toLowerCase().includes(query) ||
      (c.username && c.username.toLowerCase().includes(query)),
  );

  const filteredUnregistered = unregisteredContacts.filter(
    (c) => c.name.toLowerCase().includes(query) || c.phone.toLowerCase().includes(query),
  );

  type ListItem =
    | { type: 'header_registered'; count: number }
    | { type: 'contact_registered'; data: DeviceContact }
    | { type: 'header_unregistered'; count: number }
    | { type: 'contact_unregistered'; data: DeviceContact };

  const listItems: ListItem[] = [];

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

      {/* Header Bar */}
      <View style={[styles.header, { backgroundColor: colors.bg }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ArrowLeft size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Select Contact</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {hasPermission
              ? `${registeredContacts.length} on app • ${unregisteredContacts.length} to invite`
              : 'Permission required'}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.refreshBtn, { backgroundColor: colors.surface }]}
          onPress={loadContacts}
        >
          <RefreshCw size={18} color={colors.primaryIndigo} />
        </TouchableOpacity>
      </View>

      {/* Search Input Bar */}
      {hasPermission && (
        <View
          style={[
            styles.searchBoxWrapper,
            { backgroundColor: colors.surface, borderColor: colors.cardBorder },
          ]}
        >
          <Search size={18} color={colors.textSecondary} style={{ marginRight: 8 }} />
          <TextInput
            style={[styles.searchInput, { color: colors.textPrimary }]}
            placeholder="Search contacts by name or phone..."
            placeholderTextColor={colors.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
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
            item.type === 'header_registered' || item.type === 'header_unregistered'
              ? `${item.type}_${index}`
              : `${item.type}_${item.data.id}`
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
                    <Image source={{ uri: contact.avatarUrl }} style={styles.avatarImg} />
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
                      <View style={[styles.activeDot, { backgroundColor: '#10B981' }]} />
                    </View>
                    <Text
                      style={[styles.contactAbout, { color: colors.textSecondary }]}
                      numberOfLines={1}
                    >
                      {contact.about || 'Available | Ready to connect'}
                    </Text>
                    <Text style={[styles.contactPhone, { color: colors.textSecondary }]}>
                      {contact.phone}
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
                      {contact.phone}
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
    fontSize: 14,
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
