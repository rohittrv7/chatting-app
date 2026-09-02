/**
 * @deprecated
 * Legacy chunk-based VoIP service has been completely replaced by native WebRTC streaming (webrtcService.ts).
 * This file is retained as an empty stub for backward compatibility.
 */
class DeprecatedCallAudioService {
  public startVoiceSession() {}
  public stopVoiceSession() {}
  public setMute() {}
  public setSpeaker() {}
}

export const callAudioService = new DeprecatedCallAudioService();
