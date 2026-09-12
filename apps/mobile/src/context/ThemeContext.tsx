import React, { createContext, useContext, useState, useEffect } from 'react';
import { Platform } from 'react-native';
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

  // ── Backgrounds & Gradients
  bg: string;
  bgGradient: [string, string, string];
  surface: string;
  surfaceElevated: string;
  overlay: string;

  // ── Borders
  border: string;
  borderStrong: string;

  // ── Brand Accent — Vibrant Periwinkle/Indigo Violet (from reference)
  accent: string;
  accentLight: string;
  accentDim: string;
  accentGradient: [string, string];

  // ── Secondary accent — Emerald / Mint
  accentAlt: string;
  accentAltDim: string;

  // ── Warm Accent — Peach / Coral (from wellness reference)
  accentWarm: string;
  accentWarmDim: string;

  // ── Text
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;

  // ── Chat bubbles
  bubbleMe: string;
  bubbleMeText: string;
  bubbleThem: string;
  bubbleThemText: string;

  // ── Status colors
  danger: string;
  success: string;
  warning: string;

  // ── Legacy aliases
  primaryIndigo: string;
  onlineEmerald: string;
  unreadBadge: string;
  missedRed: string;
  inputBg: string;
  bottomBarBg: string;
  cardBorder: string;
}

// ─── Dark mode (Pure Deep Pitch Black) ───────────────────────────────────────
export const darkThemeColors: ThemeColors = {
  mode: 'dark',

  bg: '#000000',
  bgGradient: ['#000000', '#000000', '#000000'],
  surface: '#0B0B0E',
  surfaceElevated: '#131317',
  overlay: 'rgba(0,0,0,0.85)',

  border: '#1C1C24',
  borderStrong: '#2A2A36',

  accent: '#7966F2',
  accentLight: '#9585F7',
  accentDim: '#1C1838',
  accentGradient: ['#8574F5', '#604EE6'],

  accentAlt: '#10B981',
  accentAltDim: '#0E3326',

  accentWarm: '#FF8A65',
  accentWarmDim: '#3D1E16',

  textPrimary: '#FFFFFF',
  textSecondary: '#9A94B8',
  textTertiary: '#676088',

  bubbleMe: '#5E4AE3',
  bubbleMeText: '#FFFFFF',
  bubbleThem: '#131317',
  bubbleThemText: '#FFFFFF',

  danger: '#EF4444',
  success: '#10B981',
  warning: '#F59E0B',

  // Legacy aliases
  primaryIndigo: '#7966F2',
  onlineEmerald: '#10B981',
  unreadBadge: '#7966F2',
  missedRed: '#EF4444',
  inputBg: '#0B0B0E',
  bottomBarBg: '#000000',
  cardBorder: '#1C1C24',
};

// ─── Light mode (Soft Lavender to Warm Cream gradient — from reference) ───
export const lightThemeColors: ThemeColors = {
  mode: 'light',

  bg: '#F5F2FD',
  bgGradient: ['#F4F0FD', '#F8F6FD', '#FAF7F5'],
  surface: '#FFFFFF',
  surfaceElevated: '#F9F8FD',
  overlay: 'rgba(15,12,30,0.45)',

  border: '#ECE7F6',
  borderStrong: '#DCD4EE',

  accent: '#5E4AE3',
  accentLight: '#7563F5',
  accentDim: '#EEECFD',
  accentGradient: ['#6956F7', '#5340D8'],

  accentAlt: '#10B981',
  accentAltDim: '#D1FAE5',

  accentWarm: '#FF7043',
  accentWarmDim: '#FBE9E7',

  textPrimary: '#141226',
  textSecondary: '#6B6684',
  textTertiary: '#A29DBE',

  bubbleMe: '#5E4AE3',
  bubbleMeText: '#FFFFFF',
  bubbleThem: '#FFFFFF',
  bubbleThemText: '#141226',

  danger: '#DC2626',
  success: '#059669',
  warning: '#D97706',

  // Legacy aliases
  primaryIndigo: '#5E4AE3',
  onlineEmerald: '#10B981',
  unreadBadge: '#5E4AE3',
  missedRed: '#DC2626',
  inputBg: '#FFFFFF',
  bottomBarBg: '#FFFFFF',
  cardBorder: '#ECE7F6',
};

// ─── Typography pairings (Editorial Serif + Clean Sans-Serif) ───────────────
export const typography = {
  editorialSerif: Platform.select({
    ios: 'Georgia',
    android: 'serif',
    web: 'Fraunces, "DM Serif Display", Georgia, serif',
    default: 'serif',
  }),
  modernSans: Platform.select({
    ios: 'System',
    android: 'sans-serif',
    web: '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    default: 'sans-serif',
  }),
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
