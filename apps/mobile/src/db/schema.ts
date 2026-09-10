/**
 * schema.ts — SQLite DDL for the local chat database.
 *
 * This schema is applied via expo-sqlite's `execAsync` on first open and on
 * schema version upgrades. All tables use `CREATE TABLE IF NOT EXISTS` so the
 * statement is always safe to re-run.
 *
 * Version history — bump DB_SCHEMA_VERSION and add ALTER TABLE statements to
 * MIGRATION_STEPS when you add columns or tables:
 *
 *   v1 (initial) — conversations, messages, reactions tables
 */

export const DB_SCHEMA_VERSION = 1;

/**
 * Full schema DDL — executed on fresh install (no existing DB).
 * Using parameterised schema version stored in user_version pragma.
 */
export const CREATE_SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS conversations (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id        TEXT    NOT NULL UNIQUE,
  type             TEXT    NOT NULL DEFAULT 'DIRECT',
  title            TEXT,
  avatar_url       TEXT,
  recipient_db_id  TEXT,
  recipient_username TEXT,
  recipient_phone  TEXT,
  last_message_text TEXT,
  last_message_at  INTEGER,
  last_message_is_me INTEGER NOT NULL DEFAULT 0,
  last_message_status TEXT,
  unread_count     INTEGER NOT NULL DEFAULT 0,
  is_muted         INTEGER NOT NULL DEFAULT 0,
  cleared_history_at INTEGER,
  created_at_ms    INTEGER NOT NULL DEFAULT 0,
  updated_at_ms    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_conv_server_id      ON conversations(server_id);
CREATE INDEX IF NOT EXISTS idx_conv_recipient_db_id ON conversations(recipient_db_id);
CREATE INDEX IF NOT EXISTS idx_conv_last_msg_at    ON conversations(last_message_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id             TEXT,
  client_message_id     TEXT    NOT NULL UNIQUE,
  conversation_server_id TEXT   NOT NULL,
  sender_id             TEXT    NOT NULL,
  sender_name           TEXT,
  sender_avatar         TEXT,
  is_me                 INTEGER NOT NULL DEFAULT 0,
  text                  TEXT,
  type                  TEXT    NOT NULL DEFAULT 'TEXT',
  status                TEXT    NOT NULL DEFAULT 'SENDING',
  image_path            TEXT,
  local_media_path      TEXT,
  media_size            TEXT,
  is_downloaded         INTEGER NOT NULL DEFAULT 0,
  is_uploading          INTEGER NOT NULL DEFAULT 0,
  upload_progress       INTEGER NOT NULL DEFAULT 0,
  reply_to_id           TEXT,
  reply_to_text         TEXT,
  reply_to_is_me        INTEGER NOT NULL DEFAULT 0,
  is_starred            INTEGER NOT NULL DEFAULT 0,
  is_deleted            INTEGER NOT NULL DEFAULT 0,
  attachment_file_key   TEXT,
  attachment_file_nonce TEXT,
  location_json         TEXT,
  document_json         TEXT,
  contact_json          TEXT,
  call_log_json         TEXT,
  created_at_ms         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_msg_server_id             ON messages(server_id);
CREATE INDEX IF NOT EXISTS idx_msg_client_id             ON messages(client_message_id);
CREATE INDEX IF NOT EXISTS idx_msg_conv_server_id        ON messages(conversation_server_id);
CREATE INDEX IF NOT EXISTS idx_msg_created_at            ON messages(created_at_ms ASC);

CREATE TABLE IF NOT EXISTS reactions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id  TEXT    NOT NULL,
  emoji       TEXT    NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0,
  my_reaction TEXT,
  UNIQUE(message_id, emoji)
);
CREATE INDEX IF NOT EXISTS idx_reaction_message_id ON reactions(message_id);
`;

/**
 * Per-version migration steps.
 * Key = target version number; value = SQL to run when upgrading FROM (version-1) TO version.
 * Add a new entry here (and bump DB_SCHEMA_VERSION) whenever you change the schema.
 *
 * Example for v2:
 *   2: `ALTER TABLE messages ADD COLUMN forwarded_from TEXT;`
 */
export const MIGRATION_STEPS: Record<number, string> = {
  // v1 is the full schema — no prior version to migrate from
};
