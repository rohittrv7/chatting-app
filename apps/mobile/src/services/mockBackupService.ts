/**
 * mockBackupService.ts — Pluggable Google Drive Backup & Restore Mock Service
 *
 * ⚠️ BACKEND INTEGRATION NOTE:
 * When the real Google Drive backend integration is ready, replace the mock implementations
 * in this file with real Google Drive REST API / backend endpoints:
 *   - connectGoogleAccount: Trigger Google Sign-In SDK or OAuth2 flow
 *   - startBackup: Export chats/media from SQLite/AsyncStorage and upload encrypted zip to Google Drive AppData folder
 *   - restoreBackup: Download latest backup archive from Google Drive, unpack and import to local SQLite
 *   - deleteBackup: Delete backup files from Google Drive AppData folder
 *   - checkBackupExists: Query Google Drive files API with 'appDataFolder' space
 */

import { safeStorage } from './storageHelper';

export interface GoogleAccount {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
}

export interface BackupMetadata {
  id: string;
  timestamp: string; // ISO string
  formattedDate: string;
  sizeBytes: number;
  sizeFormatted: string;
  chatsCount: number;
  messagesCount: number;
  mediaFilesCount: number;
  includesImages: boolean;
  includesVideos: boolean;
  accountEmail: string;
}

export type BackupFrequency = 'daily' | 'weekly' | 'monthly' | 'manual';
export type BackupNetworkType = 'wifi' | 'cellular';

export interface BackupSettings {
  account: GoogleAccount | null;
  frequency: BackupFrequency;
  networkType: BackupNetworkType;
  includeImages: boolean;
  includeVideos: boolean;
}

export interface BackupProgress {
  percentage: number; // 0 - 100
  stage:
    'preparing' | 'exporting_messages' | 'compressing_media' | 'uploading' | 'completed' | 'failed';
  stageLabel: string;
  uploadedBytes?: number;
  totalBytes?: number;
}

export interface RestoreProgress {
  percentage: number; // 0 - 100
  stage:
    | 'connecting'
    | 'downloading'
    | 'restoring_messages'
    | 'restoring_media'
    | 'completed'
    | 'failed';
  stageLabel: string;
  restoredMessagesCount?: number;
  totalMessagesCount?: number;
  restoredMediaFiles?: number;
  totalMediaFiles?: number;
}

// ── Storage Keys ──────────────────────────────────────────────────────────────
const STORAGE_KEY_SETTINGS = '@chat_backup_settings_v1';
const STORAGE_KEY_METADATA = '@chat_backup_metadata_v1';
const STORAGE_KEY_TEST_FAILURE = '@chat_backup_test_failure_mode';
const STORAGE_KEY_TEST_HAS_BACKUP = '@chat_backup_test_has_backup';

// ── Available Mock Google Accounts ────────────────────────────────────────────
export const MOCK_GOOGLE_ACCOUNTS: GoogleAccount[] = [
  {
    id: 'acc_1',
    name: 'Rohit Sharma',
    email: 'rohit.sharma@gmail.com',
    avatarUrl:
      'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=120&auto=format&fit=crop&q=80',
  },
  {
    id: 'acc_2',
    name: 'Rohit Work',
    email: 'rohit.work.dev@gmail.com',
    avatarUrl:
      'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=120&auto=format&fit=crop&q=80',
  },
  {
    id: 'acc_3',
    name: 'Personal Cloud',
    email: 'kumar.cloud99@gmail.com',
    avatarUrl:
      'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=120&auto=format&fit=crop&q=80',
  },
];

const DEFAULT_SETTINGS: BackupSettings = {
  account: MOCK_GOOGLE_ACCOUNTS[0],
  frequency: 'daily',
  networkType: 'wifi',
  includeImages: true,
  includeVideos: false,
};

const DEFAULT_INITIAL_METADATA: BackupMetadata = {
  id: 'backup_initial_01',
  timestamp: new Date(Date.now() - 3600 * 1000 * 4).toISOString(), // 4 hours ago
  formattedDate: 'Today at 8:15 AM',
  sizeBytes: 358612992, // ~342 MB
  sizeFormatted: '342 MB',
  chatsCount: 24,
  messagesCount: 1420,
  mediaFilesCount: 1204,
  includesImages: true,
  includesVideos: false,
  accountEmail: MOCK_GOOGLE_ACCOUNTS[0].email,
};

