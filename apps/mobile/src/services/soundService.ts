import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

let Haptics: any = null;
try {
  Haptics = require('expo-haptics');
} catch (_) {}

let Audio: any = null;
try {
  Audio = require('expo-av').Audio;
} catch (_) {}

/**
 * Generate a pure raw base64 string for an 8-bit mono PCM WAV audio file.
 */
function generateWavBase64(
  sampleRate: number,
  notes: Array<{ freq: number; duration: number; volume: number }>,
): string {
  const totalDuration = notes.reduce((sum, n) => sum + n.duration, 0);
  const numSamples = Math.floor(sampleRate * totalDuration);
  const buffer = new Uint8Array(44 + numSamples);

  // RIFF Header
  buffer[0] = 0x52; // 'R'
  buffer[1] = 0x49; // 'I'
  buffer[2] = 0x46; // 'F'
  buffer[3] = 0x46; // 'F'
  const fileSize = 36 + numSamples;
  buffer[4] = fileSize & 0xff;
  buffer[5] = (fileSize >> 8) & 0xff;
  buffer[6] = (fileSize >> 16) & 0xff;
  buffer[7] = (fileSize >> 24) & 0xff;
  buffer[8] = 0x57; // 'W'
  buffer[9] = 0x41; // 'A'
  buffer[10] = 0x56; // 'V'
  buffer[11] = 0x45; // 'E'

  // 'fmt ' chunk
  buffer[12] = 0x66; // 'f'
  buffer[13] = 0x6d; // 'm'
  buffer[14] = 0x74; // 't'
  buffer[15] = 0x20; // ' '
  buffer[16] = 16; // Subchunk size (16 for PCM)
  buffer[17] = 0;
  buffer[18] = 0;
  buffer[19] = 0;
  buffer[20] = 1; // AudioFormat (1 = PCM)
  buffer[21] = 0;
  buffer[22] = 1; // NumChannels (1 = mono)
  buffer[23] = 0;
  buffer[24] = sampleRate & 0xff;
  buffer[25] = (sampleRate >> 8) & 0xff;
  buffer[26] = (sampleRate >> 16) & 0xff;
  buffer[27] = (sampleRate >> 24) & 0xff;
  buffer[28] = sampleRate & 0xff; // ByteRate
  buffer[29] = (sampleRate >> 8) & 0xff;
  buffer[30] = (sampleRate >> 16) & 0xff;
  buffer[31] = (sampleRate >> 24) & 0xff;
  buffer[32] = 1; // BlockAlign
  buffer[33] = 0;
  buffer[34] = 8; // BitsPerSample
  buffer[35] = 0;

  // 'data' chunk
  buffer[36] = 0x64; // 'd'
  buffer[37] = 0x61; // 'a'
  buffer[38] = 0x74; // 't'
  buffer[39] = 0x61; // 'a'
  buffer[40] = numSamples & 0xff;
  buffer[41] = (numSamples >> 8) & 0xff;
  buffer[42] = (numSamples >> 16) & 0xff;
  buffer[43] = (numSamples >> 24) & 0xff;

  let currentSample = 0;
  for (const note of notes) {
    const noteSamples = Math.floor(sampleRate * note.duration);
    for (let i = 0; i < noteSamples; i++) {
      const t = i / sampleRate;
      const progress = i / noteSamples;
      const env = Math.exp(-progress * 4.5) * note.volume;
      const wave = Math.sin(2 * Math.PI * note.freq * t);
      const sampleValue = Math.floor(128 + wave * env * 127);
      buffer[44 + currentSample + i] = Math.max(0, Math.min(255, sampleValue));
    }
    currentSample += noteSamples;
  }

  // Convert buffer to base64
  let binary = '';
  const len = buffer.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return typeof btoa === 'function'
    ? btoa(binary)
    : Buffer.from(binary, 'binary').toString('base64');
}

const SAMPLE_RATE = 22050;

// WhatsApp In-Chat Pop (Two crisp high-frequency blips)
const POP_BASE64 = generateWavBase64(SAMPLE_RATE, [
  { freq: 1174.66, duration: 0.045, volume: 0.8 },
  { freq: 1567.98, duration: 0.08, volume: 0.9 },
]);

// WhatsApp Out-of-Chat Alert Ringtone (3-tone melodic chime chord)
const CHIME_BASE64 = generateWavBase64(SAMPLE_RATE, [
  { freq: 659.25, duration: 0.1, volume: 0.85 }, // E5
  { freq: 880.0, duration: 0.11, volume: 0.9 }, // A5
  { freq: 1318.51, duration: 0.35, volume: 1.0 }, // E6
]);

// Message Sent Sound (Crisp descending tick)
const SENT_BASE64 = generateWavBase64(SAMPLE_RATE, [
  { freq: 1250.0, duration: 0.03, volume: 0.7 },
  { freq: 750.0, duration: 0.05, volume: 0.5 },
]);

