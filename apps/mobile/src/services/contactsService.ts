import * as Contacts from 'expo-contacts';
import { Share, Platform as RNPlatform } from 'react-native';
import { apiService } from './apiService';

export interface DeviceContact {
  id: string;
  name: string;
  username: string;
  phone: string;
  emails?: string[];
  imageAvailable?: boolean;
  isRegistered?: boolean;
  userId?: string;
  avatarUrl?: string;
  about?: string;
}

/**
 * Request contacts permissions from the user.
 */
export const requestContactsPermission = async (): Promise<boolean> => {
  try {
    const { status } = await Contacts.requestPermissionsAsync();
    return status === 'granted';
  } catch (error) {
    console.warn('Error requesting contacts permission:', error);
    return false;
  }
};

/**
 * Get current contacts permission status.
 */
export const getContactsPermissionStatus = async (): Promise<Contacts.PermissionStatus> => {
  try {
    const { status } = await Contacts.getPermissionsAsync();
    return status;
  } catch (error) {
    console.warn('Error checking contacts permission:', error);
    return Contacts.PermissionStatus.UNDETERMINED;
  }
};

let cachedDeviceContacts: DeviceContact[] | null = null;
let cachedSyncResult: {
  registered: DeviceContact[];
  unregistered: DeviceContact[];
  allSorted: DeviceContact[];
} | null = null;

/**
 * Generate a deterministic, symmetrical 1-on-1 direct conversation ID.
 * Example: getDeterministicConversationId('rohitrv7', 'priya_s') -> 'direct_priya_s_rohitrv7'
 * Both users always get the exact same conversation ID!
 */
export const getDeterministicConversationId = (userA: string, userB: string): string => {
  const cleanA = (userA || 'user_a')
    .replace(/^@+/, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, '_');
  const cleanB = (userB || 'user_b')
    .replace(/^@+/, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, '_');

  const sorted = [cleanA, cleanB].sort();
  return `direct_${sorted[0]}_${sorted[1]}`;
};

/**
 * Resolves contact display name according to user rule:
 * 1. If saved in user's mobile device contacts -> use the saved name.
 * 2. If not saved in mobile contacts -> use the profile name written by the user.
 */
export const getResolvedDisplayName = (
  identifier: { phone?: string; username?: string; userId?: string; name?: string },
  fallbackName?: string,
): string => {
  const contacts = cachedSyncResult?.allSorted || cachedDeviceContacts || [];
  const cleanUsername = (identifier.username || '').replace(/^@+/, '').toLowerCase();
  const cleanPhone = (identifier.phone || '').replace(/\D/g, '').slice(-10);
  const userId = identifier.userId || '';

  // 1. Check user's saved phonebook contacts
  for (const c of contacts) {
    const cPhone = (c.phone || '').replace(/\D/g, '').slice(-10);
    const cUser = (c.username || '').replace(/^@+/, '').toLowerCase();
    if (
      (cleanPhone && cPhone && cleanPhone === cPhone) ||
      (cleanUsername && cUser && cleanUsername === cUser) ||
      (userId && c.userId && userId === c.userId)
    ) {
      if (c.name && c.name.trim() && !/^\d{10,}$/.test(c.name)) {
        return c.name.trim(); // Saved name in user's phone!
      }
    }
  }

  // 2. If not in user's phonebook, use what the user wrote in their profile
  if (identifier.name && identifier.name.trim() && !/^\d{10,}$/.test(identifier.name)) {
    return identifier.name.trim();
  }
  if (fallbackName && fallbackName.trim() && !/^\d{10,}$/.test(fallbackName)) {
    return fallbackName.trim();
  }

  // 3. Fallback to clean username
  if (cleanUsername) {
    return cleanUsername;
  }
  return 'Friend';
};

export const invalidateContactsCache = () => {
  cachedDeviceContacts = null;
  cachedSyncResult = null;
};

/**
 * Fetch contacts list from the user's device (Cached in memory).
 */
export const fetchDeviceContacts = async (
  forceRefresh = false,
): Promise<{
  granted: boolean;
  contacts: DeviceContact[];
}> => {
  if (!forceRefresh && cachedDeviceContacts && cachedDeviceContacts.length > 0) {
    return { granted: true, contacts: cachedDeviceContacts };
  }

  try {
    const { status } = await Contacts.requestPermissionsAsync();
    if (status !== 'granted') {
      return { granted: false, contacts: [] };
    }

    const { data } = await Contacts.getContactsAsync({
      fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails, Contacts.Fields.Image],
      sort: Contacts.SortTypes.FirstName,
    });

    if (data && data.length > 0) {
      const seenPhones = new Set<string>();
      const formatted: DeviceContact[] = [];

      for (const c of data) {
        if (!c.name || !c.name.trim()) continue;
        let primaryPhone = '';
        if (c.phoneNumbers && c.phoneNumbers.length > 0) {
          primaryPhone = (c.phoneNumbers[0].number || c.phoneNumbers[0].digits || '').trim();
        }
        if (!primaryPhone) continue;

        const digits = primaryPhone.replace(/\D/g, '');
        if (digits.length < 7) continue;

        const normalizedPhone = digits.length >= 10 ? digits.slice(-10) : digits;
        if (seenPhones.has(normalizedPhone)) continue;
        seenPhones.add(normalizedPhone);

        const cleanName = (c.name || 'contact').toLowerCase().replace(/[^a-z0-9]/g, '_');
        formatted.push({
          id: c.id || Math.random().toString(),
          name: c.name.trim(),
          username: `@${cleanName}`,
          phone: normalizedPhone,
          emails: c.emails ? (c.emails.map((e) => e.email).filter(Boolean) as string[]) : [],
          isRegistered: false,
        });
      }

      cachedDeviceContacts = formatted;
      return { granted: true, contacts: formatted };
    }
    return { granted: true, contacts: [] };
  } catch (error) {
    console.warn('Error fetching device contacts:', error);
    return { granted: false, contacts: [] };
  }
};

