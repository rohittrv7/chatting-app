import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { socketService } from './socket';

class CallAudioService {
  private currentRecording: Audio.Recording | null = null;
  private currentCallId: string | null = null;
  private targetUserId: string | null = null;
  private isMuted = false;
  private isSpeaker = false;
  private isEngineRunning = false;
  private chunkCounter = 0;
  private playQueue: string[] = [];
  private isPlayingQueue = false;
  private currentPlaybackSound: Audio.Sound | null = null;

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

  public async startVoiceSession(callId: string, targetUserId: string, isSpeaker = false) {
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

      this._startRecordingLoop();
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
      if (this.currentPlaybackSound) {
        await this.currentPlaybackSound.stopAsync().catch(() => {});
        await this.currentPlaybackSound.unloadAsync().catch(() => {});
        this.currentPlaybackSound = null;
      }

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

  private async _startRecordingLoop() {
    if (!this.isEngineRunning) return;

    try {
      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await recording.startAsync();
      this.currentRecording = recording;

      // 500ms audio chunk for low-latency, real-time voice streaming
      await new Promise((res) => setTimeout(res, 500));

      if (!this.isEngineRunning) {
        await recording.stopAndUnloadAsync().catch(() => {});
        return;
      }

      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      this.currentRecording = null;

      if (uri && !this.isMuted && this.targetUserId && this.currentCallId) {
        const fileInfo = await FileSystem.getInfoAsync(uri);
        if (fileInfo.exists && (fileInfo.size || 0) > 60) {
          const base64 = await FileSystem.readAsStringAsync(uri, {
            encoding: FileSystem.EncodingType.Base64,
          });

          if (base64 && this.isEngineRunning) {
            socketService.emit('call:audio-chunk', {
              callId: this.currentCallId,
              targetUserId: this.targetUserId,
              audioBase64: base64,
              chunkIndex: ++this.chunkCounter,
            });
          }
        }
        FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      }

      if (this.isEngineRunning) {
        this._startRecordingLoop();
      }
    } catch (e) {
      if (this.isEngineRunning) {
        setTimeout(() => this._startRecordingLoop(), 300);
      }
    }
  }

  private enqueueAudioChunk(base64: string) {
    if (this.playQueue.length > 6) {
      this.playQueue.shift(); // Drop stale chunks to prevent lag
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
      this.currentPlaybackSound = sound;
      await sound.setVolumeAsync(1.0);
      await sound.playAsync();

      sound.setOnPlaybackStatusUpdate((status: any) => {
        if (status.didJustFinish || status.isLoaded === false) {
          sound.unloadAsync().catch(() => {});
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
