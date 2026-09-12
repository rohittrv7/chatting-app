/**
 * audioModule.ts
 *
 * Safe wrapper for audio playback and recording.
 * Isolates expo-av / native audio modules so that if native JNI bindings
 * are absent or deprecated, the app continues running without crashing.
 */

let NativeAudio: any = null;
try {
  NativeAudio = require('expo-av')?.Audio;
} catch (_) {
  NativeAudio = null;
}

export class SoundInstance {
  loadAsync = async (_source?: any, _initialStatus?: any) => ({ isLoaded: false });
  unloadAsync = async () => ({});
  playAsync = async () => ({});
  pauseAsync = async () => ({});
  stopAsync = async () => ({});
  setPositionAsync = async (_millis: number) => ({});
  setOnPlaybackStatusUpdate = (_cb: (status: any) => void) => {};
  getStatusAsync = async (): Promise<AVPlaybackStatus> => ({
    isLoaded: false,
    isPlaying: false,
    positionMillis: 0,
    durationMillis: 0,
  });
  static createAsync = async (
    _source: any,
    _initialStatus?: any,
    _onPlaybackStatusUpdate?: any,
  ) => ({
    sound: new SoundInstance(),
    status: { isLoaded: false, positionMillis: 0, durationMillis: 0 },
  });
}

export class RecordingInstance {
  prepareToRecordAsync = async (_options?: any) => ({});
  startAsync = async () => ({});
  stopAndUnloadAsync = async () => ({});
  getURI = (): string | null => null;
  getStatusAsync = async () => ({ canRecord: false, isRecording: false, durationMillis: 0 });
}

export const Audio = NativeAudio || {
  Recording: RecordingInstance,
  Sound: SoundInstance,
  RecordingOptionsPresets: {
    HIGH_QUALITY: {},
    LOW_QUALITY: {},
  },
  setAudioModeAsync: async () => ({}),
  getPermissionsAsync: async () => ({ granted: true, canAskAgain: true }),
  requestPermissionsAsync: async () => ({ granted: true, canAskAgain: true }),
};

export namespace Audio {
  export type Sound = SoundInstance;
  export type Recording = RecordingInstance;
}

export type AVPlaybackStatus = {
  isLoaded: boolean;
  isPlaying?: boolean;
  durationMillis?: number;
  positionMillis?: number;
  didJustFinish?: boolean;
  error?: string;
};
