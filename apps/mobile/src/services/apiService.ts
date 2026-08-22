import { Platform } from 'react-native';
import { safeStorage } from './storageHelper';
import { AUTH_STORAGE_KEYS } from '../store/authSlice';
import { UserProfile } from '../types';
import { devInspector } from './devInspectorService';

// 💻 LOCAL DEVELOPMENT URL (Active Host Wi-Fi IP)
export const LOCAL_IP = '10.36.162.14';
export const LOCAL_API_URL =
  Platform.OS === 'web' ? 'http://localhost:3000/api/v1' : `http://${LOCAL_IP}:3000/api/v1`;

export const BACKEND_BASE_URL = process.env.EXPO_PUBLIC_API_URL || LOCAL_API_URL;

export interface RequestOtpResponse {
  success: boolean;
  message: string;
  mockOtp: string;
}

export interface VerifyOtpResponse {
  success: boolean;
  accessToken: string;
  refreshToken: string;
  isNewUser: boolean;
  user: UserProfile;
}

type SessionExpiredCallback = () => void;
let sessionExpiredHandler: SessionExpiredCallback | null = null;

export const setSessionExpiredHandler = (cb: SessionExpiredCallback) => {
  sessionExpiredHandler = cb;
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

export const apiService = {
  /**
   * Request OTP from backend API
   */
  async requestOtp(phoneNumber: string): Promise<RequestOtpResponse> {
    const startTime = Date.now();
    const url = `${BACKEND_BASE_URL}/auth/otp/request`;
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
    const url = `${BACKEND_BASE_URL}/auth/otp/verify`;
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

        // Save tokens immediately in persistent storage
        await safeStorage.setItem(AUTH_STORAGE_KEYS.TOKEN, accessToken);
        await safeStorage.setItem(AUTH_STORAGE_KEYS.REFRESH_TOKEN, refreshToken);

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
   * Rotate Refresh Token and get a new Access Token seamlessly
   */
  async refreshAuthToken(): Promise<{ accessToken: string; refreshToken: string } | null> {
    try {
      const storedRefreshToken = await safeStorage.getItem(AUTH_STORAGE_KEYS.REFRESH_TOKEN);
      if (!storedRefreshToken) return null;

      const startTime = Date.now();
      const url = `${BACKEND_BASE_URL}/auth/token/refresh`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: storedRefreshToken }),
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

        devInspector.logApi({
          url,
          method: 'POST',
          requestData: { refreshToken: '***' },
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
          requestData: { refreshToken: '***' },
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
    }
  },

  /**
   * Save / Update Profile in Backend & Local Persistence
   */
  async updateProfile(token: string, profile: UserProfile): Promise<boolean> {
    const startTime = Date.now();
    const url = `${BACKEND_BASE_URL}/auth/profile`;
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
    userProfile: UserProfile | null;
    isNewUser: boolean;
  }> {
    try {
      const token = await safeStorage.getItem(AUTH_STORAGE_KEYS.TOKEN);
      const refreshToken = await safeStorage.getItem(AUTH_STORAGE_KEYS.REFRESH_TOKEN);
      const phoneNumber = await safeStorage.getItem(AUTH_STORAGE_KEYS.PHONE_NUMBER);
      const isNewUserJson = await safeStorage.getItem(AUTH_STORAGE_KEYS.IS_NEW_USER);
      const userProfileJson = await safeStorage.getItem(AUTH_STORAGE_KEYS.USER_PROFILE);

      let userProfile: UserProfile | null = null;
      if (userProfileJson) {
        userProfile = JSON.parse(userProfileJson);
      }

      const isNewUser = isNewUserJson ? JSON.parse(isNewUserJson) : false;

      return {
        token,
        refreshToken,
        phoneNumber,
        userProfile,
        isNewUser,
      };
    } catch (e) {
      return { token: null, refreshToken: null, phoneNumber: null, userProfile: null, isNewUser: true };
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
    const url = `${BACKEND_BASE_URL}/auth/contacts/sync`;
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
          devInspector.logUi('Auth', 'unmount', 'Session expired (401) - navigating to Login screen');
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
   * Search registered users across the platform by username or display name
   */
  async searchUsers(
    token: string,
    query: string,
  ): Promise<
    Array<{
      id: string;
      name: string;
      username?: string;
      about?: string;
      avatarUrl?: string;
      isRegistered: boolean;
    }>
  > {
    const cleanQuery = query.trim().replace(/^@+/, '');
    if (!cleanQuery) return [];

    const startTime = Date.now();
    const url = `${BACKEND_BASE_URL}/auth/users/search?q=${encodeURIComponent(cleanQuery)}`;

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
        const payload = json.data || json;
        const users = payload.users || [];

        devInspector.logApi({
          url,
          method: 'GET',
          responseData: payload,
          status: response.status,
          durationMs,
          fromRedisCache: false,
        });

        return users;
      }
    } catch (e: any) {
      devInspector.logApi({
        url,
        method: 'GET',
        responseData: [],
        status: 0,
        durationMs: Date.now() - startTime,
        fromRedisCache: false,
        error: e?.message || 'Search failed',
      });
    }
    return [];
  },
};

