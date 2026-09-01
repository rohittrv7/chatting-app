import { Platform } from 'react-native';
import { safeStorage } from './storageHelper';

export type ServerEnvironment = 'local' | 'live';

const SERVER_ENV_STORAGE_KEY = '@app_server_environment_v3';
const SERVER_CUSTOM_IP_KEY = '@app_custom_local_ip_v3';

// Active Host Wi-Fi IP from ipconfig
export const DEFAULT_LOCAL_IP = '10.96.71.14';

export const LIVE_API_URL = 'https://chatting-app-rme6.onrender.com/api/v1';
export const LIVE_SOCKET_URL = 'https://chatting-app-rme6.onrender.com';

class ServerConfigService {
  private currentEnv: ServerEnvironment = 'live';
  private localIp: string = DEFAULT_LOCAL_IP;
  private listeners: Set<(env: ServerEnvironment, ip: string) => void> = new Set();
  private isLoaded = false;

  constructor() {
    this.init();
  }

  private async init() {
    try {
      const storedEnv = await safeStorage.getItem(SERVER_ENV_STORAGE_KEY);
      if (storedEnv === 'live' || storedEnv === 'local') {
        this.currentEnv = storedEnv;
      } else {
        this.currentEnv = 'live'; // default to live production backend
      }

      const storedIp = await safeStorage.getItem(SERVER_CUSTOM_IP_KEY);
      if (storedIp && storedIp.trim()) {
        this.localIp = storedIp.trim();
      } else {
        this.localIp = DEFAULT_LOCAL_IP;
      }
    } catch (e) {
      this.currentEnv = 'live';
      this.localIp = DEFAULT_LOCAL_IP;
    }
    this.isLoaded = true;
    this.notify();
  }

  public getEnvironment(): ServerEnvironment {
    return this.currentEnv;
  }

  public getLocalIp(): string {
    return this.localIp;
  }

  public async setLocalIp(newIp: string): Promise<void> {
    const cleanIp = newIp
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/:[0-9]+.*$/, '');
    this.localIp = cleanIp || DEFAULT_LOCAL_IP;
    await safeStorage.setItem(SERVER_CUSTOM_IP_KEY, this.localIp);
    this.notify();
  }

  public getApiBaseUrl(): string {
    if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;
    if (this.currentEnv === 'live') {
      return LIVE_API_URL;
    }
    const ip = Platform.OS === 'web' ? 'localhost' : this.localIp;
    return `http://${ip}:3000/api/v1`;
  }

  public getSocketUrl(): string {
    if (process.env.EXPO_PUBLIC_SOCKET_URL) return process.env.EXPO_PUBLIC_SOCKET_URL;
    if (this.currentEnv === 'live') {
      return LIVE_SOCKET_URL;
    }
    const ip = Platform.OS === 'web' ? 'localhost' : this.localIp;
    return `http://${ip}:3000`;
  }

  public async setEnvironment(env: ServerEnvironment): Promise<void> {
    this.currentEnv = env;
    await safeStorage.setItem(SERVER_ENV_STORAGE_KEY, env);
    this.notify();
  }

  public async toggleEnvironment(): Promise<ServerEnvironment> {
    const nextEnv: ServerEnvironment = this.currentEnv === 'local' ? 'live' : 'local';
    await this.setEnvironment(nextEnv);
    return nextEnv;
  }

  public subscribe(cb: (env: ServerEnvironment, ip: string) => void): () => void {
    this.listeners.add(cb);
    cb(this.currentEnv, this.localIp);
    return () => this.listeners.delete(cb);
  }

  private notify() {
    for (const listener of this.listeners) {
      try {
        listener(this.currentEnv, this.localIp);
      } catch (e) {}
    }
  }
}

export const serverConfig = new ServerConfigService();
