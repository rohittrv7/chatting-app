import { socketService } from './socket';

// ─── STUN / TURN Server Configuration ──────────────────────────────────────────
export const ICE_SERVERS_CONFIG = {
  iceServers: [
    // Google Public STUN
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },

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
  iceCandidatePoolSize: 10,
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
