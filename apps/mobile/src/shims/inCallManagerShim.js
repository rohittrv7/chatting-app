/**
 * inCallManagerShim.js
 * No-op shim for react-native-incall-manager in Expo Go / metro bundler.
 * In a real EAS development build, the actual native module is used instead.
 * This shim prevents metro from crashing when it tries to bundle the native module's JS.
 */
const InCallManager = {
  start: () => {},
  stop: () => {},
  setSpeakerphoneOn: () => {},
  setForceSpeakerphoneOn: () => {},
  setMicrophoneMute: () => {},
  getIsWiredHeadsetPluggedIn: () => Promise.resolve({ isWiredHeadsetPluggedIn: false }),
  chooseAudioRoute: () => Promise.resolve(),
  requestAudioFocus: () => Promise.resolve(),
  abandonAudioFocus: () => Promise.resolve(),
  startProximitySensor: () => {},
  stopProximitySensor: () => {},
  turnScreenOn: () => {},
  turnScreenOff: () => {},
  startRingtone: () => {},
  stopRingtone: () => {},
  startRingback: () => {},
  stopRingback: () => {},
};

module.exports = { default: InCallManager };
