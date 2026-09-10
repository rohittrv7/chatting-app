/**
 * localDb.ts — Application-level API over expo-sqlite.
 *
 * Public function signatures are identical to the previous WatermelonDB version
 * so ChatContext.tsx requires zero import changes.
 *
 * Design:
 *   - upsertMessage()            → called on send (SENDING) and on socket receive
 *   - updateMessageStatus()      → called on ack / receipt / upload progress
 *   - upsertConversation()       → called on sync and on new message events
 *   - setMessageLocalMediaPath() → called after download, persists local file path
 *   - getConversations()         → one-shot read (initial render, backup export)
 *   - getMessages()              → one-shot read for a conversation
 *   - hasLocalMessages()         → check before fetching historical messages
 *   - deleteAllData()            → logout / before restore
 *   - getLocalStats()            → for backup metadata
 *
 * Reactive queries live in useLocalDb.ts (React hooks) — not here.
 * This file is pure async data access with no React dependency.
 */

import { getDatabase } from './database';
import type { ChatMessage, ConversationItem } from '../types';

// ─── Raw row types (what SQLite returns) ──────────────────────────────────────

interface MsgRow {
  id: number;
  server_id: string | null;
  client_message_id: string;
  conversation_server_id: string;
  sender_id: string;
  sender_name: string | null;
  sender_avatar: string | null;
  is_me: number;
  text: string | null;
  type: string;
  status: string;
  image_path: string | null;
  local_media_path: string | null;
  media_size: string | null;
  is_downloaded: number;
  is_uploading: number;
  upload_progress: number;
  reply_to_id: string | null;
  reply_to_text: string | null;
  reply_to_is_me: number;
  is_starred: number;
  is_deleted: number;
  attachment_file_key: string | null;
  attachment_file_nonce: string | null;
  location_json: string | null;
  document_json: string | null;
  contact_json: string | null;
  call_log_json: string | null;
  created_at_ms: number;
}

interface ConvRow {
  id: number;
  server_id: string;
  type: string;
  title: string | null;
  avatar_url: string | null;
  recipient_db_id: string | null;
  recipient_username: string | null;
  recipient_phone: string | null;
  last_message_text: string | null;
  last_message_at: number | null;
  last_message_is_me: number;
  last_message_status: string | null;
  unread_count: number;
  is_muted: number;
  cleared_history_at: number | null;
  created_at_ms: number;
  updated_at_ms: number;
}

// ─── Row → UI type converters ─────────────────────────────────────────────────

export function msgRowToChat(m: MsgRow): ChatMessage {
  const d = new Date(m.created_at_ms);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');

  const tryParse = (json: string | null) => {
    if (!json) return undefined;
    try {
      return JSON.parse(json);
    } catch {
      return undefined;
    }
  };

  return {
    id: m.server_id || m.client_message_id,
    conversationId: m.conversation_server_id,
    text: m.text || '',
    isMe: m.is_me === 1,
    time: `${hh}:${mm}`,
    status: m.status as ChatMessage['status'],
    createdAtMs: m.created_at_ms,
    createdAt: new Date(m.created_at_ms).toISOString(),
    imagePath: m.local_media_path || m.image_path || undefined,
    mediaSize: m.media_size || undefined,
    isDownloaded: m.is_downloaded === 1,
    isUploading: m.is_uploading === 1,
    uploadProgress: m.upload_progress,
    isStarred: m.is_starred === 1,
    attachmentCrypto:
      m.attachment_file_key && m.attachment_file_nonce
        ? { fileKey: m.attachment_file_key, fileNonce: m.attachment_file_nonce }
        : undefined,
    location: tryParse(m.location_json),
    document: tryParse(m.document_json),
    contact: tryParse(m.contact_json),
    callLog: tryParse(m.call_log_json),
    type:
      (m.type as any) ||
      (m.location_json
        ? 'LOCATION'
        : m.document_json
          ? 'DOCUMENT'
          : m.contact_json
            ? 'CONTACT'
            : m.image_path
              ? 'IMAGE'
              : 'TEXT'),
    audioPath: m.type === 'AUDIO' ? m.local_media_path || m.image_path || undefined : undefined,
    audioDurationSeconds:
      m.type === 'AUDIO' && m.media_size && !isNaN(Number(m.media_size))
        ? Number(m.media_size)
        : undefined,
  };
}

