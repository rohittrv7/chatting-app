/**
 * permissionsService.ts
 *
 * Just-In-Time permission helpers.
 *
 * Philosophy: NEVER ask for permissions at app startup.
 * Each helper is called at the exact moment the user invokes the feature that
 * needs it (camera when they tap the photo button, mic when a call starts, etc.)
 *
 * If the OS has permanently denied a permission (canAskAgain = false), we show
 * an Alert that opens the system Settings page so the user can manually allow it.
 */

import { Alert, Linking, Platform } from 'react-native';
import * as Contacts from 'expo-contacts';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { Camera as ExpoCamera } from 'expo-camera';
import { requestRecordingPermissionsAsync, getRecordingPermissionsAsync } from 'expo-audio';

// ─── Utility: open OS settings when a permission is permanently denied ────────

function openSettingsPrompt(permissionName: string): void {
  Alert.alert(
    `${permissionName} Permission Required`,
    `Please enable ${permissionName} access in your device Settings to use this feature.`,
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Open Settings', onPress: () => Linking.openSettings() },
    ],
  );
}

// ─── Camera ──────────────────────────────────────────────────────────────────

/**
 * Request camera permission just-in-time.
 * Shows an explanation alert first on first-request so users understand why.
 * Falls back to Settings prompt if permanently denied.
 */
export const ensureCameraPermission = async (): Promise<boolean> => {
  try {
    const { granted, canAskAgain } = await ExpoCamera.getCameraPermissionsAsync();
    if (granted) return true;

    if (!canAskAgain) {
      openSettingsPrompt('Camera');
      return false;
    }

    const result = await ExpoCamera.requestCameraPermissionsAsync();
    if (!result.granted && !result.canAskAgain) {
      openSettingsPrompt('Camera');
    }
    return result.granted;
  } catch (error) {
    console.warn('[Permissions] Camera check failed:', error);
    return false;
  }
};

// ─── Microphone ───────────────────────────────────────────────────────────────

/**
 * Request microphone permission just-in-time (called when a call is started).
 */
export const ensureMicrophonePermission = async (): Promise<boolean> => {
  try {
    if (Platform.OS === 'android') {
      const { PermissionsAndroid } = require('react-native');
      const androidGranted = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      );
      if (androidGranted) return true;
    }

    const { granted, canAskAgain } = await getRecordingPermissionsAsync();
    if (granted) return true;

    if (!canAskAgain) {
      openSettingsPrompt('Microphone');
      return false;
    }

    const result = await requestRecordingPermissionsAsync();
    if (!result.granted && !result.canAskAgain) {
      openSettingsPrompt('Microphone');
    }
    return result.granted;
  } catch (error) {
    console.warn('[Permissions] Microphone check failed:', error);
    return false;
  }
};

// ─── Contacts ────────────────────────────────────────────────────────────────

/**
 * Request contacts permission just-in-time (called when Sync Contacts is tapped).
 */
export const ensureContactsPermission = async (): Promise<boolean> => {
  try {
    // Check native Android first if on Android
    if (Platform.OS === 'android') {
      const { PermissionsAndroid } = require('react-native');
      const androidGranted = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
      );
      if (androidGranted) return true;
    }

    const { granted, canAskAgain } = await Contacts.getPermissionsAsync();
    if (granted) return true;

    if (!canAskAgain) {
      openSettingsPrompt('Contacts');
      return false;
    }

    const result = await Contacts.requestPermissionsAsync();
    if (!result.granted && !result.canAskAgain) {
      openSettingsPrompt('Contacts');
    }
    return result.granted;
  } catch (error) {
    console.warn('[Permissions] Contacts check failed:', error);
    return false;
  }
};

// ─── Media Library ────────────────────────────────────────────────────────────

/**
 * Request photo/media library permission just-in-time
 * (called when user taps photo picker or save-to-gallery).
 */
export const ensureMediaLibraryPermission = async (writeOnly = true): Promise<boolean> => {
  try {
    console.log(
      '[MediaPermissions] Checking MediaLibrary permission (writeOnly =',
      writeOnly,
      ')...',
    );
    const { granted, canAskAgain, status } = await MediaLibrary.getPermissionsAsync(writeOnly);
    console.log('[MediaPermissions] Current MediaLibrary permission status:', {
      granted,
      canAskAgain,
      status,
    });
    if (granted || status === 'granted') return true;

    if (!canAskAgain) {
      openSettingsPrompt('Photo Library / Gallery');
      return false;
    }

    const result = await MediaLibrary.requestPermissionsAsync(writeOnly);
    console.log('[MediaPermissions] Request MediaLibrary permission result:', {
      granted: result.granted,
      canAskAgain: result.canAskAgain,
      status: result.status,
    });
    if (result.granted || result.status === 'granted') return true;

    if (!result.canAskAgain) {
      openSettingsPrompt('Photo Library / Gallery');
    }
    return false;
  } catch (error) {
    console.warn('[Permissions] Media library check failed, trying ImagePicker fallback:', error);
    try {
      const imgRes = await ImagePicker.requestMediaLibraryPermissionsAsync();
      return imgRes.granted;
    } catch {
      return false;
    }
  }
};

// ─── Notifications ────────────────────────────────────────────────────────────

/**
 * Request notification permission just-in-time.
 * Called after login with a brief delay so the user has context.
 * On Android 13+, also requests POST_NOTIFICATIONS.
 */
export const ensureNotificationPermission = async (): Promise<boolean> => {
  try {
    // Android 13+ POST_NOTIFICATIONS runtime permission
    if (Platform.OS === 'android') {
      try {
        const { PermissionsAndroid } = require('react-native');
        const perm = PermissionsAndroid?.PERMISSIONS?.POST_NOTIFICATIONS;
        if (perm) {
          const current = await PermissionsAndroid.check(perm);
          if (!current) {
            const result = await PermissionsAndroid.request(perm, {
              title: 'Stay notified',
              message:
                'Allow notifications to receive messages, calls, and alerts even when the app is in the background.',
              buttonPositive: 'Allow',
              buttonNegative: 'Not now',
            });
            if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
              openSettingsPrompt('Notifications');
              return false;
            }
            if (result !== PermissionsAndroid.RESULTS.GRANTED) {
              return false;
            }
          }
        }
      } catch (_) {
        // Android < 13 — POST_NOTIFICATIONS doesn't exist
      }
    }

    // expo-notifications permission (iOS primarily, also used on Android)
    let Notifications: any = null;
    try {
      Notifications = require('expo-notifications');
    } catch (_) {
      return true; // expo-notifications not available — not a hard failure
    }

    const { granted, canAskAgain } = await Notifications.getPermissionsAsync();
    if (granted) return true;

    if (!canAskAgain) {
      openSettingsPrompt('Notifications');
      return false;
    }

    const result = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
        allowCriticalAlerts: false,
      },
    });

    if (!result.granted && !result.canAskAgain) {
      openSettingsPrompt('Notifications');
    }
    return result.granted ?? false;
  } catch (error) {
    console.warn('[Permissions] Notification check failed:', error);
    return false;
  }
};
