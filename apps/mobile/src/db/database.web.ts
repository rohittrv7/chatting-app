/**
 * database.web.ts — Web-compatible local storage fallback for expo-sqlite.
 *
 * Browsers do not support native C++ modules ('ExpoSQLite').
 * Metro automatically picks up this `.web.ts` file on web platforms (Chrome, Firefox, Safari)
 * while native Android and iOS continue to use `database.ts` with real `expo-sqlite`.
 */

export type TableChangeEvent = {
  databaseName: string;
  databaseFilePath: string;
  tableName: string;
  rowId: number;
};

type ChangeListener = (event: TableChangeEvent) => void;
const _listeners = new Set<ChangeListener>();

export function subscribeToDbChanges(listener: ChangeListener): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

function notifyChange(tableName: string, rowId: number = 1) {
  for (const listener of _listeners) {
    try {
      listener({
        databaseName: 'chat_local.db',
        databaseFilePath: 'web',
        tableName,
        rowId,
      });
    } catch (_) {}
  }
}

// In-memory tables for Web execution (optionally synced with localStorage)
const STORAGE_PREFIX = '__chat_sqlite_web_';

class WebDatabase {
  private messages: Map<string, any> = new Map();
  private conversations: Map<string, any> = new Map();

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const rawMsgs = window.localStorage.getItem(`${STORAGE_PREFIX}messages`);
        if (rawMsgs) {
          const list = JSON.parse(rawMsgs);
          for (const item of list) {
            if (item.client_message_id) this.messages.set(item.client_message_id, item);
          }
        }

