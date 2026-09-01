import {
  socketService,
  EVT_CALL_INITIATE,
  EVT_CALL_INCOMING,
  EVT_CALL_ACCEPT,
  EVT_CALL_ACCEPTED,
  EVT_CALL_REJECT,
  EVT_CALL_END,
  EVT_CALL_ENDED,
  EVT_CALL_SWITCH_VIDEO,
} from './socket';
import { soundService } from './soundService';
import { callHistoryService } from './callHistoryService';
import { callAudioService } from './callAudioService';

export type CallType = 'audio' | 'video';

export type CallState =
  | 'IDLE'
  | 'OUTGOING_CALLING'
  | 'OUTGOING_RINGING'
  | 'INCOMING_RINGING'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'ENDED';

export interface ActiveCallSession {
  callId: string;
  callerId: string;
  callerName: string;
  callerAvatar?: string;
  receiverId: string;
  targetUserId: string;
  targetUserName: string;
  targetUserAvatar?: string;
  isCaller: boolean;
  callType: CallType;
  state: CallState;
  startedAt?: number;
  durationSeconds: number;
  isMuted: boolean;
  isSpeakerOn: boolean;
  isVideoEnabled: boolean;
  conversationId?: string;
}

export type CallCompletedLog = {
  callId: string;
  targetUserId: string;
  targetUserName: string;
  callType: CallType;
  status: 'completed' | 'missed' | 'declined';
  durationSeconds: number;
  isCaller: boolean;
  conversationId?: string;
};

type CallListener = (session: ActiveCallSession | null) => void;
type CallCompletedCallback = (log: CallCompletedLog) => void;

class CallService {
  private currentSession: ActiveCallSession | null = null;
  private listeners: Set<CallListener> = new Set();
  private callCompletedListeners: Set<CallCompletedCallback> = new Set();
  private durationTimer: any = null;
  private callTimeoutTimer: any = null;
  private isInitialized = false;

  constructor() {
    this.init();
  }

  public init() {
    if (this.isInitialized) return;
    this.isInitialized = true;
    this.setupSocketListeners();
  }

