/**
 * Polyfills & Runtime Guards for React Native Hermes Engine
 *
 * Hermes provides a native TextDecoder, but it only supports 'utf-8'.
 * When libraries (like Emscripten / WebAssembly / crypto / curve25519) execute
 * `new TextDecoder('utf-16le')`, Hermes throws:
 * "RangeError: Unknown encoding: utf-16le (normalized: utf-16le)"
 * at assertValidUTF8Label, which crashes the Android app immediately on launch.
 *
 * This polyfill proxies global.TextDecoder to safely support all encodings
 * without ever throwing an unhandled RangeError.
 */

if (typeof global !== 'undefined') {
  const NativeTextDecoder = (global as any).TextDecoder;

  class SafeTextDecoder {
    encoding: string;
    fatal: boolean;
    ignoreBOM: boolean;
    private _nativeDecoder?: any;

    constructor(label: string = 'utf-8', options: any = {}) {
      const normalized = (label || 'utf-8').toLowerCase().trim().replace(/_/g, '-');
      this.encoding = normalized;
      this.fatal = Boolean(options?.fatal);
      this.ignoreBOM = Boolean(options?.ignoreBOM);

      // If utf-8, use Hermes native decoder when possible
      if (normalized === 'utf-8' || normalized === 'utf8') {
        if (NativeTextDecoder) {
          try {
            this._nativeDecoder = new NativeTextDecoder('utf-8', options);
          } catch (_) {
            this._nativeDecoder = null;
          }
        }
      }
    }

    decode(input?: any, options?: any): string {
      if (!input) return '';

      let bytes: Uint8Array;
      if (input instanceof Uint8Array) {
        bytes = input;
      } else if (ArrayBuffer.isView(input)) {
        bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
      } else if (input instanceof ArrayBuffer) {
        bytes = new Uint8Array(input);
      } else {
        bytes = new Uint8Array(input);
      }

      // Fast-path: native UTF-8
      if (this._nativeDecoder) {
        try {
          return this._nativeDecoder.decode(bytes, options);
        } catch (_) {}
      }

      const enc = this.encoding;

      // UTF-16 Little Endian (utf-16le / ucs-2)
      if (enc === 'utf-16le' || enc === 'utf-16' || enc === 'utf16le' || enc === 'ucs-2') {
        let str = '';
        for (let i = 0; i < bytes.length; i += 2) {
          if (i + 1 < bytes.length) {
            str += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
          } else {
            str += String.fromCharCode(bytes[i]);
          }
        }
        return str;
      }

      // UTF-16 Big Endian
      if (enc === 'utf-16be' || enc === 'utf16be') {
        let str = '';
        for (let i = 0; i < bytes.length; i += 2) {
          if (i + 1 < bytes.length) {
            str += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
          } else {
            str += String.fromCharCode(bytes[i] << 8);
          }
        }
        return str;
      }

      // Pure JS UTF-8 fallback
      try {
        let out = '';
        let i = 0;
        while (i < bytes.length) {
          const c = bytes[i++];
          if (c < 0x80) {
            out += String.fromCharCode(c);
          } else if (c > 0xbf && c < 0xe0) {
            out += String.fromCharCode(((c & 0x1f) << 6) | (bytes[i++] & 0x3f));
          } else if (c > 0xdf && c < 0xf0) {
            out += String.fromCharCode(
              ((c & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f),
            );
          } else {
            const u =
              (((c & 0x07) << 18) |
                ((bytes[i++] & 0x3f) << 12) |
                ((bytes[i++] & 0x3f) << 6) |
                (bytes[i++] & 0x3f)) -
              0x10000;
            out += String.fromCharCode(0xd800 + (u >> 10), 0xdc00 + (u & 0x3ff));
          }
        }
        return out;
      } catch (_) {
        return '';
      }
    }
  }

  // Assign to global
  (global as any).TextDecoder = SafeTextDecoder;
}
