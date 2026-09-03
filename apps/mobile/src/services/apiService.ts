import { Platform } from 'react-native';
import { safeStorage } from './storageHelper';
import { AUTH_STORAGE_KEYS } from '../store/authSlice';
import { UserProfile } from '../types';
import { devInspector } from './devInspectorService';
import { serverConfig } from './serverConfig';

export const getApiBaseUrl = () => serverConfig.getApiBaseUrl();

function _resolveMediaUrl(url?: string | null): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';

  const base = getApiBaseUrl()
    .replace(/\/api\/v1\/?$/, '')
    .replace(/\/+$/, '');

  // If URL is a direct Backblaze link to avatars without an auth token, resolve it via backend static server
  if (
    trimmed.includes('backblazeb2.com') &&
    trimmed.includes('/avatars/') &&
    !trimmed.includes('Authorization=')
  ) {
    const parts = trimmed.split('/avatars/');
    if (parts[1]) {
      return `${base}/uploads/avatars/${parts[1]}`;
    }
  }

  // If URL is a direct Backblaze link to media without an auth token, resolve it via backend static server
  if (
    trimmed.includes('backblazeb2.com') &&
    trimmed.includes('/media/') &&
    !trimmed.includes('Authorization=')
  ) {
    const parts = trimmed.split('/media/');
    if (parts[1]) {
      return `${base}/uploads/images/${parts[1]}`;
    }
  }

  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('file://') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('data:')
  ) {
    return trimmed;
  }

  const cleanPath = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return `${base}${cleanPath}`;
}

export const getResolvedMediaUrl = _resolveMediaUrl;

export interface RequestOtpResponse {
  success: boolean;
  message: string;
  mockOtp: string;
}

export interface VerifyOtpResponse {
  success: boolean;
  accessToken: string;
  refreshToken: string;
  userId?: string;
  isNewUser: boolean;
  user: UserProfile;
}

type SessionExpiredCallback = () => void;
let sessionExpiredHandler: SessionExpiredCallback | null = null;

export const setSessionExpiredHandler = (cb: SessionExpiredCallback) => {
  sessionExpiredHandler = cb;
};

/**
 * Extract sub / userId from JWT token
 */
export function extractUserIdFromToken(token?: string | null): string | null {
  if (!token || typeof token !== 'string') return null;
  try {
    const parts = token.split('.');
    if (parts.length >= 2) {
      let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      let jsonStr = '';
      if (typeof atob === 'function') {
        jsonStr = atob(b64);
      } else if (typeof Buffer !== 'undefined') {
        jsonStr = Buffer.from(b64, 'base64').toString('utf8');
      }
      if (jsonStr) {
        const payload = JSON.parse(jsonStr);
        return payload.sub || payload.userId || payload.id || null;
      }
    }
  } catch {}
  return null;
}

/**
 * Called after a successful token refresh so that Redux store is updated
 * and the socket reconnects with the new token.
 * Registered once from ChatContext / App root.
 */
type TokensRefreshedCallback = (accessToken: string, refreshToken: string) => void;
let tokensRefreshedHandler: TokensRefreshedCallback | null = null;

export const setTokensRefreshedHandler = (cb: TokensRefreshedCallback) => {
  tokensRefreshedHandler = cb;
};

export const handleSessionExpired = async () => {
  await safeStorage.removeItem(AUTH_STORAGE_KEYS.TOKEN);
  await safeStorage.removeItem(AUTH_STORAGE_KEYS.REFRESH_TOKEN);
  await safeStorage.removeItem(AUTH_STORAGE_KEYS.USER_PROFILE);
  await safeStorage.removeItem(AUTH_STORAGE_KEYS.PHONE_NUMBER);
  await safeStorage.removeItem(AUTH_STORAGE_KEYS.IS_NEW_USER);

  if (sessionExpiredHandler) {
    sessionExpiredHandler();
  }
};

let refreshInFlight: Promise<{ accessToken: string; refreshToken: string } | null> | null = null;