export function convRowToItem(c: ConvRow): ConversationItem {
  const lastMsgTime = c.last_message_at
    ? (() => {
        const d = new Date(c.last_message_at);
        return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
      })()
    : '';

  return {
    id: c.server_id,
    title: c.title || 'Chat',
    username: c.recipient_username || undefined,
    phone: c.recipient_phone || undefined,
    avatarUrl: c.avatar_url || undefined,
    recipientDbId: c.recipient_db_id || undefined,
    lastMessage: c.last_message_text || '',
    time: lastMsgTime,
    unread: String(c.unread_count),
    avatar: (c.title || 'C')[0].toUpperCase(),
    lastMessageIsMe: c.last_message_is_me === 1,
    lastMessageStatus: c.last_message_status as any,
    isMuted: c.is_muted === 1,
    isOnline: false, // presence is real-time only, never stored
  };
}

// ─── Write: messages ──────────────────────────────────────────────────────────

/**
 * Upsert a message — insert on first occurrence, update status/imagePath on repeat.
 * Keyed on client_message_id (always stable; server_id arrives later via ack).
 */
export async function upsertMessage(msg: {
  serverId?: string;
  clientMessageId: string;
  conversationServerId: string;
  senderId: string;
  senderName?: string;
  senderAvatar?: string;
  isMe: boolean;
  text?: string;
  type: string;
  status: string;
  imagePath?: string;
  localMediaPath?: string;
  mediaSize?: string;
  isDownloaded?: boolean;
  isUploading?: boolean;
  uploadProgress?: number;
  replyToId?: string;
  replyToText?: string;
  replyToIsMe?: boolean;
  isStarred?: boolean;
  attachmentFileKey?: string;
  attachmentFileNonce?: string;
  locationJson?: string;
  documentJson?: string;
  contactJson?: string;
  callLogJson?: string;
  createdAtMs: number;
}): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO messages (
      server_id, client_message_id, conversation_server_id, sender_id,
      sender_name, sender_avatar, is_me, text, type, status,
      image_path, local_media_path, media_size,
      is_downloaded, is_uploading, upload_progress,
      reply_to_id, reply_to_text, reply_to_is_me,
      is_starred, is_deleted,
      attachment_file_key, attachment_file_nonce,
      location_json, document_json, contact_json, call_log_json,
      created_at_ms
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0,
      ?, ?, ?, ?, ?, ?, ?
    )
    ON CONFLICT(client_message_id) DO UPDATE SET
      server_id             = COALESCE(excluded.server_id, server_id),
      status                = excluded.status,
      image_path            = COALESCE(excluded.image_path, image_path),
      local_media_path      = COALESCE(excluded.local_media_path, local_media_path),
      is_downloaded         = excluded.is_downloaded,
      is_uploading          = excluded.is_uploading,
      upload_progress       = excluded.upload_progress`,
    [
      msg.serverId ?? null,
      msg.clientMessageId,
      msg.conversationServerId,
      msg.senderId,
      msg.senderName ?? null,
      msg.senderAvatar ?? null,
      msg.isMe ? 1 : 0,
      msg.text ?? null,
      msg.type,
      msg.status,
      msg.imagePath ?? null,
      msg.localMediaPath ?? null,
      msg.mediaSize ?? null,
      msg.isDownloaded ? 1 : 0,
      msg.isUploading ? 1 : 0,
      msg.uploadProgress ?? 0,
      msg.replyToId ?? null,
      msg.replyToText ?? null,
      msg.replyToIsMe ? 1 : 0,
      msg.isStarred ? 1 : 0,
      msg.attachmentFileKey ?? null,
      msg.attachmentFileNonce ?? null,
      msg.locationJson ?? null,
      msg.documentJson ?? null,
      msg.contactJson ?? null,
      msg.callLogJson ?? null,
      msg.createdAtMs,
    ],
  );
}

/**
 * Update delivery status and optional fields (serverId on ack, imagePath after upload).
 * Keyed on client_message_id OR server_id — whichever matches first.
 */
export async function updateMessageStatus(
  clientMessageId: string,
  status: string,
  serverId?: string,
  imagePath?: string,
  isUploading?: boolean,
  uploadProgress?: number,
): Promise<void> {
  const db = await getDatabase();

  // Build dynamic SET clause only for provided fields
  const sets: string[] = ['status = ?'];
  const params: (string | number | null)[] = [status];

  if (serverId !== undefined) {
    sets.push('server_id = ?');
    params.push(serverId);
  }
  if (imagePath !== undefined) {
    sets.push('image_path = ?');
    params.push(imagePath);
  }
  if (isUploading !== undefined) {
    sets.push('is_uploading = ?');
    params.push(isUploading ? 1 : 0);
  }
  if (uploadProgress !== undefined) {
    sets.push('upload_progress = ?');
    params.push(uploadProgress);
  }

  // Match on clientMessageId OR serverId (ack path uses clientMessageId; receipt path uses serverId)
  params.push(clientMessageId, clientMessageId);

  await db.runAsync(
    `UPDATE messages SET ${sets.join(', ')}
     WHERE client_message_id = ? OR server_id = ?`,
    params,
  );
}

/**
 * Persist the local file:// path after a download completes.
 * Future renders will use localMediaPath instead of re-downloading.
 */
export async function setMessageLocalMediaPath(
  messageId: string,
  localPath: string,
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE messages
     SET local_media_path = ?, is_downloaded = 1, is_uploading = 0
     WHERE server_id = ? OR client_message_id = ?`,
    [localPath, messageId, messageId],
  );
}

