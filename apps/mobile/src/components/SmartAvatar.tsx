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
import { store } from '../store';

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
  textColor = '#6366F1',
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

    // Immediately trigger fallback view so UI never flickers or waits
    setImageError(true);

    const errorMsg = String(e?.nativeEvent?.error || '');
    const isDirect404 = errorMsg.includes('404');

    if (isDirect404) {
      failedAvatarMap.set(resolvedUri, { timestamp: Date.now(), isPermanent404: true });
      return;
    }

    const existing = failedAvatarMap.get(resolvedUri);
    if (!existing || !existing.isPermanent404) {
      // Record generic failure with current timestamp
      failedAvatarMap.set(resolvedUri, { timestamp: Date.now(), isPermanent404: false });

      // Probe URL status asynchronously to permanently blacklist genuine 404s
      if (
        typeof fetch === 'function' &&
        (resolvedUri.startsWith('http://') || resolvedUri.startsWith('https://'))
      ) {
        const headers: Record<string, string> = {};
        try {
          const token = store.getState()?.auth?.token;
          if (token) {
            headers['Authorization'] = `Bearer ${token}`;
          }
        } catch (_) {}

        fetch(resolvedUri, { method: 'HEAD', headers })
          .then((res) => {
            if (res.status === 404) {
              // Real 404: permanently blacklist!
              failedAvatarMap.set(resolvedUri, { timestamp: Date.now(), isPermanent404: true });
            } else if (res.status === 401 || res.status === 403) {
              // Protected route: token may be missing/expired -> treated as transient with 5-min retry, NOT permanent 404
              failedAvatarMap.set(resolvedUri, { timestamp: Date.now(), isPermanent404: false });
            } else if (res.ok) {
              // Succeeded on probe: remove from failure map and restore image
              failedAvatarMap.delete(resolvedUri);
              setImageError(false);
            }
          })
          .catch(() => {
            // Network dropped or unreachable: remains transient with 5-minute expiry
          });
      }
    }
  };

  // Compute resolved display letter
  const cleanName = (name || username || 'User').replace(/^@+/, '').trim();
  const letter = (cleanName[0] || 'U').toUpperCase();
  const radius = borderRadius !== undefined ? borderRadius : size / 2;

  // Check if URL is valid and not currently blacklisted
  const isFailed = resolvedUri ? isAvatarBlacklisted(resolvedUri) : false;
  const effectiveUri = !imageError && !isFailed ? resolvedUri : null;

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
        onError={handleImageError}
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
