import { Injectable, Inject } from '@nestjs/common';
import Redis from 'ioredis';

export interface OtpRecord {
  code: string;
  attempts: number;
  lockedUntil: number; // Unix timestamp ms; 0 means not locked
}

const OTP_TTL_SECONDS = 10 * 60; // 10 minutes
const MAX_ATTEMPTS = 5;
const LOCK_DURATION_SECONDS = 30 * 60; // 30 minutes

@Injectable()
export class OtpRedisService {
  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  private key(phoneNumber: string): string {
    return `otp:${phoneNumber}`;
  }

  /**
   * Store a new OTP for the given phone number, resetting attempts and lock.
   * TTL is 10 minutes from now.
   */
  async storeOtp(phoneNumber: string, code: string): Promise<void> {
    const k = this.key(phoneNumber);
    await this.redis
      .multi()
      .hset(k, 'code', code, 'attempts', '0', 'lockedUntil', '0')
      .expire(k, OTP_TTL_SECONDS)
      .exec();
  }

  /**
   * Retrieve the current OTP record; returns null if it doesn't exist (expired / never sent).
   */
  async getOtp(phoneNumber: string): Promise<OtpRecord | null> {
    const k = this.key(phoneNumber);
    const data = await this.redis.hgetall(k);
    if (!data || !data['code']) return null;
    return {
      code: data['code'],
      attempts: parseInt(data['attempts'] ?? '0', 10),
      lockedUntil: parseInt(data['lockedUntil'] ?? '0', 10),
    };
  }

  /**
   * Increment the failure counter. If >= MAX_ATTEMPTS, lock for 30 minutes and return locked=true.
   * Returns { locked, remainingAttempts }.
   */
  async recordFailure(
    phoneNumber: string,
  ): Promise<{ locked: boolean; remainingAttempts: number }> {
    const k = this.key(phoneNumber);
    const newAttempts = await this.redis.hincrby(k, 'attempts', 1);

    if (newAttempts >= MAX_ATTEMPTS) {
      const lockedUntil = Date.now() + LOCK_DURATION_SECONDS * 1000;
      // Extend TTL to cover the lockout window
      await this.redis
        .multi()
        .hset(k, 'lockedUntil', String(lockedUntil))
        .expire(k, LOCK_DURATION_SECONDS)
        .exec();
      return { locked: true, remainingAttempts: 0 };
    }

    return { locked: false, remainingAttempts: MAX_ATTEMPTS - newAttempts };
  }

  /**
   * Clear the OTP record on successful verification.
   */
  async clearOtp(phoneNumber: string): Promise<void> {
    await this.redis.del(this.key(phoneNumber));
  }
}