        const rawConvs = window.localStorage.getItem(`${STORAGE_PREFIX}conversations`);
        if (rawConvs) {
          const list = JSON.parse(rawConvs);
          let modified = false;
          for (const item of list) {
            if (item.server_id) {
              // Self-healing: repair legacy rows corrupted by parameter offset
              if (typeof item.unread_count === 'string' && isNaN(Number(item.unread_count))) {
                item.last_message_text = item.unread_count;
                item.unread_count = 0;
                modified = true;
              }
              if (
                typeof item.last_message_text === 'number' &&
                item.last_message_text > 1000000000000
              ) {
                item.last_message_at = item.last_message_text;
                item.last_message_text = '';
                modified = true;
              }
              if (item.title === 'DIRECT') {
                item.title = null;
                modified = true;
              }
              if (typeof item.recipient_phone === 'number') {
                item.recipient_phone = null;
                modified = true;
              }
              this.conversations.set(item.server_id, item);
            }
          }

          // Deduplicate and consolidate duplicate conversations for the same person
          const groupMap = new Map<string, any[]>();
          for (const conv of Array.from(this.conversations.values())) {
            if (conv.is_split_group) continue;
            const u = (conv.recipient_username || '').toLowerCase().replace(/^@+/, '');
            const p = (conv.recipient_phone ? String(conv.recipient_phone) : '')
              .replace(/\D/g, '')
              .slice(-10);
            const dbId = conv.recipient_db_id || '';
            const t = (conv.title || '').trim().toLowerCase();
            const key =
              dbId || u || p || (t && t !== 'chat' && t !== 'direct' ? t : conv.server_id);
            if (!groupMap.has(key)) groupMap.set(key, []);
            groupMap.get(key)!.push(conv);
          }

          const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          for (const [_, group] of groupMap.entries()) {
            if (group.length > 1) {
              // Prefer server UUID, then most recent last_message_at
              group.sort((a, b) => {
                const aIsUuid = UUID_REGEX.test(a.server_id) ? 1 : 0;
                const bIsUuid = UUID_REGEX.test(b.server_id) ? 1 : 0;
                if (aIsUuid !== bIsUuid) return bIsUuid - aIsUuid;
                return (Number(b.last_message_at) || 0) - (Number(a.last_message_at) || 0);
              });
              const canonical = group[0];
              for (let i = 1; i < group.length; i++) {
                const stale = group[i];
                // Migrate messages from stale conversation to canonical
                for (const msg of Array.from(this.messages.values())) {
                  if (msg.conversation_server_id === stale.server_id) {
                    msg.conversation_server_id = canonical.server_id;
                  }
                }
                // Adopt newer message preview or timestamps
                if (
                  (Number(stale.last_message_at) || 0) > (Number(canonical.last_message_at) || 0)
                ) {
                  canonical.last_message_at = stale.last_message_at;
                  canonical.last_message_text = stale.last_message_text;
                  canonical.last_message_is_me = stale.last_message_is_me;
                  canonical.last_message_status = stale.last_message_status;
                }
                if (!canonical.recipient_username && stale.recipient_username) {
                  canonical.recipient_username = stale.recipient_username;
                }
                if (!canonical.recipient_db_id && stale.recipient_db_id) {
                  canonical.recipient_db_id = stale.recipient_db_id;
                }
                this.conversations.delete(stale.server_id);
                modified = true;
              }
            }
          }

          if (modified) {
            this.persist();
          }
        }
      }
    } catch (_) {}
  }

  private persist() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(
          `${STORAGE_PREFIX}conversations`,
          JSON.stringify(Array.from(this.conversations.values())),
        );
        window.localStorage.setItem(
          `${STORAGE_PREFIX}messages`,
          JSON.stringify(Array.from(this.messages.values())),
        );
      }
    } catch (_) {}
  }

  async execAsync(sql: string): Promise<void> {
    const s = sql.trim().toUpperCase();
    if (s.includes('DELETE FROM MESSAGES') || s.includes('DELETE FROM CONVERSATIONS')) {
      this.messages.clear();
      this.conversations.clear();
      this.persist();
      notifyChange('messages');
      notifyChange('conversations');
    }
  }

  async getFirstAsync<T>(sql: string, params: any[] = []): Promise<T | null> {
    const s = sql.toUpperCase();
    if (s.includes('PRAGMA USER_VERSION')) {
      return { user_version: 2 } as unknown as T;
    }
    if (s.includes('FROM CONVERSATIONS')) {
      const serverId = params[0];
      const c = this.conversations.get(serverId);
      if (c && c.is_deleted !== 1) return c as unknown as T;
      return null;
    }
    if (s.includes('FROM MESSAGES')) {
      const convId = params[0];
      for (const m of this.messages.values()) {
        if (m.conversation_server_id === convId && m.is_deleted !== 1) {
          return m as unknown as T;
        }
      }
      return null;
    }
    return null;
  }

  async getAllAsync<T>(sql: string, params: any[] = []): Promise<T[]> {
    const s = sql.toUpperCase();

    if (s.includes('FROM CONVERSATIONS')) {
      const list = Array.from(this.conversations.values())
        .filter((c) => c.is_deleted !== 1)
        .sort((a, b) => (b.last_message_at || 0) - (a.last_message_at || 0));
      return list as unknown as T[];
    }

    if (s.includes('FROM MESSAGES')) {
      const convId = params[0];
      const list = Array.from(this.messages.values())
        .filter((m) => m.conversation_server_id === convId && m.is_deleted !== 1)
        .sort((a, b) => (a.created_at_ms || 0) - (b.created_at_ms || 0));
      return list as unknown as T[];
    }

    return [];
  }

  async runAsync(
    sql: string,
    params: any[] = [],
  ): Promise<{ lastInsertRowId: number; changes: number }> {
    const s = sql.toUpperCase();

    if (s.includes('INSERT INTO CONVERSATIONS')) {
      const serverId = params[0];
      const conv = {
        server_id: serverId,
        type: params[1] ?? 'DIRECT',
        title: params[2] && params[2] !== 'DIRECT' ? params[2] : null,
        avatar_url: params[3] ?? null,
        recipient_db_id: params[4] ?? null,
        recipient_username: params[5] ?? null,
        recipient_phone: params[6] ? String(params[6]) : null,
        last_message_text: params[7] ? String(params[7]) : null,
        last_message_at:
          typeof params[8] === 'number' ? params[8] : params[8] ? Number(params[8]) : null,
        last_message_is_me: params[9] ? 1 : 0,
        last_message_status: params[10] ?? null,
        unread_count:
          typeof params[11] === 'number'
            ? params[11]
            : params[11]
              ? isNaN(Number(params[11]))
                ? 0
                : Number(params[11])
              : 0,
        is_muted: params[12] ? 1 : 0,
        created_at_ms: typeof params[13] === 'number' ? params[13] : Date.now(),
        updated_at_ms: typeof params[14] === 'number' ? params[14] : Date.now(),
        is_split_group: params[15] ? 1 : 0,
        split_expense_id: params[16] ?? null,
        auto_delete_at: params[17] ?? null,
        is_deleted: 0,
      };
      this.conversations.set(serverId, conv);
      this.persist();
      notifyChange('conversations');
      return { lastInsertRowId: 1, changes: 1 };
    }

    if (s.includes('INSERT INTO MESSAGES')) {
      const clientMsgId = params[1];
      const msg = {
        server_id: params[0],
        client_message_id: clientMsgId,
        conversation_server_id: params[2],
        sender_id: params[3],
        sender_name: params[4],
        sender_avatar: params[5],
        is_me: params[6],
        text: params[7],
        type: params[8],
        status: params[9],
        image_path: params[10],
        local_media_path: params[11],
        media_size: params[12],
        is_downloaded: params[13],
        is_uploading: params[14],
        upload_progress: params[15],
        reply_to_id: params[16],
        reply_to_text: params[17],
        reply_to_is_me: params[18],
        is_starred: params[19],
        is_deleted: 0,
        attachment_file_key: params[20],
        attachment_file_nonce: params[21],
        location_json: params[22],
        document_json: params[23],
        contact_json: params[24],
        call_log_json: params[25],
        created_at_ms: params[26],
      };
      this.messages.set(clientMsgId, msg);
      this.persist();
      notifyChange('messages');
      return { lastInsertRowId: 1, changes: 1 };
    }

    if (s.includes('UPDATE MESSAGES')) {
      if (s.includes('CONVERSATION_SERVER_ID = ?')) {
        const newConvId = params[0];
        const oldConvId = params[1];
        let count = 0;
        for (const m of this.messages.values()) {
          if (m.conversation_server_id === oldConvId) {
            m.conversation_server_id = newConvId;
            count++;
          }
        }
        if (count > 0) {
          this.persist();
          notifyChange('messages');
        }
        return { lastInsertRowId: 1, changes: count };
      }

      if (s.includes('LOCAL_MEDIA_PATH = ?')) {
        const localPath = params[0];
        const targetId = params[1] || params[2];
        for (const m of this.messages.values()) {
          if (m.client_message_id === targetId || m.server_id === targetId) {
            m.local_media_path = localPath;
            m.is_downloaded = 1;
            m.is_uploading = 0;
          }
        }
        this.persist();
        notifyChange('messages');
        return { lastInsertRowId: 1, changes: 1 };
      }

      // Update message status, serverId, etc.
      const targetId = params[params.length - 1] || params[params.length - 2];
      let updated = false;
      let statusVal: string | undefined;
      let serverIdVal: string | undefined;

      if (s.includes('STATUS = ?')) {
        statusVal = params[0];
      }
      if (s.includes('SERVER_ID = ?')) {
        serverIdVal = s.includes('STATUS = ?') ? params[1] : params[0];
      }

      for (const m of this.messages.values()) {
        if (m.client_message_id === targetId || m.server_id === targetId) {
          if (statusVal !== undefined) m.status = statusVal;
          if (serverIdVal !== undefined && serverIdVal !== null) m.server_id = serverIdVal;
          updated = true;
        }
      }

      if (updated) {
        this.persist();
        notifyChange('messages');
      }
      return { lastInsertRowId: 1, changes: updated ? 1 : 0 };
    }

    if (s.includes('DELETE FROM CONVERSATIONS WHERE SERVER_ID')) {
      const convId = params[0];
      this.conversations.delete(convId);
      for (const [id, msg] of this.messages.entries()) {
        if (msg.conversation_server_id === convId) {
          this.messages.delete(id);
        }
      }
      this.persist();
      notifyChange('conversations');
      notifyChange('messages');
      return { lastInsertRowId: 1, changes: 1 };
    }

    if (s.includes('DELETE FROM MESSAGES WHERE CONVERSATION_SERVER_ID')) {
      const convId = params[0];
      for (const [id, msg] of this.messages.entries()) {
        if (msg.conversation_server_id === convId) {
          this.messages.delete(id);
        }
      }
      this.persist();
      notifyChange('messages');
      return { lastInsertRowId: 1, changes: 1 };
    }

    return { lastInsertRowId: 1, changes: 0 };
  }

  async withExclusiveTransactionAsync(fn: (txn: WebDatabase) => Promise<any>): Promise<any> {
    return fn(this);
  }
}

const _webDbInstance = new WebDatabase();

export async function getDatabase(): Promise<any> {
  return _webDbInstance;
}

export function getDatabaseSync(): any {
  return _webDbInstance;
}
