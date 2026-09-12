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
  EVT_WEBRTC_OFFER,
  EVT_WEBRTC_ANSWER,
} from './socket';
import { soundService } from './soundService';
import { callHistoryService } from './callHistoryService';
import { webrtcService } from './webrtcService';
import { audioRoutingService } from './audioRoutingService';
import { ensureMicrophonePermission } from './permissionsService';

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
  isNoiseSuppressionOn: boolean;
  conversationId?: string;
  sdp?: any;
  endReason?: string;
  videoSwitchPending?: boolean;
  videoSwitchRequestedBy?: string;
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
  private loggedCallIds: Set<string> = new Set();
  private handledEndedCallIds: Set<string> = new Set();

  constructor() {
    this.init();
  }

  public init() {
    if (this.isInitialized) return;
    this.isInitialized = true;
    socketService.setInCallChecker(() => this.isInCall());
    this.setupSocketListeners();
  }

  private setupSocketListeners() {
    // ── Call Status Updates from Server ('RINGING' vs 'CALLING' vs 'CONNECTED' vs 'ENDED') ──
    socketService.on(
      'call:status',
      async (payload: {
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
          // Step 1: Explicitly stop and unload expo-av ringback/ringtone player first
          await soundService.stopCallSounds();
          // Step 2: Start native InCallManager audio session cleanly without expo-av overlap
          audioRoutingService.start(this.currentSession.callType === 'video');
          // Step 3: Play subtle connected chime (non-blocking)
          soundService.playCallConnectedSound().catch(() => {});

          this.currentSession.state = 'CONNECTED';
          this.currentSession.startedAt = this.currentSession.startedAt || Date.now();
          this.startDurationTimer();
          this.notify();
        } else if (payload.status === 'RINGING') {
          if (this.currentSession.state !== 'CONNECTED') {
            this.currentSession.state = 'OUTGOING_RINGING';
            // Start ringback tone only when receiver is confirmed online/ringing
            if (this.currentSession.isCaller) {
              soundService
                .startOutgoingRingbackTone()
                .catch((e) => console.warn('⚠️ [CallService] Ringback tone failed:', e));
            }
            this.notify();
          }
        } else if (payload.status === 'CALLING') {
          if (this.currentSession.state !== 'CONNECTED') {
            this.currentSession.state = 'OUTGOING_CALLING';
            // Receiver is offline / ringing not confirmed yet — do not play ringback tone yet
            this.notify();
          }
        } else if (payload.status === 'ENDED') {
          handleRemoteEnd(payload);
        }
      },
    );

    // ── Incoming Call from remote peer ──────────────────────────────────────
    socketService.on(EVT_CALL_INCOMING, (payload: any) => {
      console.log('📞 Incoming call event received:', payload);
      if (!payload?.callId || !payload?.callerId) return;

      // If already in an active call, reject as busy
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

      // Avoid resetting if already ringing
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
        isNoiseSuppressionOn: false,
        conversationId: payload.conversationId,
        sdp: payload.sdp,
      };

      // Acknowledge back to server that receiver device received call and is ringing
      socketService.emit('call:ringing', {
        callId: payload.callId,
        callerId: payload.callerId,
      });

      // 45s incoming call timeout (auto-missed if unpicked)
      this.startCallTimeout(45000);

      // FIX: startIncomingRingtone now awaits its own init promise internally,
      // but fire as non-blocking so incoming call UI shows instantly.
      // The ringtone will start playing as soon as the audio session is ready (~50ms).
      soundService
        .startIncomingRingtone()
        .catch((e) => console.warn('⚠️ [CallService] Incoming ringtone failed:', e));
      this.notify();
    });

    // ── Call Accepted by receiver ───────────────────────────────────────────
    socketService.on(EVT_CALL_ACCEPTED, async (payload: any) => {
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
      // Step 1: Explicitly stop and unload expo-av ringback/ringtone player first
      await soundService.stopCallSounds();
      // Step 2: Start native InCallManager audio session cleanly without expo-av overlap
      audioRoutingService.start(this.currentSession.callType === 'video');
      // Step 3: Play subtle connected chime (non-blocking)
      soundService.playCallConnectedSound().catch(() => {});

      this.currentSession.state = 'CONNECTED';
      this.currentSession.startedAt = this.currentSession.startedAt || Date.now();
      this.startDurationTimer();

      // Handle SDP Answer on Caller side
      if (payload.sdp && this.currentSession.isCaller) {
        try {
          await webrtcService.handleIncomingAnswer(payload.sdp);
        } catch (err) {
          console.warn('⚠️ [WebRTC] Error handling incoming answer:', err);
        }
      }

      this.notify();
    });

    // ── Dedicated WebRTC Offer / Answer Listeners ───────────────────────────
    socketService.on(EVT_WEBRTC_OFFER, async (payload: any) => {
      if (payload?.sdp && this.currentSession && !this.currentSession.isCaller) {
        // FIX: If call is already CONNECTED, this is a renegotiation offer (e.g. video upgrade)
        // Previously this just stored sdp — now we process it immediately if PC is active.
        if (this.currentSession.state === 'CONNECTED') {
          await webrtcService.handleRenegotiationOffer(payload.sdp);
        } else {
          this.currentSession.sdp = payload.sdp;
        }
      }
    });

    socketService.on(EVT_WEBRTC_ANSWER, async (payload: any) => {
      if (payload?.sdp && this.currentSession && this.currentSession.isCaller) {
        try {
          await webrtcService.handleIncomingAnswer(payload.sdp);
        } catch (err) {
          console.warn('⚠️ [WebRTC] Error handling answer event:', err);
        }
      }
    });

    // ── FIX: Handle mid-call SDP renegotiation for video upgrade ─────────
    // NOTE: webrtcService._setupSocketListeners() already handles these events.
    // Registering them here was causing duplicate handler execution — removed.

    // ── Call Ended / Cancelled / Rejected Universal Handlers ───────────────────────────
    const handleRemoteEnd = (payload: any) => {
      console.log('📞 [CallService] Call ended/cancelled signal received:', payload);
      if (!this.currentSession) return;

      const targetCallId = payload?.callId || this.currentSession.callId;

      if (
        payload?.callId &&
        this.currentSession.callId &&
        this.currentSession.callId !== payload.callId
      ) {
        console.log(
          '⚠️ [CallService] Ignored end signal for different callId:',
          payload?.callId,
          'vs current:',
          this.currentSession.callId,
        );
        return;
      }

      // 🛑 DEBOUNCE / DEDUPLICATION GUARD:
      // If session is already in ENDED state or callId was already processed, ignore duplicate events!
      if (
        this.currentSession.state === 'ENDED' ||
        (targetCallId && this.handledEndedCallIds.has(targetCallId))
      ) {
        console.log(
          '🛡️ [CallService] Dropping duplicate call:end/cancel/error event for:',
          targetCallId,
        );
        return;
      }

      if (targetCallId) {
        this.handledEndedCallIds.add(targetCallId);
        setTimeout(() => this.handledEndedCallIds.delete(targetCallId), 30000);
      }

      console.log(
        `🛑 [CallService] Dismissing session immediately (was state: ${this.currentSession.state}, isCaller: ${this.currentSession.isCaller}, reason: ${payload?.reason})`,
      );

      this.clearCallTimeout();
      webrtcService.closeSession(); // Purely optional and safe even if WebRTC peer connection was never initiated
      audioRoutingService.stop();
      this._saveCallLog(
        payload?.reason === 'rejected' ||
          payload?.reason === 'declined' ||
          payload?.reason === 'cancelled'
          ? 'declined'
          : undefined,
      );
      soundService.stopCallSounds();
      soundService.playCallEndedSound();
      this.stopDurationTimer();
      this.currentSession.state = 'ENDED';
      if (payload?.reason) {
        this.currentSession.endReason = payload.reason;
      }
      this.notify();

      // Reset session immediately
      setTimeout(() => {
        if (this.currentSession?.state === 'ENDED') {
          this.currentSession = null;
          this.notify();
        }
      }, 350);
    };

    socketService.on(EVT_CALL_ENDED, handleRemoteEnd);
    socketService.on('call:end', handleRemoteEnd);
    socketService.on('call:cancelled', handleRemoteEnd);
    socketService.on('call:cancel', handleRemoteEnd);
    socketService.on('call:error', handleRemoteEnd);
    socketService.on('v1.call.end', handleRemoteEnd);
    // NOTE: 'call:status' with status=ENDED is already handled by the call:status listener
    // registered at the top of setupSocketListeners() — no duplicate registration needed.

    // ── Video Switch Request / Accept / Reject ───────────────────────────────
    socketService.on(EVT_CALL_SWITCH_VIDEO, async (payload: any) => {
      console.log('📹 Switch video event received from remote:', payload);
      if (!this.currentSession || this.currentSession.callId !== payload.callId) return;

      if (payload.action === 'request') {
        // Remote requested video: mark pending and notify UI (do NOT flip isVideoEnabled yet!)
        this.currentSession.videoSwitchPending = true;
        this.currentSession.videoSwitchRequestedBy = payload.senderId;
        this.notify();
      } else if (payload.action === 'accept') {
        // Remote accepted our request: activate video stream
        this.currentSession.videoSwitchPending = false;
        this.currentSession.isVideoEnabled = true;
        this.currentSession.callType = 'video';
        this.currentSession.isSpeakerOn = true;
        await webrtcService.upgradeToVideo();
        this.notify();
      } else if (payload.action === 'reject') {
        // Remote rejected: remain on audio
        this.currentSession.videoSwitchPending = false;
        this.currentSession.isVideoEnabled = false;
        this.currentSession.callType = 'audio';
        webrtcService.disableVideo();
        this.notify();
      }
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
    // Collision guard: block new outgoing call if already in an active call
    if (
      this.currentSession &&
      this.currentSession.state !== 'ENDED' &&
      (this.currentSession.state as string) !== 'IDLE'
    ) {
      console.warn('[CallService] Cannot start new call — already in an active call');
      // Return the existing session so caller can navigate to CallScreen
      return this.currentSession;
    }

    const callId = `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const isVideo = params.callType === 'video';

    // JIT: request microphone (and camera for video) before starting the call
    // Fire-and-forget — permission UI shows, WebRTC will catch denial during getUserMedia
    ensureMicrophonePermission().catch(() => {});

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
      state: 'OUTGOING_CALLING',
      durationSeconds: 0,
      isMuted: false,
      isSpeakerOn: isVideo,
      isVideoEnabled: isVideo,
      isNoiseSuppressionOn: false,
      conversationId: params.conversationId,
    };

    // ⚡ FIX 3: Emit call:initiate IMMEDIATELY so receiver device rings with 0ms delay!
    socketService.emit(EVT_CALL_INITIATE, {
      callId,
      receiverId: params.targetUserId,
      callType: params.callType,
      callerName: params.myName,
      callerAvatar: params.myAvatar,
      conversationId: params.conversationId,
    });

    // Start outgoing ringback tone so caller has immediate auditory feedback
    soundService
      .startOutgoingRingbackTone()
      .catch((e) => console.warn('⚠️ [CallService] Outgoing ringback failed:', e));

    // Initialize WebRTC and create SDP Offer in background, sending offer via follow-up EVT_WEBRTC_OFFER
    (async () => {
      try {
        await webrtcService.startLocalStream(isVideo);
        await webrtcService.initPeerConnection(callId, params.targetUserId, true);
        const offer = await webrtcService.createOffer();

        // If call was cancelled or ended while offer was being created, ABORT!
        if (
          !this.currentSession ||
          this.currentSession.callId !== callId ||
          this.currentSession.state === 'ENDED'
        ) {
          console.log(
            '🛑 [CallService] Call was cancelled before offer completed — aborting offer signal',
          );
          webrtcService.closeSession();
          return;
        }

        // Emit dedicated EVT_WEBRTC_OFFER with the generated SDP offer
        socketService.emit(EVT_WEBRTC_OFFER, {
          callId,
          targetUserId: params.targetUserId,
          sdp: offer,
        });
      } catch (err: any) {
        console.warn('⚠️ [WebRTC] Failed to create call offer / media stream error:', err);
        // ⚡ If media capture or SDP offer creation fails (e.g. mic/camera permission denied),
        // immediately send call:end / call:cancel / call:error to receiver so they stop ringing!
        if (this.currentSession && this.currentSession.callId === callId) {
          const reason =
            err?.name === 'NotAllowedError' ||
            err?.name === 'PermissionDeniedError' ||
            err?.message?.toLowerCase().includes('permission') ||
            err?.message?.toLowerCase().includes('denied')
              ? 'permission_denied'
              : 'media_error';

          socketService.emit(EVT_CALL_END, {
            callId,
            targetUserId: params.targetUserId,
            receiverId: params.targetUserId,
            reason,
          });
          socketService.emit('call:cancel', {
            callId,
            targetUserId: params.targetUserId,
            receiverId: params.targetUserId,
            reason,
          });
          socketService.emit('call:error', {
            callId,
            targetUserId: params.targetUserId,
            receiverId: params.targetUserId,
            reason,
            error: err?.message || 'Media stream capture failed',
          });

          this.endCall(callId, reason);
        }
      }
    })();

    // 45s outgoing call timeout
    this.startCallTimeout(45000);
    this.notify();
    return this.currentSession;
  }

  public async acceptCall(callId?: string) {
    if (!this.currentSession) return;
    if (callId && this.currentSession.callId !== callId) return;

    this.clearCallTimeout();
    const isVideo = this.currentSession.callType === 'video';

    // ── FIX: Start audio session IMMEDIATELY before any async work ───────
    // Previously audioRoutingService.start() was called after await startLocalStream()
    // causing ~3-5s audio silence even after connection. Now audio route is configured
    // the instant user taps Accept — hardware audio path is ready before media capture.
    audioRoutingService.start(isVideo);

    // Non-blocking sound unload for instant UI transition
    soundService.stopCallSounds().catch(() => {});
    soundService.playCallConnectedSound().catch(() => {});

    // INSTANT 0ms visual feedback: transition state immediately!
    this.currentSession.state = 'CONNECTED';
    this.currentSession.startedAt = Date.now();
    this.startDurationTimer();
    this.notify();

    // Capture the SDP offer NOW before any async work so we don't lose it
    const pendingSdp = this.currentSession.sdp;
    const callerId = this.currentSession.callerId;
    const sessionCallId = this.currentSession.callId;

    // Background WebRTC handshake
    try {
      // ── FIX: Start local media stream and init peer connection in parallel ──
      // Previously sequential: startLocalStream → initPeerConnection → handleIncomingOffer
      // Now: startLocalStream runs first (hardware warmup), then init + offer processing
      await webrtcService.startLocalStream(isVideo);

      // Only proceed if call wasn't ended during media capture
      if (!this.currentSession || this.currentSession.callId !== sessionCallId) {
        console.log('🛑 [CallService] Call ended during media capture — aborting accept');
        return;
      }

      await webrtcService.initPeerConnection(sessionCallId, callerId, false);

      let answerSdp: any = null;
      if (pendingSdp) {
        // ── FIX: Use captured pendingSdp, not this.currentSession.sdp ─────
        // this.currentSession could be null/changed by the time we await here
        answerSdp = await webrtcService.handleIncomingOffer(pendingSdp);
      }

      // Guard again — make sure session is still active
      if (!this.currentSession || this.currentSession.callId !== sessionCallId) {
        console.log('🛑 [CallService] Call ended during SDP processing — aborting accept emit');
        return;
      }

      socketService.emit(EVT_CALL_ACCEPT, {
        callId: sessionCallId,
        callerId,
        sdp: answerSdp,
      });
    } catch (err: any) {
      console.warn('⚠️ [WebRTC] Error during acceptCall handshake:', err);
      // Callee cannot access mic/camera: reject call immediately so caller knows
      this.rejectCall(this.currentSession?.callId ?? sessionCallId, 'media_error');
    }
  }

  public rejectCall(callId?: string, reason = 'declined') {
    if (!this.currentSession) return;
    if (callId && this.currentSession.callId !== callId) return;

    console.log(
      `📞 [CallService] Callee rejecting call (callId=${this.currentSession.callId}, reason=${reason})`,
    );

    this.clearCallTimeout();
    webrtcService.closeSession();
    audioRoutingService.stop();
    this._saveCallLog(reason === 'declined' ? 'declined' : 'missed');
    soundService.stopCallSounds();
    soundService.playCallEndedSound();
    this.stopDurationTimer();

    if (this.currentSession.callId) {
      this.handledEndedCallIds.add(this.currentSession.callId);
    }

    socketService.emit(EVT_CALL_REJECT, {
      callId: this.currentSession.callId,
      callerId: this.currentSession.callerId,
      targetUserId: this.currentSession.callerId,
      reason,
    });

    this.currentSession.state = 'ENDED';
    this.currentSession.endReason = reason;
    this.notify();

    setTimeout(() => {
      if (this.currentSession?.state === 'ENDED') {
        this.currentSession = null;
        this.notify();
      }
    }, 400);
  }

  public endCall(callId?: string, reason = 'ended') {
    if (!this.currentSession) return;
    if (callId && this.currentSession.callId !== callId) return;

    const isPreAnswer =
      this.currentSession.state === 'OUTGOING_CALLING' ||
      this.currentSession.state === 'OUTGOING_RINGING' ||
      this.currentSession.state === 'INCOMING_RINGING';

    const finalReason = isPreAnswer ? 'cancelled' : reason;
    console.log(
      `📞 [CallService] Ending call (isPreAnswer=${isPreAnswer}, reason=${finalReason}, callId=${this.currentSession.callId})`,
    );

    if (this.currentSession.callId) {
      this.handledEndedCallIds.add(this.currentSession.callId);
    }

    this.clearCallTimeout();
    webrtcService.closeSession();
    audioRoutingService.stop();
    this._saveCallLog(isPreAnswer ? 'declined' : undefined);
    soundService.stopCallSounds();
    soundService.playCallEndedSound();
    this.stopDurationTimer();

    socketService.emit(EVT_CALL_END, {
      callId: this.currentSession.callId,
      targetUserId: this.currentSession.targetUserId,
      receiverId: this.currentSession.targetUserId,
      reason: finalReason,
    });
    socketService.emit('call:cancel', {
      callId: this.currentSession.callId,
      targetUserId: this.currentSession.targetUserId,
      receiverId: this.currentSession.targetUserId,
      reason: finalReason,
    });
    socketService.emit('call:error', {
      callId: this.currentSession.callId,
      targetUserId: this.currentSession.targetUserId,
      receiverId: this.currentSession.targetUserId,
      reason: finalReason,
    });

    this.currentSession.state = 'ENDED';
    this.currentSession.endReason = finalReason;
    this.notify();

    setTimeout(() => {
      if (this.currentSession?.state === 'ENDED') {
        this.currentSession = null;
        this.notify();
      }
    }, 400);
  }

  public toggleMute(): boolean {
    if (!this.currentSession) return false;
    this.currentSession.isMuted = !this.currentSession.isMuted;
    webrtcService.setMute(this.currentSession.isMuted);
    this.notify();
    return this.currentSession.isMuted;
  }

  public toggleSpeaker(): boolean {
    if (!this.currentSession) return false;
    this.currentSession.isSpeakerOn = !this.currentSession.isSpeakerOn;
    audioRoutingService.setSpeakerphoneOn(this.currentSession.isSpeakerOn);
    this.notify();
    return this.currentSession.isSpeakerOn;
  }

  public async toggleNoiseSuppression(): Promise<boolean> {
    if (!this.currentSession) return false;
    const targetState = !this.currentSession.isNoiseSuppressionOn;
    const success = await webrtcService.setNoiseSuppression(targetState);
    if (success) {
      this.currentSession.isNoiseSuppressionOn = targetState;
      this.notify();
    }
    return this.currentSession.isNoiseSuppressionOn;
  }

  public async acceptVideoSwitch() {
    if (!this.currentSession) return;
    this.currentSession.videoSwitchPending = false;
    this.currentSession.isVideoEnabled = true;
    this.currentSession.callType = 'video';
    this.currentSession.isSpeakerOn = true;
    await webrtcService.upgradeToVideo();

    socketService.emit(EVT_CALL_SWITCH_VIDEO, {
      callId: this.currentSession.callId,
      targetUserId: this.currentSession.targetUserId,
      action: 'accept',
      isVideo: true,
    });
    this.notify();
  }

  public rejectVideoSwitch() {
    if (!this.currentSession) return;
    this.currentSession.videoSwitchPending = false;

    socketService.emit(EVT_CALL_SWITCH_VIDEO, {
      callId: this.currentSession.callId,
      targetUserId: this.currentSession.targetUserId,
      action: 'reject',
      isVideo: false,
    });
    this.notify();
  }

  public toggleVideoSwitch(): boolean {
    if (!this.currentSession) return false;

    // If remote requested a video switch, tapping accepts it!
    if (this.currentSession.videoSwitchPending) {
      this.acceptVideoSwitch();
      return true;
    }

    const newVideoState = !this.currentSession.isVideoEnabled;
    this.currentSession.isVideoEnabled = newVideoState;
    this.currentSession.callType = newVideoState ? 'video' : 'audio';
    if (newVideoState) {
      this.currentSession.isSpeakerOn = true;
      webrtcService.upgradeToVideo().catch(() => {});
    } else {
      webrtcService.disableVideo();
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

  public switchCamera() {
    webrtcService.switchCamera();
  }

  public getSession(): ActiveCallSession | null {
    return this.currentSession;
  }

  public isInCall(): boolean {
    return Boolean(
      this.currentSession &&
      this.currentSession.state !== 'IDLE' &&
      this.currentSession.state !== 'ENDED',
    );
  }

  public addListener(listener: CallListener): () => void {
    this.listeners.add(listener);
    listener(this.currentSession);
    return () => {
      this.listeners.delete(listener);
    };
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
    if (this.loggedCallIds.has(session.callId)) return;
    this.loggedCallIds.add(session.callId);

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
