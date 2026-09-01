import { safeStorage } from './storageHelper';

export interface CallLogItem {
  id: string;
  callId: string;
  targetUserId: string;
  targetUserName: string;
  targetUserAvatar?: string;
  callType: 'audio' | 'video';
  direction: 'outgoing' | 'incoming' | 'missed';
  status: 'completed' | 'missed' | 'declined' | 'failed';
  durationSeconds: number;
  timestamp: number;
}

type CallHistoryListener = (logs: CallLogItem[]) => void;

class CallHistoryService {
  private logs: CallLogItem[] = [];
  private listeners: Set<CallHistoryListener> = new Set();
  private isLoaded = false;

  constructor() {
    this.loadLogs();
  }

  public async loadLogs(): Promise<CallLogItem[]> {
    try {
      const raw = await safeStorage.getItem('@chat_call_history_v1');
      if (raw) {
        this.logs = JSON.parse(raw);
      }
    } catch (_) {}
    this.isLoaded = true;
    this.notify();
    return this.logs;
  }

  public async addLog(entry: Omit<CallLogItem, 'id'>): Promise<CallLogItem> {
    if (!this.isLoaded) await this.loadLogs();
    const item: CallLogItem = {
      ...entry,
      id: `call_log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    };
    this.logs = [item, ...this.logs.filter((l) => l.callId !== entry.callId)];
    // Cap at 100 recent calls
    if (this.logs.length > 100) this.logs = this.logs.slice(0, 100);

    try {
      await safeStorage.setItem('@chat_call_history_v1', JSON.stringify(this.logs));
    } catch (_) {}

    this.notify();
    return item;
  }

  public async clearHistory(): Promise<void> {
    this.logs = [];
    try {
      await safeStorage.removeItem('@chat_call_history_v1');
    } catch (_) {}
    this.notify();
  }

  public async deleteLog(id: string): Promise<void> {
    this.logs = this.logs.filter((l) => l.id !== id);
    try {
      await safeStorage.setItem('@chat_call_history_v1', JSON.stringify(this.logs));
    } catch (_) {}
    this.notify();
  }

  public getLogs(): CallLogItem[] {
    return this.logs;
  }

  public subscribe(listener: CallHistoryListener): () => void {
    this.listeners.add(listener);
    listener(this.logs);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) {
      listener([...this.logs]);
    }
  }
}

export const callHistoryService = new CallHistoryService();
