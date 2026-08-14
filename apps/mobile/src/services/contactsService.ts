import * as Contacts from 'expo-contacts';

export interface DeviceContact {
  id: string;
  name: string;
  username: string;
  phone: string;
  emails?: string[];
  imageAvailable?: boolean;
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
      fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails],
      sort: Contacts.SortTypes.FirstName,
    });

    if (data && data.length > 0) {
      const formatted: DeviceContact[] = data
        .filter((c) => c.name && c.name.trim().length > 0)
        .map((c) => {
          let primaryPhone = '';
          if (c.phoneNumbers && c.phoneNumbers.length > 0) {
            primaryPhone = c.phoneNumbers[0].number || c.phoneNumbers[0].digits || '';
          }
          const cleanName = (c.name || 'contact').toLowerCase().replace(/[^a-z0-9]/g, '_');
          return {
            id: c.id || Math.random().toString(),
            name: c.name || 'Unknown Contact',
            username: `@${cleanName}`,
            phone: primaryPhone || 'No phone number',
            emails: c.emails ? (c.emails.map((e) => e.email).filter(Boolean) as string[]) : [],
          };
        });
      return { granted: true, contacts: formatted };
    }
    return { granted: true, contacts: [] };
  } catch (error) {
    console.warn('Error fetching device contacts:', error);
    return { granted: false, contacts: [] };
  }
};
