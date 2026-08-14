import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Rect, Path, Defs, LinearGradient, Stop, Circle } from 'react-native-svg';
import { useTheme } from '../context/ThemeContext';

interface AppLogoProps {
  size?: number;
  showText?: boolean;
}

export const AppLogo: React.FC<AppLogoProps> = ({ size = 36, showText = true }) => {
  const { colors } = useTheme();

  return (
    <View style={styles.container}>
      <Svg width={size} height={size} viewBox="0 0 100 100" fill="none">
        <Defs>
          <LinearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#6366F1" />
            <Stop offset="100%" stopColor="#8B5CF6" />
          </LinearGradient>
          <LinearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#38BDF8" />
            <Stop offset="100%" stopColor="#6366F1" />
          </LinearGradient>
        </Defs>

        {/* Rounded Outer Container Badge */}
        <Rect width="100" height="100" rx="28" fill="url(#logoGrad)" />

        {/* Main Modern Minimal Chat Bubble Curve */}
        <Path
          d="M32 30 H68 C74.6274 30 80 35.3726 80 42 V58 C80 64.6274 74.6274 70 68 70 H48 L32 78 V70 C25.3726 70 20 64.6274 20 58 V42 C20 35.3726 25.3726 30 32 30 Z"
          fill="#FFFFFF"
          fillOpacity="0.95"
        />

        {/* Inner Glowing Signal Pulse Dots */}
        <Circle cx="40" cy="50" r="5" fill="url(#accentGrad)" />
        <Circle cx="52" cy="50" r="5" fill="url(#accentGrad)" />
        <Circle cx="64" cy="50" r="5" fill="url(#accentGrad)" />
      </Svg>

      {showText && (
        <View style={styles.textWrapper}>
          <Text style={[styles.brandTitle, { color: colors.textPrimary }]}>
            Chat<Text style={{ color: colors.primaryIndigo }}>System</Text>
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  textWrapper: {
    marginLeft: 10,
  },
  brandTitle: {
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
});
