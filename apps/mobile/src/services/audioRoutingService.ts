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

/**
 * Safe, crash-proof dynamic resolver for react-native-incall-manager.
 * Ensures the native module is never loaded during app bootstrap,
 * and if the native module is missing or throws, gracefully returns null.
 */
let _inCallManager: any = null;
let _inCallManagerChecked = false;

function getInCallManager(): any {
  if (!_inCallManagerChecked) {
    _inCallManagerChecked = true;
    try {
      if (NativeModules && NativeModules.InCallManager) {
        _inCallManager = require('react-native-incall-manager');
        if (_inCallManager && _inCallManager.default) {
          _inCallManager = _inCallManager.default;
        }
      } else {
        _inCallManager = null;
      }
    } catch (err) {
      console.warn(
        '⚠️ [AudioRoutingService] Native InCallManager unavailable, using expo-av fallback:',
        err,
      );
      _inCallManager = null;
    }
  }
  return _inCallManager;
}

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

    // 2. Optional native InCallManager start if available
    const incall = getInCallManager();
    if (incall && typeof incall.start === 'function') {
      try {
        incall.start({
          media: isVideo ? 'video' : 'audio',
          auto: true,
        });

        if (isVideo) {
          this.setSpeakerphoneOn(true);
        } else {
          if (this.currentStatus.hasBluetooth) {
            this.chooseAudioRoute('BLUETOOTH');
          } else {
            this.setSpeakerphoneOn(false);
          }
        }
      } catch (err) {
        console.warn('⚠️ [AudioRoutingService] Error starting InCallManager:', err);
      }
    } else {
      this.currentStatus.selectedDevice = isVideo ? 'SPEAKER_PHONE' : 'EARPIECE';
      this._notify();
    }
  }

  /**
   * Stop native audio session when call terminates
   */
  public async stop() {
    if (!this.isStarted) return;
    this.isStarted = false;

    this._removeEventListener();

    // 1. InCallManager stop if available
    const incall = getInCallManager();
    if (incall && typeof incall.stop === 'function') {
      try {
        incall.stop();
      } catch (err) {
        console.warn('⚠️ [AudioRoutingService] Error stopping InCallManager:', err);
      }
    }

    // 2. Reset expo-av audio mode
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

    // 1. Expo-AV hardware audio routing
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        playThroughEarpieceAndroid: !enable,
      });
    } catch (_) {}

    // 2. InCallManager if present
    const incall = getInCallManager();
    if (incall && typeof incall.setForceSpeakerphoneOn === 'function') {
      try {
        incall.setForceSpeakerphoneOn(enable);
      } catch (err) {
        console.warn('⚠️ [AudioRoutingService] Error setting speakerphone:', err);
      }
    }
  }

  /**
   * Manually choose an audio route (EARPIECE, SPEAKER_PHONE, BLUETOOTH, WIRED_HEADSET)
   */
  public async chooseAudioRoute(route: AudioRoute): Promise<AudioDeviceStatus> {
    const incall = getInCallManager();
    if (incall && typeof incall.chooseAudioRoute === 'function') {
      try {
        const result = await incall.chooseAudioRoute(route);
        if (result) {
          this._handleDeviceChange(result);
          return this.currentStatus;
        }
      } catch (err) {
        console.warn(`⚠️ [AudioRoutingService] Error choosing route ${route}:`, err);
      }
    }

    // Fallback: handle speaker vs earpiece
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
