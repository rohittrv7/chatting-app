import { Platform, DeviceEventEmitter, NativeModules } from 'react-native';
import { Audio } from 'expo-av';

export type AudioRoute = 'EARPIECE' | 'SPEAKER_PHONE' | 'BLUETOOTH' | 'WIRED_HEADSET';

export interface AudioDeviceStatus {
  availableDevices: AudioRoute[];
  selectedDevice: AudioRoute;
  hasBluetooth: boolean;
  hasWiredHeadset: boolean;
}

type RouteChangeListener = (status: AudioDeviceStatus) => void;

// audioRoutingService uses expo-av for native audio management without external native crashes

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

  constructor() {
    // Intentionally lazy: do NOT register listeners or load native modules here
  }

  private _setupEventListener() {
    if (this.deviceSubscription) return;
    try {
      this.deviceSubscription = DeviceEventEmitter.addListener(
        'onAudioDeviceChanged',
        (data: any) => {
          this._handleDeviceChange(data);
        },
      );
    } catch (err) {
      console.warn('⚠️ [AudioRoutingService] Failed to bind onAudioDeviceChanged listener:', err);
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
    if (typeof data.availableAudioDeviceList === 'string') {
      try {
        available = JSON.parse(data.availableAudioDeviceList);
      } catch (_) {
        available = ['EARPIECE', 'SPEAKER_PHONE'];
      }
    } else if (Array.isArray(data.availableAudioDeviceList)) {
      available = data.availableAudioDeviceList;
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

    console.log('🎧 [AudioRoutingService] Audio route updated:', this.currentStatus);
    this._notify();
  }

  /**
   * Start native audio session wrapping the call lifecycle
   */
  public async start(isVideo = false) {
    if (this.isStarted) return;
    this.isStarted = true;

    this._setupEventListener();

    // 1. Guaranteed Expo-AV audio mode setup
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        playThroughEarpieceAndroid: !isVideo,
      });
    } catch (expoErr) {
      console.warn('⚠️ [AudioRoutingService] expo-av setAudioModeAsync warning:', expoErr);
    }

    this.currentStatus.selectedDevice = isVideo ? 'SPEAKER_PHONE' : 'EARPIECE';
    this._notify();
  }

  /**
   * Stop native audio session when call terminates
   */
  public async stop() {
    if (!this.isStarted) return;
    this.isStarted = false;

    this._removeEventListener();

    // Reset expo-av audio mode
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        playThroughEarpieceAndroid: false,
      });
    } catch (_) {}
  }

  /**
   * Toggle or set speakerphone state
   */
  public async setSpeakerphoneOn(enable: boolean) {
    this.currentStatus.selectedDevice = enable ? 'SPEAKER_PHONE' : 'EARPIECE';
    this._notify();

    // Expo-AV hardware audio routing
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        playThroughEarpieceAndroid: !enable,
      });
    } catch (_) {}
  }

  /**
   * Manually choose an audio route (EARPIECE, SPEAKER_PHONE, BLUETOOTH, WIRED_HEADSET)
   */
  public async chooseAudioRoute(route: AudioRoute): Promise<AudioDeviceStatus> {
    if (route === 'SPEAKER_PHONE') {
      await this.setSpeakerphoneOn(true);
    } else if (route === 'EARPIECE') {
      await this.setSpeakerphoneOn(false);
    } else {
      this.currentStatus.selectedDevice = route;
      this._notify();
    }
    return this.currentStatus;
  }

  public getStatus(): AudioDeviceStatus {
    return { ...this.currentStatus };
  }

  public addListener(listener: RouteChangeListener) {
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