// ─── Write: conversations ─────────────────────────────────────────────────────

/**
 * Upsert a conversation — insert on first occurrence, update last-message fields on conflict.
 */
export async function upsertConversation(data: {
  serverId: string;
  type?: string;
  title?: string;
  avatarUrl?: string;
  recipientDbId?: string;
  recipientUsername?: string;
  recipientPhone?: string;
  lastMessageText?: string;
  lastMessageAt?: number;
  lastMessageIsMe?: boolean;
  lastMessageStatus?: string;
  unreadCount?: number;
  isMuted?: boolean;
}): Promise<void> {
  const db = await getDatabase();
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO conversations (
      server_id, type, title, avatar_url,
      recipient_db_id, recipient_username, recipient_phone,
      last_message_text, last_message_at, last_message_is_me, last_message_status,
      unread_count, is_muted, created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(server_id) DO UPDATE SET
      title               = COALESCE(excluded.title, title),
      avatar_url          = COALESCE(excluded.avatar_url, avatar_url),
      last_message_text   = COALESCE(excluded.last_message_text, last_message_text),
      last_message_at     = COALESCE(excluded.last_message_at, last_message_at),
      last_message_is_me  = excluded.last_message_is_me,
      last_message_status = COALESCE(excluded.last_message_status, last_message_status),
      unread_count        = excluded.unread_count,
      updated_at_ms       = excluded.updated_at_ms`,
    [
      data.serverId,
      data.type ?? 'DIRECT',
      data.title ?? null,
      data.avatarUrl ?? null,
      data.recipientDbId ?? null,
      data.recipientUsername ?? null,
      data.recipientPhone ?? null,
      data.lastMessageText ?? null,
      data.lastMessageAt ?? null,
      data.lastMessageIsMe ? 1 : 0,
      data.lastMessageStatus ?? null,
      data.unreadCount ?? 0,
      data.isMuted ? 1 : 0,
      now,
      now,
    ],
  );
}

// ─── Read: one-shot ───────────────────────────────────────────────────────────

export async function getConversations(): Promise<ConversationItem[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<ConvRow>(
    `SELECT * FROM conversations ORDER BY last_message_at DESC`,
  );
  return rows.map(convRowToItem);
}

export async function getMessages(
  conversationServerId: string,
  limit = 200,
): Promise<ChatMessage[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<MsgRow>(
    `SELECT * FROM messages
     WHERE conversation_server_id = ? AND is_deleted = 0
     ORDER BY created_at_ms ASC
     LIMIT ?`,
    [conversationServerId, limit],
  );
  return rows.map(msgRowToChat);
}

export async function hasLocalMessages(conversationServerId: string): Promise<boolean> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM messages WHERE conversation_server_id = ?`,
    [conversationServerId],
  );
  return (row?.cnt ?? 0) > 0;
}

// ─── Read: raw rows (used by backup export) ───────────────────────────────────

export async function getAllConvRows(): Promise<ConvRow[]> {
  const db = await getDatabase();
  return db.getAllAsync<ConvRow>(`SELECT * FROM conversations ORDER BY last_message_at DESC`);
}

