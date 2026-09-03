/**
 * e2eCryptoService.ts
 *
 * True End-to-End Encryption (E2EE) using TweetNaCl (X25519-XSalsa20-Poly1305).
 * Rules:
 *  1. Private key is generated once on-device and stored ONLY in expo-secure-store.
 *  2. Private key is NEVER sent to server, never stored in AsyncStorage, never logged.
 *  3. Each message is encrypted with nacl.box(messageUint8, nonce, recipientPublicKey, senderPrivateKey).
 *  4. Each message has a unique random 24-byte nonce generated via nacl.randomBytes(24).
 *  5. Decryption happens on the recipient device via nacl.box.open().
 *  6. If a message has no nonce (legacy pre-encryption messages), it falls back to raw text.
 */

import nacl from 'tweetnacl';
import { safeSecureStore as SecureStore } from './safeSecureStore';
import { apiService } from './apiService';

// ─── Encoding helpers (cross-platform Base64 & UTF-8) ─────────────────────────

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let base64 = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b1 = bytes[i];
    const b2 = i + 1 < len ? bytes[i + 1] : 0;
    const b3 = i + 2 < len ? bytes[i + 2] : 0;

    const triplet = (b1 << 16) | (b2 << 8) | b3;

    base64 += CHARS[(triplet >> 18) & 63];
    base64 += CHARS[(triplet >> 12) & 63];
    base64 += i + 1 < len ? CHARS[(triplet >> 6) & 63] : '=';
    base64 += i + 2 < len ? CHARS[triplet & 63] : '=';
  }
  return base64;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const len = clean.length;
  const placeHolders = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array((len * 3) / 4 - placeHolders);

  let byteIdx = 0;
  for (let i = 0; i < len; i += 4) {
    const c1 = CHARS.indexOf(clean[i]);
    const c2 = CHARS.indexOf(clean[i + 1]);
    const c3 = i + 2 < len ? CHARS.indexOf(clean[i + 2]) : 0;
    const c4 = i + 3 < len ? CHARS.indexOf(clean[i + 3]) : 0;

    const triplet = (c1 << 18) | (c2 << 12) | (c3 << 6) | c4;

    if (byteIdx < bytes.length) bytes[byteIdx++] = (triplet >> 16) & 255;
    if (byteIdx < bytes.length) bytes[byteIdx++] = (triplet >> 8) & 255;
    if (byteIdx < bytes.length) bytes[byteIdx++] = triplet & 255;
  }
  return bytes;
}

function encodeUtf8(str: string): Uint8Array {
  const unescaped = unescape(encodeURIComponent(str));
  const bytes = new Uint8Array(unescaped.length);
  for (let i = 0; i < unescaped.length; i++) {
    bytes[i] = unescaped.charCodeAt(i);
  }
  return bytes;
}

