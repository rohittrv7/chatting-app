/**
 * notificationService.ts
 *
 * Firebase Cloud Messaging (FCM) push notifications via expo-notifications.
 *
 * Responsibilities:
 *  1. Request push notification permission at app start
 *  2. Get FCM device token and upload it to the backend (stored in Device.fcmToken)
 *  3. Handle foreground notification display
 *  4. Handle notification tap → deep-link to the correct chat screen
 *  5. Handle background/killed app notification tap via getLastNotificationResponseAsync
 *
 * Architecture:
 *  - Expo-notifications handles both Android (FCM) and iOS (APNs) tokens.
 *  - The backend push-notification.service.ts reads Device.fcmToken and sends via FCM REST API.
 *  - For Android, a notification channel is created (required for Android 8.0+).
 */

import { Platform } from 'react-native';
import { safeStorage } from './storageHelper';
import { apiService } from './apiService';
import { ensureNotificationPermission } from './permissionsService';

// Lazy-load expo-notifications to avoid crash on devices without Google Play Services
let Notifications: any = null;
try {
  Notifications = require('expo-notifications');
} catch (_) {
  console.warn('⚠️ [NotificationService] expo-notifications not available');
}

const FCM_TOKEN_STORAGE_KEY = '@chat_fcm_token';
const FCM_TOKEN_LAST_UPLOAD_KEY = '@chat_fcm_token_uploaded_at';

// How often to re-upload the token to the backend (24 hours)
const TOKEN_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

type NavigateCallback = (screen: string, params: Record<string, any>) => void;
let _navigateCallback: NavigateCallback | null = null;
let _notificationSubscription: any = null;
let _responseSubscription: any = null;

