import { Injectable, Inject, Logger } from '@nestjs/common';
import Redis from 'ioredis';

const MESSAGE_CACHE_LIMIT = 50;
const CACHE_TTL_SECONDS = 86400; // 24 hours

@Injectable()
export class MessageRedisService {
  private readonly memoryStore = new Map<string, any[]>();
  private readonly userActiveConv = new Map<string, string>();
  private readonly logger = new Logger(MessageRedisService.name);

  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  private convKey(conversationId: string): string {
    return `messages:conv:${conversationId}`;
  }

  private userActiveKey(userId: string): string {
    return `user:${userId}:active_conv`;
  }

  /**
   * Cache a message into the conversation's Redis list (keeps latest 50 messages)
   */
  async cacheMessage(conversationId: string, message: any): Promise<void> {
    try {
      if (this.redis.status === 'ready' || this.redis.status === 'connect') {
        const k = this.convKey(conversationId);
        await this.redis
          .multi()
          .lpush(k, JSON.stringify(message))
          .ltrim(k, 0, MESSAGE_CACHE_LIMIT - 1)
          .expire(k, CACHE_TTL_SECONDS)
          .exec();
        return;
      }
    } catch (e) {
      // Memory fallback
    }

    const current = this.memoryStore.get(conversationId) || [];
    current.unshift(message);
    if (current.length > MESSAGE_CACHE_LIMIT) {
      current.length = MESSAGE_CACHE_LIMIT;
    }
    this.memoryStore.set(conversationId, current);
  }

  /**
   * Retrieve cached recent messages for a conversation
   */
  async getCachedMessages(conversationId: string, limit = 50): Promise<any[] | null> {
    try {
      if (this.redis.status === 'ready' || this.redis.status === 'connect') {
        const k = this.convKey(conversationId);
        const rows = await this.redis.lrange(k, 0, limit - 1);
        if (rows && rows.length > 0) {
          return rows.map((r) => JSON.parse(r));
        }
      }
    } catch (e) {
      // Memory fallback
    }

    const mem = this.memoryStore.get(conversationId);
    return mem && mem.length > 0 ? mem.slice(0, limit) : null;
  }

  /**
   * Update the status of a cached message (e.g. SERVER_RECEIVED -> DELIVERED -> READ)
   */
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
          const updated: string[] = [];
          for (const row of rows) {
            const parsed = JSON.parse(row);
            if (parsed.id === messageId || parsed.clientMessageId === messageId) {
              parsed.status = status;
            }
            updated.push(JSON.stringify(parsed));
          }
          await this.redis
            .multi()
            .del(k)
            .rpush(k, ...updated)
            .expire(k, CACHE_TTL_SECONDS)
            .exec();
          return;
        }
      }
    } catch (e) {
      // Memory fallback
    }

    const mem = this.memoryStore.get(conversationId);
    if (mem) {
      for (const msg of mem) {
        if (msg.id === messageId || msg.clientMessageId === messageId) {
          msg.status = status;
        }
      }
    }
  }

  /**
   * Set user's currently opened conversation (for instant READ receipt)
   */
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
    } catch (e) {
      // Memory fallback
    }

    if (conversationId) {
      this.userActiveConv.set(userId, conversationId);
    } else {
      this.userActiveConv.delete(userId);
    }
  }

  /**
   * Get user's currently active conversation
   */
  async getUserActiveConversation(userId: string): Promise<string | null> {
    try {
      if (this.redis.status === 'ready' || this.redis.status === 'connect') {
        return await this.redis.get(this.userActiveKey(userId));
      }
    } catch (e) {
      // Memory fallback
    }
    return this.userActiveConv.get(userId) || null;
  }
}
