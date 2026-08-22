export interface ApiLogEntry {
  id: string;
  url: string;
  method: string;
  requestData?: any;
  responseData?: any;
  status: number;
  durationMs: number;
  fromRedisCache: boolean;
  timestamp: string;
  error?: string;
}

export interface UiLogEntry {
  id: string;
  screen: string;
  action: 'mount' | 'unmount' | 'render' | 'tab_switch';
  details?: string;
  timestamp: string;
}

export interface SocketLogEntry {
  id: string;
  event: string;
  type: 'incoming' | 'outgoing';
  data?: any;
  timestamp: string;
}

type Listener = () => void;

class DevInspectorService {
  private apiLogs: ApiLogEntry[] = [];
  private uiLogs: UiLogEntry[] = [];
  private socketLogs: SocketLogEntry[] = [];
  private listeners: Set<Listener> = new Set();
  private isVisible: boolean = false;

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }

  public toggleVisibility() {
    this.isVisible = !this.isVisible;
    this.notify();
  }

  public setVisible(val: boolean) {
    this.isVisible = val;
    this.notify();
  }

  public getIsVisible(): boolean {
    return this.isVisible;
  }

  public logApi(entry: Omit<ApiLogEntry, 'id' | 'timestamp'>) {
    const newEntry: ApiLogEntry = {
      ...entry,
      id: `api_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toLocaleTimeString(),
    };
    this.apiLogs.unshift(newEntry);
    if (this.apiLogs.length > 50) this.apiLogs.pop();
    this.notify();
  }

  public logUi(screen: string, action: UiLogEntry['action'], details?: string) {
    const newEntry: UiLogEntry = {
      id: `ui_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      screen,
      action,
      details,
      timestamp: new Date().toLocaleTimeString(),
    };
    this.uiLogs.unshift(newEntry);
    if (this.uiLogs.length > 50) this.uiLogs.pop();
    this.notify();
  }

  public logSocket(event: string, type: 'incoming' | 'outgoing', data?: any) {
    const newEntry: SocketLogEntry = {
      id: `sock_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      event,
      type,
      data,
      timestamp: new Date().toLocaleTimeString(),
    };
    this.socketLogs.unshift(newEntry);
    if (this.socketLogs.length > 50) this.socketLogs.pop();
    this.notify();
  }

  public getApiLogs(): ApiLogEntry[] {
    return [...this.apiLogs];
  }

  public getUiLogs(): UiLogEntry[] {
    return [...this.uiLogs];
  }

  public getSocketLogs(): SocketLogEntry[] {
    return [...this.socketLogs];
  }

  public clearAllLogs() {
    this.apiLogs = [];
    this.uiLogs = [];
    this.socketLogs = [];
    this.notify();
  }
}

export const devInspector = new DevInspectorService();
