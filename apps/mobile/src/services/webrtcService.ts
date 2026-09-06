import { socketService } from './socket';

// ─── STUN / TURN Server Configuration ──────────────────────────────────────────
// FIX: Reduced iceCandidatePoolSize from 10 to 4 — large pool causes ICE gathering
// to block waiting for all candidates before sending any, adding ~3-5s delay.
// iceTransportPolicy 'all' ensures UDP is tried first (fastest path).
// bundlePolicy 'max-bundle' reduces ICE candidates needed (single transport for all tracks).
export const ICE_SERVERS_CONFIG = {
  iceServers: [
    // Google Public STUN (fastest, most reliable globally)
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },

    // Free Open Relay Project Public TURN (Supports UDP & TCP on ports 80, 443, 3478)
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
        'turns:openrelay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
  // FIX: Reduced from 10 → 4. iceCandidatePoolSize pre-gathers candidates at
  // RTCPeerConnection creation time. Value of 10 caused excessive pre-gathering
  // that competed with the actual offer/answer flow on low-bandwidth mobile connections.
  iceCandidatePoolSize: 4,
  // Ensure all media (audio+video) shares one ICE transport — fewer candidates needed
  bundlePolicy: 'max-bundle' as RTCBundlePolicy,
  // Try UDP first (lowest latency), fall back to TCP/TURN automatically
  iceTransportPolicy: 'all' as RTCIceTransportPolicy,
};

export type MediaStream = any;
export type MediaStreamTrack = any;
export type RTCPeerConnection = any;
export type RTCIceCandidate = any;
export type RTCSessionDescription = any;

type StreamListener = (stream: MediaStream | null) => void;
type ConnectionStateListener = (state: string) => void;

/**
 * Safe dynamic resolver for react-native-webrtc.
 * Guarantees that native WebRTC modules are NEVER evaluated at app startup,
 * preventing any UnsatisfiedLinkError or bootstrap crashes.
 */
let _webrtcModule: any = null;
let _webrtcChecked = false;

export function getWebRTC(): any {
  if (!_webrtcChecked) {
    _webrtcChecked = true;
    try {
      _webrtcModule = require('react-native-webrtc');
    } catch (err) {
      console.warn('⚠️ [WebRTCService] Native react-native-webrtc unavailable:', err);
      _webrtcModule = null;
    }
  }
  return _webrtcModule;
}

class WebRTCService {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private currentCallId: string | null = null;
  private targetUserId: string | null = null;
  private isCaller = false;
  private isVideoCall = false;

  // Race condition queue: holds ICE candidates that arrive before setRemoteDescription() completes
  private pendingIceCandidates: RTCIceCandidate[] = [];
  private isRemoteDescriptionSet = false;
  private isBitrateApplied = false;

  // Renegotiation glare guard: prevents concurrent renegotiation attempts
  // Only one renegotiation can be in flight at a time to avoid signaling collisions.
  private _isRenegotiating = false;

  private localStreamListeners: Set<StreamListener> = new Set();
  private remoteStreamListeners: Set<StreamListener> = new Set();
  private connectionStateListeners: Set<ConnectionStateListener> = new Set();

  constructor() {
    this._setupSocketListeners();
  }

  // ─── Stream Subscriptions for UI ───────────────────────────────────────────

  public subscribeLocalStream(listener: StreamListener): () => void {
    this.localStreamListeners.add(listener);
    listener(this.localStream);
    return () => this.localStreamListeners.delete(listener);
  }

  public subscribeRemoteStream(listener: StreamListener): () => void {
    this.remoteStreamListeners.add(listener);
    listener(this.remoteStream);
    return () => this.remoteStreamListeners.delete(listener);
  }

  public subscribeConnectionState(listener: ConnectionStateListener): () => void {
    this.connectionStateListeners.add(listener);
    return () => this.connectionStateListeners.delete(listener);
  }

  public getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  public getRemoteStream(): MediaStream | null {
    return this.remoteStream;
  }

  // ─── Socket ICE & Signaling Listeners ───────────────────────────────────────