  private setupSocketListeners() {
    // ── Call Status Updates from Server ('RINGING' vs 'CALLING' vs 'CONNECTED' vs 'ENDED') ──
    socketService.on(
      'call:status',
      (payload: {
        callId: string;
        status: 'RINGING' | 'CALLING' | 'CONNECTED' | 'ENDED';
        isOnline?: boolean;
        reason?: string;
      }) => {
        console.log('📞 Call status event:', payload);
        if (!this.currentSession) return;
        if (
          payload?.callId &&
          this.currentSession.callId &&
          this.currentSession.callId !== payload.callId
        ) {
          return;
        }

        if (payload.status === 'CONNECTED') {
          this.clearCallTimeout();
          soundService.stopCallSounds();
          soundService.playCallConnectedSound();
          this.currentSession.state = 'CONNECTED';
          this.currentSession.startedAt = this.currentSession.startedAt || Date.now();
          this.startDurationTimer();
          callAudioService.startVoiceSession(
            this.currentSession.callId,
            this.currentSession.targetUserId,
            this.currentSession.isSpeakerOn,
          );
          this.notify();
        } else if (payload.status === 'RINGING') {
          if (this.currentSession.state !== 'CONNECTED') {
            this.currentSession.state = 'OUTGOING_RINGING';
            this.notify();
          }
        } else if (payload.status === 'CALLING') {
          if (this.currentSession.state !== 'CONNECTED') {
            this.currentSession.state = 'OUTGOING_CALLING';
            this.notify();
          }
        } else if (payload.status === 'ENDED') {
          this.clearCallTimeout();
          callAudioService.stopVoiceSession();
          this._saveCallLog(
            payload.reason === 'rejected' || payload.reason === 'declined' ? 'declined' : undefined,
          );
          soundService.stopCallSounds();
          soundService.playCallEndedSound();
          this.stopDurationTimer();
          this.currentSession.state = 'ENDED';
          this.notify();

          setTimeout(() => {
            if (this.currentSession?.state === 'ENDED') {
              this.currentSession = null;
              this.notify();
            }
          }, 1500);
        }
      },
    );

    // ── Incoming Call from remote peer ──────────────────────────────────────
    socketService.on(EVT_CALL_INCOMING, (payload: any) => {
      console.log('📞 Incoming call event received:', payload);
      if (!payload?.callId || !payload?.callerId) return;

      // If already in a call with a DIFFERENT call ID, reject incoming call as busy
      if (
        this.currentSession &&
        this.currentSession.callId !== payload.callId &&
        this.currentSession.state !== 'IDLE' &&
        this.currentSession.state !== 'ENDED'
      ) {
        socketService.emit(EVT_CALL_REJECT, {
          callId: payload.callId,
          callerId: payload.callerId,
          reason: 'busy',
        });
        return;
      }

      // If already ringing with this exact call ID, avoid resetting
      if (
        this.currentSession &&
        this.currentSession.callId === payload.callId &&
        this.currentSession.state === 'INCOMING_RINGING'
      ) {
        return;
      }

      this.currentSession = {
        callId: payload.callId,
        callerId: payload.callerId,
        callerName: payload.callerName || 'Contact',
        callerAvatar: payload.callerAvatar,
        receiverId: 'me',
        targetUserId: payload.callerId,
        targetUserName: payload.callerName || 'Contact',
        targetUserAvatar: payload.callerAvatar,
        isCaller: false,
        callType: payload.callType || 'audio',
        state: 'INCOMING_RINGING',
        durationSeconds: 0,
        isMuted: false,
        isSpeakerOn: payload.callType === 'video',
        isVideoEnabled: payload.callType === 'video',
        conversationId: payload.conversationId,
      };

      // Acknowledge back to server that receiver device received call and is ringing
      socketService.emit('call:ringing', {
        callId: payload.callId,
        callerId: payload.callerId,
      });

      // 45s incoming call timeout (auto-missed if unpicked)
      this.startCallTimeout(45000);

      // Play looping incoming ringtone
      soundService.startIncomingRingtone();
      this.notify();
    });

    // ── Call Accepted by receiver ───────────────────────────────────────────
    socketService.on(EVT_CALL_ACCEPTED, (payload: any) => {
      console.log('📞 Call accepted by remote party:', payload);
      if (!this.currentSession) return;
      if (
        payload?.callId &&
        this.currentSession.callId &&
        this.currentSession.callId !== payload.callId
      ) {
        if (!this.currentSession.isCaller) return;
      }

      this.clearCallTimeout();
      soundService.stopCallSounds();
      soundService.playCallConnectedSound();

      this.currentSession.state = 'CONNECTED';
      this.currentSession.startedAt = this.currentSession.startedAt || Date.now();
      this.startDurationTimer();
      callAudioService.startVoiceSession(
        this.currentSession.callId,
        this.currentSession.targetUserId,
        this.currentSession.isSpeakerOn,
      );
      this.notify();
    });

    // ── Call Ended / Rejected ───────────────────────────────────────────────
    socketService.on(EVT_CALL_ENDED, (payload: any) => {
      console.log('📞 Call ended by remote party:', payload);
      if (!this.currentSession) return;
      if (
        payload?.callId &&
        this.currentSession.callId &&
        this.currentSession.callId !== payload.callId
      ) {
        return;
      }

      this.clearCallTimeout();
      callAudioService.stopVoiceSession();
      this._saveCallLog(
        payload.reason === 'rejected' || payload.reason === 'declined' ? 'declined' : undefined,
      );
      soundService.stopCallSounds();
      soundService.playCallEndedSound();
      this.stopDurationTimer();
      this.currentSession.state = 'ENDED';
      this.notify();

      // Reset after brief delay
      setTimeout(() => {
        if (this.currentSession?.state === 'ENDED') {
          this.currentSession = null;
          this.notify();
        }
      }, 1500);
    });

    // ── Video Switch Request / Accept / Reject ───────────────────────────────
    socketService.on(EVT_CALL_SWITCH_VIDEO, (payload: any) => {
      console.log('📹 Switch video event received from remote:', payload);
      if (!this.currentSession || this.currentSession.callId !== payload.callId) return;

      const isVideo =
        payload.action === 'request' || payload.action === 'accept' || payload.isVideo === true;
      this.currentSession.isVideoEnabled = isVideo;
      this.currentSession.callType = isVideo ? 'video' : 'audio';
      if (isVideo) {
        this.currentSession.isSpeakerOn = true;
      }
      this.notify();
    });
  }

