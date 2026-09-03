/**
 * signalProtocolStore.ts
 *
 * Implements SignalProtocolStore (StorageType) for @privacyresearch/libsignal-protocol-typescript.
 *
 * HYBRID STORAGE ARCHITECTURE (Resolves iOS 2048-byte Keychain limit):
 * 1. Hardware Keystore / iOS Keychain (expo-secure-store):
 *    - Stores only the 32-byte Master Encryption Key, Identity Key Pair (< 200 bytes), and Registration ID (4 bytes).
 * 2. High-Capacity Encrypted Local Store (AsyncStorage + nacl.secretbox):
 *    - All Double Ratchet session records, Signed PreKeys, and One-Time PreKeys are symmetrically
 *      encrypted with the hardware-backed Master Key and stored in AsyncStorage.
 * 3. In-Memory Write-Through Cache:
 *    - Provides fast access during real-time chat sessions.
 */

import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import nacl from 'tweetnacl';
import {
  StorageType,
  KeyPairType,
  Direction,
  SessionRecordType,
} from '@privacyresearch/libsignal-protocol-typescript';

// ─── Binary / Base64 Helpers ─────────────────────────────────────────────────

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function arrayBufferToBase64(buffer: ArrayBufferLike | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer as ArrayBuffer);
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

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
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
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