// Telephone Ringback Tone (440Hz + 480Hz dial tone: 1.2s tone + 1.8s silence)
function generateRingbackWav(sampleRate = 22050): string {
  const totalDuration = 3.0;
  const numSamples = Math.floor(sampleRate * totalDuration);
  const buffer = new Uint8Array(44 + numSamples);

  buffer[0] = 0x52;
  buffer[1] = 0x49;
  buffer[2] = 0x46;
  buffer[3] = 0x46;
  const fileSize = 36 + numSamples;
  buffer[4] = fileSize & 0xff;
  buffer[5] = (fileSize >> 8) & 0xff;
  buffer[6] = (fileSize >> 16) & 0xff;
  buffer[7] = (fileSize >> 24) & 0xff;
  buffer[8] = 0x57;
  buffer[9] = 0x41;
  buffer[10] = 0x56;
  buffer[11] = 0x45;
  buffer[12] = 0x66;
  buffer[13] = 0x6d;
  buffer[14] = 0x74;
  buffer[15] = 0x20;
  buffer[16] = 16;
  buffer[17] = 0;
  buffer[18] = 0;
  buffer[19] = 0;
  buffer[20] = 1;
  buffer[21] = 0;
  buffer[22] = 1;
  buffer[23] = 0;
  buffer[24] = sampleRate & 0xff;
  buffer[25] = (sampleRate >> 8) & 0xff;
  buffer[26] = (sampleRate >> 16) & 0xff;
  buffer[27] = (sampleRate >> 24) & 0xff;
  buffer[28] = sampleRate & 0xff;
  buffer[29] = (sampleRate >> 8) & 0xff;
  buffer[30] = (sampleRate >> 16) & 0xff;
  buffer[31] = (sampleRate >> 24) & 0xff;
  buffer[32] = 1;
  buffer[33] = 0;
  buffer[34] = 8;
  buffer[35] = 0;
  buffer[36] = 0x64;
  buffer[37] = 0x61;
  buffer[38] = 0x74;
  buffer[39] = 0x61;
  buffer[40] = numSamples & 0xff;
  buffer[41] = (numSamples >> 8) & 0xff;
  buffer[42] = (numSamples >> 16) & 0xff;
  buffer[43] = (numSamples >> 24) & 0xff;

  const toneDuration = 1.2;
  const toneSamples = Math.floor(sampleRate * toneDuration);
  for (let i = 0; i < numSamples; i++) {
    if (i < toneSamples) {
      const t = i / sampleRate;
      const wave = 0.5 * Math.sin(2 * Math.PI * 440 * t) + 0.5 * Math.sin(2 * Math.PI * 480 * t);
      let env = 1.0;
      if (i < 400) env = i / 400;
      else if (toneSamples - i < 400) env = (toneSamples - i) / 400;
      buffer[44 + i] = Math.floor(128 + wave * env * 115);
    } else {
      buffer[44 + i] = 128;
    }
  }

  let binary = '';
  for (let i = 0; i < buffer.byteLength; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return typeof btoa === 'function'
    ? btoa(binary)
    : Buffer.from(binary, 'binary').toString('base64');
}

const RINGBACK_BASE64 = generateRingbackWav(SAMPLE_RATE);

// WhatsApp-style Incoming Ringing Melody
const INCOMING_RINGTONE_BASE64 = generateWavBase64(SAMPLE_RATE, [
  { freq: 659.25, duration: 0.12, volume: 0.9 },
  { freq: 783.99, duration: 0.12, volume: 0.9 },
  { freq: 987.77, duration: 0.14, volume: 0.95 },
  { freq: 1318.51, duration: 0.35, volume: 1.0 },
  { freq: 0, duration: 0.1, volume: 0 },
  { freq: 987.77, duration: 0.12, volume: 0.9 },
  { freq: 1318.51, duration: 0.45, volume: 1.0 },
  { freq: 0, duration: 0.8, volume: 0 },
]);

// Call Connected Chime
const CONNECTED_CHIME_BASE64 = generateWavBase64(SAMPLE_RATE, [
  { freq: 523.25, duration: 0.08, volume: 0.8 },
  { freq: 659.25, duration: 0.08, volume: 0.85 },
  { freq: 1046.5, duration: 0.22, volume: 0.95 },
]);

// Call Ended / Busy 3-Beep Tone
const CALL_ENDED_BASE64 = generateWavBase64(SAMPLE_RATE, [
  { freq: 480.0, duration: 0.12, volume: 0.9 },
  { freq: 0, duration: 0.08, volume: 0 },
  { freq: 480.0, duration: 0.12, volume: 0.9 },
  { freq: 0, duration: 0.08, volume: 0 },
  { freq: 480.0, duration: 0.25, volume: 0.9 },
]);

class SoundService {
  private audioCtx: any = null;
  private isAudioModeConfigured = false;
  private localFilesInitialized = false;

  private popFileUri = '';
  private chimeFileUri = '';
  private sentFileUri = '';
  private ringbackFileUri = '';
  private incomingRingtoneFileUri = '';
  private connectedChimeFileUri = '';
  private callEndedFileUri = '';
  private activeLoopingSound: any = null;
  private activeSounds: Set<any> = new Set();
  private currentSoundGeneration = 0;

  constructor() {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        const AudioContextClass =
          (window as any).AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          this.audioCtx = new AudioContextClass();
        }
      } catch (_) {}
    } else {
      this._initNativeAudio().catch(() => {});
    }
  }

  private async _initNativeAudio() {
    if (Platform.OS === 'web') return;
    try {
      if (Audio && !this.isAudioModeConfigured) {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          allowsRecordingIOS: false,
          staysActiveInBackground: false,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        });
        this.isAudioModeConfigured = true;
      }

      if (!this.localFilesInitialized && FileSystem.cacheDirectory) {
        this.popFileUri = `${FileSystem.cacheDirectory}wa_in_chat_pop_v4.wav`;
        this.chimeFileUri = `${FileSystem.cacheDirectory}wa_alert_chime_v4.wav`;
        this.sentFileUri = `${FileSystem.cacheDirectory}wa_msg_sent_v4.wav`;
        this.ringbackFileUri = `${FileSystem.cacheDirectory}wa_ringback_tone_v4.wav`;
        this.incomingRingtoneFileUri = `${FileSystem.cacheDirectory}wa_incoming_ringtone_v4.wav`;
        this.connectedChimeFileUri = `${FileSystem.cacheDirectory}wa_connected_chime_v4.wav`;
        this.callEndedFileUri = `${FileSystem.cacheDirectory}wa_call_ended_v4.wav`;

        // Write files to local disk so Android MediaPlayer and iOS AVAudioPlayer can load real file:// URIs
        await Promise.all([
          this._writeBase64File(this.popFileUri, POP_BASE64),
          this._writeBase64File(this.chimeFileUri, CHIME_BASE64),
          this._writeBase64File(this.sentFileUri, SENT_BASE64),
          this._writeBase64File(this.ringbackFileUri, RINGBACK_BASE64),
          this._writeBase64File(this.incomingRingtoneFileUri, INCOMING_RINGTONE_BASE64),
          this._writeBase64File(this.connectedChimeFileUri, CONNECTED_CHIME_BASE64),
          this._writeBase64File(this.callEndedFileUri, CALL_ENDED_BASE64),
        ]);
        this.localFilesInitialized = true;
      }
    } catch (_) {}
  }

  private async _writeBase64File(fileUri: string, base64Data: string) {
    try {
      const info = await FileSystem.getInfoAsync(fileUri);
      if (!info.exists || info.size === 0) {
        await FileSystem.writeAsStringAsync(fileUri, base64Data, {
          encoding: FileSystem.EncodingType.Base64,
        });
      }
    } catch (_) {}
  }

  private _ensureWebAudioContext() {
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
  }

  private async _playNativeFile(fileUri: string, volume = 1.0) {
    if (!Audio) return;
    try {
      await this._initNativeAudio();
      if (!fileUri) return;

      const { sound } = await Audio.Sound.createAsync(
        { uri: fileUri },
        { shouldPlay: true, volume },
      );
      sound.setOnPlaybackStatusUpdate((status: any) => {
        if (status.didJustFinish || status.isLoaded === false) {
          sound.unloadAsync().catch(() => {});
        }
      });
    } catch (_) {}
  }

  /**
   * 1. In-Chat Message Sound (WhatsApp style double pop blip)
   * Triggered when a new message arrives inside the active open chat room.
   */
  public async playInChatReceiveSound() {
    try {
      if (Haptics) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }

      if (Platform.OS === 'web' && this.audioCtx) {
        this._ensureWebAudioContext();
        const now = this.audioCtx.currentTime;
        const osc1 = this.audioCtx.createOscillator();
        const gain1 = this.audioCtx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(1174, now);
        gain1.gain.setValueAtTime(0.3, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc1.connect(gain1);
        gain1.connect(this.audioCtx.destination);
        osc1.start(now);
        osc1.stop(now + 0.05);

        const osc2 = this.audioCtx.createOscillator();
        const gain2 = this.audioCtx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(1567, now + 0.05);
        gain2.gain.setValueAtTime(0.35, now + 0.05);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc2.connect(gain2);
        gain2.connect(this.audioCtx.destination);
        osc2.start(now + 0.05);
        osc2.stop(now + 0.12);
        return;
      }

      await this._playNativeFile(this.popFileUri, 0.85);
    } catch (_) {}
  }

  /**
   * 2. Out-of-Chat Notification Ringtone (WhatsApp style 3-note melodic chime)
   * Triggered when an incoming message arrives while on the chat list or outside the conversation.
   */
  public async playNotificationTone() {
    try {
      if (Haptics) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }

      if (Platform.OS === 'web' && this.audioCtx) {
        this._ensureWebAudioContext();
        const now = this.audioCtx.currentTime;
        const notes = [
          { freq: 659.25, time: 0, dur: 0.12, vol: 0.45 },
          { freq: 880.0, time: 0.09, dur: 0.14, vol: 0.5 },
          { freq: 1318.51, time: 0.18, dur: 0.35, vol: 0.6 },
        ];
        for (const n of notes) {
          const osc = this.audioCtx.createOscillator();
          const gain = this.audioCtx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(n.freq, now + n.time);
          gain.gain.setValueAtTime(n.vol, now + n.time);
          gain.gain.exponentialRampToValueAtTime(0.001, now + n.time + n.dur);
          osc.connect(gain);
          gain.connect(this.audioCtx.destination);
          osc.start(now + n.time);
          osc.stop(now + n.time + n.dur);
        }
        return;
      }

      await this._playNativeFile(this.chimeFileUri, 1.0);
    } catch (_) {}
  }

  /**
   * 3. Message Sent Sound (Crisp swoosh tick)
   */
  public async playMessageSentSound() {
    try {
      if (Platform.OS === 'web' && this.audioCtx) {
        this._ensureWebAudioContext();
        const now = this.audioCtx.currentTime;
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1200, now);
        osc.frequency.exponentialRampToValueAtTime(450, now + 0.05);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.05);
        return;
      }

      await this._playNativeFile(this.sentFileUri, 0.6);
    } catch (_) {}
  }

  /**
   * 4. Outgoing Call Ringback Tone (Looped dial tone: tring... tring...)
   */
  public async startOutgoingRingbackTone() {
    const gen = ++this.currentSoundGeneration;
    try {
      await this.stopCallSounds();
      await this._initNativeAudio();
      if (this.currentSoundGeneration !== gen || !Audio || !this.ringbackFileUri) return;

      const { sound } = await Audio.Sound.createAsync(
        { uri: this.ringbackFileUri },
        { shouldPlay: true, isLooping: true, volume: 0.9 },
      );
      if (this.currentSoundGeneration !== gen) {
        sound.stopAsync().catch(() => {});
        sound.unloadAsync().catch(() => {});
        return;
      }
      this.activeLoopingSound = sound;
      this.activeSounds.add(sound);
    } catch (e) {
      console.warn('Could not start ringback tone:', e);
    }
  }

  /**
   * 5. Incoming Ringtone (Looped melody chime when call is incoming)
   */
  public async startIncomingRingtone() {
    const gen = ++this.currentSoundGeneration;
    try {
      await this.stopCallSounds();
      await this._initNativeAudio();
      if (this.currentSoundGeneration !== gen || !Audio || !this.incomingRingtoneFileUri) return;

      const { sound } = await Audio.Sound.createAsync(
        { uri: this.incomingRingtoneFileUri },
        { shouldPlay: true, isLooping: true, volume: 1.0 },
      );
      if (this.currentSoundGeneration !== gen) {
        sound.stopAsync().catch(() => {});
        sound.unloadAsync().catch(() => {});
        return;
      }
      this.activeLoopingSound = sound;
      this.activeSounds.add(sound);
    } catch (e) {
      console.warn('Could not start incoming ringtone:', e);
    }
  }

  /**
   * Stop any active looping call sound (dial tone or ringtone)
   */
  public async stopCallSounds() {
    this.currentSoundGeneration++;
    for (const snd of this.activeSounds) {
      try {
        snd.stopAsync().catch(() => {});
        snd.unloadAsync().catch(() => {});
      } catch (_) {}
    }
    this.activeSounds.clear();

    if (this.activeLoopingSound) {
      try {
        await this.activeLoopingSound.stopAsync();
        await this.activeLoopingSound.unloadAsync();
      } catch (_) {}
      this.activeLoopingSound = null;
    }
  }

  /**
   * 6. Call Connected Sound (Positive upward chime)
   */
  public async playCallConnectedSound() {
    try {
      await this.stopCallSounds();
      await this._playNativeFile(this.connectedChimeFileUri, 0.85);
    } catch (_) {}
  }

  /**
   * 7. Call Ended / Busy Tone (3 short disconnect beeps)
   */
  public async playCallEndedSound() {
    try {
      await this.stopCallSounds();
      await this._playNativeFile(this.callEndedFileUri, 0.85);
    } catch (_) {}
  }
}

export const soundService = new SoundService();
