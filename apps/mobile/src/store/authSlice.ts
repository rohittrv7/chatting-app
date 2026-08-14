import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { safeStorage } from '../services/storageHelper';
import { UserProfile } from '../types';

export interface AuthState {
  token: string | null;
  phoneNumber: string | null;
  userProfile: UserProfile | null;
  isNewUser: boolean;
  isAuthenticated: boolean;
  isLoading: boolean;
}

const initialState: AuthState = {
  token: null,
  phoneNumber: null,
  userProfile: null,
  isNewUser: false,
  isAuthenticated: false,
  isLoading: true,
};

export const AUTH_STORAGE_KEYS = {
  TOKEN: '@whatsapp_connect_token',
  USER_PROFILE: '@whatsapp_connect_user_profile',
  PHONE_NUMBER: '@whatsapp_connect_phone',
  IS_NEW_USER: '@whatsapp_connect_is_new_user',
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
    otpVerifiedSuccess: (
      state,
      action: PayloadAction<{
        token: string;
        phoneNumber: string;
        userProfile: UserProfile | null;
        isNewUser: boolean;
      }>
    ) => {
      state.token = action.payload.token;
      state.phoneNumber = action.payload.phoneNumber;
      state.userProfile = action.payload.userProfile;
      state.isNewUser = action.payload.isNewUser;
      state.isAuthenticated = true;
      state.isLoading = false;

      safeStorage.setItem(AUTH_STORAGE_KEYS.TOKEN, action.payload.token);
      safeStorage.setItem(AUTH_STORAGE_KEYS.PHONE_NUMBER, action.payload.phoneNumber);
      safeStorage.setItem(AUTH_STORAGE_KEYS.IS_NEW_USER, JSON.stringify(action.payload.isNewUser));
      if (action.payload.userProfile) {
        safeStorage.setItem(AUTH_STORAGE_KEYS.USER_PROFILE, JSON.stringify(action.payload.userProfile));
      }
    },
    profileUpdatedSuccess: (state, action: PayloadAction<UserProfile>) => {
      state.userProfile = action.payload;
      state.isNewUser = false;
      state.isAuthenticated = true;

      safeStorage.setItem(AUTH_STORAGE_KEYS.IS_NEW_USER, JSON.stringify(false));
      safeStorage.setItem(AUTH_STORAGE_KEYS.USER_PROFILE, JSON.stringify(action.payload));
    },
    restoreSession: (
      state,
      action: PayloadAction<{
        token: string;
        phoneNumber: string;
        userProfile: UserProfile | null;
        isNewUser: boolean;
      }>
    ) => {
      state.token = action.payload.token;
      state.phoneNumber = action.payload.phoneNumber;
      state.userProfile = action.payload.userProfile;
      state.isNewUser = action.payload.isNewUser;
      state.isAuthenticated = true;
      state.isLoading = false;
    },
    logout: (state) => {
      state.token = null;
      state.phoneNumber = null;
      state.userProfile = null;
      state.isNewUser = false;
      state.isAuthenticated = false;
      state.isLoading = false;

      safeStorage.removeItem(AUTH_STORAGE_KEYS.TOKEN);
      safeStorage.removeItem(AUTH_STORAGE_KEYS.USER_PROFILE);
      safeStorage.removeItem(AUTH_STORAGE_KEYS.PHONE_NUMBER);
      safeStorage.removeItem(AUTH_STORAGE_KEYS.IS_NEW_USER);
    },
  },
});

export const { setLoading, otpVerifiedSuccess, profileUpdatedSuccess, restoreSession, logout } =
  authSlice.actions;
export default authSlice.reducer;
