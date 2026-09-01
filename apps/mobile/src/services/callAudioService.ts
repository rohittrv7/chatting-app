import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { socketService } from './socket';

// HD Voice Wideband Preset (24kHz Mono AAC — standard for VoIP Voice Clarity)
const VoIPRecordingOptions: Audio.RecordingOptions = {
  isMeteringEnabled: false,
  android: {
    extension: '.m4a',
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 24000,
    numberOfChannels: 1,
    bitRate: 64000,
  },
  ios: {
    extension: '.m4a',
    audioQuality: Audio.IOSAudioQuality.HIGH,
    sampleRate: 24000,
    numberOfChannels: 1,
    bitRate: 64000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 64000,
  },
};

class CallAudioService {
  private currentRecording: Audio.Recording | null = null;
  private currentCallId: string | null = null;
  private targetUserId: string | null = null;
  private isMuted = false;
  private isSpeaker = true;
  private isEngineRunning = false;
  private chunkCounter = 0;
  private playQueue: string[] = [];
  private isPlayingQueue = false;
  private activeSounds: Audio.Sound[] = [];

  constructor() {
    socketService.on(
      'call:audio-chunk',
      (data: { callId: string; audioBase64: string; senderId?: string }) => {
        if (this.currentCallId && data.callId === this.currentCallId && data.audioBase64) {
          this.enqueueAudioChunk(data.audioBase64);
        }
      },
    );
  }

  public async startVoiceSession(callId: string, targetUserId: string, isSpeaker = true) {
    this.currentCallId = callId;
    this.targetUserId = targetUserId;
    this.isSpeaker = isSpeaker;
    this.isEngineRunning = true;
    this.isMuted = false;
    this.playQueue = [];
    this.chunkCounter = 0;

    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        console.warn('[CallAudio] Microphone permission not granted');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: !isSpeaker,
      });

      this._startContinuousRecordingLoop();
    } catch (err) {
      console.warn('[CallAudio] Failed to start voice session:', err);
    }
  }

  public async stopVoiceSession() {
    this.isEngineRunning = false;
    this.currentCallId = null;
    this.targetUserId = null;
    this.playQueue = [];

    try {
      if (this.currentRecording) {
        await this.currentRecording.stopAndUnloadAsync().catch(() => {});
        this.currentRecording = null;
      }

      for (const snd of this.activeSounds) {
        await snd.stopAsync().catch(() => {});
        await snd.unloadAsync().catch(() => {});
      }
      this.activeSounds = [];

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
      });
    } catch (_) {}
  }

  public setMute(muted: boolean) {
    this.isMuted = muted;
  }

  public async setSpeaker(speaker: boolean) {
    this.isSpeaker = speaker;
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: !speaker,
      });
    } catch (_) {}
  }

  private async _startContinuousRecordingLoop() {
    if (!this.isEngineRunning) return;

    try {
      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(VoIPRecordingOptions);
      await recording.startAsync();
      this.currentRecording = recording;

      // 1000ms duration per packet ensures complete speech syllables without clipping
      await new Promise((res) => setTimeout(res, 1000));

      if (!this.isEngineRunning) {
        await recording.stopAndUnloadAsync().catch(() => {});
        return;
      }

      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      this.currentRecording = null;

      // Immediately launch next recording pass so there is zero gap in voice capture
      if (this.isEngineRunning) {
        this._startContinuousRecordingLoop();
      }

      // Process and stream previous chunk asynchronously
      if (uri && !this.isMuted && this.targetUserId && this.currentCallId) {
        this._sendAudioFile(uri, this.currentCallId, this.targetUserId);
      }
    } catch (e) {
      if (this.isEngineRunning) {
        setTimeout(() => this._startContinuousRecordingLoop(), 200);
      }
    }
  }

  private async _sendAudioFile(uri: string, callId: string, targetUserId: string) {
    try {
      const fileInfo = await FileSystem.getInfoAsync(uri);
      if (fileInfo.exists && (fileInfo.size || 0) > 100) {
        const base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });

        if (base64 && this.isEngineRunning) {
          socketService.emit('call:audio-chunk', {
            callId,
            targetUserId,
            audioBase64: base64,
            chunkIndex: ++this.chunkCounter,
          });
        }
      }
    } catch (_) {
    } finally {
      FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    }
  }

  private enqueueAudioChunk(base64: string) {
    if (this.playQueue.length > 8) {
      this.playQueue.shift(); // Drop overflow to prevent lag
    }
    this.playQueue.push(base64);
    if (!this.isPlayingQueue) {
      this._processPlayQueue();
    }
  }

  private async _processPlayQueue() {
    if (this.playQueue.length === 0 || !this.isEngineRunning) {
      this.isPlayingQueue = false;
      return;
    }

    this.isPlayingQueue = true;
    const base64 = this.playQueue.shift()!;
    const chunkFile = `${FileSystem.cacheDirectory}call_rx_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.m4a`;

    try {
      await FileSystem.writeAsStringAsync(chunkFile, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const { sound } = await Audio.Sound.createAsync(
        { uri: chunkFile },
        { shouldPlay: true, volume: 1.0 },
      );

      this.activeSounds.push(sound);
      await sound.setVolumeAsync(1.0);
      await sound.playAsync();

      sound.setOnPlaybackStatusUpdate((status: any) => {
        if (status.didJustFinish || status.isLoaded === false) {
          sound.unloadAsync().catch(() => {});
          this.activeSounds = this.activeSounds.filter((s) => s !== sound);
          FileSystem.deleteAsync(chunkFile, { idempotent: true }).catch(() => {});
          this._processPlayQueue();
        }
      });
    } catch (e) {
      this._processPlayQueue();
    }
  }
}

export const callAudioService = new CallAudioService();
