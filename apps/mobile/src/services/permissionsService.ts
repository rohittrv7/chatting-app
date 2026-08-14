import * as Contacts from 'expo-contacts';
import * as ImagePicker from 'expo-image-picker';
import { Camera as ExpoCamera } from 'expo-camera';

export interface AppPermissionState {
  contacts: boolean;
  camera: boolean;
  mediaLibrary: boolean;
}

/**
 * Request all primary app permissions at initial launch.
 */
export const requestAllAppPermissions = async (): Promise<AppPermissionState> => {
  try {
    const contactsRes = await Contacts.requestPermissionsAsync();
    const cameraRes = await ExpoCamera.requestCameraPermissionsAsync();
    const mediaRes = await ImagePicker.requestMediaLibraryPermissionsAsync();

    return {
      contacts: contactsRes.status === 'granted',
      camera: cameraRes.status === 'granted',
      mediaLibrary: mediaRes.status === 'granted',
    };
  } catch (error) {
    console.warn('Error requesting app permissions:', error);
    return {
      contacts: false,
      camera: false,
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