  private _setupSocketListeners() {
    socketService.on(
      'call:ice-candidate',
      async (data: { callId: string; candidate: any; senderId?: string }) => {
        if (data?.candidate && (!data.callId || data.callId === this.currentCallId)) {
          await this.addIceCandidate(data.candidate);
        }
      },
    );

    socketService.on(
      'webrtc:ice-candidate',
      async (data: { callId: string; candidate: any; senderId?: string }) => {
        if (data?.candidate && (!data.callId || data.callId === this.currentCallId)) {
          await this.addIceCandidate(data.candidate);
        }
      },
    );

    // ── FIX: Handle mid-call SDP renegotiation (video upgrade flow) ───────
    socketService.on(
      'webrtc:renegotiate-offer',
      async (data: { callId: string; sdp: any; senderId?: string }) => {
        if (!data?.sdp || (data.callId && data.callId !== this.currentCallId)) return;
        await this.handleRenegotiationOffer(data.sdp);
      },
    );

    socketService.on(
      'webrtc:renegotiate-answer',
      async (data: { callId: string; sdp: any; senderId?: string }) => {
        if (!data?.sdp || (data.callId && data.callId !== this.currentCallId)) return;
        await this.handleRenegotiationAnswer(data.sdp);
      },
    );
  }

  // ─── Local Media Capture ───────────────────────────────────────────────────

