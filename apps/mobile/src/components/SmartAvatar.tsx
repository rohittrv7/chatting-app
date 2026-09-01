import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  StyleProp,
  ViewStyle,
  TextStyle,
  ImageStyle,
} from 'react-native';
import { apiService } from '../services/apiService';

interface SmartAvatarProps {
  avatarUrl?: string | null;
  name?: string | null;
  username?: string | null;
  size?: number;
  groupBg?: string;
  textColor?: string;
  style?: StyleProp<ViewStyle | ImageStyle>;
  textStyle?: StyleProp<TextStyle>;
  borderRadius?: number;
}

export const SmartAvatar: React.FC<SmartAvatarProps> = ({
  avatarUrl,
  name,
  username,
  size = 48,
  groupBg,
  textColor = '#6366F1',
  style,
  textStyle,
  borderRadius,
}) => {
  const [imageError, setImageError] = useState(false);

  // Reset error when avatarUrl changes
  useEffect(() => {
    setImageError(false);
  }, [avatarUrl]);

  const rawUrl = avatarUrl && typeof avatarUrl === 'string' ? avatarUrl.trim() : '';

  // Compute resolved display letter
  const cleanName = (name || username || 'User').replace(/^@+/, '').trim();
  const letter = (cleanName[0] || 'U').toUpperCase();

  const radius = borderRadius !== undefined ? borderRadius : size / 2;

  // Resolve media URL (supports relative server path, absolute URL, base64 data:, or local file://)
  const effectiveUri =
    rawUrl.length > 0 && !imageError ? apiService.getResolvedMediaUrl(rawUrl) || rawUrl : null;

  if (effectiveUri) {
    return (
      <Image
        source={{ uri: effectiveUri }}
        style={[
          styles.image,
          {
            width: size,
            height: size,
            borderRadius: radius,
          },
          style as ImageStyle,
        ]}
        resizeMode="cover"
        onError={() => setImageError(true)}
      />
    );
  }

  // Fallback: stylish text letter avatar
  const defaultBg = groupBg || 'rgba(99, 102, 241, 0.16)';
  const fontSize = Math.max(12, Math.round(size * 0.42));

  return (
    <View
      style={[
        styles.fallbackContainer,
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: defaultBg,
          borderColor: 'rgba(99, 102, 241, 0.25)',
        },
        style as ViewStyle,
      ]}
    >
      <Text
        style={[
          styles.fallbackText,
          {
            fontSize,
            color: textColor,
          },
          textStyle,
        ]}
        numberOfLines={1}
      >
        {letter}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  image: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  fallbackContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  fallbackText: {
    fontWeight: '800',
  },
});
