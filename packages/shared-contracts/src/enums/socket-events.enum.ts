/**
 * Versioned Socket.io event names for the WhatsApp-style E2EE chat application.
 * These names are the single source of truth used by both the NestJS backend
 * and the Flutter client (via Dart mirror).
 */
export enum SocketEvent {
  // ─── Message events ──────────────────────────────────────────────────────────
  /** C → S: Send an encrypted message to the server */
  MESSAGE_SEND = 'v1.message.send',
  /** S → C: Deliver ciphertext to a recipient device */
  MESSAGE_RECEIVE = 'v1.message.receive',
  /** S → C: SERVER_RECEIVED acknowledgement back to the sender */
  MESSAGE_ACK = 'v1.message.ack',
  /** C → S: DELIVERED / READ receipt from the recipient device */
  MESSAGE_RECEIPT = 'v1.message.receipt',
  MESSAGE_RECEIPT_UPDATE = 'v1.message.receipt',
  /** S → C: Receipt update fan-out to the original sender */
  MESSAGE_RECEIPT_FAN_OUT = 'v1.message.receipt.fan-out',
  /** S → C: Delete-for-everyone notification */
  MESSAGE_DELETED = 'v1.message.deleted',

  // ─── Reaction events ─────────────────────────────────────────────────────────
  /** C → S: Add an emoji reaction to a message */
  REACTION_ADD = 'v1.reaction.add',
  /** C → S: Remove an emoji reaction from a message */
  REACTION_REMOVE = 'v1.reaction.remove',
  /** S → C: Reaction update fan-out to all conversation members */
  REACTION_FAN_OUT = 'v1.reaction.fan-out',

  // ─── Presence events ─────────────────────────────────────────────────────────
  /** C → S: App moved to foreground (user is online) */
  PRESENCE_ONLINE = 'v1.presence.online',
  /** C → S: App moved to background or disconnected */
  PRESENCE_OFFLINE = 'v1.presence.offline',
  /** S → C: Presence change notification for a contact */
  PRESENCE_UPDATE = 'v1.presence.update',
  /** C ↔ S: Typing start / stop indicator */
  PRESENCE_TYPING = 'v1.presence.typing',

  // ─── Call events ─────────────────────────────────────────────────────────────
  /** C → S: Initiate an audio or video call */
  CALL_INITIATE = 'v1.call.initiate',
  /** S → C: Incoming call notification to the recipient */
  CALL_INCOMING = 'v1.call.incoming',
  /** C → S: Accept an incoming call */
  CALL_ACCEPT = 'v1.call.accept',
  /** C → S: Decline an incoming call */
  CALL_DECLINE = 'v1.call.decline',
  CALL_REJECT = 'v1.call.decline',
  /** C → S: End an active call */
  CALL_END = 'v1.call.end',
  /** C ↔ S: ICE candidate relay for WebRTC negotiation */
  CALL_ICE_CANDIDATE = 'v1.call.ice-candidate',
  /** C → S: WebRTC SDP offer relay */
  CALL_SDP_OFFER = 'v1.call.sdp-offer',
  CALL_OFFER = 'v1.call.sdp-offer',
  /** C → S: WebRTC SDP answer relay */
  CALL_SDP_ANSWER = 'v1.call.sdp-answer',
  CALL_ANSWER = 'v1.call.sdp-answer',

  // ─── Key management events ───────────────────────────────────────────────────
  /** S → C: OneTimePreKey pool is low — client should replenish */
  KEYS_REPLENISH = 'v1.keys.replenish',
  /** S → C: SignedPreKey rotation is due */
  KEYS_ROTATE_SIGNED = 'v1.keys.rotate-signed',

  // ─── Media events ────────────────────────────────────────────────────────────
  /** S → C: A media attachment has expired and been deleted from storage */
  MEDIA_EXPIRED = 'v1.media.expired',

  // ─── Device events ───────────────────────────────────────────────────────────
  /** S → C: Remote device revocation (force logout) */
  DEVICE_FORCE_LOGOUT = 'v1.device.force-logout',
}
