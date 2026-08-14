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
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useChat } from '../context/ChatContext';
import { useTheme } from '../context/ThemeContext';
import { ArrowLeft, RefreshCw, UserCheck, Search, ShieldAlert, UserPlus } from 'lucide-react-native';
import { fetchDeviceContacts, DeviceContact, requestContactsPermission } from '../services/contactsService';

type Props = NativeStackScreenProps<RootStackParamList, 'Contacts'>;

export const ContactsScreen: React.FC<Props> = ({ navigation }) => {
  const { addConversation } = useChat();
  const { themeMode, colors } = useTheme();

  const [contacts, setContacts] = useState<DeviceContact[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasPermission, setHasPermission] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  const loadContacts = async () => {
    setIsLoading(true);
    const result = await fetchDeviceContacts();
    setHasPermission(result.granted);
    setContacts(result.contacts);
    setIsLoading(false);
  };

  useEffect(() => {
    loadContacts();
  }, []);

  const handleSelectContact = (name: string, username?: string) => {
    addConversation(name, username);
    navigation.navigate('Chat', { conversationId: `conv_${Date.now()}`, title: name });
  };

  const handleRequestPermission = async () => {
    const granted = await requestContactsPermission();
    if (granted) {
      loadContacts();
    }
  };

  const filteredContacts = contacts.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.phone.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.username && c.username.toLowerCase().includes(searchQuery.toLowerCase()))
  );

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
            {hasPermission ? `${contacts.length} device contacts` : 'Permission required'}
          </Text>
        </View>
        <TouchableOpacity style={[styles.refreshBtn, { backgroundColor: colors.surface }]} onPress={loadContacts}>
          <RefreshCw size={18} color={colors.primaryIndigo} />
        </TouchableOpacity>
      </View>

      {/* Search Input Bar with @username search support */}
      {hasPermission && (
        <View style={[styles.searchBoxWrapper, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
          <Search size={18} color={colors.textSecondary} style={{ marginRight: 8 }} />
          <TextInput
            style={[styles.searchInput, { color: colors.textPrimary }]}
            placeholder="Search by name, phone or @username..."
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
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Syncing phone contacts...</Text>
        </View>
      ) : !hasPermission ? (
        <View style={styles.centerContainer}>
          <View style={[styles.permissionIconCircle, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
            <ShieldAlert size={36} color={colors.primaryIndigo} />
          </View>
          <Text style={[styles.permissionTitle, { color: colors.textPrimary }]}>Contacts Access Required</Text>
          <Text style={[styles.permissionSubtitle, { color: colors.textSecondary }]}>
            Please grant access to your phone contacts to see who you can chat and call with.
          </Text>
          <TouchableOpacity style={[styles.grantBtn, { backgroundColor: colors.primaryIndigo }]} onPress={handleRequestPermission}>
            <UserPlus size={18} color="#FFF" style={{ marginRight: 8 }} />
            <Text style={styles.grantBtnText}>Grant Contacts Permission</Text>
          </TouchableOpacity>
        </View>
      ) : filteredContacts.length === 0 ? (
        <View style={styles.centerContainer}>
          <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>No Contacts Found</Text>
          <Text style={[styles.permissionSubtitle, { color: colors.textSecondary }]}>
            {searchQuery
              ? `No contact matches "${searchQuery}"`
              : 'No contacts found on this device.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredContacts}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 24 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.contactCard, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}
              activeOpacity={0.8}
              onPress={() => handleSelectContact(item.name, item.username)}
            >
              <View style={[styles.avatar, { backgroundColor: colors.cardBorder }]}>
                <Text style={[styles.avatarLetter, { color: colors.primaryIndigo }]}>
                  {item.name ? item.name[0].toUpperCase() : '?'}
                </Text>
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.contactName, { color: colors.textPrimary }]}>{item.name}</Text>
                <Text style={[styles.contactUsername, { color: colors.primaryIndigo }]}>{item.username}</Text>
                <Text style={[styles.contactPhone, { color: colors.textSecondary }]}>{item.phone}</Text>
              </View>
              <UserCheck size={18} color={colors.primaryIndigo} />
            </TouchableOpacity>
          )}
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
  contactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 8,
    borderWidth: 1,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarLetter: {
    fontSize: 16,
    fontWeight: '700',
  },
  contactName: {
    fontSize: 15,
    fontWeight: '700',
  },
  contactUsername: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 1,
  },
  contactPhone: {
    fontSize: 12,
    marginTop: 2,
  },
});
