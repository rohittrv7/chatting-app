import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PushNotificationService {
  private readonly logger = new Logger(PushNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Send push notification for a new chat message to offline/background devices.
   * Only called when the receiver is NOT currently connected via WebSocket.
   */
  async sendMessagePush(
    targetUserId: string,
    messageData: {
      conversationId: string;
      senderId: string;
      senderName: string;
      senderAvatar?: string;
      messagePreview: string;
      messageType?: string;
    },
  ): Promise<void> {
    try {
      const devices = await this.prisma.device.findMany({
        where: { userId: targetUserId, fcmToken: { not: null } },
        select: { id: true, fcmToken: true, platform: true },
      });

      const tokens = devices
        .map((d) => d.fcmToken)
        .filter((t): t is string => Boolean(t && t.length > 10));

      if (tokens.length === 0) return;

      // Truncate preview to 100 chars to avoid large payloads
      const preview = messageData.messagePreview?.substring(0, 100) || 'New message';

      const fcmServerKey = this.configService.get<string>('FCM_SERVER_KEY');
      const payload = {
        registration_ids: tokens,
        priority: 'high',
        data: {
          type: 'NEW_MESSAGE',
          conversationId: messageData.conversationId,
          senderId: messageData.senderId,
          senderName: messageData.senderName,
          senderAvatar: messageData.senderAvatar || '',
          messagePreview: preview,
          timestamp: Date.now().toString(),
        },
        notification: {
          title: messageData.senderName,
          body: preview,
          sound: 'default',
          android_channel_id: 'message_channel',
          badge: '1',
        },
      };

      if (fcmServerKey) {
        const response = await fetch('https://fcm.googleapis.com/fcm/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `key=${fcmServerKey}`,
          },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          const errText = await response.text();
          this.logger.warn(`[Push] Message FCM error ${response.status}: ${errText}`);
        } else {
          this.logger.log(
            `[Push] Message push sent to ${tokens.length} device(s) for user=${targetUserId}`,
          );
        }
      } else {
        this.logger.log(
          `[Push] FCM_SERVER_KEY not set — message push simulated for ${tokens.length} token(s)`,
        );
      }
    } catch (err: any) {
      this.logger.error(`[Push] Failed to send message push: ${err?.message}`);
    }
  }
  /**
   * Dispatches a high-priority push notification to offline/backgrounded receiver devices
   * for an incoming call so their phone rings immediately even if socket is disconnected.
   */
  async sendIncomingCallPush(
    targetUserId: string,
    callData: {
      callId: string;
      callerId: string;
      callerName: string;
      callerAvatar?: string;
      callType: 'audio' | 'video';
      conversationId?: string;
    },
  ): Promise<void> {
    try {
      const devices = await this.prisma.device.findMany({
        where: {
          userId: targetUserId,
          fcmToken: { not: null },
        },
        select: {
          id: true,
          fcmToken: true,
          platform: true,
        },
      });

      const tokens = devices
        .map((d) => d.fcmToken)
        .filter((t): t is string => Boolean(t && t.length > 10));

      if (tokens.length === 0) {
        this.logger.log(
          `📞 [Push Notification] No FCM tokens registered for receiver ${targetUserId}`,
        );
        return;
      }

      this.logger.log(
        `📞 [Push Notification] Dispatching high-priority incoming call push to ${tokens.length} device(s) for user=${targetUserId}`,
      );

      const fcmServerKey = this.configService.get<string>('FCM_SERVER_KEY');

      const payload = {
        registration_ids: tokens,
        priority: 'high',
        data: {
          type: 'INCOMING_CALL',
          callId: callData.callId,
          callerId: callData.callerId,
          callerName: callData.callerName,
          callerAvatar: callData.callerAvatar || '',
          callType: callData.callType,
          conversationId: callData.conversationId || '',
          timestamp: Date.now().toString(),
        },
        notification: {
          title: `Incoming ${callData.callType === 'video' ? 'Video' : 'Voice'} Call`,
          body: `${callData.callerName} is calling you...`,
          sound: 'default',
          android_channel_id: 'call_channel',
        },
      };

      if (fcmServerKey) {
        const response = await fetch('https://fcm.googleapis.com/fcm/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `key=${fcmServerKey}`,
          },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          this.logger.log(
            `🟢 [Push Notification] FCM push successfully delivered for callId=${callData.callId}`,
          );
        } else {
          const errText = await response.text();
          this.logger.warn(
            `🟡 [Push Notification] FCM responded with status ${response.status}: ${errText}`,
          );
        }
      } else {
        this.logger.log(
          `ℹ️ [Push Notification] FCM_SERVER_KEY not configured in env — push simulated for ${tokens.length} token(s)`,
        );
      }
    } catch (err: any) {
      this.logger.error(
        `🔴 [Push Notification] Failed to send incoming call push: ${err?.message}`,
      );
    }
  }
}
