/**
 * audioRoutingService.ts — Native audio routing for calls
 *
 * Uses react-native-incall-manager (InCallManager) which provides real
 * Bluetooth SCO routing, wired-headset detection, and proper earpiece/
 * speaker management during calls.
 *
 * InCallManager emits 'onAudioDeviceChanged' via DeviceEventEmitter with:
 *   { availableAudioDeviceList: AudioRoute[], selectedAudioDevice: AudioRoute }
 *
 * expo-av is still used as a fallback for iOS audio session setup only
 * (allowsRecordingIOS, playsInSilentModeIOS).
 */
import { Platform, DeviceEventEmitter } from 'react-native';

let Audio: any = null;
try {
  Audio = require('expo-av')?.Audio;
} catch (_) {}

// Safe dynamic import — InCallManager is a native module.
// metro.config.js maps this to inCallManagerShim.js in Expo Go / metro bundles.
// In a real EAS development build, the actual native module will be compiled in
// and react-native-incall-manager will work fully.
let InCallManager: any = null;
try {
  InCallManager = require('react-native-incall-manager').default;
  if (InCallManager && typeof InCallManager.start !== 'function') {
    InCallManager = null; // shim loaded — treat as unavailable
  }
} catch (_) {
  // Not available — expo-av fallback will be used
}

export type AudioRoute = 'EARPIECE' | 'SPEAKER_PHONE' | 'BLUETOOTH' | 'WIRED_HEADSET';

export interface AudioDeviceStatus {
  availableDevices: AudioRoute[];
  selectedDevice: AudioRoute;
  hasBluetooth: boolean;
  hasWiredHeadset: boolean;
}

type RouteChangeListener = (status: AudioDeviceStatus) => void;

class AudioRoutingService {
  private isStarted = false;
  private currentStatus: AudioDeviceStatus = {
    availableDevices: ['EARPIECE', 'SPEAKER_PHONE'],
    selectedDevice: 'EARPIECE',
    hasBluetooth: false,
    hasWiredHeadset: false,
  };

  private listeners: Set<RouteChangeListener> = new Set();
  private deviceSubscription: any = null;

  constructor() {}

  // ─── Private: event listener ─────────────────────────────────────────────

  private _setupEventListener() {
    if (this.deviceSubscription) return;
    try {
      // InCallManager emits this event when Bluetooth connects/disconnects,
      // wired headset is plugged in, or the user manually changes route.
      this.deviceSubscription = DeviceEventEmitter.addListener(
        'onAudioDeviceChanged',
        (data: any) => this._handleDeviceChange(data),
      );
    } catch (err) {
      console.warn('[AudioRoutingService] Failed to bind onAudioDeviceChanged:', err);
    }
  }

  private _removeEventListener() {
    if (this.deviceSubscription) {
      try {
        this.deviceSubscription.remove();
      } catch (_) {}
      this.deviceSubscription = null;
    }
  }

