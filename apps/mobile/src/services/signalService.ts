/**
 * signalService.ts
 *
 * E2EE completely removed for high-speed instant socket messaging.
 * Stubs are maintained for interface compatibility without any crypto overhead or network requests.
 */

export interface SignalCiphertextEntry {
  deviceId: number;
  ciphertext: string;
  messageType?: number;
}

export const ENCRYPTION_ENABLED = false;

class SignalService {
  private currentDeviceId: number = 1;

  async initDeviceKeys(_userId: string, deviceId: number = 1, _token: string): Promise<boolean> {
    this.currentDeviceId = deviceId;
    return true;
  }

  invalidateDeviceCache(_userId?: string): void {}

  async encryptForDevices(
    _recipientUserId: string,
    plaintext: string,
    _token: string,
  ): Promise<SignalCiphertextEntry[]> {
    return [{ deviceId: 1, ciphertext: plaintext, messageType: 1 }];
  }

  async decryptMessage(
    _senderUserId: string,
    _senderDeviceId: number,
    ciphertextBase64: string,
    _messageType: number,
  ): Promise<string> {
    return ciphertextBase64;
  }

  getDeviceId(): number {
    return this.currentDeviceId;
  }
}

export const signalService = new SignalService();