  public async startLocalStream(isVideo: boolean): Promise<MediaStream> {
    this.isVideoCall = isVideo;

    // Release any previous local tracks
    if (this.localStream) {
      try {
        this.localStream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
      } catch (_) {}
      this.localStream = null;
    }

    const webrtc = getWebRTC();
    if (!webrtc || !webrtc.mediaDevices) {
      throw new Error('WebRTC native module is not available on this device');
    }

    const constraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: isVideo
        ? {
            facingMode: 'user',
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 30 },
          }
        : false,
    };

    try {
      const stream = (await webrtc.mediaDevices.getUserMedia(constraints as any)) as MediaStream;
      this.localStream = stream;
      this._notifyLocalStream(stream);
      return stream;
    } catch (err: any) {
      console.warn('⚠️ [WebRTC] getUserMedia error:', err?.message || err);
      if (isVideo && webrtc?.mediaDevices) {
        const audioOnlyStream = (await webrtc.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: false,
            autoGainControl: false,
          },
        } as any)) as MediaStream;
        this.localStream = audioOnlyStream;
        this._notifyLocalStream(audioOnlyStream);
        return audioOnlyStream;
      }
      throw err;
    }
  }

  // ─── Peer Connection Management ────────────────────────────────────────────

  public async initPeerConnection(
    callId: string,
    targetUserId: string,
    isCaller: boolean,
  ): Promise<RTCPeerConnection> {
    this.currentCallId = callId;
    this.targetUserId = targetUserId;
    this.isCaller = isCaller;
    this.pendingIceCandidates = [];
    this.isRemoteDescriptionSet = false;
    this.isBitrateApplied = false;
    this._isRenegotiating = false;

    // Cleanup existing peer connection if active
    if (this.peerConnection) {
      try {
        this.peerConnection.close();
      } catch (_) {}
      this.peerConnection = null;
    }

    const webrtc = getWebRTC();
    if (!webrtc || !webrtc.RTCPeerConnection) {
      throw new Error('RTCPeerConnection is not available on this device');
    }

    const pc = new webrtc.RTCPeerConnection(ICE_SERVERS_CONFIG);
    this.peerConnection = pc;

    // Add local stream tracks to the connection
    if (this.localStream) {
      try {
        this.localStream.getTracks().forEach((track: MediaStreamTrack) => {
          pc.addTrack(track, this.localStream!);
        });
      } catch (err) {
        console.warn('⚠️ [WebRTC] Error adding local tracks to pc:', err);
      }
    }

    // ICE Candidate generation event
    pc.onicecandidate = (event: any) => {
      if (event.candidate && this.currentCallId && this.targetUserId) {
        console.log(
          `📡 [WebRTC] Generated local ICE candidate (${event.candidate.protocol} ${event.candidate.candidate?.substring(0, 35)}...)`,
        );
        socketService.emit('call:ice-candidate', {
          callId: this.currentCallId,
          targetUserId: this.targetUserId,
          candidate: event.candidate,
        });
      }
    };

    // Remote Track received event
    pc.ontrack = (event: any) => {
      console.log('🎬 [WebRTC] Remote track received:', event.track?.kind);
      if (event.streams && event.streams[0]) {
        this.remoteStream = event.streams[0];
        this._notifyRemoteStream(event.streams[0]);
      } else if (event.track) {
        if (!this.remoteStream && webrtc.MediaStream) {
          this.remoteStream = new webrtc.MediaStream();
        }
        if (this.remoteStream) {
          this.remoteStream.addTrack(event.track);
          this._notifyRemoteStream(this.remoteStream);
        }
      }
    };

    // ICE Connection State
    pc.oniceconnectionstatechange = () => {
      const iceState = pc.iceConnectionState;
      console.log(`📡 [WebRTC] ICE Connection State: 👉 ${iceState?.toUpperCase()}`);
      if (iceState === 'connected' || iceState === 'completed') {
        this._applyHighQualityVideoBitrate();
      }
    };

    // Peer Connection State
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log(`📡 [WebRTC] Peer Connection State: 👉 ${state?.toUpperCase()}`);
      if (state === 'connected') {
        this._applyHighQualityVideoBitrate();
      }
      this._notifyConnectionState(state);
    };

    return pc;
  }

  // ─── SDP Offer / Answer Handshake ──────────────────────────────────────────

  /** Caller: Create SDP Offer */
  public async createOffer(): Promise<RTCSessionDescription> {
    if (!this.peerConnection) {
      throw new Error('[WebRTC] PeerConnection not initialized');
    }

    console.log('📡 [WebRTC] Creating SDP Offer (Caller)');
    const offer = await this.peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: this.isVideoCall,
    } as any);

    await this.peerConnection.setLocalDescription(offer);
    return offer;
  }

  /** Callee: Process incoming SDP Offer and Create SDP Answer */
  public async handleIncomingOffer(offerSdp: any): Promise<RTCSessionDescription> {
    if (!this.peerConnection) {
      throw new Error('[WebRTC] PeerConnection not initialized');
    }

    const webrtc = getWebRTC();
    if (!webrtc || !webrtc.RTCSessionDescription) {
      throw new Error('[WebRTC] RTCSessionDescription unavailable');
    }

    console.log('📡 [WebRTC] Setting Remote Description (Offer on Callee)');
    const sessionDesc = new webrtc.RTCSessionDescription(offerSdp);
    await this.peerConnection.setRemoteDescription(sessionDesc);
    this.isRemoteDescriptionSet = true;

    await this._flushPendingIceCandidates();

    console.log('📡 [WebRTC] Creating SDP Answer (Callee)');
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    return answer;
  }

  /** Caller: Process incoming SDP Answer from Callee */
  public async handleIncomingAnswer(answerSdp: any): Promise<void> {
    if (!this.peerConnection) {
      throw new Error('[WebRTC] PeerConnection not initialized');
    }

    const webrtc = getWebRTC();
    if (!webrtc || !webrtc.RTCSessionDescription) {
      throw new Error('[WebRTC] RTCSessionDescription unavailable');
    }

    console.log('📡 [WebRTC] Setting Remote Description (Answer on Caller)');
    const sessionDesc = new webrtc.RTCSessionDescription(answerSdp);
    await this.peerConnection.setRemoteDescription(sessionDesc);
    this.isRemoteDescriptionSet = true;

    await this._flushPendingIceCandidates();
  }

  /** Add ICE Candidate with Race Condition Protection */
  public async addIceCandidate(candidate: any): Promise<void> {
    try {
      const webrtc = getWebRTC();
      if (!webrtc || !webrtc.RTCIceCandidate) return;

      const rtcCandidate = new webrtc.RTCIceCandidate(candidate);

      if (
        this.peerConnection &&
        this.isRemoteDescriptionSet &&
        this.peerConnection.remoteDescription
      ) {
        await this.peerConnection.addIceCandidate(rtcCandidate);
        console.log('✔ [WebRTC] Added ICE candidate directly');
      } else {
        this.pendingIceCandidates.push(rtcCandidate);
        console.log(
          `⏳ [WebRTC] Queued ICE candidate (waiting for remote description, queue size: ${this.pendingIceCandidates.length})`,
        );
      }
    } catch (err: any) {
      console.warn('⚠️ [WebRTC] Error adding ICE candidate:', err?.message || err);
    }
  }

  private isAudioMuted = false;

  public setMute(isMuted: boolean) {
    this.isAudioMuted = isMuted;
    if (this.localStream) {
      try {
        this.localStream.getAudioTracks().forEach((track: MediaStreamTrack) => {
          track.enabled = !isMuted;
        });
      } catch (_) {}
    }
  }

  public getIsMuted(): boolean {
    return this.isAudioMuted;
  }

  public setVideoEnabled(isEnabled: boolean) {
    if (this.localStream) {
      try {
        this.localStream.getVideoTracks().forEach((track: MediaStreamTrack) => {
          track.enabled = isEnabled;
        });
      } catch (_) {}
    }
  }

  /**
   * Mid-call video upgrade: capture camera track, attach to peer connection,
   * then perform full SDP renegotiation so the remote side receives the video stream.
   *
   * POLITE/IMPOLITE PEER PATTERN:
   * - isCaller (impolite peer) = initiates renegotiation via _renegotiate()
   * - !isCaller (polite peer) = only prepares tracks; waits for caller's renegotiation offer.
   *   The callee calling addTrack() before receiving the new offer is correct — when the
   *   renegotiate-offer arrives and setRemoteDescription/createAnswer runs, the callee's
   *   track is already in the sender list and will be included in the answer.
   */
  public async upgradeToVideo(): Promise<boolean> {
    const webrtc = getWebRTC();
    if (!webrtc || !webrtc.mediaDevices) return false;

    this.isVideoCall = true;
    try {
      const existingVideoTracks = this.localStream?.getVideoTracks() || [];
      if (existingVideoTracks.length > 0) {
        existingVideoTracks.forEach((t: MediaStreamTrack) => {
          t.enabled = true;
        });
        this._notifyLocalStream(this.localStream);
        // Caller initiates renegotiation; callee waits for caller's offer
        if (this.isCaller) {
          await this._renegotiate();
        }
        return true;
      }

      const videoStream = (await webrtc.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
        },
      } as any)) as MediaStream;

      const videoTrack = videoStream.getVideoTracks()[0];
      if (videoTrack) {
        if (this.localStream) {
          this.localStream.addTrack(videoTrack);
        } else {
          this.localStream = videoStream;
        }

        if (this.peerConnection) {
          try {
            this.peerConnection.addTrack(videoTrack, this.localStream);
          } catch (e) {
            console.warn('⚠️ [WebRTC] addTrack video error on upgrade:', e);
          }
        }

        this._notifyLocalStream(this.localStream);

        // Polite/impolite peer pattern:
        // - Caller (impolite): sends renegotiation offer
        // - Callee (polite): track is added and ready; waits for caller's offer.
        //   The offer will arrive via webrtc:renegotiate-offer → handleRenegotiationOffer().
        if (this.isCaller) {
          await this._renegotiate();
        } else {
          console.log(
            '📹 [WebRTC] Callee: video track added, waiting for renegotiation offer from caller',
          );
        }
        return true;
      }
    } catch (err) {
      console.warn('⚠️ [WebRTC] Failed to capture video on switch:', err);
    }
    return false;
  }

  /**
   * Perform an in-call SDP renegotiation (new offer → remote answer cycle).
   * Only the CALLER (impolite peer) calls this to avoid signaling glare.
   *
   * GLARE GUARD: If a renegotiation is already in flight, skip — prevents
   * collision when both sides try to renegotiate simultaneously.
   */
  private async _renegotiate(): Promise<void> {
    if (!this.peerConnection || !this.isCaller) {
      // Polite peer pattern: only the original caller initiates renegotiation
      return;
    }

    if (this._isRenegotiating) {
      console.log('⏸️ [WebRTC] Renegotiation already in flight — skipping duplicate request');
      return;
    }

    this._isRenegotiating = true;
    try {
      console.log('🔄 [WebRTC] Starting SDP renegotiation for video upgrade');
      const offer = await this.peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      } as any);
      await this.peerConnection.setLocalDescription(offer);

      // Reset remote description flag so incoming answer is processed correctly
      this.isRemoteDescriptionSet = false;

      socketService.emit('webrtc:renegotiate-offer', {
        callId: this.currentCallId,
        targetUserId: this.targetUserId,
        sdp: offer,
      });
      console.log('📡 [WebRTC] Renegotiation offer sent to remote peer');
    } catch (err: any) {
      console.warn('⚠️ [WebRTC] Renegotiation failed:', err?.message || err);
      this._isRenegotiating = false; // Release lock on failure
    }
    // Lock is released in handleRenegotiationAnswer() after the cycle completes
  }

  /**
   * Handle incoming renegotiation offer from remote (callee side — polite peer).
   * Creates and sends back the renegotiation answer.
   */
  public async handleRenegotiationOffer(offerSdp: any): Promise<void> {
    if (!this.peerConnection) return;
    const webrtc = getWebRTC();
    if (!webrtc || !webrtc.RTCSessionDescription) return;

    try {
      console.log('🔄 [WebRTC] Handling incoming renegotiation offer');
      const sessionDesc = new webrtc.RTCSessionDescription(offerSdp);

      // If we're in the middle of our own offer (shouldn't happen since only caller
      // initiates, but guard against it), rollback first
      if (
        this.peerConnection.signalingState === 'have-local-offer' ||
        this.peerConnection.signalingState === 'have-remote-offer'
      ) {
        console.warn('⚠️ [WebRTC] Unexpected signalingState during renegotiation — rolling back');
        try {
          await this.peerConnection.setLocalDescription({ type: 'rollback' } as any);
        } catch (_) {}
      }

      await this.peerConnection.setRemoteDescription(sessionDesc);
      this.isRemoteDescriptionSet = true;
      await this._flushPendingIceCandidates();

      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      socketService.emit('webrtc:renegotiate-answer', {
        callId: this.currentCallId,
        targetUserId: this.targetUserId,
        sdp: answer,
      });
      console.log('📡 [WebRTC] Renegotiation answer sent');
    } catch (err: any) {
      console.warn('⚠️ [WebRTC] Failed to handle renegotiation offer:', err?.message || err);
    }
  }

  /**
   * Handle incoming renegotiation answer (caller side — impolite peer).
   * Called after the callee processes our renegotiation offer.
   */
  public async handleRenegotiationAnswer(answerSdp: any): Promise<void> {
    if (!this.peerConnection) return;
    const webrtc = getWebRTC();
    if (!webrtc || !webrtc.RTCSessionDescription) return;

    try {
      console.log('🔄 [WebRTC] Applying renegotiation answer from remote');
      const sessionDesc = new webrtc.RTCSessionDescription(answerSdp);
      await this.peerConnection.setRemoteDescription(sessionDesc);
      this.isRemoteDescriptionSet = true;
      await this._flushPendingIceCandidates();
      console.log('✅ [WebRTC] Renegotiation complete — video track active on both sides');
    } catch (err: any) {
      console.warn('⚠️ [WebRTC] Failed to apply renegotiation answer:', err?.message || err);
    } finally {
      // Always release the renegotiation lock when the cycle ends
      this._isRenegotiating = false;
    }
  }

  public disableVideo(): void {
    if (this.localStream) {
      try {
        this.localStream.getVideoTracks().forEach((track: MediaStreamTrack) => {
          track.enabled = false;
        });
      } catch (_) {}
    }
  }

  private async _flushPendingIceCandidates() {
    if (!this.peerConnection || !this.peerConnection.remoteDescription) return;
    const count = this.pendingIceCandidates.length;
    if (count === 0) return;

    console.log(`🚀 [WebRTC] Flushing ${count} queued ICE candidates after remote description set`);
    while (this.pendingIceCandidates.length > 0) {
      const candidate = this.pendingIceCandidates.shift();
      if (candidate) {
        try {
          await this.peerConnection.addIceCandidate(candidate);
        } catch (e: any) {
          console.warn('⚠️ [WebRTC] Error flushing candidate:', e?.message || e);
        }
      }
    }
  }

  // ─── In-Call Media Controls ────────────────────────────────────────────────

  public switchCamera() {
    if (this.localStream) {
      try {
        const videoTrack = this.localStream.getVideoTracks()[0];
        if (videoTrack && (videoTrack as any)._switchCamera) {
          (videoTrack as any)._switchCamera();
        }
      } catch (_) {}
    }
  }

  // ─── Teardown & Clean Hardware Release ─────────────────────────────────────

  public closeSession() {
    console.log('🛑 [WebRTC] Closing WebRTC session and releasing hardware');
    this.isAudioMuted = false;

    // Stop all local media tracks
    if (this.localStream) {
      try {
        this.localStream.getTracks().forEach((track: MediaStreamTrack) => {
          try {
            track.stop();
            (track as any).release?.();
          } catch (_) {}
        });
      } catch (_) {}
      this.localStream = null;
      this._notifyLocalStream(null);
    }

    // Stop all remote media tracks
    if (this.remoteStream) {
      try {
        this.remoteStream.getTracks().forEach((track: MediaStreamTrack) => {
          try {
            track.stop();
            (track as any).release?.();
          } catch (_) {}
        });
      } catch (_) {}
      this.remoteStream = null;
      this._notifyRemoteStream(null);
    }

    // Close PeerConnection
    if (this.peerConnection) {
      try {
        this.peerConnection.close();
      } catch (_) {}
      this.peerConnection = null;
    }

    this.pendingIceCandidates = [];
    this.isRemoteDescriptionSet = false;
    this.isBitrateApplied = false;
    this._isRenegotiating = false;
    this.currentCallId = null;
    this.targetUserId = null;
    this.isCaller = false;
  }

  private isNoiseSuppressionEnabled = false;

  public getNoiseSuppression(): boolean {
    return this.isNoiseSuppressionEnabled;
  }

  /**
   * Toggles noise suppression live without restarting the call or renegotiating SDP.
   */
  public async setNoiseSuppression(enabled: boolean): Promise<boolean> {
    this.isNoiseSuppressionEnabled = enabled;
    const audioTrack = this.localStream?.getAudioTracks()[0];
    if (!audioTrack) {
      console.warn('⚠️ [WebRTC] No local audio track available to toggle noise suppression');
      return false;
    }

    // 1. Attempt standard applyConstraints()
    try {
      if (typeof (audioTrack as any).applyConstraints === 'function') {
        await (audioTrack as any).applyConstraints({
          noiseSuppression: enabled,
          autoGainControl: enabled,
        });
        console.log(
          `🎙️ [WebRTC] applyConstraints applied on audio track: noiseSuppression=${enabled}`,
        );
        return true;
      }
    } catch (err: any) {
      console.log(`ℹ️ [WebRTC] applyConstraints fallback to replaceTrack...`);
    }

    // 2. Seamless live track replacement via RTCRtpSender.replaceTrack()
    const webrtc = getWebRTC();
    if (!webrtc || !webrtc.mediaDevices) return false;

    try {
      const newStream = (await webrtc.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: enabled,
          autoGainControl: enabled,
        },
        video: false,
      } as any)) as MediaStream;

      const newAudioTrack = newStream.getAudioTracks()[0];
      if (!newAudioTrack) return false;

      const shouldBeEnabled = !this.isAudioMuted && audioTrack.enabled;
      newAudioTrack.enabled = shouldBeEnabled;

      if (this.peerConnection) {
        const senders = (this.peerConnection as any).getSenders
          ? (this.peerConnection as any).getSenders()
          : [];
        const audioSender = senders.find((s: any) => s.track && s.track.kind === 'audio');

        if (audioSender && typeof audioSender.replaceTrack === 'function') {
          await audioSender.replaceTrack(newAudioTrack);
        }
      }

      this.localStream?.removeTrack(audioTrack);
      this.localStream?.addTrack(newAudioTrack);

      try {
        audioTrack.stop();
        (audioTrack as any).release?.();
      } catch (_) {}

      newStream.getTracks().forEach((track: MediaStreamTrack) => {
        if (track !== newAudioTrack) {
          try {
            track.stop();
            (track as any).release?.();
          } catch (_) {}
        }
      });

      this._notifyLocalStream(this.localStream);
      return true;
    } catch (replaceErr: any) {
      console.warn('⚠️ [WebRTC] Failed to replace audio track for noise suppression:', replaceErr);
      return false;
    }
  }

  /**
   * Applies 1.5 Mbps bitrate and 30fps to the video sender once connection is established (720p HD)
   */
  private async _applyHighQualityVideoBitrate() {
    if (!this.peerConnection || this.isBitrateApplied) return;
    try {
      const senders = (this.peerConnection as any).getSenders?.();
      if (!senders || !Array.isArray(senders)) return;

      const videoSender = senders.find((s: any) => s.track && s.track.kind === 'video');
      if (!videoSender || typeof videoSender.getParameters !== 'function') return;

      const params = videoSender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      params.encodings[0].maxBitrate = 1500000;
      params.encodings[0].maxFramerate = 30;

      if (typeof videoSender.setParameters === 'function') {
        await videoSender.setParameters(params);
        this.isBitrateApplied = true;
      }
    } catch (err: any) {
      console.warn('⚠️ [WebRTC] Could not set video sender parameters:', err?.message || err);
    }
  }

  private _notifyLocalStream(stream: MediaStream | null) {
    for (const listener of this.localStreamListeners) {
      try {
        listener(stream);
      } catch (_) {}
    }
  }

  private _notifyRemoteStream(stream: MediaStream | null) {
    for (const listener of this.remoteStreamListeners) {
      try {
        listener(stream);
      } catch (_) {}
    }
  }

  private _notifyConnectionState(state: string) {
    for (const listener of this.connectionStateListeners) {
      try {
        listener(state);
      } catch (_) {}
    }
  }
}

export const webrtcService = new WebRTCService();
