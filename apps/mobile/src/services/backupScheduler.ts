/**
 * backupScheduler.ts — Background Backup Scheduler
 *
 * Implements WhatsApp-style automatic backup scheduling using:
 *   - expo-background-fetch: fires the task periodically while the app is in background
 *   - expo-task-manager: registers the background task handler
 *   - @react-native-community/netinfo: check WiFi vs cellular before uploading
 *
 * Behavior mirrors WhatsApp exactly:
 *   - Daily/weekly/monthly frequency from BackupSettings
 *   - WiFi-only or WiFi+cellular from BackupSettings.networkType
 *   - Skips backup if last backup is recent enough
 *   - All conditions checked inside the background task (network, frequency, last backup time)
 *
 * Setup: call `initBackupScheduler()` once at app startup (in App.tsx / root component).
 * The background task is registered once and persists across app restarts.
 *
 * iOS note: expo-background-fetch is subject to iOS background execution limits.
 * The minimum fetch interval is 15 minutes; iOS may delay execution further.
 * This is normal and matches how WhatsApp behaves on iOS.
 *
 * Android note: WorkManager is used under the hood on Android, providing more
 * reliable scheduling than iOS BGAppRefreshTask.
 */

import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import NetInfo from '@react-native-community/netinfo';
import { AppState, Platform } from 'react-native';
import { safeStorage } from './storageHelper';
import { googleDriveBackupService } from './googleDriveBackupService';
import type { BackupFrequency, BackupNetworkType } from './googleDriveBackupService';

// ─── Task name (must be unique across the app) ────────────────────────────────

export const BACKGROUND_BACKUP_TASK = 'CHAT_BACKGROUND_BACKUP';

// ─── Storage keys ─────────────────────────────────────────────────────────────

const KEY_LAST_BACKUP_TIME = '@chat_last_backup_time_ms';
const KEY_LAST_BACKUP_ATTEMPT = '@chat_last_backup_attempt_ms';

// ─── Frequency → minimum interval (ms) ───────────────────────────────────────

const FREQUENCY_INTERVALS_MS: Record<BackupFrequency, number> = {
  daily: 24 * 60 * 60 * 1000, // 24 hours
  weekly: 7 * 24 * 60 * 60 * 1000, // 7 days
  monthly: 30 * 24 * 60 * 60 * 1000, // 30 days
  manual: Infinity, // never auto-backup
};

// Minimum interval passed to BackgroundFetch — 15 min is the minimum iOS allows
const BG_FETCH_MIN_INTERVAL_SECONDS = 15 * 60; // 15 minutes

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Check if the current network connection satisfies the user's backup network preference.
 *   - 'wifi' → only backup on WiFi (not cellular)
 *   - 'cellular' → backup on any connection
 */
async function isNetworkSuitable(networkType: BackupNetworkType): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    if (!state.isConnected) return false;
    if (networkType === 'cellular') return true; // Any connection is fine
    // WiFi-only: type must be 'wifi'
    return state.type === 'wifi';
  } catch {
    return false; // If we can't check, assume unsuitable (safer)
  }
}

/**
 * Check if enough time has passed since the last successful backup
 * for the configured frequency.
 */
async function isBackupDue(frequency: BackupFrequency): Promise<boolean> {
  if (frequency === 'manual') return false;

  const minInterval = FREQUENCY_INTERVALS_MS[frequency];
  const lastBackupStr = await safeStorage.getItem(KEY_LAST_BACKUP_TIME);
  if (!lastBackupStr) return true; // Never backed up → due now

  const lastBackupMs = parseInt(lastBackupStr, 10);
  return Date.now() - lastBackupMs >= minInterval;
}

/**
 * Record the time of the last successful backup.
 */
async function recordSuccessfulBackup(): Promise<void> {
  await safeStorage.setItem(KEY_LAST_BACKUP_TIME, String(Date.now()));
}

/**
 * Record the time of the last backup attempt (success or failure).
 * Used to avoid hammering the API on repeated failures.
 */
async function recordBackupAttempt(): Promise<void> {
  await safeStorage.setItem(KEY_LAST_BACKUP_ATTEMPT, String(Date.now()));
}

// ─── Background Task Definition ───────────────────────────────────────────────
// IMPORTANT: TaskManager.defineTask must be called at module level (top-level)
// and NOT inside a function. It must be in a file imported early in the app bundle.

