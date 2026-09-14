import * as Contacts from 'expo-contacts';
import { Share, Platform as RNPlatform, PermissionsAndroid } from 'react-native';
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

export interface ContactsPermissionDetails {
  granted: boolean;
  status: Contacts.PermissionStatus;
  canAskAgain: boolean;
}

/**
 * Check current contacts permission without triggering a prompt to the user.
 * Queries expo-contacts and native PermissionsAndroid (authoritative for Android 6+).
 */
export const getContactsPermissionDetails = async (): Promise<ContactsPermissionDetails> => {
  let isGranted = false;
  let status = Contacts.PermissionStatus.UNDETERMINED;
  let canAskAgain = true;

  try {
    const expoPerm = await Contacts.getPermissionsAsync();
    console.log('[ContactsPermission] Current expo-contacts getPermissionsAsync:', {
      status: expoPerm.status,
      granted: expoPerm.granted,
      canAskAgain: expoPerm.canAskAgain,
    });
    isGranted = expoPerm.granted || expoPerm.status === Contacts.PermissionStatus.GRANTED;
    status = expoPerm.status;
    canAskAgain = expoPerm.canAskAgain !== false;
  } catch (error) {
    console.warn('[ContactsPermission] Error calling Contacts.getPermissionsAsync:', error);
  }

  // On Android, directly check native PackageManager via PermissionsAndroid
  if (RNPlatform.OS === 'android') {
    try {
      const androidGranted = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
      );
      console.log(
        '[ContactsPermission] Android PermissionsAndroid.check READ_CONTACTS:',
        androidGranted,
      );
      if (androidGranted) {
        isGranted = true;
        status = Contacts.PermissionStatus.GRANTED;
      }
    } catch (androidErr) {
      console.warn('[ContactsPermission] PermissionsAndroid.check failed:', androidErr);
    }
  }

  console.log('[ContactsPermission] Final resolved permission status:', {
    granted: isGranted,
    status,
    canAskAgain,
  });

  return { granted: isGranted, status, canAskAgain };
};

/**
 * Request contacts permission just-in-time.
 * First checks if already granted (e.g. granted manually in Android Settings).
 * Falls back to native PermissionsAndroid if Expo doesn't prompt.
 */
export const requestContactsPermissionDetailed = async (): Promise<ContactsPermissionDetails> => {
  console.log('[ContactsPermission] Requesting contacts permission...');
  const current = await getContactsPermissionDetails();
  if (current.granted) {
    console.log('[ContactsPermission] Permission already granted, skipping request prompt.');
    return current;
  }

  let isGranted = false;
  let status = current.status;
  let canAskAgain = current.canAskAgain;

  try {
    const expoResult = await Contacts.requestPermissionsAsync();
    console.log('[ContactsPermission] expo-contacts requestPermissionsAsync result:', {
      status: expoResult.status,
      granted: expoResult.granted,
      canAskAgain: expoResult.canAskAgain,
    });
    isGranted = expoResult.granted || expoResult.status === Contacts.PermissionStatus.GRANTED;
    status = expoResult.status;
    canAskAgain = expoResult.canAskAgain !== false;
  } catch (error) {
    console.warn('[ContactsPermission] Error calling Contacts.requestPermissionsAsync:', error);
  }

  // On Android, if expo didn't grant, try native PermissionsAndroid dialog
  if (!isGranted && RNPlatform.OS === 'android') {
    try {
      const reqRes = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
        {
          title: 'Contacts Permission',
          message: 'WhatsApp Connect needs access to your contacts to let you chat with friends.',
          buttonPositive: 'Allow',
          buttonNegative: 'Deny',
        },
      );
      console.log('[ContactsPermission] PermissionsAndroid.request result:', reqRes);
      if (reqRes === PermissionsAndroid.RESULTS.GRANTED) {
        isGranted = true;
        status = Contacts.PermissionStatus.GRANTED;
      } else if (reqRes === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
        canAskAgain = false;
      }
    } catch (androidErr) {
      console.warn('[ContactsPermission] PermissionsAndroid.request failed:', androidErr);
    }
  }

  console.log('[ContactsPermission] Final requestContactsPermissionDetailed result:', {
    granted: isGranted,
    status,
    canAskAgain,
  });

  return { granted: isGranted, status, canAskAgain };
};

/**
 * Request contacts permissions from the user.
 */
export const requestContactsPermission = async (): Promise<boolean> => {
  const result = await requestContactsPermissionDetailed();
  return result.granted;
};

/**
 * Get current contacts permission status.
 */
