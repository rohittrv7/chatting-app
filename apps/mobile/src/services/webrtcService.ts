import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices,
  MediaStream,
  MediaStreamTrack,
} from 'react-native-webrtc';
import { socketService } from './socket';

// ─── STUN / TURN Server Configuration ──────────────────────────────────────────
// 1. Google Public STUN Servers (Used for direct P2P connection where NAT allows)
// 2. Open Relay Public TURN Servers (Used for strict NAT / mobile carrier traversal e.g. Jio/Airtel)
//
// 📍 HOW TO SWAP WITH YOUR OWN COTURN SERVER LATER:
// Replace the Open Relay entry below with your Coturn domain, port, username, and password:
// {
//   urls: ['turn:your-coturn-domain.com:3478', 'turns:your-coturn-domain.com:5349'],
//   username: 'your-coturn-username',
//   credential: 'your-coturn-password',
// }
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

type StreamListener = (stream: MediaStream | null) => void;
type ConnectionStateListener = (state: string) => void;

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
      this.localStream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
      this.localStream = null;
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
      const stream = (await mediaDevices.getUserMedia(constraints as any)) as MediaStream;
      this.localStream = stream;
      this._notifyLocalStream(stream);
      return stream;
    } catch (err: any) {
      console.warn('⚠️ [WebRTC] getUserMedia error:', err?.message || err);
      // Fallback to audio-only if video device is unavailable
      if (isVideo) {
        const audioOnlyStream = (await mediaDevices.getUserMedia({
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

    const pc = new RTCPeerConnection(ICE_SERVERS_CONFIG);
    this.peerConnection = pc;

    // Add local stream tracks to the connection
    if (this.localStream) {
      this.localStream.getTracks().forEach((track: MediaStreamTrack) => {
        pc.addTrack(track, this.localStream!);
      });
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
        if (!this.remoteStream) {
          this.remoteStream = new MediaStream();
        }
        this.remoteStream.addTrack(event.track);
        this._notifyRemoteStream(this.remoteStream);
      }
    };

    // ─── Comprehensive Connection State Logging ──────────────────────────────

    // ICE Connection State (checking -> connected / completed / failed / disconnected / closed)
    pc.oniceconnectionstatechange = () => {
      const iceState = pc.iceConnectionState;
      console.log(`📡 [WebRTC] ICE Connection State: 👉 ${iceState.toUpperCase()}`);
      if (iceState === 'failed') {
        console.warn(
          '⚠️ [WebRTC] ICE Connection failed! NAT traversal failed — check STUN/TURN server connectivity.',
        );
      } else if (iceState === 'connected' || iceState === 'completed') {
        console.log('🟢 [WebRTC] Media transport established successfully via P2P / TURN relay!');
        this._applyHighQualityVideoBitrate();
      } else if (iceState === 'disconnected') {
        console.warn(
          '🟡 [WebRTC] ICE disconnected — temporary network hiccup or interface change (e.g. WiFi ↔ 4G).',
        );
      }
    };

    // Peer Connection State (new -> connecting -> connected -> disconnected -> failed -> closed)
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log(`📡 [WebRTC] Peer Connection State: 👉 ${state.toUpperCase()}`);
      if (state === 'connected') {
        this._applyHighQualityVideoBitrate();
      }
      this._notifyConnectionState(state);
    };

    // Signaling State
    pc.onsignalingstatechange = () => {
      console.log(`📡 [WebRTC] Signaling State: 👉 ${pc.signalingState}`);
    };

    // ICE Gathering State
    pc.onicegatheringstatechange = () => {
      console.log(`📡 [WebRTC] ICE Gathering State: 👉 ${pc.iceGatheringState}`);
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

    console.log('📡 [WebRTC] Setting Remote Description (Offer on Callee)');
    const sessionDesc = new RTCSessionDescription(offerSdp);
    await this.peerConnection.setRemoteDescription(sessionDesc);
    this.isRemoteDescriptionSet = true;

    // Race condition prevention: Drain any queued ICE candidates that arrived before the offer
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

    console.log('📡 [WebRTC] Setting Remote Description (Answer on Caller)');
    const sessionDesc = new RTCSessionDescription(answerSdp);
    await this.peerConnection.setRemoteDescription(sessionDesc);
    this.isRemoteDescriptionSet = true;

    // Race condition prevention: Drain any queued ICE candidates that arrived before the answer
    await this._flushPendingIceCandidates();
  }

  /** Add ICE Candidate with Race Condition Protection */
  public async addIceCandidate(candidate: any): Promise<void> {
    try {
      const rtcCandidate = new RTCIceCandidate(candidate);

      // If remote description is already set, add candidate immediately
      if (
        this.peerConnection &&
        this.isRemoteDescriptionSet &&
        this.peerConnection.remoteDescription
      ) {
        await this.peerConnection.addIceCandidate(rtcCandidate);
        console.log('✔ [WebRTC] Added ICE candidate directly');
      } else {
        // Otherwise, queue candidate safely to be added after setRemoteDescription() finishes
        this.pendingIceCandidates.push(rtcCandidate);
        console.log(
          `⏳ [WebRTC] Queued ICE candidate (waiting for remote description, queue size: ${this.pendingIceCandidates.length})`,
        );
      }
    } catch (err: any) {
      console.warn('⚠️ [WebRTC] Error adding ICE candidate:', err?.message || err);
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

  public setMute(isMuted: boolean) {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track: MediaStreamTrack) => {
        track.enabled = !isMuted;
      });
    }
  }

  public setVideoEnabled(isEnabled: boolean) {
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach((track: MediaStreamTrack) => {
        track.enabled = isEnabled;
      });
    }
  }

  public switchCamera() {
    if (this.localStream) {
      const videoTrack = this.localStream.getVideoTracks()[0];
      if (videoTrack && (videoTrack as any)._switchCamera) {
        (videoTrack as any)._switchCamera();
      }
    }
  }

  // ─── Teardown & Clean Hardware Release ─────────────────────────────────────

  public closeSession() {
    console.log('🛑 [WebRTC] Closing WebRTC session and releasing hardware');

    // Stop all local media tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach((track: MediaStreamTrack) => {
        try {
          track.stop();
        } catch (_) {}
      });
      this.localStream = null;
      this._notifyLocalStream(null);
    }

    // Stop all remote media tracks
    if (this.remoteStream) {
      this.remoteStream.getTracks().forEach((track: MediaStreamTrack) => {
        try {
          track.stop();
        } catch (_) {}
      });
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
      params.encodings[0].maxBitrate = 1500000; // 1.5 Mbps (Target 720p HD video bitrate)
      params.encodings[0].maxFramerate = 30;

      if (typeof videoSender.setParameters === 'function') {
        await videoSender.setParameters(params);
        this.isBitrateApplied = true;
        console.log(
          '🚀 [WebRTC] High-quality HD video bitrate applied: 1.5 Mbps @ 30fps (Caller & Callee)',
        );
      }
    } catch (err: any) {
      console.warn('⚠️ [WebRTC] Could not set video sender parameters:', err?.message || err);
    }
  }

  // ─── Private Event Dispatchers ─────────────────────────────────────────────

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
