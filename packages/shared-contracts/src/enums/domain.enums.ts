/**
 * Domain enums shared between the NestJS backend, Flutter client,
 * and any other consumers in the monorepo.
 */

export enum MessageType {
  TEXT = 'TEXT',
  IMAGE = 'IMAGE',
  VIDEO = 'VIDEO',
  AUDIO = 'AUDIO',
  DOCUMENT = 'DOCUMENT',
  LOCATION = 'LOCATION',
  SYSTEM = 'SYSTEM',
}

/**
 * Delivery state machine:
 * QUEUED → SENDING → SERVER_RECEIVED → DELIVERED → READ
 *                  ↘ FAILED → RETRYING → SENDING (retry cycle)
 */
export enum DeliveryStatus {
  QUEUED = 'QUEUED',
  SENDING = 'SENDING',
  SERVER_RECEIVED = 'SERVER_RECEIVED',
  DELIVERED = 'DELIVERED',
  READ = 'READ',
  FAILED = 'FAILED',
  RETRYING = 'RETRYING',
}

export enum ConversationType {
  DIRECT = 'DIRECT',
  GROUP = 'GROUP',
}

export enum Role {
  MEMBER = 'MEMBER',
  ADMIN = 'ADMIN',
}

export enum CallType {
  AUDIO = 'AUDIO',
  VIDEO = 'VIDEO',
}

export enum CallStatus {
  INITIATED = 'INITIATED',
  RINGING = 'RINGING',
  ACCEPTED = 'ACCEPTED',
  DECLINED = 'DECLINED',
  ENDED = 'ENDED',
  MISSED = 'MISSED',
  BUSY = 'BUSY',
}

export enum PresenceStatus {
  ONLINE = 'ONLINE',
  OFFLINE = 'OFFLINE',
}

export enum LastSeenVisibility {
  EVERYONE = 'EVERYONE',
  MY_CONTACTS = 'MY_CONTACTS',
  NOBODY = 'NOBODY',
}

export enum Platform {
  ANDROID = 'ANDROID',
  IOS = 'IOS',
}
