import React, { createContext, useContext, useState, useEffect } from 'react';
import { safeStorage } from '../services/storageHelper';

export type ThemeMode = 'dark' | 'light';

const THEME_STORAGE_KEY = '@whatsapp_connect_theme_mode';

export interface ThemeColors {
  mode: ThemeMode;
  bg: string;
  surface: string;
  cardBorder: string;
  textPrimary: string;
  textSecondary: string;
  primaryIndigo: string;
  onlineEmerald: string;
  unreadBadge: string;
  missedRed: string;
  inputBg: string;
  bottomBarBg: string;
}

export const darkThemeColors: ThemeColors = {
  mode: 'dark',
  bg: '#000000', // Pure Deep Black (#000000)
  surface: '#121212', // Deep Black Surface (#121212)
  cardBorder: '#262626', // Dark Border (#262626)
  textPrimary: '#FFFFFF', // Pure White Text
  textSecondary: '#A3A3A3', // Muted Text
  primaryIndigo: '#6366F1', // Electric Indigo Accent
  onlineEmerald: '#22C55E', // Green Online Badge
  unreadBadge: '#6366F1', // Violet Unread Badge
  missedRed: '#EF4444', // Missed Call Red
  inputBg: '#181818', // Input Field Pure Dark
  bottomBarBg: '#121212', // Bottom Nav Bar Surface
};

export const lightThemeColors: ThemeColors = {
  mode: 'light',
  bg: '#F5F3FF', // Soft Lavender Light Backdrop
  surface: '#FFFFFF', // White Surface Card
  cardBorder: '#EDE9FE', // Light Lavender Border
  textPrimary: '#0F172A', // Dark Text Primary
  textSecondary: '#64748B', // Secondary Slate Text
  primaryIndigo: '#6366F1', // Electric Indigo Accent
  onlineEmerald: '#22C55E', // Green Online Badge
  unreadBadge: '#6366F1', // Violet Unread Badge
  missedRed: '#EF4444', // Missed Call Red
  inputBg: '#FFFFFF', // Input Field Light Surface
  bottomBarBg: '#FFFFFF', // Bottom Nav Bar White
};

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
    safeStorage.getItem(THEME_STORAGE_KEY).then((savedTheme) => {
      if (savedTheme === 'light' || savedTheme === 'dark') {
        setThemeModeState(savedTheme);
      }
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