  private _handleDeviceChange(data: any) {
    if (!data) return;

    let available: AudioRoute[] = [];
    const rawList = data.availableAudioDeviceList;
    if (typeof rawList === 'string') {
      try {
        available = JSON.parse(rawList);
      } catch (_) {
        available = ['EARPIECE', 'SPEAKER_PHONE'];
      }
    } else if (Array.isArray(rawList)) {
      available = rawList as AudioRoute[];
    }

    const selected = (data.selectedAudioDevice as AudioRoute) || this.currentStatus.selectedDevice;
    const hasBluetooth = available.includes('BLUETOOTH');
    const hasWiredHeadset = available.includes('WIRED_HEADSET');

    this.currentStatus = {
      availableDevices: available.length > 0 ? available : ['EARPIECE', 'SPEAKER_PHONE'],
      selectedDevice: selected,
      hasBluetooth,
      hasWiredHeadset,
    };
    console.log('🎧 [AudioRoutingService] Route changed:', this.currentStatus);
    this._notify();
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Start the native audio session at the beginning of a call.
   * - Starts InCallManager (handles Bluetooth SCO, proximity sensor, keep-awake)
   * - Sets up DeviceEventEmitter listener for route changes
   * - Probes wired headset state immediately so UI reflects pre-connected devices
   */
  public async start(isVideo = false) {
    if (this.isStarted) return;
    this.isStarted = true;

    this._setupEventListener();

    // expo-av: configure iOS audio session for recording + playback
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        playThroughEarpieceAndroid: false, // InCallManager handles routing on Android
      });
    } catch (err) {
      console.warn('[AudioRoutingService] expo-av setAudioModeAsync:', err);
    }

    // InCallManager: start native call audio session
    if (InCallManager) {
      try {
        InCallManager.start({ media: isVideo ? 'video' : 'audio', auto: true });
        // Request Android audio focus
        if (Platform.OS === 'android') {
          await InCallManager.requestAudioFocus().catch(() => {});
        }
        // Probe wired headset state immediately
        const headsetInfo = await InCallManager.getIsWiredHeadsetPluggedIn().catch(() => ({
          isWiredHeadsetPluggedIn: false,
        }));
        if (headsetInfo.isWiredHeadsetPluggedIn) {
          const available: AudioRoute[] = ['EARPIECE', 'SPEAKER_PHONE', 'WIRED_HEADSET'];
          this.currentStatus = {
            availableDevices: available,
            selectedDevice: 'WIRED_HEADSET',
            hasBluetooth: false,
            hasWiredHeadset: true,
          };
        } else {
          this.currentStatus.selectedDevice = isVideo ? 'SPEAKER_PHONE' : 'EARPIECE';
        }
      } catch (err) {
        console.warn('[AudioRoutingService] InCallManager.start error:', err);
        this.currentStatus.selectedDevice = isVideo ? 'SPEAKER_PHONE' : 'EARPIECE';
      }
    } else {
      // Fallback: expo-av only
      this.currentStatus.selectedDevice = isVideo ? 'SPEAKER_PHONE' : 'EARPIECE';
      if (!isVideo) {
        try {
          await Audio.setAudioModeAsync({
            playThroughEarpieceAndroid: true,
            allowsRecordingIOS: true,
            playsInSilentModeIOS: true,
            staysActiveInBackground: true,
          });
        } catch (_) {}
      }
    }

    this._notify();
  }

  /**
   * Stop the native audio session when the call ends.
   */
  public async stop() {
    if (!this.isStarted) return;
    this.isStarted = false;

    this._removeEventListener();

    if (InCallManager) {
      try {
        if (Platform.OS === 'android') {
          await InCallManager.abandonAudioFocus().catch(() => {});
        }
        InCallManager.stop();
      } catch (err) {
        console.warn('[AudioRoutingService] InCallManager.stop error:', err);
      }
    }

    // Restore expo-av to normal media playback mode
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        playThroughEarpieceAndroid: false,
      });
    } catch (_) {}

    // Reset status
    this.currentStatus = {
      availableDevices: ['EARPIECE', 'SPEAKER_PHONE'],
      selectedDevice: 'EARPIECE',
      hasBluetooth: false,
      hasWiredHeadset: false,
    };
    this._notify();
  }

  /**
   * Toggle or directly set speakerphone.
   */
  public async setSpeakerphoneOn(enable: boolean) {
    const route: AudioRoute = enable ? 'SPEAKER_PHONE' : 'EARPIECE';
    await this.chooseAudioRoute(route);
  }

  /**
   * Choose an audio output route.
   * SPEAKER_PHONE / EARPIECE: use InCallManager.setSpeakerphoneOn()
   * BLUETOOTH: use InCallManager.chooseAudioRoute('BLUETOOTH') — routes via SCO
   * WIRED_HEADSET: use InCallManager.chooseAudioRoute('WIRED_HEADSET')
   */
  public async chooseAudioRoute(route: AudioRoute): Promise<AudioDeviceStatus> {
    this.currentStatus.selectedDevice = route;
    this._notify();

    if (InCallManager) {
      try {
        if (route === 'SPEAKER_PHONE') {
          InCallManager.setForceSpeakerphoneOn(true);
          InCallManager.setSpeakerphoneOn(true);
        } else if (route === 'EARPIECE') {
          InCallManager.setForceSpeakerphoneOn(false);
          InCallManager.setSpeakerphoneOn(false);
        } else if (route === 'BLUETOOTH') {
          // Route audio to Bluetooth SCO headset
          InCallManager.setForceSpeakerphoneOn(false);
          InCallManager.setSpeakerphoneOn(false);
          await InCallManager.chooseAudioRoute('BLUETOOTH').catch(() => {});
        } else if (route === 'WIRED_HEADSET') {
          InCallManager.setForceSpeakerphoneOn(false);
          InCallManager.setSpeakerphoneOn(false);
          await InCallManager.chooseAudioRoute('WIRED_HEADSET').catch(() => {});
        }
      } catch (err) {
        console.warn('[AudioRoutingService] chooseAudioRoute error:', err);
      }
    } else {
      // expo-av fallback: speaker/earpiece only
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
          playThroughEarpieceAndroid: route === 'EARPIECE',
        });
      } catch (_) {}
    }

    return this.getStatus();
  }

  public getStatus(): AudioDeviceStatus {
    return { ...this.currentStatus };
  }

  public addListener(listener: RouteChangeListener): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private _notify() {
    const status = this.getStatus();
    this.listeners.forEach((l) => {
      try {
        l(status);
      } catch (_) {}
    });
  }
}

export const audioRoutingService = new AudioRoutingService();