export const notificationService = {
  /**
   * Register a navigation callback so notification taps can deep-link.
   * Call this once from your root navigator after it is mounted.
   */
  setNavigationHandler(cb: NavigateCallback): void {
    _navigateCallback = cb;
  },

  /**
   * Register background FCM data message handler.
   * MUST be called at module-level (outside React components) so it's registered
   * before the app fully boots — Firebase requires this to handle killed-app pushes.
   *
   * For data-only messages (type=INCOMING_CALL), this handler triggers a local
   * notification so the user sees the call UI even when the app is completely closed.
   */
  registerBackgroundHandler(): void {
    if (!Notifications) return;
    try {
      // expo-notifications background task for data-only pushes
      // When app is killed and a high-priority data message arrives, this fires
      Notifications.addNotificationReceivedListener?.((notification: any) => {
        const data = notification?.request?.content?.data || {};
        if (data.type === 'INCOMING_CALL') {
          console.log('🔔 [BG] Incoming call push received in background:', data.callId);
          // Schedule a local notification so the call shows even if socket is dead
          Notifications.scheduleNotificationAsync?.({
            content: {
              title: `📞 Incoming ${data.callType === 'video' ? 'Video' : 'Voice'} Call`,
              body: `${data.callerName} is calling you`,
              sound: 'default',
              data,
              categoryIdentifier: 'incoming_call',
            },
            trigger: null, // fire immediately
          }).catch(() => {});
        }
      });
    } catch (err) {
      console.warn('[NotificationService] registerBackgroundHandler error:', err);
    }
  },

  /**
   * Main entry point — call once after the user is logged in.
   * 1. Requests permission
   * 2. Gets FCM token
   * 3. Uploads token to backend
   * 4. Sets up foreground handler + tap handler
   */
  async init(token: string): Promise<string | null> {
    if (!Notifications) return null;

    // Configure how notifications appear when the app is in the foreground
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });

    // Android: create a high-priority notification channel for calls
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('call_channel', {
        name: 'Incoming Calls',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 500, 250, 500],
        lightColor: '#10B981',
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        bypassDnd: true,
        sound: 'default',
      }).catch(() => {});

      await Notifications.setNotificationChannelAsync('message_channel', {
        name: 'Messages',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 200],
        lightColor: '#6366F1',
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        sound: 'default',
      }).catch(() => {});
    }

    const fcmToken = await this._requestPermissionAndGetToken();
    if (fcmToken) {
      await this._uploadTokenIfNeeded(token, fcmToken);
    }

    // Remove old subscriptions before adding new ones (prevent duplicate handlers on re-init)
    this.cleanup();

    // Foreground notification listener — show in-app notification banner
    _notificationSubscription = Notifications.addNotificationReceivedListener(
      (notification: any) => {
        const data = notification?.request?.content?.data || {};
        console.log('🔔 [NotificationService] Foreground notification received:', data.type);
        // Foreground handling is done by the app UI itself (chat screen shows message,
        // IncomingCallModal shows call UI) — no extra action needed here
      },
    );

    // Notification tap handler — deep-link to the right screen
    _responseSubscription = Notifications.addNotificationResponseReceivedListener(
      (response: any) => {
        this._handleNotificationTap(response);
      },
    );

    // Check if the app was opened from a killed state via notification tap
    Notifications.getLastNotificationResponseAsync()
      .then((response: any) => {
        if (response) {
          // Small delay to let the navigator mount
          setTimeout(() => this._handleNotificationTap(response), 800);
        }
      })
      .catch(() => {});

    return fcmToken;
  },

  /**
   * Handle a notification tap and navigate to the correct screen.
   */
  _handleNotificationTap(response: any): void {
    if (!_navigateCallback) return;
    const data = response?.notification?.request?.content?.data || {};
    const type = data.type as string;

    console.log('🔔 [NotificationService] Notification tapped, type:', type, 'data:', data);

    if (type === 'NEW_MESSAGE' && data.conversationId) {
      _navigateCallback('Chat', {
        conversationId: data.conversationId,
        title: data.senderName || 'Chat',
        recipientDbId: data.senderId || '',
        avatarUrl: data.senderAvatar || undefined,
      });
    } else if (type === 'INCOMING_CALL' && data.callId) {
      // For incoming calls, navigate to the Call screen
      // The socket should already have delivered call:incoming by this point
      // If not (app was killed), open the ConversationList as fallback
      if (data.conversationId) {
        _navigateCallback('Chat', {
          conversationId: data.conversationId,
          title: data.callerName || 'Incoming Call',
          recipientDbId: data.callerId || '',
        });
      }
    }
  },

  /**
   * Request notification permission JIT and return the device push token.
   * Delegates permission logic to ensureNotificationPermission() which handles
   * Android 13+, iOS, and the "permanently denied → open Settings" flow.
   */
  async _requestPermissionAndGetToken(): Promise<string | null> {
    if (!Notifications) return null;
    try {
      const granted = await ensureNotificationPermission();
      if (!granted) {
        console.log('🔔 [NotificationService] Notification permission not granted');
        return null;
      }

      let tokenData: any = null;
      try {
        tokenData = await Notifications.getDevicePushTokenAsync();
      } catch (tokenErr: any) {
        const msg = tokenErr?.message || String(tokenErr);
        if (
          msg.includes('google-services') ||
          msg.includes('GoogleService') ||
          msg.includes('Firebase') ||
          msg.includes('FCM')
        ) {
          console.warn(
            '🔔 [NotificationService] Firebase not configured — push notifications disabled.\n' +
              'Add google-services.json (Android) / GoogleService-Info.plist (iOS) to enable FCM.',
          );
        } else {
          console.warn('⚠️ [NotificationService] Failed to get device push token:', tokenErr);
        }
        return null;
      }

      const fcmToken = tokenData?.data as string | undefined;
      if (fcmToken) {
        await safeStorage.setItem(FCM_TOKEN_STORAGE_KEY, fcmToken);
        console.log('🔔 [NotificationService] FCM token:', fcmToken.substring(0, 20) + '...');
      }
      return fcmToken || null;
    } catch (err) {
      console.warn('⚠️ [NotificationService] Failed to get push token:', err);
      return null;
    }
  },

  /**
   * Upload FCM token to backend (throttled: at most once per 24h or if token changed).
   */
  async _uploadTokenIfNeeded(authToken: string, fcmToken: string): Promise<void> {
    try {
      const lastUploadedToken = await safeStorage.getItem(FCM_TOKEN_STORAGE_KEY + '_uploaded');
      const lastUploadTime = await safeStorage.getItem(FCM_TOKEN_LAST_UPLOAD_KEY);
      const now = Date.now();

      const tokenChanged = lastUploadedToken !== fcmToken;
      const uploadExpired =
        !lastUploadTime || now - parseInt(lastUploadTime, 10) > TOKEN_REFRESH_INTERVAL_MS;

      if (!tokenChanged && !uploadExpired) {
        console.log('🔔 [NotificationService] FCM token already uploaded, skipping');
        return;
      }

      await apiService.updateFcmToken(authToken, fcmToken);
      await safeStorage.setItem(FCM_TOKEN_STORAGE_KEY + '_uploaded', fcmToken);
      await safeStorage.setItem(FCM_TOKEN_LAST_UPLOAD_KEY, now.toString());
      console.log('🔔 [NotificationService] FCM token uploaded to backend');
    } catch (err) {
      console.warn('⚠️ [NotificationService] Failed to upload FCM token:', err);
    }
  },

  /**
   * Remove all notification listeners. Call on logout.
   */
  cleanup(): void {
    if (_notificationSubscription) {
      try {
        _notificationSubscription.remove();
      } catch (_) {}
      _notificationSubscription = null;
    }
    if (_responseSubscription) {
      try {
        _responseSubscription.remove();
      } catch (_) {}
      _responseSubscription = null;
    }
  },

  /**
   * Clear app badge count (iOS).
   */
  async clearBadge(): Promise<void> {
    if (!Notifications) return;
    try {
      await Notifications.setBadgeCountAsync(0);
    } catch (_) {}
  },
};
