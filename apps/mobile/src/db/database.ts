/**
 * database.ts — expo-sqlite v15 singleton for local-first chat storage.
 *
 * Replaces WatermelonDB + LokiJS with a real SQLite database that:
 *   - Persists to device storage (not memory) via expo-sqlite
 *   - Works in Expo managed workflow without any native build changes
 *   - Supports reactive queries via addDatabaseChangeListener
 *   - Scales to tens of thousands of messages (indexed queries, not full in-memory load)
 *
 * Why expo-sqlite instead of WatermelonDB+SQLite:
 *   WatermelonDB 0.27.1 requires its own native module (NativeModules.WMDatabaseBridge)
 *   which is NOT expo-sqlite — it's a separate C++ bridge that only compiles in bare
 *   workflow or EAS development builds. expo-sqlite is fully managed by Expo and works
 *   in all Expo environments including Expo Go and standard EAS builds.
 *
 * Reactive updates:
 *   addDatabaseChangeListener fires with {tableName, rowId} on every INSERT/UPDATE/DELETE.
 *   useLocalConversations() and useLocalMessages() hooks in useLocalDb.ts subscribe to
 *   this listener and re-query affected tables, giving WhatsApp-style live UI updates.
 */

import { openDatabaseAsync, addDatabaseChangeListener, type SQLiteDatabase } from 'expo-sqlite';
import { CREATE_SCHEMA_SQL, DB_SCHEMA_VERSION, MIGRATION_STEPS } from './schema';

// ─── Singleton ────────────────────────────────────────────────────────────────

let _db: SQLiteDatabase | null = null;
let _initPromise: Promise<SQLiteDatabase> | null = null;

/**
 * Open (or return the cached) database instance.
 * Safe to call from multiple places — only one openDatabaseAsync() call is made.
 */
export async function getDatabase(): Promise<SQLiteDatabase> {
  if (_db) return _db;
  if (_initPromise) return _initPromise;

  _initPromise = _openAndMigrate();
  _db = await _initPromise;
  return _db;
}

/**
 * Synchronously return the database IF already initialised.
 * Only call this after getDatabase() has resolved at least once.
 * Throws if called before init — use getDatabase() for the first access.
 */
export function getDatabaseSync(): SQLiteDatabase {
  if (!_db) throw new Error('[LocalDB] Database not initialised yet. Call getDatabase() first.');
  return _db;
}

// ─── Init & Migration ─────────────────────────────────────────────────────────

async function _openAndMigrate(): Promise<SQLiteDatabase> {
  // enableChangeListener: true → allows addDatabaseChangeListener to fire
  const db = await openDatabaseAsync('chat_local.db', { enableChangeListener: true });

  // Read current schema version from SQLite user_version pragma
  const versionRow = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const currentVersion = versionRow?.user_version ?? 0;

  if (currentVersion === 0) {
    // Fresh install — apply full schema
    await db.execAsync(CREATE_SCHEMA_SQL);
    await db.execAsync(`PRAGMA user_version = ${DB_SCHEMA_VERSION}`);
    console.log('[LocalDB] Fresh schema applied (v' + DB_SCHEMA_VERSION + ')');
  } else if (currentVersion < DB_SCHEMA_VERSION) {
    // Incremental migration from currentVersion to DB_SCHEMA_VERSION
    await db.withExclusiveTransactionAsync(async (txn) => {
      for (let v = currentVersion + 1; v <= DB_SCHEMA_VERSION; v++) {
        const sql = MIGRATION_STEPS[v];
        if (sql) {
          await txn.execAsync(sql);
          console.log(`[LocalDB] Applied migration to v${v}`);
        }
      }
      await txn.execAsync(`PRAGMA user_version = ${DB_SCHEMA_VERSION}`);
    });
    console.log('[LocalDB] Migrated to v' + DB_SCHEMA_VERSION);
  } else {
    console.log('[LocalDB] Schema up to date (v' + currentVersion + ')');
  }

  return db;
}

// ─── Change listener (for reactive hooks) ────────────────────────────────────

export type TableChangeEvent = {
  databaseName: string;
  databaseFilePath: string;
  tableName: string;
  rowId: number;
};

type ChangeListener = (event: TableChangeEvent) => void;

/**
 * Subscribe to all database changes. The listener fires synchronously on the
 * JS thread after every INSERT/UPDATE/DELETE on any table.
 *
 * Returns an unsubscribe function — call it in useEffect cleanup.
 *
 * Note: addDatabaseChangeListener is a module-level subscription (not per-db),
 * so we proxy it here to keep all database coupling inside this module.
 */
export function subscribeToDbChanges(listener: ChangeListener): () => void {
  const subscription = addDatabaseChangeListener(listener);
  return () => subscription.remove();
}
