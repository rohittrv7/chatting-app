import React, { useState, useEffect, useRef } from 'react';
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

// Lazy dynamic token resolver to prevent circular store dependency during module load
function getAuthToken(): string | null {
  try {
    const { store } = require('../store');
    return store.getState()?.auth?.token || null;
  } catch {
    return null;
  }
}

interface FailedAvatarEntry {
  timestamp: number;
  isPermanent404: boolean;
}

// Module-level map tracking failed URLs with timestamp and HTTP 404 vs transient distinction.
// - Real HTTP 404 responses are permanently blacklisted (no retry loops).
// - Generic network errors / timeouts expire after 5 minutes to allow recovery.
const failedAvatarMap = new Map<string, FailedAvatarEntry>();
const RETRY_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

export function isAvatarBlacklisted(url: string): boolean {
  const entry = failedAvatarMap.get(url);
  if (!entry) return false;
  // Confirmed 404: permanently blacklist
  if (entry.isPermanent404) return true;
  // Generic network error: allow retry after 5 minutes
  if (Date.now() - entry.timestamp > RETRY_EXPIRY_MS) {
    failedAvatarMap.delete(url);
    return false;
  }
  return true;
}

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

const SmartAvatarComponent: React.FC<SmartAvatarProps> = ({
  avatarUrl,
  name,
  username,
  size = 48,
  groupBg,
  textColor = '#E8622A',
  style,
  textStyle,
  borderRadius,
}) => {
  const rawUrl = avatarUrl && typeof avatarUrl === 'string' ? avatarUrl.trim() : '';
  const resolvedUri = rawUrl.length > 0 ? apiService.getResolvedMediaUrl(rawUrl) || rawUrl : null;

  // Initialize imageError immediately if this URL is already blacklisted
  const [imageError, setImageError] = useState(() =>
    resolvedUri ? isAvatarBlacklisted(resolvedUri) : false,
  );
  const prevUrlRef = useRef<string | null | undefined>(avatarUrl);

  // Only reset error state if the avatarUrl has ACTUALLY changed to a different URL
  useEffect(() => {
    if (avatarUrl !== prevUrlRef.current) {
      prevUrlRef.current = avatarUrl;
      const newResolved =
        avatarUrl && typeof avatarUrl === 'string'
          ? apiService.getResolvedMediaUrl(avatarUrl.trim()) || avatarUrl.trim()
          : null;

      if (newResolved && isAvatarBlacklisted(newResolved)) {
        setImageError(true);
      } else {
        setImageError(false);
      }
    }
  }, [avatarUrl]);

  // Handle image load failure: record transient error or verify HTTP 404
  const handleImageError = (e?: any) => {
    if (!resolvedUri) return;

    // Immediately trigger fallback view so UI never flickers or blinks
    setImageError(true);

    const errorMsg = String(e?.nativeEvent?.error || e?.nativeEvent?.description || '');
    // FIX: React Native Image gives inconsistent error messages across platforms.
    // Treat ALL load failures as permanent for this session to prevent retry loops.
    // The URL is only retried after RETRY_EXPIRY_MS (5 minutes) for non-404 errors.
    // For confirmed 404s (backend now returns proper 404), mark permanent.
    const looksLike404 =
      errorMsg.includes('404') ||
      errorMsg.includes('Not Found') ||
      errorMsg.toLowerCase().includes('not found');

    failedAvatarMap.set(resolvedUri, {
      timestamp: Date.now(),
      isPermanent404: looksLike404,
    });
  };

  // Compute resolved display letter
  const cleanName = (name || username || 'User').replace(/^@+/, '').trim();
  const letter = (cleanName[0] || 'U').toUpperCase();
  const radius = borderRadius !== undefined ? borderRadius : size / 2;

  // Check if URL is valid and not currently blacklisted
  const isFailed = resolvedUri ? isAvatarBlacklisted(resolvedUri) : false;
  const effectiveUri = !imageError && !isFailed ? resolvedUri : null;

  if (effectiveUri) {
    const token = getAuthToken();
    const source = {
      uri: effectiveUri,
      headers:
        token && (effectiveUri.startsWith('http://') || effectiveUri.startsWith('https://'))
          ? { Authorization: `Bearer ${token}` }
          : undefined,
      cache: 'force-cache' as const,
    };

    return (
      <Image
        source={source}
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
        onError={handleImageError}
      />
    );
  }

  // Fallback: stylish text letter avatar
  const defaultBg = groupBg || 'rgba(232, 98, 42, 0.16)';
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
          borderColor: 'rgba(232, 98, 42, 0.25)',
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

export const SmartAvatar = React.memo(SmartAvatarComponent);

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
