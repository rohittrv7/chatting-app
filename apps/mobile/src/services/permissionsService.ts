import * as Contacts from 'expo-contacts';
import * as ImagePicker from 'expo-image-picker';
import { Camera as ExpoCamera } from 'expo-camera';
import { Audio } from 'expo-av';

export interface AppPermissionState {
  contacts: boolean;
  camera: boolean;
  microphone: boolean;
  mediaLibrary: boolean;
}

/**
 * Request all primary app permissions at initial launch.
 * (Contacts, Camera, Microphone, and Media Library)
 */
export const requestAllAppPermissions = async (): Promise<AppPermissionState> => {
  try {
    const contactsRes = await Contacts.requestPermissionsAsync().catch(() => ({
      status: 'denied',
    }));
    const cameraRes = await ExpoCamera.requestCameraPermissionsAsync().catch(() => ({
      status: 'denied',
    }));
    const audioRes = await Audio.requestPermissionsAsync().catch(() => ({ status: 'denied' }));
    const mediaRes = await ImagePicker.requestMediaLibraryPermissionsAsync().catch(() => ({
      status: 'denied',
    }));

    return {
      contacts: contactsRes.status === 'granted',
      camera: cameraRes.status === 'granted',
      microphone: audioRes.status === 'granted',
      mediaLibrary: mediaRes.status === 'granted',
    };
  } catch (error) {
    console.warn('Error requesting app permissions:', error);
    return {
      contacts: false,
      camera: false,
      microphone: false,
      mediaLibrary: false,
    };
  }
};

/**
 * Check & request Camera Permission on-demand.
 */
export const ensureCameraPermission = async (): Promise<boolean> => {
  try {
    const statusRes = await ExpoCamera.getCameraPermissionsAsync();
    if (statusRes.granted) return true;

    const reqRes = await ExpoCamera.requestCameraPermissionsAsync();
    return reqRes.granted;
  } catch (error) {
    console.warn('Error checking camera permission:', error);
    return false;
  }
};

/**
 * Check & request Contacts Permission on-demand.
 */
export const ensureContactsPermission = async (): Promise<boolean> => {
  try {
    const statusRes = await Contacts.getPermissionsAsync();
    if (statusRes.granted) return true;

    const reqRes = await Contacts.requestPermissionsAsync();
    return reqRes.granted;
  } catch (error) {
    console.warn('Error checking contacts permission:', error);
    return false;
  }
};

/**
 * Check & request Gallery / Media Library Permission on-demand.
 */
export const ensureMediaLibraryPermission = async (): Promise<boolean> => {
  try {
    const statusRes = await ImagePicker.getMediaLibraryPermissionsAsync();
    if (statusRes.granted) return true;

    const reqRes = await ImagePicker.requestMediaLibraryPermissionsAsync();
    return reqRes.granted;
  } catch (error) {
    console.warn('Error checking media library permission:', error);
    return false;
  }
};
