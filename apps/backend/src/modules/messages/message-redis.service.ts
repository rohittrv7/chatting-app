import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import Redis from 'ioredis';
import { OtelService } from '../observability/otel.service';

const MESSAGE_CACHE_LIMIT = 50;
const CACHE_TTL_SECONDS = 86400; // 24 hours
const PRESENCE_TTL_SECONDS = 30 * 24 * 3600; // 30 days for lastSeen

@Injectable()
export class MessageRedisService {
  private readonly memoryStore = new Map<string, any[]>();
  private readonly userActiveConv = new Map<string, string>();
  private readonly lastSeenMemory = new Map<string, string>();
  private readonly logger = new Logger(MessageRedisService.name);

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    @Optional() private readonly otelService?: OtelService,
  ) {}

  /**
   * Returns dedicated pub/sub Redis clients for the Socket.IO Redis adapter.
   * Returns { pub: null, sub: null } when Redis is unavailable so the gateway
   * can fall back to the in-memory adapter gracefully.
   */
  async getPubSubClients(): Promise<{ pub: Redis | null; sub: Redis | null }> {
    try {
      const isReady = this.redis.status === 'ready' || this.redis.status === 'connect';
      if (!isReady) return { pub: null, sub: null };

      // Duplicate the existing connection — ioredis requires separate clients for pub/sub
      const pub = this.redis.duplicate();
      const sub = this.redis.duplicate();
      return { pub, sub };
    } catch {
      return { pub: null, sub: null };
    }
  }

  // ─── Keys ────────────────────────────────────────────────────────────────

  private convKey(conversationId: string): string {
    return `messages:conv:${conversationId}`;
  }

  private userActiveKey(userId: string): string {
    return `user:${userId}:active_conv`;
  }

  private lastSeenKey(userId: string): string {
    return `user:${userId}:last_seen`;
  }

  // ─── Message Cache ────────────────────────────────────────────────────────

  async cacheMessage(conversationId: string, message: any): Promise<void> {
    const start = Date.now();
    try {
      if (this.redis.status === 'ready' || this.redis.status === 'connect') {
        const k = this.convKey(conversationId);
        await this.redis
          .multi()
          .lpush(k, JSON.stringify(message))
          .ltrim(k, 0, MESSAGE_CACHE_LIMIT - 1)
          .expire(k, CACHE_TTL_SECONDS)
          .exec();
        this.otelService?.recordRedisOp('LPUSH_LTRIM', k, Date.now() - start);
        return;
      }
    } catch (e: any) {
      this.otelService?.recordRedisOp(
        'LPUSH_LTRIM',
        this.convKey(conversationId),
        Date.now() - start,
        e,
      );
    }

    const current = this.memoryStore.get(conversationId) || [];
    current.unshift(message);
    if (current.length > MESSAGE_CACHE_LIMIT) current.length = MESSAGE_CACHE_LIMIT;
    this.memoryStore.set(conversationId, current);
  }

  async getCachedMessages(conversationId: string, limit = 50): Promise<any[] | null> {
    const start = Date.now();
    try {
      if (this.redis.status === 'ready' || this.redis.status === 'connect') {
        const k = this.convKey(conversationId);
        const rows = await this.redis.lrange(k, 0, limit - 1);
        this.otelService?.recordRedisOp('LRANGE', k, Date.now() - start);
        if (rows && rows.length > 0) return rows.map((r) => JSON.parse(r));
      }
    } catch (e: any) {
      this.otelService?.recordRedisOp(
        'LRANGE',
        this.convKey(conversationId),
        Date.now() - start,
        e,
      );
    }

    const mem = this.memoryStore.get(conversationId);
    return mem && mem.length > 0 ? mem.slice(0, limit) : null;
  }

  async updateCachedMessageStatus(
    conversationId: string,
    messageId: string,
    status: string,
  ): Promise<void> {
    try {
      if (this.redis.status === 'ready' || this.redis.status === 'connect') {
        const k = this.convKey(conversationId);
        const rows = await this.redis.lrange(k, 0, MESSAGE_CACHE_LIMIT - 1);
        if (rows && rows.length > 0) {
          const updated: string[] = rows.map((row) => {
            const parsed = JSON.parse(row);
            if (parsed.id === messageId || parsed.clientMessageId === messageId) {
              parsed.status = status;
            }
            return JSON.stringify(parsed);
          });
          await this.redis
            .multi()
            .del(k)
            .rpush(k, ...updated)
            .expire(k, CACHE_TTL_SECONDS)
            .exec();
          return;
        }
      }
    } catch {}

    const mem = this.memoryStore.get(conversationId);
    if (mem) {
      for (const msg of mem) {
        if (msg.id === messageId || msg.clientMessageId === messageId) {
          msg.status = status;
        }
      }
    }
  }

  // ─── Active Conversation ──────────────────────────────────────────────────

  async setUserActiveConversation(userId: string, conversationId: string | null): Promise<void> {
    try {
      if (this.redis.status === 'ready' || this.redis.status === 'connect') {
        const k = this.userActiveKey(userId);
        if (conversationId) {
          await this.redis.set(k, conversationId, 'EX', 7200);
        } else {
          await this.redis.del(k);
        }
        return;
      }
    } catch {}

    if (conversationId) {
      this.userActiveConv.set(userId, conversationId);
    } else {
      this.userActiveConv.delete(userId);
    }
  }

  async getUserActiveConversation(userId: string): Promise<string | null> {
    try {
      if (this.redis.status === 'ready' || this.redis.status === 'connect') {
        return await this.redis.get(this.userActiveKey(userId));
      }
    } catch {}
    return this.userActiveConv.get(userId) || null;
  }

  // ─── lastSeen Persistence ─────────────────────────────────────────────────

  /**
   * Persist the last-seen timestamp for a user (called on disconnect).
   * Stored for 30 days so clients can always fetch it.
   */
  async setLastSeen(userId: string, isoTimestamp: string): Promise<void> {
    try {
      if (this.redis.status === 'ready' || this.redis.status === 'connect') {
        await this.redis.set(this.lastSeenKey(userId), isoTimestamp, 'EX', PRESENCE_TTL_SECONDS);
        return;
      }
    } catch {}
    this.lastSeenMemory.set(userId, isoTimestamp);
  }

  /**
   * Retrieve stored lastSeen for a user.
   */
  async getLastSeen(userId: string): Promise<string | null> {
    try {
      if (this.redis.status === 'ready' || this.redis.status === 'connect') {
        return await this.redis.get(this.lastSeenKey(userId));
      }
    } catch {}
    return this.lastSeenMemory.get(userId) || null;
  }

  /**
   * Batch fetch lastSeen for multiple userIds.
   */
  async getLastSeenBatch(userIds: string[]): Promise<Record<string, string | null>> {
    const result: Record<string, string | null> = {};
    if (userIds.length === 0) return result;

    try {
      if (this.redis.status === 'ready' || this.redis.status === 'connect') {
        const keys = userIds.map((id) => this.lastSeenKey(id));
        const values = await this.redis.mget(...keys);
        userIds.forEach((id, i) => {
          result[id] = values[i] ?? null;
        });
        return result;
      }
    } catch {}

    for (const id of userIds) {
      result[id] = this.lastSeenMemory.get(id) || null;
    }
    return result;
  }
}