function decodeUtf8(bytes: Uint8Array): string {
  let encoded = '';
  for (let i = 0; i < bytes.length; i++) {
    encoded += String.fromCharCode(bytes[i]);
  }
  try {
    return decodeURIComponent(escape(encoded));
  } catch {
    return encoded;
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SECURE_STORE_KEY_PRIVATE = 'chat_e2e_private_key_v1';
const SECURE_STORE_KEY_PUBLIC = 'chat_e2e_public_key_v1';

class E2ECryptoService {
  private keyPair: nacl.BoxKeyPair | null = null;
  private publicKeyCache = new Map<string, string>(); // userId -> base64 publicKey

  /**
   * Initializes or loads device X25519 keypair from expo-secure-store.
   * If not present, generates a new one and stores private key in SecureStore.
   */
  async initOrGetDeviceKeyPair(): Promise<{ publicKey: string }> {
    if (this.keyPair) {
      return { publicKey: uint8ArrayToBase64(this.keyPair.publicKey) };
    }

    try {
      const storedPrivKeyB64 = await SecureStore.getItemAsync(SECURE_STORE_KEY_PRIVATE);
      const storedPubKeyB64 = await SecureStore.getItemAsync(SECURE_STORE_KEY_PUBLIC);

      if (storedPrivKeyB64 && storedPubKeyB64) {
        const secretKey = base64ToUint8Array(storedPrivKeyB64);
        const publicKey = base64ToUint8Array(storedPubKeyB64);
        this.keyPair = { publicKey, secretKey };
        return { publicKey: storedPubKeyB64 };
      }
    } catch (e) {
      console.warn('⚠️ [E2EE] Could not read from SecureStore:', e);
    }

    // Generate fresh X25519 Box keypair
    const newKeyPair = nacl.box.keyPair();
    const pubKeyB64 = uint8ArrayToBase64(newKeyPair.publicKey);
    const privKeyB64 = uint8ArrayToBase64(newKeyPair.secretKey);

    try {
      await SecureStore.setItemAsync(SECURE_STORE_KEY_PRIVATE, privKeyB64);
      await SecureStore.setItemAsync(SECURE_STORE_KEY_PUBLIC, pubKeyB64);
    } catch (saveErr) {
      console.warn('⚠️ [E2EE] Could not persist private key to SecureStore:', saveErr);
    }

    this.keyPair = newKeyPair;
    console.log('🔐 [E2EE] Generated and stored new X25519 Device KeyPair');
    return { publicKey: pubKeyB64 };
  }

  /**
   * Get current device's public key (base64)
   */
  async getMyPublicKey(): Promise<string | null> {
    const pair = await this.initOrGetDeviceKeyPair();
    return pair.publicKey;
  }

  /**
   * Syncs our public key with the backend
   */
  async registerPublicKeyWithBackend(token: string): Promise<boolean> {
    try {
      const myPubKey = await this.getMyPublicKey();
      if (!myPubKey || !token) return false;
      const res = await apiService.uploadPublicKey(token, myPubKey);
      return res.success;
    } catch (err) {
      console.warn('⚠️ [E2EE] Failed to register public key with backend:', err);
      return false;
    }
  }

  /**
   * Fetch and cache recipient's public key
   */
  async getRecipientPublicKey(userId: string, token?: string): Promise<string | null> {
    if (!userId) return null;
    const cached = this.publicKeyCache.get(userId);
    if (cached) return cached;

    try {
      const res = await apiService.getUserPublicKey(userId, token);
      if (res?.publicKey) {
        this.publicKeyCache.set(userId, res.publicKey);
        return res.publicKey;
      }
    } catch (err) {
      console.warn(`⚠️ [E2EE] Error fetching public key for ${userId}:`, err);
    }
    return null;
  }

  /**
   * Cache a user's public key in-memory
   */
  setRecipientPublicKey(userId: string, publicKey: string) {
    if (userId && publicKey) {
      this.publicKeyCache.set(userId, publicKey);
    }
  }

  /**
   * STEP 3: Encrypt plaintext message with TweetNaCl
   * nacl.box(messageUint8, nonce, recipientPublicKey, senderPrivateKey)
   */
  async encryptMessage(
    plaintext: string,
    recipientPublicKeyBase64: string,
  ): Promise<{ ciphertext: string; nonce: string } | null> {
    if (!plaintext) return null;

    await this.initOrGetDeviceKeyPair();
    if (!this.keyPair) {
      console.warn('⚠️ [E2EE] Keypair not initialized');
      return null;
    }

    try {
      const recipientPubKeyBytes = base64ToUint8Array(recipientPublicKeyBase64);
      if (recipientPubKeyBytes.length !== nacl.box.publicKeyLength) {
        console.warn('⚠️ [E2EE] Invalid recipient public key length');
        return null;
      }

      // 24-byte random nonce per message
      const nonce = nacl.randomBytes(nacl.box.nonceLength);
      const messageBytes = encodeUtf8(plaintext);

      // Authenticated X25519-XSalsa20-Poly1305 encryption
      const encryptedBytes = nacl.box(
        messageBytes,
        nonce,
        recipientPubKeyBytes,
        this.keyPair.secretKey,
      );

      return {
        ciphertext: uint8ArrayToBase64(encryptedBytes),
        nonce: uint8ArrayToBase64(nonce),
      };
    } catch (err) {
      console.warn('⚠️ [E2EE] Encryption failed:', err);
      return null;
    }
  }

  /**
   * STEP 5 & 8: Decrypt ciphertext message with TweetNaCl
   * nacl.box.open(ciphertext, nonce, senderPublicKey, receiverPrivateKey)
   *
   * Backward Compatibility (Step 8):
   * If nonce is missing or empty, treat as legacy plaintext!
   */
  async decryptMessage(
    ciphertextBase64?: string | null,
    nonceBase64?: string | null,
    senderPublicKeyBase64?: string | null,
  ): Promise<string> {
    if (!ciphertextBase64) return '';

    // Step 8: If no nonce, it is a legacy unencrypted message -> return as-is
    if (!nonceBase64) {
      return ciphertextBase64;
    }

    // If sender public key is not provided or invalid, cannot decrypt yet
    if (!senderPublicKeyBase64) {
      return '🔒 Encrypted message';
    }

    await this.initOrGetDeviceKeyPair();
    if (!this.keyPair) {
      return '🔒 Encrypted message';
    }

    try {
      const cipherBytes = base64ToUint8Array(ciphertextBase64);
      const nonceBytes = base64ToUint8Array(nonceBase64);
      const senderPubKeyBytes = base64ToUint8Array(senderPublicKeyBase64);

      if (
        nonceBytes.length !== nacl.box.nonceLength ||
        senderPubKeyBytes.length !== nacl.box.publicKeyLength
      ) {
        return ciphertextBase64; // Fallback
      }

      const decryptedBytes = nacl.box.open(
        cipherBytes,
        nonceBytes,
        senderPubKeyBytes,
        this.keyPair.secretKey,
      );

      if (!decryptedBytes) {
        console.warn('⚠️ [E2EE] Decryption failed (bad key or corrupted ciphertext)');
        return '🔒 Encrypted message';
      }

      return decodeUtf8(decryptedBytes);
    } catch (err) {
      console.warn('⚠️ [E2EE] Decryption error:', err);
      return '🔒 Encrypted message';
    }
  }
}

export const e2eCryptoService = new E2ECryptoService();