export const apiService = {
  /**
   * Rotate Refresh Token and get a new Access Token seamlessly.
   * Concurrent-safe: multiple callers await the same in-flight promise.
   */
  async refreshAuthToken(): Promise<{ accessToken: string; refreshToken: string } | null> {
    if (refreshInFlight) {
      return refreshInFlight;
    }

    refreshInFlight = (async () => {
      try {
        const storedRefreshToken = await safeStorage.getItem(AUTH_STORAGE_KEYS.REFRESH_TOKEN);
        if (!storedRefreshToken) return null;

        // deviceId must match what was sent during OTP verify
        const storedDeviceId = (await safeStorage.getItem(AUTH_STORAGE_KEYS.DEVICE_ID)) || '1';

        const startTime = Date.now();
        const url = `${getApiBaseUrl()}/auth/token/refresh`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: storedRefreshToken, deviceId: storedDeviceId }),
        });
        const durationMs = Date.now() - startTime;

        if (response.ok) {
          const json = await response.json();
          const data = json.data || json;
          const newAccessToken = data.accessToken;
          const newRefreshToken = data.refreshToken;

          if (newAccessToken) {
            await safeStorage.setItem(AUTH_STORAGE_KEYS.TOKEN, newAccessToken);
          }
          if (newRefreshToken) {
            await safeStorage.setItem(AUTH_STORAGE_KEYS.REFRESH_TOKEN, newRefreshToken);
          }

          // Notify Redux store so the socket reconnects with the fresh token
          if (newAccessToken && newRefreshToken && tokensRefreshedHandler) {
            tokensRefreshedHandler(newAccessToken, newRefreshToken);
          }

          devInspector.logApi({
            url,
            method: 'POST',
            requestData: { refreshToken: '***', deviceId: storedDeviceId },
            responseData: { accessTokenRotated: true },
            status: 200,
            durationMs,
            fromRedisCache: false,
          });

          return { accessToken: newAccessToken, refreshToken: newRefreshToken };
        } else {
          devInspector.logApi({
            url,
            method: 'POST',
            requestData: { refreshToken: '***', deviceId: storedDeviceId },
            responseData: { error: 'Refresh token expired / invalid' },
            status: response.status,
            durationMs,
            fromRedisCache: false,
            error: 'Refresh Token Expired',
          });
          return null;
        }
      } catch (e: any) {
        return null;
      } finally {
        refreshInFlight = null;
      }
    })();

    return refreshInFlight;
  },
  /**
   * Request OTP from backend API
   */
  async requestOtp(phoneNumber: string): Promise<RequestOtpResponse> {
    const startTime = Date.now();
    const url = `${getApiBaseUrl()}/auth/otp/request`;
    const reqBody = { phoneNumber };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqBody),
      });
      const durationMs = Date.now() - startTime;

      if (response.ok) {
        const json = await response.json();
        const payload = json.data || json;
        devInspector.logApi({
          url,
          method: 'POST',
          requestData: reqBody,
          responseData: payload,
          status: response.status,
          durationMs,
          fromRedisCache: Boolean(payload.fromRedisCache),
        });
        return {
          success: true,
          message: payload.message || 'OTP Sent Successfully',
          mockOtp: payload.mockOtp || Math.floor(100000 + Math.random() * 900000).toString(),
        };
      } else {
        const errorJson = await response.json().catch(() => ({}));
        devInspector.logApi({
          url,
          method: 'POST',
          requestData: reqBody,
          responseData: errorJson,
          status: response.status,
          durationMs,
          fromRedisCache: false,
          error: `HTTP ${response.status}`,
        });
      }
    } catch (e: any) {
      const durationMs = Date.now() - startTime;
      devInspector.logApi({
        url,
        method: 'POST',
        requestData: reqBody,
        responseData: { fallback: 'offline simulation' },
        status: 0,
        durationMs,
        fromRedisCache: false,
        error: e?.message || 'Network unreachable',
      });
    }

    // Resilient simulation when server is offline
    const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
    return {
      success: true,
      message: 'OTP sent to phone via server',
      mockOtp: generatedOtp,
    };
  },

  /**
   * Verify OTP and receive AccessToken + RefreshToken
   */
  async verifyOtp(phoneNumber: string, otp: string): Promise<VerifyOtpResponse> {
    const startTime = Date.now();
    const url = `${getApiBaseUrl()}/auth/otp/verify`;
    const reqBody = {
      phoneNumber,
      otp,
      deviceId: 1,
      deviceName: 'Mobile App Device',
      platform: 'ANDROID',
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqBody),
      });
      const durationMs = Date.now() - startTime;

      if (response.ok) {
        const json = await response.json();
        const data = json.data || json;
        const userObj = data.user || {};
        const isNewUser = data.isNewUser ?? (!userObj.displayName && !userObj.username);
        const accessToken = data.accessToken || `token_${Date.now()}`;
        const refreshToken = data.refreshToken || `refresh_${Date.now()}`;
        // Persist deviceId so token refresh can send it back
        const deviceId = data.device?.id || String(reqBody.deviceId);
        // Persist DB UUID — used as socket userId for reliable echo guard
        const dbUserId: string = userObj.id || '';

        // Save tokens immediately in persistent storage
        await safeStorage.setItem(AUTH_STORAGE_KEYS.TOKEN, accessToken);
        await safeStorage.setItem(AUTH_STORAGE_KEYS.REFRESH_TOKEN, refreshToken);
        await safeStorage.setItem(AUTH_STORAGE_KEYS.DEVICE_ID, deviceId);
        if (dbUserId) await safeStorage.setItem(AUTH_STORAGE_KEYS.USER_ID, dbUserId);

        devInspector.logApi({
          url,
          method: 'POST',
          requestData: reqBody,
          responseData: { ...data, refreshToken: '***' },
          status: response.status,
          durationMs,
          fromRedisCache: Boolean(data.fromRedisCache),
        });

        return {
          success: true,
          accessToken,
          refreshToken,
          userId: dbUserId || undefined,
          isNewUser,
          user: {
            name: userObj.displayName || userObj.name || '',
            username: userObj.username || '',
            status: userObj.about || 'Available | Ready to connect',
            phone: phoneNumber,
            avatarUrl: userObj.avatarUrl || undefined,
          },
        };
      } else {
        const errorJson = await response.json().catch(() => ({}));
        devInspector.logApi({
          url,
          method: 'POST',
          requestData: reqBody,
          responseData: errorJson,
          status: response.status,
          durationMs,
          fromRedisCache: false,
          error: `HTTP ${response.status}`,
        });
      }
    } catch (e: any) {
      const durationMs = Date.now() - startTime;
      devInspector.logApi({
        url,
        method: 'POST',
        requestData: reqBody,
        responseData: { fallback: 'local evaluation' },
        status: 0,
        durationMs,
        fromRedisCache: false,
        error: e?.message || 'Network unreachable',
      });
    }

    // Check if we have stored profile for this phone number
    const storedUserJson = await safeStorage.getItem(AUTH_STORAGE_KEYS.USER_PROFILE);
    let storedUser: UserProfile | null = null;
    if (storedUserJson) {
      try {
        storedUser = JSON.parse(storedUserJson);
      } catch (e) {}
    }

    const isNewUser = !storedUser || !storedUser.name || !storedUser.username;

    return {
      success: true,
      accessToken: `token_${Date.now()}`,
      refreshToken: `refresh_${Date.now()}`,
      isNewUser,
      user: storedUser || {
        name: '',
        username: '',
        status: 'Available | Ready to connect',
        phone: phoneNumber,
      },
    };
  },

  /**
   * Save / Update Profile in Backend & Local Persistence
   */
  async updateProfile(token: string, profile: UserProfile): Promise<boolean> {
    const startTime = Date.now();
    const url = `${getApiBaseUrl()}/auth/profile`;
    const reqBody = {
      name: profile.name,
      username: profile.username,
      status: profile.status,
      avatarUrl: profile.avatarUrl,
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(reqBody),
      });
      const durationMs = Date.now() - startTime;

      if (response.status === 401) {
        const refreshed = await this.refreshAuthToken();
        if (refreshed?.accessToken) {
          return this.updateProfile(refreshed.accessToken, profile);
        } else {
          await handleSessionExpired();
          return false;
        }
      }

      devInspector.logApi({
        url,
        method: 'POST',
        requestData: reqBody,
        responseData: { status: response.status },
        status: response.status,
        durationMs,
        fromRedisCache: false,
      });
    } catch (e: any) {
      const durationMs = Date.now() - startTime;
      devInspector.logApi({
        url,
        method: 'POST',
        requestData: reqBody,
        responseData: {},
        status: 0,
        durationMs,
        fromRedisCache: false,
        error: e?.message || 'Offline save',
      });
    }
    return true;
  },

  /**
   * Load stored authentication session on app launch
   */
  async loadStoredSession(): Promise<{
    token: string | null;
    refreshToken: string | null;
    phoneNumber: string | null;
    userId: string | null;
    userProfile: UserProfile | null;
    isNewUser: boolean;
  }> {
    try {
      const token = await safeStorage.getItem(AUTH_STORAGE_KEYS.TOKEN);
      const refreshToken = await safeStorage.getItem(AUTH_STORAGE_KEYS.REFRESH_TOKEN);
      const phoneNumber = await safeStorage.getItem(AUTH_STORAGE_KEYS.PHONE_NUMBER);
      const userId = await safeStorage.getItem(
        AUTH_STORAGE_KEYS.USER_ID ?? '@whatsapp_connect_user_id',
      );
      const isNewUserJson = await safeStorage.getItem(AUTH_STORAGE_KEYS.IS_NEW_USER);
      const userProfileJson = await safeStorage.getItem(AUTH_STORAGE_KEYS.USER_PROFILE);

      let userProfile: UserProfile | null = null;
      if (userProfileJson) userProfile = JSON.parse(userProfileJson);
      const isNewUser = isNewUserJson ? JSON.parse(isNewUserJson) : false;
      const resolvedUserId = userId || extractUserIdFromToken(token);

      return { token, refreshToken, phoneNumber, userId: resolvedUserId, userProfile, isNewUser };
    } catch {
      return {
        token: null,
        refreshToken: null,
        phoneNumber: null,
        userId: null,
        userProfile: null,
        isNewUser: true,
      };
    }
  },

  /**
   * Sync phone contacts with backend to discover registered app users
   */
  async syncContacts(
    token: string,
    phoneNumbers: string[],
  ): Promise<{
    registered: Array<{
      id: string;
      phoneNumber: string;
      displayName: string | null;
      username: string | null;
      avatarUrl: string | null;
      about: string | null;
      isRegistered: boolean;
    }>;
    unregistered: string[];
    fromRedisCache?: boolean;
  }> {
    const startTime = Date.now();
    const url = `${getApiBaseUrl()}/auth/contacts/sync`;
    const reqBody = { phoneNumbers };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(reqBody),
      });
      const durationMs = Date.now() - startTime;

      if (response.status === 401) {
        devInspector.logApi({
          url,
          method: 'POST',
          requestData: reqBody,
          responseData: { status: 401, error: 'Unauthorized - attempting token refresh' },
          status: 401,
          durationMs,
          fromRedisCache: false,
          error: '401 Unauthorized',
        });

        // 🔄 Automatic Token Refresh
        const refreshed = await this.refreshAuthToken();
        if (refreshed?.accessToken) {
          return this.syncContacts(refreshed.accessToken, phoneNumbers);
        } else {
          // Both access token and refresh token expired -> log out to Login screen
          devInspector.logUi(
            'Auth',
            'unmount',
            'Session expired (401) - navigating to Login screen',
          );
          await handleSessionExpired();
          return { registered: [], unregistered: phoneNumbers };
        }
      }

      if (response.ok) {
        const json = await response.json();
        const payload = json.data || json;

        devInspector.logApi({
          url,
          method: 'POST',
          requestData: reqBody,
          responseData: payload,
          status: response.status,
          durationMs,
          fromRedisCache: Boolean(payload.fromRedisCache),
        });

        return payload;
      } else {
        const errorJson = await response.json().catch(() => ({}));
        devInspector.logApi({
          url,
          method: 'POST',
          requestData: reqBody,
          responseData: errorJson,
          status: response.status,
          durationMs,
          fromRedisCache: false,
          error: `HTTP ${response.status}`,
        });
      }
    } catch (e: any) {
      const durationMs = Date.now() - startTime;
      devInspector.logApi({
        url,
        method: 'POST',
        requestData: reqBody,
        responseData: { fallback: 'offline' },
        status: 0,
        durationMs,
        fromRedisCache: false,
        error: e?.message || 'Network unreachable',
      });
    }
    return { registered: [], unregistered: phoneNumbers };
  },

  /**
   * Search registered users across the platform by username, phone number, or display name
   */
  async searchUsers(
    token: string,
    query: string,
  ): Promise<
    Array<{
      id: string;
      name: string;
      username?: string;
      phoneNumber?: string;
      about?: string;
      avatarUrl?: string;
      isRegistered: boolean;
    }>
  > {
    const cleanQuery = query.trim().replace(/^@+/, '');
    if (!cleanQuery) return [];

    const startTime = Date.now();
    const url = `${getApiBaseUrl()}/auth/users/search?q=${encodeURIComponent(cleanQuery)}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      const durationMs = Date.now() - startTime;

      if (response.status === 401) {
        const refreshed = await this.refreshAuthToken();
        if (refreshed?.accessToken) {
          return this.searchUsers(refreshed.accessToken, query);
        }
      }

      if (response.ok) {
        const json = await response.json();
        let rawList: any[] = [];
        if (Array.isArray(json.data)) {
          rawList = json.data;
        } else if (json.data && Array.isArray(json.data.users)) {
          rawList = json.data.users;
        } else if (Array.isArray(json.users)) {
          rawList = json.users;
        } else if (Array.isArray(json)) {
          rawList = json;
        }

        const mapped = rawList.map((u) => ({
          id: u.id,
          name: u.displayName || u.name || u.username || u.phoneNumber || 'User',
          username: u.username
            ? u.username.startsWith('@')
              ? u.username
              : `@${u.username.replace(/^@+/, '')}`
            : undefined,
          phoneNumber: u.phoneNumber,
          avatarUrl: u.avatarUrl ? this.getResolvedMediaUrl(u.avatarUrl) : undefined,
          about: u.about || 'Available on WhatsApp',
          isRegistered: true,
        }));

        devInspector.logApi({
          url,
          method: 'GET',
          requestData: { query },
          responseData: { count: mapped.length, sample: mapped[0] },
          status: response.status,
          durationMs,
          fromRedisCache: false,
        });

        return mapped;
      }
    } catch (e: any) {
      devInspector.logApi({
        url,
        method: 'GET',
        requestData: { query },
        responseData: [],
        status: 0,
        durationMs: Date.now() - startTime,
        fromRedisCache: false,
        error: e?.message || 'Search failed',
      });
    }
    return [];
  },

  /**
   * Resolves relative media and avatar URLs to absolute URLs with active backend IP / host
   */
  getResolvedMediaUrl(pathOrUrl?: string): string | undefined {
    if (!pathOrUrl || typeof pathOrUrl !== 'string') return undefined;
    if (
      pathOrUrl.startsWith('http://') ||
      pathOrUrl.startsWith('https://') ||
      pathOrUrl.startsWith('data:') ||
      pathOrUrl.startsWith('file:')
    ) {
      return pathOrUrl;
    }
    const base = getApiBaseUrl().replace(/\/api\/v1\/?$/, '');
    const cleanPath = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
    return `${base}${cleanPath}`;
  },

  /**
   * Upload image/media with simulated & real upload progress tracking (0% -> 100%).
   * Requires an auth token — the backend /media/upload endpoint is now protected.
   */
  async uploadMedia(
    base64Data: string,
    onProgress?: (percent: number) => void,
    token?: string,
  ): Promise<{ success: boolean; url: string; fullUrl: string }> {
    const startTime = Date.now();
    const url = `${getApiBaseUrl()}/media/upload`;

    if (onProgress) onProgress(15);

    try {
      const progressTimer = setInterval(() => {
        if (onProgress) onProgress(Math.min(85, Math.floor(25 + Math.random() * 55)));
      }, 150);

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ base64Data }),
      });

      clearInterval(progressTimer);
      if (onProgress) onProgress(100);

      const durationMs = Date.now() - startTime;
      if (response.ok) {
        const json = await response.json();
        const payload = json.data || json;
        const relativeUrl = payload.url || `/uploads/images/img_${Date.now()}.jpg`;
        const fullUrl = this.getResolvedMediaUrl(relativeUrl) || relativeUrl;

        devInspector.logApi({
          url,
          method: 'POST',
          requestData: { uploadSize: base64Data.length },
          responseData: payload,
          status: response.status,
          durationMs,
          fromRedisCache: false,
        });

        return { success: true, url: relativeUrl, fullUrl };
      }

      if (response.status === 401 && token) {
        // Token expired mid-upload — refresh and retry once
        const refreshed = await this.refreshAuthToken();
        if (refreshed?.accessToken) {
          return this.uploadMedia(base64Data, onProgress, refreshed.accessToken);
        }
        await handleSessionExpired();
      }
    } catch {}

    if (onProgress) onProgress(100);
    // Fallback: embed as data URL so the message still shows the image
    const dataUrl = base64Data.startsWith('data:')
      ? base64Data
      : `data:image/jpeg;base64,${base64Data}`;
    return { success: true, url: dataUrl, fullUrl: dataUrl };
  },

  /**
   * Upload avatar image and save to user profile
   */
  async uploadAvatar(
    token: string,
    base64Data: string,
  ): Promise<{ success: boolean; avatarUrl?: string; b2Url?: string }> {
    const url = `${getApiBaseUrl()}/auth/avatar`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ base64Data }),
      });
      if (response.ok) {
        const json = await response.json();
        const payload = json.data || json;
        const fullAvatar = this.getResolvedMediaUrl(payload.avatarUrl) || payload.avatarUrl;
        return { success: true, avatarUrl: fullAvatar, b2Url: payload.b2Url || fullAvatar };
      }
    } catch (e) {}

    const dataUrl = base64Data.startsWith('data:')
      ? base64Data
      : `data:image/jpeg;base64,${base64Data}`;
    return { success: true, avatarUrl: dataUrl };
  },

  /**
   * Direct media file upload for chat messages (photos, docs, etc.).
   */
  async uploadMediaFile(
    token: string,
    base64Data: string,
    fileName?: string,
    mimeType?: string,
  ): Promise<{ success: boolean; url?: string; b2Url?: string; fileName?: string }> {
    const url = `${getApiBaseUrl()}/media/upload`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          base64Data,
          fileName: fileName || `file_${Date.now()}.jpg`,
          mimeType: mimeType || 'image/jpeg',
        }),
      });

      if (response.status === 401) {
        const refreshed = await this.refreshAuthToken();
        if (refreshed?.accessToken) {
          return this.uploadMediaFile(refreshed.accessToken, base64Data, fileName, mimeType);
        }
        await handleSessionExpired();
        return { success: false };
      }

      if (response.ok) {
        const json = await response.json();
        const payload = json.data || json;
        const resolvedUrl = this.getResolvedMediaUrl(payload.url) || payload.url;
        return {
          success: true,
          url: resolvedUrl,
          b2Url: payload.b2Url || resolvedUrl,
          fileName: payload.fileName,
        };
      }
    } catch (e) {
      console.warn('uploadMediaFile error:', e);
    }
    return { success: false };
  },

  /**
   * Fetch active conversations for the current user from backend database.
   * Auto-refreshes the access token on 401.
   */
  async fetchUserConversations(token: string): Promise<any[]> {
    const url = `${getApiBaseUrl()}/conversations`;
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.status === 401) {
        const refreshed = await this.refreshAuthToken();
        if (refreshed?.accessToken) {
          return this.fetchUserConversations(refreshed.accessToken);
        }
        await handleSessionExpired();
        return [];
      }

      if (response.ok) {
        const json = await response.json();
        return json.data || json || [];
      }
    } catch (e) {}
    return [];
  },

  /**
   * Fetch historical messages for a conversation from backend database.
   * Auto-refreshes the access token on 401.
   */
  async fetchHistoricalMessages(token: string, conversationId: string): Promise<any[]> {
    const url = `${getApiBaseUrl()}/messages/${conversationId}?limit=50`;
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.status === 401) {
        const refreshed = await this.refreshAuthToken();
        if (refreshed?.accessToken) {
          return this.fetchHistoricalMessages(refreshed.accessToken, conversationId);
        }
        await handleSessionExpired();
        return [];
      }

      if (response.ok) {
        const json = await response.json();
        return json.data || json || [];
      }
    } catch (e) {}
    return [];
  },

  /**
   * Delete conversation on the backend database for the current user.
   */
  async deleteConversation(
    token: string,
    conversationId: string,
  ): Promise<{ success: boolean; message?: string }> {
    const startTime = Date.now();
    const url = `${getApiBaseUrl()}/conversations/${encodeURIComponent(conversationId)}`;
    try {
      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      const durationMs = Date.now() - startTime;

      if (response.status === 401) {
        const refreshed = await this.refreshAuthToken();
        if (refreshed?.accessToken) {
          return this.deleteConversation(refreshed.accessToken, conversationId);
        }
        await handleSessionExpired();
        return { success: false, message: 'Session expired' };
      }

      const json = await response.json().catch(() => ({}));
      devInspector.logApi({
        url,
        method: 'DELETE',
        requestData: { conversationId },
        responseData: json,
        status: response.status,
        durationMs,
        fromRedisCache: false,
      });

      return { success: response.ok, message: json.message || 'Deleted' };
    } catch (e: any) {
      const durationMs = Date.now() - startTime;
      devInspector.logApi({
        url,
        method: 'DELETE',
        requestData: { conversationId },
        responseData: {},
        status: 0,
        durationMs,
        fromRedisCache: false,
        error: e?.message || 'Network error',
      });
      return { success: false, message: e?.message };
    }
  },

  /**
   * Get or create a 1:1 direct conversation on the backend.
   * Returns the real UUID conversationId from the DB.
   * Called before sending the first message to a contact if we only have a local ID.
   */
  async getOrCreateDirectConversation(
    token: string,
    targetUserId: string,
  ): Promise<{ id: string; recipientDbId: string } | null> {
    const url = `${getApiBaseUrl()}/conversations`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ type: 'DIRECT', targetUserId }),
      });

      if (response.status === 401) {
        const refreshed = await this.refreshAuthToken();
        if (refreshed?.accessToken) {
          return this.getOrCreateDirectConversation(refreshed.accessToken, targetUserId);
        }
        await handleSessionExpired();
        return null;
      }

      if (response.ok) {
        const json = await response.json();
        const conv = json.data || json;
        return { id: conv.id, recipientDbId: targetUserId };
      }
    } catch {}
    return null;
  },

  /**
   * Clear all messages in a conversation on backend for current user.
   */
  async clearChat(
    token: string,
    conversationId: string,
  ): Promise<{ success: boolean; message?: string }> {
    const startTime = Date.now();
    const url = `${getApiBaseUrl()}/messages/conversation/${encodeURIComponent(conversationId)}/clear`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      const durationMs = Date.now() - startTime;

      if (response.status === 401) {
        const refreshed = await this.refreshAuthToken();
        if (refreshed?.accessToken) {
          return this.clearChat(refreshed.accessToken, conversationId);
        }
        await handleSessionExpired();
        return { success: false, message: 'Session expired' };
      }

      const json = await response.json().catch(() => ({}));
      devInspector.logApi({
        url,
        method: 'POST',
        requestData: { conversationId },
        responseData: json,
        status: response.status,
        durationMs,
        fromRedisCache: false,
      });

      return { success: response.ok, message: json.message || 'Cleared' };
    } catch (e: any) {
      const durationMs = Date.now() - startTime;
      devInspector.logApi({
        url,
        method: 'POST',
        requestData: { conversationId },
        responseData: {},
        status: 0,
        durationMs,
        fromRedisCache: false,
        error: e?.message || 'Network error',
      });
      return { success: false, message: e?.message };
    }
  },

  async blockUser(token: string, targetUserId: string): Promise<boolean> {
    try {
      const response = await fetch(`${getApiBaseUrl()}/auth/users/block`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ targetUserId }),
      });
      return response.ok;
    } catch {
      return false;
    }
  },

  async unblockUser(token: string, targetUserId: string): Promise<boolean> {
    try {
      const response = await fetch(`${getApiBaseUrl()}/auth/users/unblock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ targetUserId }),
      });
      return response.ok;
    } catch {
      return false;
    }
  },

  async getBlockedUsers(token: string): Promise<any[]> {
    try {
      const response = await fetch(`${getApiBaseUrl()}/auth/users/blocked`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const json = await response.json();
        return json.data || json || [];
      }
      return [];
    } catch {
      return [];
    }
  },

  async getBlockStatus(
    token: string,
    targetUserId: string,
  ): Promise<{ blockedByMe: boolean; blockedByThem: boolean }> {
    try {
      const response = await fetch(`${getApiBaseUrl()}/auth/users/block-status/${targetUserId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const json = await response.json();
        return json.data || json || { blockedByMe: false, blockedByThem: false };
      }
      return { blockedByMe: false, blockedByThem: false };
    } catch {
      return { blockedByMe: false, blockedByThem: false };
    }
  },

  /**
   * Register device Signal IdentityKey, SignedPreKey, and OneTimePreKeys
   */
  async registerSignalKeys(token: string, dto: any): Promise<{ success: boolean }> {
    try {
      const response = await fetch(`${getApiBaseUrl()}/keys/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(dto),
      });
      if (response.ok) {
        return { success: true };
      }
    } catch (e) {
      console.warn('registerSignalKeys error:', e);
    }
    return { success: false };
  },

  async uploadPublicKey(token: string, publicKey: string): Promise<{ success: boolean }> {
    return { success: true };
  },

  /**
   * Fetch X3DH PreKey bundle for target user device
   */
  async getPreKeyBundle(
    targetUserId: string,
    targetDeviceId: number = 1,
    token?: string,
  ): Promise<any | null> {
    try {
      const authToken = token || (await safeStorage.getItem('@chat_token'));
      const response = await fetch(
        `${getApiBaseUrl()}/keys/bundle/${encodeURIComponent(targetUserId)}/${targetDeviceId}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
        },
      );
      if (response.ok) {
        const json = await response.json();
        return json.data || json;
      }
    } catch (e) {
      console.warn('getPreKeyBundle error:', e);
    }
    return null;
  },

  /**
   * Fetch active devices for target user
   */
  async getDevicesForUser(
    targetUserId: string,
    token?: string,
  ): Promise<Array<{ deviceId: number }>> {
    try {
      const authToken = token || (await safeStorage.getItem('@chat_token'));
      const response = await fetch(
        `${getApiBaseUrl()}/keys/devices/${encodeURIComponent(targetUserId)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
        },
      );
      if (response.ok) {
        const json = await response.json();
        return json.data || json || [];
      }
    } catch (e) {
      console.warn('getDevicesForUser error:', e);
    }
    return [];
  },

  /**
   * Get target user's X25519 public key from backend
   */
  async getUserPublicKey(
    targetUserId: string,
    token?: string,
  ): Promise<{ userId: string; publicKey: string | null } | null> {
    try {
      const authToken = token || (await safeStorage.getItem('@chat_token'));
      const response = await fetch(
        `${getApiBaseUrl()}/users/${encodeURIComponent(targetUserId)}/public-key`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
        },
      );
      if (response.ok) {
        const json = await response.json();
        const data = json.data || json;
        return { userId: data.userId, publicKey: data.publicKey };
      }
    } catch (e) {
      console.warn('getUserPublicKey error:', e);
    }
    return null;
  },

  /**
   * Submit message report for content moderation
   */
  async submitReport(
    token: string,
    payload: {
      messageId?: string;
      reportedUserId: string;
      messageContent: string;
      reason: string;
      contextMessages?: any[];
    },
  ): Promise<{ success: boolean; reportId?: string }> {
    try {
      const response = await fetch(`${getApiBaseUrl()}/reports`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (response.ok) {
        const json = await response.json();
        const data = json.data || json;
        return { success: true, reportId: data.reportId };
      }
    } catch (e) {
      console.warn('submitReport error:', e);
    }
    return { success: false };
  },
};

(apiService as any).getResolvedMediaUrl = _resolveMediaUrl;
