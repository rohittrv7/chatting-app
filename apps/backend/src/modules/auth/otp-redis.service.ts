import { Injectable, Inject, Logger } from '@nestjs/common';
import Redis from 'ioredis';

export interface OtpRecord {
  code: string;
  attempts: number;
  lockedUntil: number; // Unix timestamp ms; 0 means not locked
  expiresAt?: number;
}

const OTP_TTL_SECONDS = 10 * 60; // 10 minutes
const MAX_ATTEMPTS = 5;
const LOCK_DURATION_SECONDS = 30 * 60; // 30 minutes

@Injectable()
export class OtpRedisService {
  private readonly memoryStore = new Map<string, OtpRecord>();
  private readonly logger = new Logger(OtpRedisService.name);

  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  private key(phoneNumber: string): string {
    return `otp:${phoneNumber}`;
  }

  /**
   * Store a new OTP for the given phone number, resetting attempts and lock.
   * TTL is 10 minutes from now.
   */
  async storeOtp(phoneNumber: string, code: string): Promise<void> {
    try {
      if (this.redis.status === 'ready' || this.redis.status === 'connect') {
        const k = this.key(phoneNumber);
        await this.redis
          .multi()
          .hset(k, 'code', code, 'attempts', '0', 'lockedUntil', '0')
          .expire(k, OTP_TTL_SECONDS)
          .exec();
        return;
      }
    } catch {
      // Fallback to in-memory store
    }

    // In-memory fallback
    this.memoryStore.set(phoneNumber, {
      code,
      attempts: 0,
      lockedUntil: 0,
      expiresAt: Date.now() + OTP_TTL_SECONDS * 1000,
    });
  }

  /**
   * Retrieve the current OTP record; returns null if it doesn't exist (expired / never sent).
   */
  async getOtp(phoneNumber: string): Promise<OtpRecord | null> {
    try {
      if (this.redis.status === 'ready' || this.redis.status === 'connect') {
        const k = this.key(phoneNumber);
        const data = await this.redis.hgetall(k);
        if (data && data['code']) {
          return {
            code: data['code'],
            attempts: parseInt(data['attempts'] ?? '0', 10),
            lockedUntil: parseInt(data['lockedUntil'] ?? '0', 10),
          };
        }
      }
    } catch {
      // Fallback to memory
    }

    const memRecord = this.memoryStore.get(phoneNumber);
    if (!memRecord) return null;
    if (memRecord.expiresAt && Date.now() > memRecord.expiresAt) {
      this.memoryStore.delete(phoneNumber);
      return null;
    }
    return memRecord;
  }

  /**
   * Increment the failure counter. If >= MAX_ATTEMPTS, lock for 30 minutes and return locked=true.
   * Returns { locked, remainingAttempts }.
   */
  async recordFailure(
    phoneNumber: string,
  ): Promise<{ locked: boolean; remainingAttempts: number }> {
    try {
      if (this.redis.status === 'ready' || this.redis.status === 'connect') {
        const k = this.key(phoneNumber);
        const newAttempts = await this.redis.hincrby(k, 'attempts', 1);

        if (newAttempts >= MAX_ATTEMPTS) {
          const lockedUntil = Date.now() + LOCK_DURATION_SECONDS * 1000;
          await this.redis
            .multi()
            .hset(k, 'lockedUntil', String(lockedUntil))
            .expire(k, LOCK_DURATION_SECONDS)
            .exec();
          return { locked: true, remainingAttempts: 0 };
        }

        return { locked: false, remainingAttempts: MAX_ATTEMPTS - newAttempts };
      }
    } catch {
      // Fallback to memory
    }

    const rec = this.memoryStore.get(phoneNumber) || {
      code: '',
      attempts: 0,
      lockedUntil: 0,
    };
    rec.attempts += 1;
    if (rec.attempts >= MAX_ATTEMPTS) {
      rec.lockedUntil = Date.now() + LOCK_DURATION_SECONDS * 1000;
      this.memoryStore.set(phoneNumber, rec);
      return { locked: true, remainingAttempts: 0 };
    }
    this.memoryStore.set(phoneNumber, rec);
    return { locked: false, remainingAttempts: MAX_ATTEMPTS - rec.attempts };
  }

  /**
   * Clear the OTP record on successful verification.
   */
  async clearOtp(phoneNumber: string): Promise<void> {
    try {
      if (this.redis.status === 'ready' || this.redis.status === 'connect') {
        await this.redis.del(this.key(phoneNumber));
      }
    } catch {
      // ignore
    }
    this.memoryStore.delete(phoneNumber);
  }
}