TaskManager.defineTask(BACKGROUND_BACKUP_TASK, async () => {
  try {
    console.log('[BackupScheduler] Background task fired');

    const settings = await googleDriveBackupService.getSettings();

    // No account connected → skip
    if (!settings.account) {
      console.log('[BackupScheduler] No Google account — skipping');
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    // Manual frequency → skip auto-backup
    if (settings.frequency === 'manual') {
      console.log('[BackupScheduler] Manual frequency — skipping auto-backup');
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    // Not due yet for this frequency
    const due = await isBackupDue(settings.frequency);
    if (!due) {
      console.log('[BackupScheduler] Backup not due yet');
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    // Network check
    const networkOk = await isNetworkSuitable(settings.networkType);
    if (!networkOk) {
      console.log(`[BackupScheduler] Network not suitable for networkType=${settings.networkType}`);
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    console.log('[BackupScheduler] All conditions met — starting background backup');
    await recordBackupAttempt();

    await googleDriveBackupService.startBackup();
    await recordSuccessfulBackup();

    console.log('[BackupScheduler] Background backup completed successfully');
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (err: any) {
    console.warn('[BackupScheduler] Background backup failed:', err?.message || err);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Register the background backup task. Call once at app startup.
 *
 * Safe to call multiple times — subsequent calls are no-ops if already registered.
 */
export async function initBackupScheduler(): Promise<void> {
  try {
    const status = await BackgroundFetch.getStatusAsync();

    if (
      status === BackgroundFetch.BackgroundFetchStatus.Restricted ||
      status === BackgroundFetch.BackgroundFetchStatus.Denied
    ) {
      console.log('[BackupScheduler] Background fetch restricted/denied by OS — cannot schedule');
      return;
    }

    // Register the task with minimum interval
    // iOS will control actual scheduling; Android WorkManager respects this more closely
    await BackgroundFetch.registerTaskAsync(BACKGROUND_BACKUP_TASK, {
      minimumInterval: BG_FETCH_MIN_INTERVAL_SECONDS,
      stopOnTerminate: false, // Android: continue after app is killed
      startOnBoot: true, // Android: reschedule after device restart
    });

    console.log('[BackupScheduler] Background backup task registered');
  } catch (err: any) {
    // Task already registered error is safe to ignore
    if (err?.message?.includes('already') || err?.message?.includes('registered')) {
      console.log('[BackupScheduler] Task already registered');
      return;
    }
    console.warn('[BackupScheduler] Failed to register background task:', err?.message || err);
  }
}

/**
 * Unregister the background task. Call on logout / account disconnect.
 */
export async function stopBackupScheduler(): Promise<void> {
  try {
    await BackgroundFetch.unregisterTaskAsync(BACKGROUND_BACKUP_TASK);
    console.log('[BackupScheduler] Background backup task unregistered');
  } catch {
    // Already unregistered — ignore
  }
}

/**
 * Check the current registration and permission status of the background task.
 * Returns a human-readable status for display in settings UI if needed.
 */
export async function getSchedulerStatus(): Promise<{
  isRegistered: boolean;
  status: string;
  lastBackupMs: number | null;
}> {
  try {
    const [isRegistered, statusCode, lastBackupStr] = await Promise.all([
      TaskManager.isTaskRegisteredAsync(BACKGROUND_BACKUP_TASK),
      BackgroundFetch.getStatusAsync(),
      safeStorage.getItem(KEY_LAST_BACKUP_TIME),
    ]);

    const statusLabels: Record<number, string> = {
      [BackgroundFetch.BackgroundFetchStatus.Available]: 'available',
      [BackgroundFetch.BackgroundFetchStatus.Restricted]: 'restricted',
      [BackgroundFetch.BackgroundFetchStatus.Denied]: 'denied',
    };

    return {
      isRegistered,
      status: statusLabels[statusCode] || 'unknown',
      lastBackupMs: lastBackupStr ? parseInt(lastBackupStr, 10) : null,
    };
  } catch {
    return { isRegistered: false, status: 'unknown', lastBackupMs: null };
  }
}

/**
 * Manually trigger a foreground backup check — same conditions as background,
 * but runs in the foreground. Used by the "Back Up Now" button in BackupContext
 * and for testing that all conditions are working correctly.
 *
 * This is NOT the same as calling googleDriveBackupService.startBackup() directly —
 * it respects network and frequency constraints (useful for "auto-backup if due" on app resume).
 */
export async function triggerBackupIfDue(force = false): Promise<boolean> {
  const settings = await googleDriveBackupService.getSettings();
  if (!settings.account) return false;
  if (settings.frequency === 'manual' && !force) return false;

  const [due, networkOk] = await Promise.all([
    force ? Promise.resolve(true) : isBackupDue(settings.frequency),
    isNetworkSuitable(settings.networkType),
  ]);

  if (!due || !networkOk) return false;

  try {
    await googleDriveBackupService.startBackup();
    await recordSuccessfulBackup();
    return true;
  } catch (err) {
    console.warn('[BackupScheduler] Foreground backup failed:', err);
    return false;
  }
}