class MockBackupService {
  private activeBackupCancellation: boolean = false;
  private activeRestoreCancellation: boolean = false;

  // ── Settings Management ───────────────────────────────────────────────────
  async getSettings(): Promise<BackupSettings> {
    try {
      const raw = await safeStorage.getItem(STORAGE_KEY_SETTINGS);
      if (raw) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      }
    } catch {}
    return DEFAULT_SETTINGS;
  }

  async saveSettings(settings: Partial<BackupSettings>): Promise<BackupSettings> {
    const current = await this.getSettings();
    const updated: BackupSettings = { ...current, ...settings };
    await safeStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(updated));
    return updated;
  }

  // ── Google Account Management ─────────────────────────────────────────────
  /**
   * Connect a Google Account.
   * In future: Trigger Google Sign-In with Drive AppData scope.
   */
  async connectGoogleAccount(accountOrEmail: GoogleAccount | string): Promise<GoogleAccount> {
    // Simulate short network handshaking
    await new Promise((r) => setTimeout(r, 450));

    let account: GoogleAccount;
    if (typeof accountOrEmail === 'string') {
      const matched = MOCK_GOOGLE_ACCOUNTS.find(
        (a) => a.email.toLowerCase() === accountOrEmail.toLowerCase(),
      );
      account = matched || {
        id: `custom_${Date.now()}`,
        name: accountOrEmail.split('@')[0],
        email: accountOrEmail,
      };
    } else {
      account = accountOrEmail;
    }

    await this.saveSettings({ account });
    return account;
  }

  /**
   * Disconnect the Google Account.
   */
  async disconnectGoogleAccount(): Promise<void> {
    await new Promise((r) => setTimeout(r, 200));
    await this.saveSettings({ account: null });
  }

  // ── Backup Metadata ───────────────────────────────────────────────────────
  /**
   * Get metadata about the last recorded backup.
   * Returns null if no backup exists.
   */
  async getBackupMetadata(): Promise<BackupMetadata | null> {
    try {
      const raw = await safeStorage.getItem(STORAGE_KEY_METADATA);
      if (raw) {
        return JSON.parse(raw);
      }
      // Provide default initial mock backup so user immediately sees WhatsApp-like stats
      await safeStorage.setItem(STORAGE_KEY_METADATA, JSON.stringify(DEFAULT_INITIAL_METADATA));
      return DEFAULT_INITIAL_METADATA;
    } catch {
      return DEFAULT_INITIAL_METADATA;
    }
  }

  /**
   * Check if a backup exists for the given user phone number.
   * Used during post-OTP login to decide whether to show Screen 2 or skip to Screen 3.
   */
  async checkBackupExists(
    phoneNumber: string,
  ): Promise<{ exists: boolean; metadata?: BackupMetadata }> {
    // Check if developer has forced "no backup" mode for testing Screen 3
    const forceNoBackup = await safeStorage.getItem(STORAGE_KEY_TEST_HAS_BACKUP);
    if (forceNoBackup === 'false') {
      return { exists: false };
    }

    const metadata = await this.getBackupMetadata();
    if (!metadata) {
      return { exists: false };
    }
    return { exists: true, metadata };
  }

  // ── Start Backup Simulation ───────────────────────────────────────────────
  /**
   * Simulates full WhatsApp backup to Google Drive with realistic progress phases:
   * 1. Preparing messages (0-20%)
   * 2. Uploading message database (20-45%)
   * 3. Compressing & uploading media (45-85%)
   * 4. Finalizing & committing backup (85-100%)
   */
  async startBackup(onProgress?: (progress: BackupProgress) => void): Promise<BackupMetadata> {
    this.activeBackupCancellation = false;

    // Check if test failure mode is enabled
    const testFailure = await safeStorage.getItem(STORAGE_KEY_TEST_FAILURE);
    const shouldFail = testFailure === 'true';

    const settings = await this.getSettings();
    const baseBytes = 24 * 1024 * 1024; // 24 MB messages
    const imageBytes = settings.includeImages ? 180 * 1024 * 1024 : 0; // 180 MB photos
    const videoBytes = settings.includeVideos ? 210 * 1024 * 1024 : 0; // 210 MB videos
    const totalBytes = baseBytes + imageBytes + videoBytes;
    const sizeFormatted = `${Math.round(totalBytes / (1024 * 1024))} MB`;

    // Stage 1: Preparing
    onProgress?.({
      percentage: 5,
      stage: 'preparing',
      stageLabel: 'Preparing messages and media...',
      uploadedBytes: 0,
      totalBytes,
    });
    await new Promise((r) => setTimeout(r, 600));
    if (this.activeBackupCancellation) throw new Error('Backup cancelled');

    onProgress?.({
      percentage: 18,
      stage: 'preparing',
      stageLabel: 'Calculating backup size...',
      uploadedBytes: Math.floor(totalBytes * 0.18),
      totalBytes,
    });
    await new Promise((r) => setTimeout(r, 700));
    if (this.activeBackupCancellation) throw new Error('Backup cancelled');

    // Stage 2: Uploading messages
    onProgress?.({
      percentage: 32,
      stage: 'exporting_messages',
      stageLabel: 'Uploading messages (1,420 messages)...',
      uploadedBytes: Math.floor(totalBytes * 0.32),
      totalBytes,
    });
    await new Promise((r) => setTimeout(r, 800));
    if (this.activeBackupCancellation) throw new Error('Backup cancelled');

    // Simulate failure if requested
    if (shouldFail) {
      onProgress?.({
        percentage: 42,
        stage: 'failed',
        stageLabel: 'Upload failed. Check your network connection.',
        uploadedBytes: Math.floor(totalBytes * 0.42),
        totalBytes,
      });
      throw new Error('Upload to Google Drive failed (Mock error for testing retry)');
    }

    onProgress?.({
      percentage: 48,
      stage: 'exporting_messages',
      stageLabel: 'Messages uploaded to Google Drive',
      uploadedBytes: Math.floor(totalBytes * 0.48),
      totalBytes,
    });
    await new Promise((r) => setTimeout(r, 600));
    if (this.activeBackupCancellation) throw new Error('Backup cancelled');

    // Stage 3: Compressing & Uploading media
    const mediaSteps = [
      { pct: 60, label: 'Uploading media files (312 of 1,204)...' },
      { pct: 75, label: 'Uploading media files (840 of 1,204)...' },
      { pct: 88, label: 'Uploading media files (1,204 of 1,204)...' },
    ];

    for (const step of mediaSteps) {
      onProgress?.({
        percentage: step.pct,
        stage: 'compressing_media',
        stageLabel: step.label,
        uploadedBytes: Math.floor(totalBytes * (step.pct / 100)),
        totalBytes,
      });
      await new Promise((r) => setTimeout(r, 850));
      if (this.activeBackupCancellation) throw new Error('Backup cancelled');
    }

    // Stage 4: Finalizing
    onProgress?.({
      percentage: 96,
      stage: 'uploading',
      stageLabel: 'Finalizing Google Drive backup...',
      uploadedBytes: Math.floor(totalBytes * 0.96),
      totalBytes,
    });
    await new Promise((r) => setTimeout(r, 600));

    // Completed
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    const formattedDate = `Today at ${displayHours}:${minutes} ${ampm}`;

    const newMetadata: BackupMetadata = {
      id: `backup_${Date.now()}`,
      timestamp: now.toISOString(),
      formattedDate,
      sizeBytes: totalBytes,
      sizeFormatted,
      chatsCount: 24,
      messagesCount: 1420,
      mediaFilesCount: (settings.includeImages ? 1050 : 0) + (settings.includeVideos ? 154 : 0),
      includesImages: settings.includeImages,
      includesVideos: settings.includeVideos,
      accountEmail: settings.account?.email || 'rohit.sharma@gmail.com',
    };

    await safeStorage.setItem(STORAGE_KEY_METADATA, JSON.stringify(newMetadata));

    onProgress?.({
      percentage: 100,
      stage: 'completed',
      stageLabel: 'Backup complete',
      uploadedBytes: totalBytes,
      totalBytes,
    });

    return newMetadata;
  }

  cancelBackup(): void {
    this.activeBackupCancellation = true;
  }

  // ── Restore Simulation ────────────────────────────────────────────────────
  /**
   * Simulates full WhatsApp restore from Google Drive:
   * 1. Connecting to Google Drive (0-15%)
   * 2. Downloading backup archive (15-45%)
   * 3. Restoring chat messages (45-75%)
   * 4. Restoring media files (75-100%)
   */
  async restoreBackup(
    onProgress?: (progress: RestoreProgress) => void,
  ): Promise<{ success: boolean; chatsRestored: number; messagesRestored: number }> {
    this.activeRestoreCancellation = false;

    // Stage 1: Connecting
    onProgress?.({
      percentage: 8,
      stage: 'connecting',
      stageLabel: 'Connecting to Google Drive...',
    });
    await new Promise((r) => setTimeout(r, 700));
    if (this.activeRestoreCancellation) throw new Error('Restore cancelled');

    onProgress?.({
      percentage: 22,
      stage: 'downloading',
      stageLabel: 'Downloading backup archive (342 MB)...',
    });
    await new Promise((r) => setTimeout(r, 900));
    if (this.activeRestoreCancellation) throw new Error('Restore cancelled');

    // Stage 2: Restoring messages
    onProgress?.({
      percentage: 42,
      stage: 'restoring_messages',
      stageLabel: 'Restoring messages (620 / 1,420)...',
      restoredMessagesCount: 620,
      totalMessagesCount: 1420,
    });
    await new Promise((r) => setTimeout(r, 800));
    if (this.activeRestoreCancellation) throw new Error('Restore cancelled');

    onProgress?.({
      percentage: 65,
      stage: 'restoring_messages',
      stageLabel: 'Restoring messages (1,420 / 1,420)...',
      restoredMessagesCount: 1420,
      totalMessagesCount: 1420,
    });
    await new Promise((r) => setTimeout(r, 800));
    if (this.activeRestoreCancellation) throw new Error('Restore cancelled');

    // Stage 3: Restoring media
    onProgress?.({
      percentage: 82,
      stage: 'restoring_media',
      stageLabel: 'Restoring media files (450 of 1,204)...',
      restoredMediaFiles: 450,
      totalMediaFiles: 1204,
    });
    await new Promise((r) => setTimeout(r, 900));
    if (this.activeRestoreCancellation) throw new Error('Restore cancelled');

    onProgress?.({
      percentage: 95,
      stage: 'restoring_media',
      stageLabel: 'Finishing up...',
      restoredMediaFiles: 1204,
      totalMediaFiles: 1204,
    });
    await new Promise((r) => setTimeout(r, 600));

    onProgress?.({
      percentage: 100,
      stage: 'completed',
      stageLabel: '1,420 messages restored',
    });

    return { success: true, chatsRestored: 24, messagesRestored: 1420 };
  }

  cancelRestore(): void {
    this.activeRestoreCancellation = true;
  }

  // ── Delete Backup ─────────────────────────────────────────────────────────
  async deleteBackup(): Promise<void> {
    await new Promise((r) => setTimeout(r, 500));
    await safeStorage.removeItem(STORAGE_KEY_METADATA);
  }

  // ── Testing Toggles ───────────────────────────────────────────────────────
  async getMockFailureMode(): Promise<boolean> {
    const val = await safeStorage.getItem(STORAGE_KEY_TEST_FAILURE);
    return val === 'true';
  }

  async setMockFailureMode(fail: boolean): Promise<void> {
    await safeStorage.setItem(STORAGE_KEY_TEST_FAILURE, fail ? 'true' : 'false');
  }

  async getMockBackupAvailable(): Promise<boolean> {
    const val = await safeStorage.getItem(STORAGE_KEY_TEST_HAS_BACKUP);
    return val !== 'false';
  }

  async setMockBackupAvailable(available: boolean): Promise<void> {
    await safeStorage.setItem(STORAGE_KEY_TEST_HAS_BACKUP, available ? 'true' : 'false');
  }
}

export const mockBackupService = new MockBackupService();
