import { Platform, DeviceEventEmitter } from 'react-native';
import InCallManager from 'react-native-incall-manager';

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

  constructor() {
    this._setupEventListener();
  }

  private _setupEventListener() {
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
  public start(isVideo = false) {
    if (this.isStarted) return;
    this.isStarted = true;

    try {
      InCallManager.start({
        media: isVideo ? 'video' : 'audio',
        auto: true,
      });

      // Default route: for video -> speaker, for audio -> earpiece (or bluetooth if connected)
      if (isVideo) {
        this.setSpeakerphoneOn(true);
      } else {
        // Auto-select bluetooth headset if already connected at call start
        if (this.currentStatus.hasBluetooth) {
          console.log(
            '🎧 [AudioRoutingService] Bluetooth device detected at call start - selecting Bluetooth route',
          );
          this.chooseAudioRoute('BLUETOOTH');
        } else {
          this.setSpeakerphoneOn(false);
        }
      }

      console.log(
        `🎙️ [AudioRoutingService] InCallManager started (media: ${isVideo ? 'video' : 'audio'})`,
      );
    } catch (err) {
      console.warn('⚠️ [AudioRoutingService] Error starting InCallManager:', err);
    }
  }

  /**
   * Stop native audio session when call terminates
   */
  public stop() {
    if (!this.isStarted) return;
    this.isStarted = false;

    try {
      InCallManager.stop();
      console.log('🎙️ [AudioRoutingService] InCallManager stopped');
    } catch (err) {
      console.warn('⚠️ [AudioRoutingService] Error stopping InCallManager:', err);
    }
  }

  /**
   * Toggle or set speakerphone state
   */
  public setSpeakerphoneOn(enable: boolean) {
    try {
      InCallManager.setForceSpeakerphoneOn(enable);
      this.currentStatus.selectedDevice = enable ? 'SPEAKER_PHONE' : 'EARPIECE';
      this._notify();
      console.log(`🔊 [AudioRoutingService] Speakerphone force set to: ${enable}`);
    } catch (err) {
      console.warn('⚠️ [AudioRoutingService] Error setting speakerphone:', err);
    }
  }

  /**
   * Manually choose an audio route (EARPIECE, SPEAKER_PHONE, BLUETOOTH, WIRED_HEADSET)
   */
  public async chooseAudioRoute(route: AudioRoute): Promise<AudioDeviceStatus> {
    try {
      const result = await InCallManager.chooseAudioRoute(route);
      if (result) {
        this._handleDeviceChange(result);
      } else {
        this.currentStatus.selectedDevice = route;
        this._notify();
      }
      console.log(`🎯 [AudioRoutingService] chooseAudioRoute -> ${route}`);
    } catch (err) {
      console.warn(`⚠️ [AudioRoutingService] Error choosing route ${route}:`, err);
      // Fallback for speaker vs earpiece
      if (route === 'SPEAKER_PHONE') {
        this.setSpeakerphoneOn(true);
      } else if (route === 'EARPIECE') {
        this.setSpeakerphoneOn(false);
      }
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