export function stringToArrayBuffer(str: string): ArrayBuffer {
  const unescaped = unescape(encodeURIComponent(str));
  const bytes = new Uint8Array(unescaped.length);
  for (let i = 0; i < unescaped.length; i++) {
    bytes[i] = unescaped.charCodeAt(i);
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

export function arrayBufferToString(buffer: ArrayBufferLike | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer as ArrayBuffer);
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

// ─── Hardware-Backed Master Key Management ───────────────────────────────────

const MASTER_KEY_STORAGE_KEY = 'sig_master_db_key_v1';
const PREFIX_IDENTITY = 'sig_id_key';
const PREFIX_REGISTRATION_ID = 'sig_reg_id';
const ASYNC_PREFIX_PRE_KEY = '@sig_pk_';
const ASYNC_PREFIX_SIGNED_PRE_KEY = '@sig_spk_';
const ASYNC_PREFIX_SESSION = '@sig_sess_';
const ASYNC_PREFIX_REMOTE_IDENTITY = '@sig_rem_id_';

class SignalProtocolStore implements StorageType {
  private masterKey?: Uint8Array;
  private identityKeyPair?: KeyPairType<ArrayBuffer>;
  private registrationId?: number;
  private preKeys = new Map<string, KeyPairType<ArrayBuffer>>();
  private signedPreKeys = new Map<string, KeyPairType<ArrayBuffer>>();
  private sessions = new Map<string, SessionRecordType>();
  private remoteIdentities = new Map<string, ArrayBuffer>();
  private isLoaded = false;

  private async getOrInitMasterKey(maxAttempts = 3): Promise<Uint8Array> {
    if (this.masterKey) return this.masterKey;

    let lastError: any = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        let storedKeyB64: string | null = null;
        try {
          storedKeyB64 = await SecureStore.getItemAsync(MASTER_KEY_STORAGE_KEY);
        } catch (readErr: any) {
          // Transient keystore / locked keychain error: retry before failing hard
          console.warn(
            `⚠️ [SignalStore] SecureStore read attempt ${attempt}/${maxAttempts} failed:`,
            readErr?.message || readErr,
          );
          if (attempt < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
            continue;
          }
          throw new Error(
            'Secure storage is temporarily locked. Please unlock your device and tap Retry.',
          );
        }

        if (storedKeyB64) {
          this.masterKey = new Uint8Array(base64ToArrayBuffer(storedKeyB64));
          return this.masterKey;
        }

        // Key truly does not exist on this device yet. Generate fresh 32-byte symmetric master key ONCE.
        const freshKey = nacl.randomBytes(32);
        const freshKeyB64 = arrayBufferToBase64(freshKey);

        try {
          await SecureStore.setItemAsync(MASTER_KEY_STORAGE_KEY, freshKeyB64);
        } catch (writeErr: any) {
          console.warn(
            `⚠️ [SignalStore] SecureStore write attempt ${attempt}/${maxAttempts} failed:`,
            writeErr?.message || writeErr,
          );
          if (attempt < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
            continue;
          }
          throw new Error(
            "Couldn't set up secure storage, please retry. Please verify device security and storage permissions.",
          );
        }

        // Only assign to in-memory cache once durability in SecureStore is 100% guaranteed
        this.masterKey = freshKey;
        return freshKey;
      } catch (err: any) {
        lastError = err;
        if (attempt >= maxAttempts) break;
      }
    }

    throw lastError || new Error('Secure storage is unavailable. Please retry.');
  }

  private async encryptPayload(plaintext: string): Promise<string> {
    const key = await this.getOrInitMasterKey();
    const nonce = nacl.randomBytes(24);
    const plainBytes = new Uint8Array(stringToArrayBuffer(plaintext));
    const box = nacl.secretbox(plainBytes, nonce, key);

    return JSON.stringify({
      n: arrayBufferToBase64(nonce),
      c: arrayBufferToBase64(box),
    });
  }

  private async decryptPayload(encryptedJson: string): Promise<string | null> {
    try {
      const key = await this.getOrInitMasterKey();
      const parsed = JSON.parse(encryptedJson);
      const nonce = new Uint8Array(base64ToArrayBuffer(parsed.n));
      const box = new Uint8Array(base64ToArrayBuffer(parsed.c));
      const opened = nacl.secretbox.open(box, nonce, key);
      if (!opened) return null;
      return arrayBufferToString(opened);
    } catch {
      return null;
    }
  }

  async init(): Promise<void> {
    if (this.isLoaded) return;
    try {
      await this.getOrInitMasterKey();

      // 1. Load Registration ID from SecureStore (< 10 bytes)
      const regIdStr = await SecureStore.getItemAsync(PREFIX_REGISTRATION_ID);
      if (regIdStr) {
        this.registrationId = parseInt(regIdStr, 10);
      }

      // 2. Load Identity Key Pair from SecureStore (~150 bytes, well under 2048B)
      const identityJson = await SecureStore.getItemAsync(PREFIX_IDENTITY);
      if (identityJson) {
        const parsed = JSON.parse(identityJson);
        this.identityKeyPair = {
          pubKey: base64ToArrayBuffer(parsed.pubKey),
          privKey: base64ToArrayBuffer(parsed.privKey),
        };
      }
    } catch (e) {
      console.warn('⚠️ [SignalStore] Error initializing keys:', e);
    }
    this.isLoaded = true;
  }

  // ─── Registration ID ────────────────────────────────────────────────────────

  async setLocalRegistrationId(registrationId: number): Promise<void> {
    this.registrationId = registrationId;
    await SecureStore.setItemAsync(PREFIX_REGISTRATION_ID, registrationId.toString());
  }

  async getLocalRegistrationId(): Promise<number | undefined> {
    if (this.registrationId !== undefined) return this.registrationId;
    const str = await SecureStore.getItemAsync(PREFIX_REGISTRATION_ID);
    if (str) {
      this.registrationId = parseInt(str, 10);
      return this.registrationId;
    }
    return undefined;
  }

  // ─── Identity Key Pair ──────────────────────────────────────────────────────

  async setIdentityKeyPair(keyPair: KeyPairType<ArrayBuffer>): Promise<void> {
    this.identityKeyPair = keyPair;
    const payload = JSON.stringify({
      pubKey: arrayBufferToBase64(keyPair.pubKey),
      privKey: arrayBufferToBase64(keyPair.privKey),
    });
    await SecureStore.setItemAsync(PREFIX_IDENTITY, payload);
  }

  async getIdentityKeyPair(): Promise<KeyPairType<ArrayBuffer> | undefined> {
    if (this.identityKeyPair) return this.identityKeyPair;
    const json = await SecureStore.getItemAsync(PREFIX_IDENTITY);
    if (json) {
      const parsed = JSON.parse(json);
      this.identityKeyPair = {
        pubKey: base64ToArrayBuffer(parsed.pubKey),
        privKey: base64ToArrayBuffer(parsed.privKey),
      };
      return this.identityKeyPair;
    }
    return undefined;
  }

  // ─── Remote Identity Trust ──────────────────────────────────────────────────

  async isTrustedIdentity(
    identifier: string,
    identityKey: ArrayBuffer,
    _direction: Direction,
  ): Promise<boolean> {
    const existing = await this.getRemoteIdentity(identifier);
    if (!existing) return true;

    const existingB64 = arrayBufferToBase64(existing);
    const incomingB64 = arrayBufferToBase64(identityKey);
    return existingB64 === incomingB64;
  }

  async saveIdentity(
    encodedAddress: string,
    publicKey: ArrayBuffer,
    _nonblockingApproval?: boolean,
  ): Promise<boolean> {
    const key = `${ASYNC_PREFIX_REMOTE_IDENTITY}${encodedAddress}`;
    this.remoteIdentities.set(encodedAddress, publicKey);
    const encrypted = await this.encryptPayload(arrayBufferToBase64(publicKey));
    await AsyncStorage.setItem(key, encrypted);
    return true;
  }

  private async getRemoteIdentity(identifier: string): Promise<ArrayBuffer | undefined> {
    if (this.remoteIdentities.has(identifier)) {
      return this.remoteIdentities.get(identifier);
    }
    const key = `${ASYNC_PREFIX_REMOTE_IDENTITY}${identifier}`;
    const enc = await AsyncStorage.getItem(key);
    if (enc) {
      const dec = await this.decryptPayload(enc);
      if (dec) {
        const buf = base64ToArrayBuffer(dec);
        this.remoteIdentities.set(identifier, buf);
        return buf;
      }
    }
    return undefined;
  }

  // ─── One-Time PreKeys (Encrypted AsyncStorage) ───────────────────────────────

  async loadPreKey(keyId: string | number): Promise<KeyPairType<ArrayBuffer> | undefined> {
    const id = keyId.toString();
    if (this.preKeys.has(id)) return this.preKeys.get(id);

    const key = `${ASYNC_PREFIX_PRE_KEY}${id}`;
    const enc = await AsyncStorage.getItem(key);
    if (enc) {
      const dec = await this.decryptPayload(enc);
      if (dec) {
        const parsed = JSON.parse(dec);
        const pair: KeyPairType<ArrayBuffer> = {
          pubKey: base64ToArrayBuffer(parsed.pubKey),
          privKey: base64ToArrayBuffer(parsed.privKey),
        };
        this.preKeys.set(id, pair);
        return pair;
      }
    }
    return undefined;
  }

  async storePreKey(keyId: string | number, keyPair: KeyPairType<ArrayBuffer>): Promise<void> {
    const id = keyId.toString();
    this.preKeys.set(id, keyPair);
    const key = `${ASYNC_PREFIX_PRE_KEY}${id}`;
    const payload = JSON.stringify({
      pubKey: arrayBufferToBase64(keyPair.pubKey),
      privKey: arrayBufferToBase64(keyPair.privKey),
    });
    const encrypted = await this.encryptPayload(payload);
    await AsyncStorage.setItem(key, encrypted);
  }

  async removePreKey(keyId: string | number): Promise<void> {
    const id = keyId.toString();
    this.preKeys.delete(id);
    const key = `${ASYNC_PREFIX_PRE_KEY}${id}`;
    await AsyncStorage.removeItem(key);
  }

  // ─── Signed PreKeys (Encrypted AsyncStorage) ─────────────────────────────────

  async loadSignedPreKey(keyId: string | number): Promise<KeyPairType<ArrayBuffer> | undefined> {
    const id = keyId.toString();
    if (this.signedPreKeys.has(id)) return this.signedPreKeys.get(id);

    const key = `${ASYNC_PREFIX_SIGNED_PRE_KEY}${id}`;
    const enc = await AsyncStorage.getItem(key);
    if (enc) {
      const dec = await this.decryptPayload(enc);
      if (dec) {
        const parsed = JSON.parse(dec);
        const pair: KeyPairType<ArrayBuffer> = {
          pubKey: base64ToArrayBuffer(parsed.pubKey),
          privKey: base64ToArrayBuffer(parsed.privKey),
        };
        this.signedPreKeys.set(id, pair);
        return pair;
      }
    }
    return undefined;
  }

  async storeSignedPreKey(
    keyId: string | number,
    keyPair: KeyPairType<ArrayBuffer>,
  ): Promise<void> {
    const id = keyId.toString();
    this.signedPreKeys.set(id, keyPair);
    const key = `${ASYNC_PREFIX_SIGNED_PRE_KEY}${id}`;
    const payload = JSON.stringify({
      pubKey: arrayBufferToBase64(keyPair.pubKey),
      privKey: arrayBufferToBase64(keyPair.privKey),
    });
    const encrypted = await this.encryptPayload(payload);
    await AsyncStorage.setItem(key, encrypted);
  }

  async removeSignedPreKey(keyId: string | number): Promise<void> {
    const id = keyId.toString();
    this.signedPreKeys.delete(id);
    const key = `${ASYNC_PREFIX_SIGNED_PRE_KEY}${id}`;
    await AsyncStorage.removeItem(key);
  }

  // ─── Sessions (Encrypted AsyncStorage — NO 2048-byte iOS limit!) ────────────

  async loadSession(encodedAddress: string): Promise<SessionRecordType | undefined> {
    if (this.sessions.has(encodedAddress)) {
      return this.sessions.get(encodedAddress);
    }
    const key = `${ASYNC_PREFIX_SESSION}${encodedAddress}`;
    const enc = await AsyncStorage.getItem(key);
    if (enc) {
      const dec = await this.decryptPayload(enc);
      if (dec) {
        this.sessions.set(encodedAddress, dec);
        return dec;
      }
    }
    return undefined;
  }

  async storeSession(encodedAddress: string, record: SessionRecordType): Promise<void> {
    this.sessions.set(encodedAddress, record);
    const key = `${ASYNC_PREFIX_SESSION}${encodedAddress}`;
    const encrypted = await this.encryptPayload(record);
    await AsyncStorage.setItem(key, encrypted);
  }

  async removeSession(encodedAddress: string): Promise<void> {
    this.sessions.delete(encodedAddress);
    const key = `${ASYNC_PREFIX_SESSION}${encodedAddress}`;
    await AsyncStorage.removeItem(key);
  }

  async removeAllSessions(): Promise<void> {
    this.sessions.clear();
  }
}

export const signalProtocolStore = new SignalProtocolStore();
