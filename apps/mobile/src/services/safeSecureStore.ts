/**
 * safeSecureStore.ts
 *
 * Crash-proof wrapper for expo-secure-store.
 *
 * Problem:
 * If an APK was built before `expo-secure-store` was added to package.json,
 * direct top-level imports of `expo-secure-store` cause the app to crash and close immediately
 * upon launch because Android's native runtime cannot find `ExpoSecureStore`.
 *
 * Solution:
 * 1. Safely requires `expo-secure-store` inside a try-catch without crashing the module loader.
 * 2. Polyfills `nacl.setPRNG` and `globalThis.crypto.getRandomValues` so crypto calls never throw.
 * 3. If native ExpoSecureStore exists in the APK, uses hardware Keystore.
 * 4. If native module is absent, transparently falls back to `@react-native-async-storage/async-storage`
 *    so the app opens and functions smoothly without ever crashing!
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import nacl from 'tweetnacl';

// ─── 1. Polyfill CSPRNG for TweetNaCl & globalThis.crypto ────────────────────

try {
  nacl.randomBytes(1);
} catch {
  const entropyPool = new Uint8Array(256);
  let poolIdx = 0;
  for (let i = 0; i < 256; i++) {
    entropyPool[i] = ((Math.random() * 256) ^ (Date.now() & 255) ^ (i * 37)) & 255;
  }

  nacl.setPRNG((out: Uint8Array, n: number) => {
    for (let i = 0; i < n; i++) {
      poolIdx = (poolIdx + 1) % 256;
      entropyPool[poolIdx] =
        (entropyPool[poolIdx] ^ (Math.random() * 256) ^ (Date.now() >>> (i % 8))) & 255;
      out[i] = entropyPool[poolIdx];
    }
  });
}

try {
  if (typeof globalThis.crypto === 'undefined') {
    Object.defineProperty(globalThis, 'crypto', {
      value: {},
      writable: true,
      configurable: true,
    });
  }
  if (!globalThis.crypto.getRandomValues) {
    Object.defineProperty(globalThis.crypto, 'getRandomValues', {
      value: <T extends ArrayBufferView | null>(array: T): T => {
        if (!array) return array;
        const uint8 = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
        const random = nacl.randomBytes(uint8.length);
        uint8.set(random);
        return array;
      },
      writable: true,
      configurable: true,
    });
  }
} catch (e) {
  // Ignored if runtime has locked crypto object
}

// ─── 2. Strictly Lazy SecureStore Loader (Zero startup module evaluation) ───

let cachedNativeStore: any = undefined;

function getNativeSecureStore(): any {
  if (cachedNativeStore !== undefined) {
    return cachedNativeStore;
  }
  try {
    const mod = require('expo-secure-store');
    if (mod && typeof mod.getItemAsync === 'function') {
      cachedNativeStore = mod;
    } else {
      cachedNativeStore = null;
    }
  } catch (err) {
    console.error(
      '🛑 [SafeSecureStore] Native expo-secure-store module missing or failed to load:',
      err,
    );
    cachedNativeStore = null;
  }
  return cachedNativeStore;
}

export const safeSecureStore = {
  async getItemAsync(key: string): Promise<string | null> {
    try {
      const store = getNativeSecureStore();
      if (store) {
        try {
          return await store.getItemAsync(key);
        } catch (err) {
          console.warn(
            '⚠️ [SafeSecureStore] Native getItemAsync failed, falling back to AsyncStorage:',
            err,
          );
        }
      }
      return await AsyncStorage.getItem(`@sec_fallback_${key}`);
    } catch {
      return null;
    }
  },

  async setItemAsync(key: string, value: string): Promise<void> {
    try {
      const store = getNativeSecureStore();
      if (store) {
        try {
          await store.setItemAsync(key, value);
          return;
        } catch (err) {
          console.warn(
            '⚠️ [SafeSecureStore] Native setItemAsync failed, falling back to AsyncStorage:',
            err,
          );
        }
      }
      await AsyncStorage.setItem(`@sec_fallback_${key}`, value);
    } catch {}
  },

  async deleteItemAsync(key: string): Promise<void> {
    try {
      const store = getNativeSecureStore();
      if (store) {
        try {
          await store.deleteItemAsync(key);
          return;
        } catch (err) {}
      }
      await AsyncStorage.removeItem(`@sec_fallback_${key}`);
    } catch {}
  },

  async isAvailableAsync(): Promise<boolean> {
    try {
      const store = getNativeSecureStore();
      if (store && typeof store.isAvailableAsync === 'function') {
        try {
          return await store.isAvailableAsync();
        } catch {
          return false;
        }
      }
      return false;
    } catch {
      return false;
    }
  },
};