  // ─── Public Actions ────────────────────────────────────────────────────────

  public startCall(params: {
    targetUserId: string;
    targetUserName: string;
    targetUserAvatar?: string;
    callType: CallType;
    myUserId?: string;
    myName?: string;
    myAvatar?: string;
    conversationId?: string;
  }): ActiveCallSession {
    const callId = `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    this.currentSession = {
      callId,
      callerId: params.myUserId || 'me',
      callerName: params.myName || 'Me',
      callerAvatar: params.myAvatar,
      receiverId: params.targetUserId,
      targetUserId: params.targetUserId,
      targetUserName: params.targetUserName,
      targetUserAvatar: params.targetUserAvatar,
      isCaller: true,
      callType: params.callType,
      state: 'OUTGOING_CALLING', // Initial state until server checks online status
      durationSeconds: 0,
      isMuted: false,
      isSpeakerOn: params.callType === 'video',
      isVideoEnabled: params.callType === 'video',
      conversationId: params.conversationId,
    };

    // Emit initiate signal to server
    socketService.emit(EVT_CALL_INITIATE, {
      callId,
      receiverId: params.targetUserId,
      callType: params.callType,
      callerName: params.myName,
      callerAvatar: params.myAvatar,
      conversationId: params.conversationId,
    });

    // Start outgoing ringback dial tone (tring... tring...)
    soundService.startOutgoingRingbackTone();
    // 45s outgoing call timeout (auto-cut if nobody answers)
    this.startCallTimeout(45000);
    this.notify();
    return this.currentSession;
  }

  public acceptCall(callId?: string) {
    if (!this.currentSession) return;
    if (callId && this.currentSession.callId !== callId) return;

    this.clearCallTimeout();
    soundService.stopCallSounds();
    soundService.playCallConnectedSound();

    this.currentSession.state = 'CONNECTED';
    this.currentSession.startedAt = Date.now();

    socketService.emit(EVT_CALL_ACCEPT, {
      callId: this.currentSession.callId,
      callerId: this.currentSession.callerId,
    });

    this.startDurationTimer();
    callAudioService.startVoiceSession(
      this.currentSession.callId,
      this.currentSession.targetUserId,
      this.currentSession.isSpeakerOn,
    );
    this.notify();
  }

  public rejectCall(callId?: string, reason = 'declined') {
    if (!this.currentSession) return;
    if (callId && this.currentSession.callId !== callId) return;

    this.clearCallTimeout();
    callAudioService.stopVoiceSession();
    this._saveCallLog(reason === 'declined' ? 'declined' : 'missed');
    soundService.stopCallSounds();
    soundService.playCallEndedSound();
    this.stopDurationTimer();

    socketService.emit(EVT_CALL_REJECT, {
      callId: this.currentSession.callId,
      callerId: this.currentSession.callerId,
      reason,
    });

    this.currentSession.state = 'ENDED';
    this.notify();

    setTimeout(() => {
      this.currentSession = null;
      this.notify();
    }, 1000);
  }

  public endCall(callId?: string, reason = 'ended') {
    if (!this.currentSession) return;
    if (callId && this.currentSession.callId !== callId) return;

    this.clearCallTimeout();
    callAudioService.stopVoiceSession();
    this._saveCallLog(reason === 'no_answer' ? 'declined' : undefined);
    soundService.stopCallSounds();
    soundService.playCallEndedSound();
    this.stopDurationTimer();

    socketService.emit(EVT_CALL_END, {
      callId: this.currentSession.callId,
      targetUserId: this.currentSession.targetUserId,
      reason,
    });

    this.currentSession.state = 'ENDED';
    this.notify();

    setTimeout(() => {
      this.currentSession = null;
      this.notify();
    }, 1000);
  }

  public toggleMute(): boolean {
    if (!this.currentSession) return false;
    this.currentSession.isMuted = !this.currentSession.isMuted;
    callAudioService.setMute(this.currentSession.isMuted);
    this.notify();
    return this.currentSession.isMuted;
  }

  public toggleSpeaker(): boolean {
    if (!this.currentSession) return false;
    this.currentSession.isSpeakerOn = !this.currentSession.isSpeakerOn;
    callAudioService.setSpeaker(this.currentSession.isSpeakerOn);
    this.notify();
    return this.currentSession.isSpeakerOn;
  }

  public toggleVideoSwitch(): boolean {
    if (!this.currentSession) return false;
    const newVideoState = !this.currentSession.isVideoEnabled;
    this.currentSession.isVideoEnabled = newVideoState;
    this.currentSession.callType = newVideoState ? 'video' : 'audio';
    if (newVideoState) {
      this.currentSession.isSpeakerOn = true;
      callAudioService.setSpeaker(true);
    }

    socketService.emit(EVT_CALL_SWITCH_VIDEO, {
      callId: this.currentSession.callId,
      targetUserId: this.currentSession.targetUserId,
      action: newVideoState ? 'request' : 'reject',
      isVideo: newVideoState,
    });

    this.notify();
    return newVideoState;
  }

  public getSession(): ActiveCallSession | null {
    return this.currentSession;
  }

  public addListener(listener: CallListener) {
    this.listeners.add(listener);
    listener(this.currentSession);
  }

  public removeListener(listener: CallListener) {
    this.listeners.delete(listener);
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  private notify() {
    for (const listener of this.listeners) {
      listener(this.currentSession ? { ...this.currentSession } : null);
    }
  }

  private startDurationTimer() {
    this.stopDurationTimer();
    this.durationTimer = setInterval(() => {
      if (this.currentSession && this.currentSession.state === 'CONNECTED') {
        this.currentSession.durationSeconds += 1;
        this.notify();
      }
    }, 1000);
  }

  private stopDurationTimer() {
    if (this.durationTimer) {
      clearInterval(this.durationTimer);
      this.durationTimer = null;
    }
  }

  private startCallTimeout(durationMs = 45000) {
    this.clearCallTimeout();
    this.callTimeoutTimer = setTimeout(() => {
      if (
        this.currentSession &&
        (this.currentSession.state === 'OUTGOING_CALLING' ||
          this.currentSession.state === 'OUTGOING_RINGING' ||
          this.currentSession.state === 'INCOMING_RINGING')
      ) {
        console.log('📞 Call timeout reached (unanswered) - auto ending call');
        if (this.currentSession.isCaller) {
          this.endCall(this.currentSession.callId, 'no_answer');
        } else {
          this.rejectCall(this.currentSession.callId, 'missed');
        }
      }
    }, durationMs);
  }

  private clearCallTimeout() {
    if (this.callTimeoutTimer) {
      clearTimeout(this.callTimeoutTimer);
      this.callTimeoutTimer = null;
    }
  }

  private _saveCallLog(statusOverride?: 'completed' | 'missed' | 'declined' | 'failed') {
    if (!this.currentSession) return;
    const session = this.currentSession;
    const isConnected = session.durationSeconds > 0 || session.state === 'CONNECTED';

    let direction: 'outgoing' | 'incoming' | 'missed' = session.isCaller ? 'outgoing' : 'incoming';
    let status: 'completed' | 'missed' | 'declined' | 'failed' = statusOverride || 'completed';

    if (!session.isCaller && !isConnected) {
      direction = 'missed';
      status = 'missed';
    } else if (session.isCaller && !isConnected) {
      status = statusOverride || 'declined';
    } else if (isConnected) {
      status = 'completed';
    }

    callHistoryService.addLog({
      callId: session.callId,
      targetUserId: session.targetUserId,
      targetUserName: session.targetUserName,
      targetUserAvatar: session.targetUserAvatar,
      callType: session.callType,
      direction,
      status,
      durationSeconds: session.durationSeconds,
      timestamp: session.startedAt || Date.now(),
    });

    const completedLog: CallCompletedLog = {
      callId: session.callId,
      targetUserId: session.targetUserId,
      targetUserName: session.targetUserName,
      callType: session.callType,
      status: status === 'failed' ? 'declined' : status,
      durationSeconds: session.durationSeconds,
      isCaller: session.isCaller,
      conversationId: session.conversationId,
    };

    for (const listener of this.callCompletedListeners) {
      try {
        listener(completedLog);
      } catch (_) {}
    }
  }

  public onCallCompleted(cb: CallCompletedCallback) {
    this.callCompletedListeners.add(cb);
    return () => {
      this.callCompletedListeners.delete(cb);
    };
  }
}

export const callService = new CallService();