/**
 * Sync phone contacts with server to discover registered app users.
 * Returns contacts sorted with Registered App Users on TOP!
 * Cached in memory to prevent repeated network calls.
 */
export const syncContactsWithServer = async (
  contacts: DeviceContact[],
  token?: string,
  forceRefresh = false,
): Promise<{
  registered: DeviceContact[];
  unregistered: DeviceContact[];
  allSorted: DeviceContact[];
}> => {
  if (!forceRefresh && cachedSyncResult && cachedSyncResult.allSorted.length > 0) {
    return cachedSyncResult;
  }
  if (!contacts || contacts.length === 0) {
    return { registered: [], unregistered: [], allSorted: [] };
  }

  if (!token) {
    return {
      registered: [],
      unregistered: contacts,
      allSorted: contacts,
    };
  }

  const phoneNumbers = contacts
    .map((c) => {
      const d = (c.phone || '').replace(/\D/g, '');
      return d.length >= 10 ? d.slice(-10) : d;
    })
    .filter((p) => p && p.trim().length >= 7);

  const syncResult = await apiService.syncContacts(token, phoneNumbers);

  const registeredPhoneMap = new Map<string, any>();
  for (const regUser of syncResult.registered) {
    const rawDigits = (regUser.phoneNumber || '').replace(/\D/g, '');
    const clean10 = rawDigits.length >= 10 ? rawDigits.slice(-10) : rawDigits;
    if (clean10) {
      registeredPhoneMap.set(clean10, regUser);
    }
    registeredPhoneMap.set(regUser.phoneNumber, regUser);
    registeredPhoneMap.set(rawDigits, regUser);
  }

  const registeredList: DeviceContact[] = [];
  const unregisteredList: DeviceContact[] = [];
  const seenRegisteredUserIds = new Set<string>();
  const seenUnregisteredPhones = new Set<string>();

  for (const contact of contacts) {
    const digits = (contact.phone || '').replace(/\D/g, '');
    const clean10 = digits.length >= 10 ? digits.slice(-10) : digits;

    const matchedUser =
      (clean10 ? registeredPhoneMap.get(clean10) : null) ||
      registeredPhoneMap.get(contact.phone) ||
      registeredPhoneMap.get(digits);

    if (matchedUser) {
      if (!seenRegisteredUserIds.has(matchedUser.id)) {
        seenRegisteredUserIds.add(matchedUser.id);
        const cleanUserHandle = matchedUser.username
          ? `@${matchedUser.username.replace(/^@+/, '')}`
          : contact.username
            ? `@${contact.username.replace(/^@+/, '')}`
            : `@user_${clean10.slice(-4)}`;

        const regContact: DeviceContact = {
          ...contact,
          phone: clean10 || contact.phone,
          isRegistered: true,
          userId: matchedUser.id,
          name: matchedUser.displayName || contact.name,
          username: cleanUserHandle,
          avatarUrl: matchedUser.avatarUrl || undefined,
          about: matchedUser.about || 'Available | Ready to connect',
        };
        registeredList.push(regContact);
      }
    } else {
      if (clean10 && !seenUnregisteredPhones.has(clean10)) {
        seenUnregisteredPhones.add(clean10);
        unregisteredList.push({
          ...contact,
          phone: clean10,
          isRegistered: false,
        });
      }
    }
  }

  // Sort registered alphabetically, then unregistered alphabetically
  registeredList.sort((a, b) => a.name.localeCompare(b.name));
  unregisteredList.sort((a, b) => a.name.localeCompare(b.name));

  const result = {
    registered: registeredList,
    unregistered: unregisteredList,
    allSorted: [...registeredList, ...unregisteredList],
  };

  cachedSyncResult = result;
  return result;
};

/**
 * Invite a contact via native SMS / Share sheet
 */
export const inviteContact = async (phoneNumber: string, contactName: string): Promise<void> => {
  try {
    const inviteMessage = `Hey ${contactName}! Let's connect on this secure, end-to-end encrypted chat & call app. Download it here: https://chat.app/download`;
    await Share.share({
      title: 'Invite to Chat App',
      message: inviteMessage,
    });
  } catch (error) {
    console.warn('Error sharing invite:', error);
  }
};