export const getContactsPermissionStatus = async (): Promise<Contacts.PermissionStatus> => {
  const result = await getContactsPermissionDetails();
  return result.status;
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
  const resolveHandle = (raw: any): string => {
    if (!raw) return 'user';
    const rawStr = String(raw);
    const clean = rawStr.replace(/^@+/, '').trim();
    const contacts = cachedSyncResult?.allSorted || cachedDeviceContacts || [];
    for (const c of contacts) {
      const cPhone = String(c.phone || '').replace(/\D/g, '');
      const cleanDigits = clean.replace(/\D/g, '');
      if (
        c.username &&
        (String(c.name || '').toLowerCase() === clean.toLowerCase() ||
          (cleanDigits.length >= 7 && cPhone.endsWith(cleanDigits)) ||
          c.userId === clean)
      ) {
        return String(c.username).replace(/^@+/, '').toLowerCase().trim();
      }
    }
    return clean.toLowerCase().replace(/[^a-z0-9]/g, '_');
  };

  const cleanA = resolveHandle(userA);
  const cleanB = resolveHandle(userB);

  const sorted = [cleanA, cleanB].sort();
  return `direct_${sorted[0]}_${sorted[1]}`;
};

/**
 * Resolves full contact details from cached device contacts & sync results
 */
export const getResolvedContact = (identifier: {
  phone?: any;
  username?: any;
  userId?: any;
  name?: any;
}): DeviceContact | null => {
  if (!identifier) return null;
  const contacts = cachedSyncResult?.allSorted || cachedDeviceContacts || [];
  const cleanUsername = String(identifier.username || '')
    .replace(/^@+/, '')
    .toLowerCase();
  const cleanPhone = String(identifier.phone || '')
    .replace(/\D/g, '')
    .slice(-10);
  const userId = String(identifier.userId || '');

  for (const c of contacts) {
    const cPhone = String(c.phone || '')
      .replace(/\D/g, '')
      .slice(-10);
    const cUser = String(c.username || '')
      .replace(/^@+/, '')
      .toLowerCase();
    if (
      (cleanPhone && cPhone && cleanPhone === cPhone) ||
      (cleanUsername && cUser && cleanUsername === cUser) ||
      (userId && c.userId && userId === c.userId)
    ) {
      return c;
    }
  }
  return null;
};

/**
 * Resolves contact display name according to user rule:
 * 1. If saved in user's mobile device contacts -> use the saved phone contact name.
 * 2. If not saved in mobile contacts -> use the profile name written by the user.
 */
export const getResolvedDisplayName = (
  identifier: { phone?: any; username?: any; userId?: any; name?: any },
  fallbackName?: any,
): string => {
  if (!identifier && !fallbackName) return 'Friend';

  const matchedContact = getResolvedContact(identifier);
  if (
    matchedContact &&
    matchedContact.name &&
    typeof matchedContact.name === 'string' &&
    matchedContact.name.trim() &&
    matchedContact.name.trim() !== 'DIRECT' &&
    !/^\d{10,}$/.test(matchedContact.name)
  ) {
    return matchedContact.name.trim(); // 📱 Saved name in user's phone contacts!
  }

  // 2. If not in user's phonebook, use what the user wrote in their profile
  const nameStr = String(identifier?.name || '').trim();
  if (nameStr && nameStr !== 'DIRECT' && !/^\d{10,}$/.test(nameStr)) {
    return nameStr;
  }
  const fallbackStr = String(fallbackName || '').trim();
  if (fallbackStr && fallbackStr !== 'DIRECT' && !/^\d{10,}$/.test(fallbackStr)) {
    return fallbackStr;
  }

  // 3. Fallback to clean username
  const cleanUsername = String(identifier?.username || '')
    .replace(/^@+/, '')
    .trim();
  if (cleanUsername && cleanUsername.toLowerCase() !== 'direct') {
    return cleanUsername;
  }

  // 4. Fallback to phone number if available (exclude raw 13-digit millisecond timestamps)
  const cleanPhone = String(identifier?.phone || '').trim();
  if (cleanPhone && cleanPhone.length >= 7 && !/^\d{13}$/.test(cleanPhone)) {
    return cleanPhone;
  }

  return 'Friend';
};

export const invalidateContactsCache = () => {
  cachedDeviceContacts = null;
  cachedSyncResult = null;
};

/**
 * Fetch contacts list from the user's device (Cached in memory).
 * Uses getContactsPermissionDetails() so it checks both Android native and Expo permission state.
 */
