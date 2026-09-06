/**
 * signalService.ts
 *
 * True End-to-End Encryption using Signal Protocol (X3DH + Double Ratchet).
 * Backed by @privacyresearch/libsignal-protocol-typescript.
 *
 * Multi-device architecture:
 *  - Each device has its own IdentityKey, SignedPreKey, and OneTimePreKeys.
 *  - Messages carry a `ciphertexts` array of { deviceId, ciphertext, messageType }.
 *  - Each device independently ratchets forward per conversation partner device.
 */

import {
  KeyHelper,
  SignalProtocolAddress,
  SessionBuilder,
  SessionCipher,
} from '@privacyresearch/libsignal-protocol-typescript';
import {
  signalProtocolStore,
  arrayBufferToBase64,
  base64ToArrayBuffer,
  stringToArrayBuffer,
  arrayBufferToString,
} from './signalProtocolStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiService } from './apiService';

export interface SignalCiphertextEntry {
  deviceId: number;
  ciphertext: string;
  messageType?: number;
}

// ── Positive & Negative Session Caches ─────────────────────────────────────────
// Positive cache: set of addresses (e.g. `${userId}.${deviceId}`) with verified established sessions
const activeSessionCache = new Set<string>();
let sessionsPreloaded = false;

async function preloadActiveSessions(): Promise<void> {
  if (sessionsPreloaded) return;
  try {
    const keys = await AsyncStorage.getAllKeys();
    const prefix = '@sig_sess_';
    for (const k of keys) {
      if (k.startsWith(prefix)) {
        const addr = k.substring(prefix.length);
        if (addr) activeSessionCache.add(addr);
      }
    }
    sessionsPreloaded = true;
  } catch (err) {
    console.warn('⚠️ [Signal] Failed to preload session keys:', err);
  }
}

// Negative cache: temporary cooldown for recipients who have not uploaded key bundles
const failedBundleCache = new Map<string, number>();
const FAILED_BUNDLE_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

class SignalService {
  private isInitialized = false;
  private currentUserId?: string;
  private currentDeviceId: number = 1;

  /**
   * Initialize or retrieve this device's Signal identity.
   * If new, generates 1 IdentityKey, 1 SignedPreKey, and 100 One-Time PreKeys,
   * stores private keys in SecureStore, and registers public bundle with backend.
   */
  async initDeviceKeys(userId: string, deviceId: number = 1, token: string): Promise<boolean> {
    this.currentUserId = userId;
    this.currentDeviceId = deviceId;
    await signalProtocolStore.init();

    const existingIdentity = await signalProtocolStore.getIdentityKeyPair();
    const existingRegId = await signalProtocolStore.getLocalRegistrationId();

    if (existingIdentity && existingRegId) {
      this.isInitialized = true;
      return true;
    }

    console.log('🔐 [Signal] Generating fresh device Signal keys (IK, SPK, 100 OTPKs)...');

    // 1. Registration ID & Identity Key Pair
    const registrationId = KeyHelper.generateRegistrationId();
    const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
    await signalProtocolStore.setLocalRegistrationId(registrationId);
    await signalProtocolStore.setIdentityKeyPair(identityKeyPair);

    // 2. Signed PreKey
    const signedPreKeyId = 1;
    const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, signedPreKeyId);
    await signalProtocolStore.storeSignedPreKey(signedPreKeyId, signedPreKey.keyPair);

    // 3. 100 One-Time PreKeys
    const oneTimePreKeysDto: Array<{ keyId: number; publicKey: string }> = [];
    for (let i = 1; i <= 100; i++) {
      const preKey = await KeyHelper.generatePreKey(i);
      await signalProtocolStore.storePreKey(i, preKey.keyPair);
      oneTimePreKeysDto.push({
        keyId: preKey.keyId,
        publicKey: arrayBufferToBase64(preKey.keyPair.pubKey),
      });
    }

    // 4. Register with backend
    try {
      const registerDto = {
        deviceId,
        identityPublicKey: arrayBufferToBase64(identityKeyPair.pubKey),
        signedPreKeyId,
        signedPrePublicKey: arrayBufferToBase64(signedPreKey.keyPair.pubKey),
        signedPreKeySignature: arrayBufferToBase64(signedPreKey.signature),
        oneTimePreKeys: oneTimePreKeysDto,
      };

      const res = await apiService.registerSignalKeys(token, registerDto);
      if (res.success) {
        this.isInitialized = true;
        console.log('🔐 [Signal] Device keys registered with backend successfully');
        return true;
      }
    } catch (err) {
      console.warn('⚠️ [Signal] Failed to register keys with backend:', err);
    }