export async function getMsgRowsForConv(
  conversationServerId: string,
  limit = 10000,
): Promise<MsgRow[]> {
  const db = await getDatabase();
  return db.getAllAsync<MsgRow>(
    `SELECT * FROM messages WHERE conversation_server_id = ? AND is_deleted = 0 ORDER BY created_at_ms ASC LIMIT ?`,
    [conversationServerId, limit],
  );
}

// ─── Bulk ops ─────────────────────────────────────────────────────────────────

/**
 * Hard-reset — called on logout and before backup restore.
 * Drops and recreates all tables so next open gets a clean slate.
 */
export async function deleteAllData(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(`
    DROP TABLE IF EXISTS reactions;
    DROP TABLE IF EXISTS messages;
    DROP TABLE IF EXISTS conversations;
  `);
  // Recreate schema immediately
  const { CREATE_SCHEMA_SQL, DB_SCHEMA_VERSION } = await import('./schema');
  await db.execAsync(CREATE_SCHEMA_SQL);
  await db.execAsync(`PRAGMA user_version = ${DB_SCHEMA_VERSION}`);
}

export async function getLocalStats(): Promise<{
  messagesCount: number;
  conversationsCount: number;
}> {
  const db = await getDatabase();
  const [mRow, cRow] = await Promise.all([
    db.getFirstAsync<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM messages`),
    db.getFirstAsync<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM conversations`),
  ]);
  return {
    messagesCount: mRow?.cnt ?? 0,
    conversationsCount: cRow?.cnt ?? 0,
  };
}

// ─── Backup import (used by googleDriveBackupService restore) ─────────────────

export async function importConversationRows(
  convs: Array<{
    serverId: string;
    type?: string;
    title?: string;
    avatarUrl?: string;
    recipientDbId?: string;
    recipientUsername?: string;
    recipientPhone?: string;
    lastMessageText?: string;
    lastMessageAt?: number;
    lastMessageIsMe?: boolean;
    lastMessageStatus?: string;
    unreadCount?: number;
    isMuted?: boolean;
  }>,
): Promise<void> {
  for (const c of convs) {
    await upsertConversation(c);
  }
}

export async function importMessageRows(
  msgs: Array<{
    serverId?: string;
    clientMessageId: string;
    conversationServerId: string;
    senderId: string;
    senderName?: string;
    isMe: boolean;
    text?: string;
    type?: string;
    status?: string;
    imagePath?: string;
    mediaSize?: string;
    isStarred?: boolean;
    replyToId?: string;
    replyToText?: string;
    replyToIsMe?: boolean;
    locationJson?: string;
    documentJson?: string;
    contactJson?: string;
    callLogJson?: string;
    createdAtMs: number;
  }>,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const db = await getDatabase();
  const total = msgs.length;
  // Batch in transactions of 200 for performance
  const BATCH = 200;
  for (let i = 0; i < msgs.length; i += BATCH) {
    const batch = msgs.slice(i, i + BATCH);
    await db.withExclusiveTransactionAsync(async (txn) => {
      for (const m of batch) {
        await txn.runAsync(
          `INSERT OR IGNORE INTO messages (
            server_id, client_message_id, conversation_server_id, sender_id,
            sender_name, is_me, text, type, status,
            image_path, media_size, is_downloaded, is_uploading, upload_progress,
            reply_to_id, reply_to_text, reply_to_is_me,
            is_starred, is_deleted,
            location_json, document_json, contact_json, call_log_json,
            created_at_ms
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, 0, 0, 0,
            ?, ?, ?, ?, 0,
            ?, ?, ?, ?, ?
          )`,
          [
            m.serverId ?? null,
            m.clientMessageId,
            m.conversationServerId,
            m.senderId,
            m.senderName ?? null,
            m.isMe ? 1 : 0,
            m.text ?? null,
            m.type ?? 'TEXT',
            m.status ?? 'READ',
            m.imagePath ?? null,
            m.mediaSize ?? null,
            m.replyToId ?? null,
            m.replyToText ?? null,
            m.replyToIsMe ? 1 : 0,
            m.isStarred ? 1 : 0,
            m.locationJson ?? null,
            m.documentJson ?? null,
            m.contactJson ?? null,
            m.callLogJson ?? null,
            m.createdAtMs,
          ],
        );
      }
    });
    onProgress?.(Math.min(i + BATCH, total), total);
  }
}