export const fetchDeviceContacts = async (
  forceRefresh = false,
): Promise<{
  granted: boolean;
  contacts: DeviceContact[];
  canAskAgain: boolean;
}> => {
  if (!forceRefresh && cachedDeviceContacts && cachedDeviceContacts.length > 0) {
    console.log('[ContactsSync] Returning cached device contacts:', cachedDeviceContacts.length);
    return { granted: true, contacts: cachedDeviceContacts, canAskAgain: true };
  }

  try {
    const permission = await getContactsPermissionDetails();
    if (!permission.granted) {
      console.log(
        '[ContactsSync] Contacts permission is not granted. Status:',
        permission.status,
        'canAskAgain:',
        permission.canAskAgain,
      );
      return { granted: false, contacts: [], canAskAgain: permission.canAskAgain };
    }

    console.log('[ContactsSync] Permission confirmed granted. Reading contacts from device OS...');
    const { data } = await Contacts.getContactsAsync({
      fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails, Contacts.Fields.Image],
      sort: Contacts.SortTypes.FirstName,
    });

    console.log('[ContactsSync] Raw contacts retrieved from OS:', data ? data.length : 0);

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

      console.log('[ContactsSync] Normalized valid device contacts:', formatted.length);
      cachedDeviceContacts = formatted;
      return { granted: true, contacts: formatted, canAskAgain: true };
    }
    return { granted: true, contacts: [], canAskAgain: true };
  } catch (error) {
    console.warn('[ContactsSync] Error fetching device contacts:', error);
    return { granted: false, contacts: [], canAskAgain: true };
  }
};

/**
 * Sync phone contacts with server to discover registered app users.
 * Returns contacts sorted with Registered App Users on TOP!
 * Cached in memory to prevent repeated network calls.
 */
export const syncContactsWithBackend = async (
  token?: string,
  forceRefresh = false,
): Promise<{
  registered: DeviceContact[];
  unregistered: DeviceContact[];
  allSorted: DeviceContact[];
}> => {
  const { contacts } = await fetchDeviceContacts(forceRefresh);
  return syncContactsWithServer(contacts, token, forceRefresh);
};

let syncInFlightPromise: Promise<{
  registered: DeviceContact[];
  unregistered: DeviceContact[];
  allSorted: DeviceContact[];
}> | null = null;
let lastSyncTimestamp = 0;
const SYNC_CACHE_TTL_MS = 30000; // 30 seconds debounce

export const syncContactsWithServer = async (
  contacts: DeviceContact[],
  token?: string,
  forceRefresh = false,
): Promise<{
  registered: DeviceContact[];
  unregistered: DeviceContact[];
  allSorted: DeviceContact[];
}> => {
  const now = Date.now();
  if (!forceRefresh && cachedSyncResult && now - lastSyncTimestamp < SYNC_CACHE_TTL_MS) {
    console.log('[ContactsSync] Using cached sync result (within 30s TTL)');
    return cachedSyncResult;
  }

  if (syncInFlightPromise) {
    console.log('[ContactsSync] Reusing in-flight sync promise');
    return syncInFlightPromise;
  }

  if (!contacts || contacts.length === 0) {
    console.log('[ContactsSync] No device contacts to sync with server');
    return { registered: [], unregistered: [], allSorted: [] };
  }

  if (!token) {
    console.log('[ContactsSync] No auth token available, cannot sync contacts with server');
    return {
      registered: [],
      unregistered: contacts,
      allSorted: contacts,
    };
  }

  syncInFlightPromise = (async () => {
    try {
      const phoneNumbers = contacts
        .map((c) => {
          const d = (c.phone || '').replace(/\D/g, '');
          return d.length >= 10 ? d.slice(-10) : d;
        })
        .filter((p) => p && p.trim().length >= 7);

      console.log(
        '[ContactsSync] Firing POST /api/v1/auth/contacts/sync with',
        phoneNumbers.length,
        'phone numbers',
      );
      const syncResult = await apiService.syncContacts(token, phoneNumbers);
      console.log('[ContactsSync] POST /api/v1/auth/contacts/sync response received:', {
        registeredCount: syncResult.registered?.length,
        unregisteredCount: syncResult.unregistered?.length,
      });

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

            const isDeviceNameValid =
              contact.name && contact.name.trim() && !/^\d{10,}$/.test(contact.name);
            const resolvedName = isDeviceNameValid
              ? contact.name.trim()
              : matchedUser.displayName || contact.name;

            const regContact: DeviceContact = {
              ...contact,
              phone: clean10 || contact.phone,
              isRegistered: true,
              userId: matchedUser.id,
              name: resolvedName,
              username: cleanUserHandle,
              avatarUrl:
                apiService.getResolvedMediaUrl(matchedUser.avatarUrl) ||
                matchedUser.avatarUrl ||
                undefined,
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

      lastSyncTimestamp = Date.now();
      cachedSyncResult = result;
      return result;
    } finally {
      syncInFlightPromise = null;
    }
  })();

  return syncInFlightPromise;
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
