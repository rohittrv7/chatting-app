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

/**
 * Fetch contacts list from the user's device.
 */
export const fetchDeviceContacts = async (): Promise<{
  granted: boolean;
  contacts: DeviceContact[];
}> => {
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

        const normalizedPhone = primaryPhone.startsWith('+')
          ? `+${digits}`
          : digits.length === 10
            ? `+91${digits}`
            : `+${digits}`;
        if (seenPhones.has(normalizedPhone) || seenPhones.has(digits)) continue;
        seenPhones.add(normalizedPhone);
        seenPhones.add(digits);

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
 */
export const syncContactsWithServer = async (
  contacts: DeviceContact[],
  token?: string,
): Promise<{
  registered: DeviceContact[];
  unregistered: DeviceContact[];
  allSorted: DeviceContact[];
}> => {
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

  const phoneNumbers = contacts.map((c) => c.phone).filter((p) => p && p.trim().length > 5);
  const syncResult = await apiService.syncContacts(token, phoneNumbers);

  const registeredPhoneMap = new Map<string, any>();
  for (const regUser of syncResult.registered) {
    const rawDigits = regUser.phoneNumber.replace(/\D/g, '');
    registeredPhoneMap.set(regUser.phoneNumber, regUser);
    registeredPhoneMap.set(rawDigits, regUser);
    registeredPhoneMap.set(`+${rawDigits}`, regUser);
    if (rawDigits.length === 10) {
      registeredPhoneMap.set(`+91${rawDigits}`, regUser);
    }
  }

  const registeredList: DeviceContact[] = [];
  const unregisteredList: DeviceContact[] = [];
  const seenRegisteredUserIds = new Set<string>();
  const seenUnregisteredPhones = new Set<string>();

  for (const contact of contacts) {
    const digits = contact.phone.replace(/\D/g, '');
    const matchedUser =
      registeredPhoneMap.get(contact.phone) ||
      registeredPhoneMap.get(digits) ||
      registeredPhoneMap.get(`+${digits}`) ||
      (digits.length === 10 ? registeredPhoneMap.get(`+91${digits}`) : null);

    if (matchedUser) {
      if (!seenRegisteredUserIds.has(matchedUser.id)) {
        seenRegisteredUserIds.add(matchedUser.id);
        const cleanUserHandle = matchedUser.username
          ? `@${matchedUser.username.replace(/^@+/, '')}`
          : contact.username
            ? `@${contact.username.replace(/^@+/, '')}`
            : `@user_${digits.slice(-4)}`;

        const regContact: DeviceContact = {
          ...contact,
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
      if (digits.length >= 7 && !seenUnregisteredPhones.has(digits)) {
        seenUnregisteredPhones.add(digits);
        unregisteredList.push({
          ...contact,
          isRegistered: false,
        });
      }
    }
  }

  // Sort registered alphabetically, then unregistered alphabetically
  registeredList.sort((a, b) => a.name.localeCompare(b.name));
  unregisteredList.sort((a, b) => a.name.localeCompare(b.name));

  return {
    registered: registeredList,
    unregistered: unregisteredList,
    allSorted: [...registeredList, ...unregisteredList],
  };
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