    this.isInitialized = true;
    return true;
  }

  private deviceCache = new Map<string, Array<{ deviceId: number }>>();

  invalidateDeviceCache(userId?: string) {
    if (userId) {
      this.deviceCache.delete(userId);
    } else {
      this.deviceCache.clear();
    }
  }

  /**
   * Multi-device encryption:
   * Encrypts plaintext message separately for every active device of the recipient
   * (and sender's other devices).
   * Populates the ciphertexts array: [{ deviceId, ciphertext, messageType }]
   */
  async encryptForDevices(
    recipientUserId: string,
    plaintext: string,
    token: string,
  ): Promise<SignalCiphertextEntry[]> {
    if (!plaintext) return [];
    await signalProtocolStore.init();
    await preloadActiveSessions();

    // 1. Fetch recipient active devices (with caching)
    let devices: Array<{ deviceId: number }> | undefined = this.deviceCache.get(recipientUserId);
    if (!devices) {
      try {
        devices = await apiService.getDevicesForUser(recipientUserId, token);
        if (devices && devices.length > 0) {
          this.deviceCache.set(recipientUserId, devices);
        }
      } catch {}
    }

    if (!devices || devices.length === 0) {
      devices = [{ deviceId: 1 }]; // Default device
    }

    const results: SignalCiphertextEntry[] = [];
    const plaintextBuffer = stringToArrayBuffer(plaintext);

    for (const dev of devices) {
      const targetAddress = new SignalProtocolAddress(recipientUserId, dev.deviceId);
      const targetKey = targetAddress.toString();
      try {
        // ── Positive Session Cache Check ──────────────────────────────────────
        // Fast in-memory check: if session is already established, REUSE IT directly!
        let hasSession = activeSessionCache.has(targetKey);

        if (!hasSession) {
          // Check storage directly in case session was established in a prior run
          const storedSession = await signalProtocolStore.loadSession(targetKey);
          if (storedSession) {
            activeSessionCache.add(targetKey);
            hasSession = true;
          }
        }

        // Only fetch PreKey bundle if NO session exists yet (initial X3DH handshake)
        if (!hasSession) {
          const cacheKey = `${recipientUserId}:${dev.deviceId}`;
          const lastFail = failedBundleCache.get(cacheKey);
          if (!lastFail || Date.now() - lastFail > FAILED_BUNDLE_COOLDOWN_MS) {
            console.log(`🔐 [Signal] Establishing initial X3DH session with ${targetKey}`);
            const bundle = await apiService.getPreKeyBundle(recipientUserId, dev.deviceId, token);
            if (bundle) {
              // Signal Protocol processPreKey: verifies SPK signature against IdentityKey!
              const sessionBuilder = new SessionBuilder(signalProtocolStore, targetAddress);
              await sessionBuilder.processPreKey({
                identityKey: base64ToArrayBuffer(bundle.identityPublicKey),
                registrationId: bundle.registrationId,
                signedPreKey: {
                  keyId: bundle.signedPreKeyId,
                  publicKey: base64ToArrayBuffer(bundle.signedPrePublicKey),
                  signature: base64ToArrayBuffer(bundle.signedPreKeySignature),
                },
                preKey: bundle.oneTimePrePublicKey
                  ? {
                      keyId: bundle.oneTimePreKeyId ?? 0,
                      publicKey: base64ToArrayBuffer(bundle.oneTimePrePublicKey),
                    }
                  : undefined,
              });

              // Mark as active in positive cache so subsequent messages reuse it!
              activeSessionCache.add(targetKey);
              failedBundleCache.delete(cacheKey);
            } else {
              // Negative cache: prevent repeated HTTP calls for users without keys
              failedBundleCache.set(cacheKey, Date.now());
            }
          }
        }

        const cipher = new SessionCipher(signalProtocolStore, targetAddress);
        const encrypted = await cipher.encrypt(plaintextBuffer);

        // Record successful session in cache
        activeSessionCache.add(targetKey);

        results.push({
          deviceId: dev.deviceId,
          ciphertext: arrayBufferToBase64(stringToArrayBuffer(encrypted.body)),
          messageType: encrypted.type, // 3 = PREKEY, 1 = WHISPER
        });
      } catch (devErr) {
        console.warn(
          `⚠️ [Signal] Failed encrypting for ${recipientUserId}:${dev.deviceId}:`,
          devErr,
        );
        // If session is corrupt or invalidated, evict from cache so fresh bundle can be fetched on next try
        activeSessionCache.delete(targetKey);
      }
    }

    return results;
  }

  /**
   * Decrypt incoming message for this device.
   */
  async decryptMessage(
    senderUserId: string,
    senderDeviceId: number,
    ciphertextBase64: string,
    messageType: number,
  ): Promise<string> {
    await signalProtocolStore.init();
    await preloadActiveSessions();

    const senderAddress = new SignalProtocolAddress(senderUserId, senderDeviceId || 1);
    const cipher = new SessionCipher(signalProtocolStore, senderAddress);

    const binaryCiphertext = arrayBufferToString(base64ToArrayBuffer(ciphertextBase64));

    try {
      let decryptedBuf: ArrayBuffer;
      if (messageType === 3) {
        // PreKey / X3DH initiating message
        decryptedBuf = await cipher.decryptPreKeyWhisperMessage(binaryCiphertext, 'binary');
      } else {
        // Double Ratchet message
        decryptedBuf = await cipher.decryptWhisperMessage(binaryCiphertext, 'binary');
      }

      // Record incoming sender session in active cache
      activeSessionCache.add(senderAddress.toString());

      return arrayBufferToString(decryptedBuf);
    } catch (err: any) {
      console.warn(
        `⚠️ [Signal] Decryption failed for ${senderUserId}:${senderDeviceId}:`,
        err?.message,
      );
      throw err;
    }
  }

  getDeviceId(): number {
    return this.currentDeviceId;
  }
}

export const signalService = new SignalService();
