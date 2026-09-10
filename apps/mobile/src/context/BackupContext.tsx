/**
 * BackupContext.tsx — Reactive state layer for Chat Backup & Restore
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  mockBackupService,
  GoogleAccount,
  BackupMetadata,
  BackupSettings,
  BackupProgress,
  RestoreProgress,
} from '../services/googleDriveBackupService';

interface BackupContextValue {
  account: GoogleAccount | null;
  lastBackup: BackupMetadata | null;
  settings: BackupSettings;
  isLoading: boolean;

  // Backup State
  isBackingUp: boolean;
  backupProgress: number;
  backupStage: BackupProgress['stage'];
  backupStageLabel: string;
  backupError: string | null;

  // Restore State
  isRestoring: boolean;
  restoreProgress: number;
  restoreStage: RestoreProgress['stage'];
  restoreStageLabel: string;
  restoreError: string | null;

  // Testing controls
  mockFailureMode: boolean;
  mockBackupAvailable: boolean;

  // Actions
  connectAccount: (accountOrEmail: GoogleAccount | string) => Promise<void>;
  disconnectAccount: () => Promise<void>;
  updateSettings: (newSettings: Partial<BackupSettings>) => Promise<void>;
  startBackup: () => Promise<boolean>;
  cancelBackup: () => void;
  startRestore: () => Promise<boolean>;
  cancelRestore: () => void;
  deleteBackup: () => Promise<void>;
  refreshMetadata: () => Promise<void>;
  toggleMockFailure: () => Promise<void>;
  toggleMockBackupAvailable: () => Promise<void>;
}

const BackupContext = createContext<BackupContextValue | undefined>(undefined);

export const BackupProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<BackupSettings>({
    account: null,
    frequency: 'daily',
    networkType: 'wifi',
    includeImages: true,
    includeVideos: false,
  });
  const [lastBackup, setLastBackup] = useState<BackupMetadata | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Backup state
  const [isBackingUp, setIsBackingUp] = useState<boolean>(false);
  const [backupProgress, setBackupProgress] = useState<number>(0);
  const [backupStage, setBackupStage] = useState<BackupProgress['stage']>('preparing');
  const [backupStageLabel, setBackupStageLabel] = useState<string>('');
  const [backupError, setBackupError] = useState<string | null>(null);

  // Restore state
  const [isRestoring, setIsRestoring] = useState<boolean>(false);
  const [restoreProgress, setRestoreProgress] = useState<number>(0);
  const [restoreStage, setRestoreStage] = useState<RestoreProgress['stage']>('connecting');
  const [restoreStageLabel, setRestoreStageLabel] = useState<string>('');
  const [restoreError, setRestoreError] = useState<string | null>(null);

  // Testing switches
  const [mockFailureMode, setMockFailureMode] = useState<boolean>(false);
  const [mockBackupAvailable, setMockBackupAvailable] = useState<boolean>(true);

  const refreshMetadata = useCallback(async () => {
    try {
      const [savedSettings, meta, failMode, backupAvail] = await Promise.all([
        mockBackupService.getSettings(),
        mockBackupService.getBackupMetadata(),
        mockBackupService.getMockFailureMode(),
        mockBackupService.getMockBackupAvailable(),
      ]);
      setSettings(savedSettings);
      setLastBackup(meta);
      setMockFailureMode(failMode);
      setMockBackupAvailable(backupAvail);
    } catch (e) {
      console.warn('Error loading backup state:', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshMetadata();
  }, [refreshMetadata]);

  const connectAccount = async (accountOrEmail: GoogleAccount | string) => {
    const acc = await mockBackupService.connectGoogleAccount(accountOrEmail);
    setSettings((prev) => ({ ...prev, account: acc }));
  };

  const disconnectAccount = async () => {
    await mockBackupService.disconnectGoogleAccount();
    setSettings((prev) => ({ ...prev, account: null }));
  };

  const updateSettings = async (newSettings: Partial<BackupSettings>) => {
    const updated = await mockBackupService.saveSettings(newSettings);
    setSettings(updated);
  };

  const startBackup = async (): Promise<boolean> => {
    setIsBackingUp(true);
    setBackupProgress(0);
    setBackupStage('preparing');
    setBackupStageLabel('Preparing messages and media...');
    setBackupError(null);

    try {
      const meta = await mockBackupService.startBackup((p) => {
        setBackupProgress(p.percentage);
        setBackupStage(p.stage);
        setBackupStageLabel(p.stageLabel);
      });
      setLastBackup(meta);
      setIsBackingUp(false);
      return true;
    } catch (err: any) {
      setBackupError(err.message || 'Backup failed');
      setBackupStage('failed');
      setIsBackingUp(false);
      return false;
    }
  };

  const cancelBackup = () => {
    mockBackupService.cancelBackup();
    setIsBackingUp(false);
    setBackupStageLabel('Backup cancelled');
  };

  const startRestore = async (): Promise<boolean> => {
    setIsRestoring(true);
    setRestoreProgress(0);
    setRestoreStage('connecting');
    setRestoreStageLabel('Connecting to Google Drive...');
    setRestoreError(null);

    try {
      await mockBackupService.restoreBackup((p) => {
        setRestoreProgress(p.percentage);
        setRestoreStage(p.stage);
        setRestoreStageLabel(p.stageLabel);
      });
      setIsRestoring(false);
      return true;
    } catch (err: any) {
      setRestoreError(err.message || 'Restore failed');
      setRestoreStage('failed');
      setIsRestoring(false);
      return false;
    }
  };

  const cancelRestore = () => {
    mockBackupService.cancelRestore();
    setIsRestoring(false);
    setRestoreStageLabel('Restore cancelled');
  };

  const deleteBackup = async () => {
    await mockBackupService.deleteBackup();
    setLastBackup(null);
  };

  const toggleMockFailure = async () => {
    const next = !mockFailureMode;
    await mockBackupService.setMockFailureMode(next);
    setMockFailureMode(next);
  };

  const toggleMockBackupAvailable = async () => {
    const next = !mockBackupAvailable;
    await mockBackupService.setMockBackupAvailable(next);
    setMockBackupAvailable(next);
  };

  return (
    <BackupContext.Provider
      value={{
        account: settings.account,
        lastBackup,
        settings,
        isLoading,
        isBackingUp,
        backupProgress,
        backupStage,
        backupStageLabel,
        backupError,
        isRestoring,
        restoreProgress,
        restoreStage,
        restoreStageLabel,
        restoreError,
        mockFailureMode,
        mockBackupAvailable,
        connectAccount,
        disconnectAccount,
        updateSettings,
        startBackup,
        cancelBackup,
        startRestore,
        cancelRestore,
        deleteBackup,
        refreshMetadata,
        toggleMockFailure,
        toggleMockBackupAvailable,
      }}
    >
      {children}
    </BackupContext.Provider>
  );
};

export const useBackup = () => {
  const context = useContext(BackupContext);
  if (!context) {
    throw new Error('useBackup must be used within a BackupProvider');
  }
  return context;
};
