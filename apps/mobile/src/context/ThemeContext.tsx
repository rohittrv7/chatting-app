import React, { createContext, useContext, useState, useEffect } from 'react';
import { safeStorage } from '../services/storageHelper';

export type ThemeMode = 'dark' | 'light';

const THEME_STORAGE_KEY = '@whatsapp_connect_theme_mode';

// ─── Extended token set ────────────────────────────────────────────────────
// Design system: "Ink & Ember"
// Accent: deep ember orange — distinctive, warm, professional
// Secondary: muted teal — status indicators, ticks, online dots
// Typography: no custom fonts loaded yet (loaded via expo-font when needed);
//   fontFamily fields are prepared for Sora (headings) + DM Sans (body).
//   For now system fonts are used at the right weights, swap values in once fonts load.

export interface ThemeColors {
  mode: ThemeMode;

  // ── Backgrounds
  bg: string; // page / screen background
  surface: string; // cards, rows, bottom nav
  surfaceElevated: string; // modals, bottom sheets, selected state
  overlay: string; // modal backdrop overlay

  // ── Borders
  border: string; // subtle dividers, card edges
  borderStrong: string; // input outlines, focused states

  // ── Accent — ember orange
  accent: string; // primary CTA, unread badge, active icon
  accentLight: string; // pressed / hover state
  accentDim: string; // tinted backgrounds (badge bg, unread row tint)

  // ── Secondary accent — teal
  accentAlt: string; // read receipts double-tick, online dot, reactions
  accentAltDim: string; // teal tinted bg

  // ── Text
  textPrimary: string; // main text
  textSecondary: string; // subtitles, timestamps, labels
  textTertiary: string; // placeholders, disabled

  // ── Chat bubbles
  bubbleMe: string; // my bubble background
  bubbleMeText: string; // my bubble text
  bubbleThem: string; // their bubble background
  bubbleThemText: string; // their bubble text

  // ── Status colors
  danger: string; // delete, missed call, error
  success: string; // upload done, sent success, positive
  warning: string; // pending, amber states

  // ── Legacy aliases (kept for backward compat with existing screens)
  primaryIndigo: string; // maps to accent
  onlineEmerald: string; // maps to accentAlt
  unreadBadge: string; // maps to accent
  missedRed: string; // maps to danger
  inputBg: string; // maps to surface
  bottomBarBg: string; // maps to surface
  cardBorder: string; // maps to border
}

// ─── Dark mode ──────────────────────────────────────────────────────────────
export const darkThemeColors: ThemeColors = {
  mode: 'dark',

  bg: '#0D0D0D',
  surface: '#161618',
  surfaceElevated: '#1E1E21',
  overlay: 'rgba(0,0,0,0.78)',

  border: '#2A2A2E',
  borderStrong: '#3A3A40',

  accent: '#E8622A',
  accentLight: '#FF8A5C',
  accentDim: '#3D2218',

  accentAlt: '#2ABCB0',
  accentAltDim: '#0F2E2B',

  textPrimary: '#F0EDE8',
  textSecondary: '#8A8680',
  textTertiary: '#5A5650',

  bubbleMe: '#2D1A10',
  bubbleMeText: '#F5DDD0',
  bubbleThem: '#1A1A1E',
  bubbleThemText: '#F0EDE8',

  danger: '#E05252',
  success: '#52C97A',
  warning: '#F59E0B',

  // Legacy aliases
  primaryIndigo: '#E8622A',
  onlineEmerald: '#2ABCB0',
  unreadBadge: '#E8622A',
  missedRed: '#E05252',
  inputBg: '#161618',
  bottomBarBg: '#161618',
  cardBorder: '#2A2A2E',
};

// ─── Light mode ─────────────────────────────────────────────────────────────
export const lightThemeColors: ThemeColors = {
  mode: 'light',

  bg: '#FAF8F5',
  surface: '#FFFFFF',
  surfaceElevated: '#F0EDE8',
  overlay: 'rgba(0,0,0,0.55)',

  border: '#E8E2D8',
  borderStrong: '#D0C8BA',

  accent: '#D4511F',
  accentLight: '#E8622A',
  accentDim: '#FEE8DC',

  accentAlt: '#1A9E94',
  accentAltDim: '#D6F2F0',

  textPrimary: '#1A1714',
  textSecondary: '#706860',
  textTertiary: '#A8A098',

  bubbleMe: '#E8622A',
  bubbleMeText: '#FFFFFF',
  bubbleThem: '#FFFFFF',
  bubbleThemText: '#1A1714',

  danger: '#C84040',
  success: '#3A9E5C',
  warning: '#D97706',

  // Legacy aliases
  primaryIndigo: '#D4511F',
  onlineEmerald: '#1A9E94',
  unreadBadge: '#D4511F',
  missedRed: '#C84040',
  inputBg: '#FFFFFF',
  bottomBarBg: '#FFFFFF',
  cardBorder: '#E8E2D8',
};

// ─── Spacing scale ───────────────────────────────────────────────────────────
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  '3xl': 32,
  '4xl': 48,
} as const;

// ─── Border radius scale ─────────────────────────────────────────────────────
export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 100,
  // Chat bubble radii: pinched corner on sender side
  bubbleMe: [18, 18, 4, 18] as [number, number, number, number], // top-left top-right bottom-right bottom-left
  bubbleThem: [18, 18, 18, 4] as [number, number, number, number],
} as const;

// ─── Shadow presets ──────────────────────────────────────────────────────────
// Two-layer warm shadows (ember tinted + base dark)
export const shadow = {
  card: {
    shadowColor: '#E8622A',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  elevated: {
    shadowColor: '#E8622A',
    shadowOpacity: 0.1,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
} as const;

// ─── Context ─────────────────────────────────────────────────────────────────

interface ThemeContextType {
  themeMode: ThemeMode;
  colors: ThemeColors;
  setThemeMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  themeMode: 'dark',
  colors: darkThemeColors,
  setThemeMode: () => {},
  toggleTheme: () => {},
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [themeMode, setThemeModeState] = useState<ThemeMode>('dark');

  useEffect(() => {
    safeStorage.getItem(THEME_STORAGE_KEY).then((saved) => {
      if (saved === 'light' || saved === 'dark') setThemeModeState(saved);
    });
  }, []);

  const setThemeMode = (mode: ThemeMode) => {
    setThemeModeState(mode);
    safeStorage.setItem(THEME_STORAGE_KEY, mode);
  };

  const toggleTheme = () => {
    setThemeModeState((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      safeStorage.setItem(THEME_STORAGE_KEY, next);
      return next;
    });
  };

  const colors = themeMode === 'dark' ? darkThemeColors : lightThemeColors;

  return (
    <ThemeContext.Provider value={{ themeMode, colors, setThemeMode, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
