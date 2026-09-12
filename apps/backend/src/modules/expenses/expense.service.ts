import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ChatGateway, EVT_MESSAGE_NEW } from '../messages/message.gateway';
import { ConversationService } from '../conversations/conversation.service';
import { CreateExpenseSplitDto, SettleUpDto } from './dto/create-expense.dto';
import { ConversationType, MessageType, Role, DeliveryStatus, Prisma } from '@prisma/client';

@Injectable()
export class ExpenseService {
  private readonly logger = new Logger(ExpenseService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => ChatGateway))
    private readonly chatGateway: ChatGateway,
    @Inject(forwardRef(() => ConversationService))
    private readonly conversationService: ConversationService,
  ) {}

  private async getOrCreateSenderDeviceId(userId: string): Promise<string> {
    const device = await this.prisma.device.findFirst({
      where: { userId },
    });
    if (device) return device.id;

    const newDevice = await this.prisma.device.create({
      data: {
        userId,
        deviceId: 1,
        deviceName: 'System / Server',
        platform: 'server',
      },
    });
    return newDevice.id;
  }

  /**
   * Helper: Resolve userId from UUID, phone number, or username
   */
  async resolveUserId(idOrPhoneOrUsername: string): Promise<string | null> {
    if (!idOrPhoneOrUsername) return null;
    const clean = idOrPhoneOrUsername.replace(/^@+/, '');
    const clean10 = clean.replace(/\D/g, '').slice(-10);

    const user = await this.prisma.user.findFirst({
      where: {
        isActive: true,
        OR: [
          { id: idOrPhoneOrUsername },
          { username: { equals: clean, mode: 'insensitive' } },
          ...(clean10
            ? [
                { phoneNumber: clean10 },
                { phoneNumber: `+91${clean10}` },
                { phoneNumber: `+${clean10}` },
                { phoneNumber: `91${clean10}` },
              ]
            : []),
          { phoneNumber: clean },
        ],
      },
      select: { id: true },
    });

    if (user?.id) return user.id;

    // Auto-provision placeholder user if phone or name provided so splits can be assigned to anyone
    try {
      const phoneToUse = clean10 && clean10.length === 10 ? clean10 : null;
      if (phoneToUse) {
        const created = await this.prisma.user.create({
          data: {
            phoneNumber: phoneToUse,
            displayName: clean !== phoneToUse ? clean : `User ${phoneToUse.slice(-4)}`,
            isActive: true,
          },
        });
        return created.id;
      } else if (clean && clean.length >= 2) {
        const created = await this.prisma.user.create({
          data: {
            phoneNumber: `temp_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
            username: clean
              .toLowerCase()
              .replace(/[^a-z0-9_]/g, '_')
              .slice(0, 20),
            displayName: clean,
            isActive: true,
          },
        });
        return created.id;
      }
    } catch {
      const fallback = await this.prisma.user.findFirst({
        where: {
          OR: [
            ...(clean10 ? [{ phoneNumber: clean10 }] : []),
            { username: { equals: clean, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      });
      return fallback?.id || null;
    }

    return null;
  }

  /**
   * Create an Expense Split (1:1 chat reuse or temporary lightweight Split Group for 3+ people)
   */
  async createExpenseSplit(currentUserId: string, dto: CreateExpenseSplitDto) {
    const creatorId = (await this.resolveUserId(currentUserId)) || currentUserId;

    // Resolve all participant IDs
    const rawList = dto.participantUserIds || dto.participantIds || [];
    const resolvedParticipantIds: string[] = [];
    for (const rawId of rawList) {
      const uid = await this.resolveUserId(rawId);
      if (uid && uid !== creatorId && !resolvedParticipantIds.includes(uid)) {
        resolvedParticipantIds.push(uid);
      }
    }

    if (resolvedParticipantIds.length === 0) {
      throw new BadRequestException('At least one other participant is required to create a split');
    }

    const payerId = dto.paidByUserId
      ? (await this.resolveUserId(dto.paidByUserId)) || creatorId
      : creatorId;

    const allMemberIds: string[] = [creatorId, ...resolvedParticipantIds];
    if (!allMemberIds.includes(payerId)) {
      allMemberIds.push(payerId);
    }

    const totalAmount = Number(dto.totalAmount);
    if (isNaN(totalAmount) || totalAmount <= 0) {
      throw new BadRequestException('Total amount must be greater than 0');
    }

    // Calculate amounts per participant
    const participantAmounts: { userId: string; amountOwed: number; shareValue?: number }[] = [];
    const splitType = dto.splitType || 'EQUAL';

    if (splitType === 'EQUAL') {
      const n = allMemberIds.length;
      const share = Math.floor((totalAmount / n) * 100) / 100;
      const remainder = Math.round((totalAmount - share * n) * 100) / 100;

      for (let i = 0; i < allMemberIds.length; i++) {
        const uid = allMemberIds[i];
        // The payer absorbs the cent/paisa rounding remainder so total is exact
        const amount = uid === payerId ? Number((share + remainder).toFixed(2)) : share;
        participantAmounts.push({ userId: uid, amountOwed: amount });
      }
    } else if (splitType === 'PERCENT') {
      const sharesMap = dto.shares || dto.customAmounts || {};
      let totalPercent = 0;
      for (const uid of allMemberIds) {
        let pVal = sharesMap[uid];
        if (pVal === undefined) {
          for (const rawKey of Object.keys(sharesMap)) {
            const resolved = await this.resolveUserId(rawKey);
            if (resolved === uid) {
              pVal = sharesMap[rawKey];
              break;
            }
          }
        }
        const numericP = Number(pVal || 0);
        if (numericP < 0) throw new BadRequestException('Percentage cannot be negative');
        totalPercent += numericP;
        const calculatedAmount = Math.round(totalAmount * (numericP / 100) * 100) / 100;
        participantAmounts.push({
          userId: uid,
          amountOwed: calculatedAmount,
          shareValue: numericP,
        });
      }
      if (Math.abs(totalPercent - 100) > 0.5) {
        throw new BadRequestException(
          `Total percentages must sum to 100% (currently ${totalPercent}%)`,
        );
      }
    } else if (splitType === 'SHARES') {
      const sharesMap = dto.shares || dto.customAmounts || {};
      let totalShares = 0;
      const resolvedShares: { uid: string; shares: number }[] = [];
      for (const uid of allMemberIds) {
        let sVal = sharesMap[uid];
        if (sVal === undefined) {
          for (const rawKey of Object.keys(sharesMap)) {
            const resolved = await this.resolveUserId(rawKey);
            if (resolved === uid) {
              sVal = sharesMap[rawKey];
              break;
            }
          }
        }
        const numericS = Number(sVal || 1);
        if (numericS <= 0) throw new BadRequestException('Shares must be at least 1');
        totalShares += numericS;
        resolvedShares.push({ uid, shares: numericS });
      }
      for (const item of resolvedShares) {
        const calculatedAmount = Math.round(totalAmount * (item.shares / totalShares) * 100) / 100;
        participantAmounts.push({
          userId: item.uid,
          amountOwed: calculatedAmount,
          shareValue: item.shares,
        });
      }
    } else {
      // EXACT / CUSTOM SPLIT
      const customMap = dto.customAmounts || dto.shares || {};
      let sum = 0;
      for (const uid of allMemberIds) {
        let amt = customMap[uid];
        if (amt === undefined) {
          for (const rawKey of Object.keys(customMap)) {
            const resolvedKey = await this.resolveUserId(rawKey);
            if (resolvedKey === uid) {
              amt = customMap[rawKey];
              break;
            }
          }
        }
        const numericAmt = Number(amt || 0);
        if (numericAmt < 0) {
          throw new BadRequestException('Individual participant share cannot be negative');
        }
        participantAmounts.push({
          userId: uid,
          amountOwed: Number(numericAmt.toFixed(2)),
          shareValue: numericAmt,
        });
        sum += numericAmt;
      }
      if (Math.abs(sum - totalAmount) > 0.05) {
        throw new BadRequestException(
          `Sum of shares (₹${sum.toFixed(2)}) must equal total amount (₹${totalAmount.toFixed(2)})`,
        );
      }
    }

    // Determine Conversation:
    // If exactly 1 other participant (2 total people) -> reuse existing or getOrCreate 1:1 conversation
    // If 2+ other participants (3+ total people) -> create lightweight Split Group
    let targetConversationId: string;
    let splitGroupId: string | null = null;
    let isNewGroup = false;

    if (resolvedParticipantIds.length === 1) {
      // 1:1 Split
      if (dto.conversationId) {
        targetConversationId = dto.conversationId;
      } else {
        const directConv = await this.conversationService.getOrCreateDirect(
          creatorId,
          resolvedParticipantIds[0],
        );
        targetConversationId = directConv.id;
      }
    } else {
      // 3+ total people -> Temporary or Ongoing Split Group
      isNewGroup = true;
      const groupTitle = `${dto.title.trim()} - Split`;
      const splitGroup = await this.prisma.conversation.create({
        data: {
          type: ConversationType.GROUP,
          title: groupTitle,
          isSplitGroup: true,
          members: {
            create: allMemberIds.map((uid) => ({
              userId: uid,
              role: uid === creatorId ? Role.ADMIN : Role.MEMBER,
            })),
          },
        },
      });
      targetConversationId = splitGroup.id;
      splitGroupId = splitGroup.id;
    }

    // Create ExpenseSplit & ExpenseParticipant records in DB
    const expense = await this.prisma.expenseSplit.create({
      data: {
        createdBy: creatorId,
        paidBy: payerId,
        title: dto.title.trim(),
        totalAmount: new Prisma.Decimal(totalAmount),
        currency: dto.currency || 'INR',
        splitType: splitType,
        category: (dto.category || 'OTHER').toUpperCase(),
        conversationId: splitGroupId ? null : targetConversationId,
        splitGroupId: splitGroupId,
        isOngoingGroup: Boolean(dto.isOngoingGroup),
        status: 'ACTIVE',
        participants: {
          create: participantAmounts.map((p) => ({
            userId: p.userId,
            amountOwed: new Prisma.Decimal(p.amountOwed),
            shareValue: p.shareValue !== undefined ? new Prisma.Decimal(p.shareValue) : null,
            // Payer's own share is marked paid upfront
            isPaid: p.userId === payerId,
            paidAt: p.userId === payerId ? new Date() : null,
          })),
        },
      },
      include: {
        participants: {
          include: {
            user: {
              select: { id: true, displayName: true, phoneNumber: true, avatarUrl: true },
            },
          },
        },
        creator: {
          select: { id: true, displayName: true, phoneNumber: true, avatarUrl: true },
        },
        payer: {
          select: { id: true, displayName: true, phoneNumber: true, avatarUrl: true },
        },
      },
    });

    // If splitGroup was created, link back splitExpenseId
    if (splitGroupId) {
      await this.prisma.conversation.update({
        where: { id: splitGroupId },
        data: { splitExpenseId: expense.id },
      });
    }

    // Post SYSTEM message into conversation
    const creatorName = expense.creator.displayName || expense.creator.phoneNumber || 'Someone';
    const systemText = splitGroupId
      ? `Split created: ${expense.title} — ₹${totalAmount} split among ${allMemberIds.length} people`
      : `Split created: ${expense.title} — ₹${totalAmount} between you and ${creatorName}`;

    const serverMsgId = `sys_split_${expense.id}_${Date.now()}`;
    const senderDeviceId = await this.getOrCreateSenderDeviceId(creatorId);
    const sysMsg = await this.prisma.message
      .create({
        data: {
          id: serverMsgId,
          conversationId: targetConversationId,
          senderId: creatorId,
          senderDeviceId,
          type: MessageType.SYSTEM,
          status: DeliveryStatus.DELIVERED,
          ciphertexts: { system: true, text: systemText, expenseId: expense.id } as any,
        },
      })
      .catch((err) => {
        this.logger.warn(`Failed to insert system message in DB: ${err.message}`);
        return null;
      });

    // Broadcast socket events
    const msgPayload = {
      id: sysMsg?.id || serverMsgId,
      serverMessageId: sysMsg?.id || serverMsgId,
      conversationId: targetConversationId,
      senderId: creatorId,
      type: 'SYSTEM',
      status: 'DELIVERED',
      text: systemText,
      createdAt: new Date().toISOString(),
      expenseId: expense.id,
    };

    this.chatGateway.broadcastToUsers(allMemberIds, EVT_MESSAGE_NEW, msgPayload);
    this.chatGateway.broadcastToUsers(allMemberIds, 'expense:created', {
      expenseId: expense.id,
      conversationId: targetConversationId,
      title: expense.title,
      totalAmount,
      currency: expense.currency,
      splitGroupId,
      isSplitGroup: !!splitGroupId,
    });

    if (isNewGroup) {
      this.chatGateway.broadcastToUsers(allMemberIds, 'conversation:new', {
        id: targetConversationId,
        type: 'GROUP',
        title: `${dto.title.trim()} - Split`,
        isSplitGroup: true,
        splitExpenseId: expense.id,
      });
    }

    return {
      success: true,
      expense,
      conversationId: targetConversationId,
      isSplitGroup: !!splitGroupId,
    };
  }

  /**
   * Mark a participant's share as paid
   * Can be performed by the participant themselves OR by the creator ("Cash mein le liya")
   */
  async markParticipantPaid(currentUserId: string, expenseId: string, targetUserId: string) {
    const callerId = (await this.resolveUserId(currentUserId)) || currentUserId;
    const resolvedTargetId = (await this.resolveUserId(targetUserId)) || targetUserId;

    const expense = await this.prisma.expenseSplit.findUnique({
      where: { id: expenseId },
      include: {
        participants: {
          include: {
            user: { select: { id: true, displayName: true, phoneNumber: true } },
          },
        },
        splitGroup: {
          include: { members: true },
        },
        creator: {
          select: { id: true, displayName: true, phoneNumber: true },
        },
      },
    });

    if (!expense) {
      throw new NotFoundException('Expense split not found');
    }

    // Authorization: only targetUser themselves or expense creator can mark as paid
    if (callerId !== resolvedTargetId && callerId !== expense.createdBy) {
      throw new ForbiddenException(
        'Only the participant themselves or the split creator can mark this share as paid',
      );
    }

    const participant = expense.participants.find((p) => p.userId === resolvedTargetId);
    if (!participant) {
      throw new NotFoundException('Participant not found in this expense split');
    }

    if (participant.isPaid) {
      return { success: true, alreadyPaid: true, expense };
    }

    // Update participant as paid
    const updatedParticipant = await this.prisma.expenseParticipant.update({
      where: {
        expenseSplitId_userId: {
          expenseSplitId: expenseId,
          userId: resolvedTargetId,
        },
      },
      data: {
        isPaid: true,
        paidAt: new Date(),
      },
      include: {
        user: { select: { id: true, displayName: true, phoneNumber: true, avatarUrl: true } },
      },
    });

    // Post SYSTEM message: "[Name] paid their share (₹[amount]) ✅"
    const targetName =
      updatedParticipant.user.displayName || updatedParticipant.user.phoneNumber || 'Participant';
    const systemText = `${targetName} paid their share (₹${participant.amountOwed}) ✅`;

    const convId = expense.splitGroupId || expense.conversationId;
    const allMemberIds = expense.participants.map((p) => p.userId);

    if (convId) {
      const serverMsgId = `sys_paid_${expense.id}_${resolvedTargetId}_${Date.now()}`;
      const senderDeviceId = await this.getOrCreateSenderDeviceId(callerId);
      await this.prisma.message
        .create({
          data: {
            id: serverMsgId,
            conversationId: convId,
            senderId: callerId,
            senderDeviceId,
            type: MessageType.SYSTEM,
            status: DeliveryStatus.DELIVERED,
            ciphertexts: { system: true, text: systemText, expenseId: expense.id } as any,
          },
        })
        .catch(() => {});

      this.chatGateway.broadcastToUsers(allMemberIds, EVT_MESSAGE_NEW, {
        id: serverMsgId,
        serverMessageId: serverMsgId,
        conversationId: convId,
        senderId: callerId,
        type: 'SYSTEM',
        status: 'DELIVERED',
        text: systemText,
        createdAt: new Date().toISOString(),
        expenseId: expense.id,
      });
    }

    // Check if ALL participants are now paid
    const remainingUnpaid = expense.participants.filter(
      (p) => p.userId !== resolvedTargetId && !p.isPaid,
    );

    let isFullySettled = false;
    let autoDeleteAt: Date | null = null;

    if (remainingUnpaid.length === 0) {
      isFullySettled = true;
      const gracePeriodMs = process.env.DEBUG_SPLIT_AUTO_DELETE_SECONDS
        ? Number(process.env.DEBUG_SPLIT_AUTO_DELETE_SECONDS) * 1000
        : 24 * 60 * 60 * 1000;
      autoDeleteAt =
        expense.splitGroupId && !expense.isOngoingGroup
          ? new Date(Date.now() + gracePeriodMs)
          : null;

      await this.prisma.expenseSplit.update({
        where: { id: expenseId },
        data: {
          status: 'SETTLED',
          settledAt: new Date(),
          autoDeleteAt: autoDeleteAt,
        },
      });

      // Post final settlement message in group
      if (convId) {
        const settleMsgText =
          expense.splitGroupId && !expense.isOngoingGroup
            ? '🎉 All settled! This split group will be removed in 24 hours.'
            : '🎉 All settled! Everyone has cleared their shares.';

        const settleMsgId = `sys_settle_${expense.id}_${Date.now()}`;
        const senderDeviceId = await this.getOrCreateSenderDeviceId(callerId);
        await this.prisma.message
          .create({
            data: {
              id: settleMsgId,
              conversationId: convId,
              senderId: callerId,
              senderDeviceId,
              type: MessageType.SYSTEM,
              status: DeliveryStatus.DELIVERED,
              ciphertexts: { system: true, text: settleMsgText, expenseId: expense.id } as any,
            },
          })
          .catch(() => {});

        this.chatGateway.broadcastToUsers(allMemberIds, EVT_MESSAGE_NEW, {
          id: settleMsgId,
          serverMessageId: settleMsgId,
          conversationId: convId,
          senderId: callerId,
          type: 'SYSTEM',
          status: 'DELIVERED',
          text: settleMsgText,
          createdAt: new Date().toISOString(),
          expenseId: expense.id,
        });

        this.chatGateway.broadcastToUsers(allMemberIds, 'expense:settled', {
          expenseId: expense.id,
          conversationId: convId,
          autoDeleteAt: autoDeleteAt?.toISOString() || null,
        });
      }
    }

    // Emit updated expense state to all members
    this.chatGateway.broadcastToUsers(allMemberIds, 'expense:updated', {
      expenseId: expense.id,
      paidUserId: resolvedTargetId,
      isFullySettled,
      autoDeleteAt: autoDeleteAt?.toISOString() || null,
    });

    return {
      success: true,
      participant: updatedParticipant,
      isFullySettled,
      autoDeleteAt,
    };
  }

  /**
   * Send a payment reminder to unpaid participants
   */
  async remindUnpaidParticipants(currentUserId: string, expenseId: string) {
    const callerId = (await this.resolveUserId(currentUserId)) || currentUserId;

    const expense = await this.prisma.expenseSplit.findUnique({
      where: { id: expenseId },
      include: {
        participants: {
          include: {
            user: { select: { id: true, displayName: true, phoneNumber: true } },
          },
        },
      },
    });

    if (!expense) {
      throw new NotFoundException('Expense split not found');
    }

    if (callerId !== expense.createdBy) {
      throw new ForbiddenException('Only the split creator can send payment reminders');
    }

    const unpaidParticipants = expense.participants.filter((p) => !p.isPaid);
    if (unpaidParticipants.length === 0) {
      throw new BadRequestException('All participants have already paid!');
    }

    const unpaidTotal = unpaidParticipants.reduce((sum, p) => sum + Number(p.amountOwed), 0);
    const unpaidNames = unpaidParticipants
      .map((p) => p.user.displayName || p.user.phoneNumber || 'User')
      .join(', ');

    const reminderText = `🔔 Reminder: ₹${unpaidTotal.toFixed(2)} is pending from ${unpaidNames} for "${expense.title}"`;
    const convId = expense.splitGroupId || expense.conversationId;
    const allMemberIds = expense.participants.map((p) => p.userId);

    if (convId) {
      const serverMsgId = `sys_remind_${expense.id}_${Date.now()}`;
      const senderDeviceId = await this.getOrCreateSenderDeviceId(callerId);
      await this.prisma.message
        .create({
          data: {
            id: serverMsgId,
            conversationId: convId,
            senderId: callerId,
            senderDeviceId,
            type: MessageType.SYSTEM,
            status: DeliveryStatus.DELIVERED,
            ciphertexts: { system: true, text: reminderText, expenseId: expense.id } as any,
          },
        })
        .catch(() => {});

      this.chatGateway.broadcastToUsers(allMemberIds, EVT_MESSAGE_NEW, {
        id: serverMsgId,
        serverMessageId: serverMsgId,
        conversationId: convId,
        senderId: callerId,
        type: 'SYSTEM',
        status: 'DELIVERED',
        text: reminderText,
        createdAt: new Date().toISOString(),
        expenseId: expense.id,
      });
    }

    return {
      success: true,
      unpaidCount: unpaidParticipants.length,
      reminderText,
    };
  }

  /**
   * Get Hisaab History: all active and settled splits with financial summaries
   * Optionally filtered by category
   */
  async getExpenseHistory(currentUserId: string, category?: string) {
    const userId = (await this.resolveUserId(currentUserId)) || currentUserId;

    const where: Prisma.ExpenseSplitWhereInput = {
      OR: [{ createdBy: userId }, { paidBy: userId }, { participants: { some: { userId } } }],
    };

    if (category && category !== 'ALL') {
      where.category = category.toUpperCase();
    }

    const splits = await this.prisma.expenseSplit.findMany({
      where,
      include: {
        creator: {
          select: { id: true, displayName: true, phoneNumber: true, avatarUrl: true },
        },
        payer: {
          select: { id: true, displayName: true, phoneNumber: true, avatarUrl: true },
        },
        participants: {
          include: {
            user: {
              select: { id: true, displayName: true, phoneNumber: true, avatarUrl: true },
            },
          },
        },
        conversation: {
          select: { id: true, title: true, type: true },
        },
        splitGroup: {
          select: { id: true, title: true, type: true, isSplitGroup: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Calculate totals
    let totalOwedByMe = 0;
    let totalOwedToMe = 0;
    let activeCount = 0;
    let settledCount = 0;

    for (const split of splits) {
      if (split.status === 'ACTIVE') {
        activeCount++;
      } else {
        settledCount++;
      }

      const payerId = split.paidBy || split.createdBy;
      if (payerId === userId) {
        // Current user paid: others owe current user for unpaid shares
        for (const p of split.participants) {
          if (p.userId !== userId && !p.isPaid) {
            totalOwedToMe += Number(p.amountOwed);
          }
        }
      } else {
        // Someone else paid: check if current user has an unpaid share
        const myPart = split.participants.find((p) => p.userId === userId);
        if (myPart && !myPart.isPaid) {
          totalOwedByMe += Number(myPart.amountOwed);
        }
      }
    }

    return {
      splits,
      summary: {
        totalOwedByMe: Number(totalOwedByMe.toFixed(2)),
        totalOwedToMe: Number(totalOwedToMe.toFixed(2)),
        activeCount,
        settledCount,
        totalCount: splits.length,
      },
    };
  }

  /**
   * Get overall pairwise net balances ("Simplify Debts") for current user
   * Aggregates unpaid splits and direct bilateral settlements
   */
  async getNetBalances(currentUserId: string) {
    const userId = (await this.resolveUserId(currentUserId)) || currentUserId;

    // 1. Fetch all active splits involving this user
    const activeSplits = await this.prisma.expenseSplit.findMany({
      where: {
        status: 'ACTIVE',
        OR: [{ createdBy: userId }, { paidBy: userId }, { participants: { some: { userId } } }],
      },
      include: {
        participants: {
          include: {
            user: { select: { id: true, displayName: true, phoneNumber: true, avatarUrl: true } },
          },
        },
        payer: { select: { id: true, displayName: true, phoneNumber: true, avatarUrl: true } },
        creator: { select: { id: true, displayName: true, phoneNumber: true, avatarUrl: true } },
      },
    });

    // Map of otherUserId -> accumulator
    const balanceMap = new Map<
      string,
      {
        user: {
          id: string;
          displayName: string | null;
          phoneNumber: string;
          avatarUrl: string | null;
        };
        netBalance: number;
        owedToUser: number;
        userOwes: number;
        activeSplitsCount: number;
      }
    >();

    const getOrCreateEntry = (u: {
      id: string;
      displayName: string | null;
      phoneNumber: string;
      avatarUrl: string | null;
    }) => {
      if (!balanceMap.has(u.id)) {
        balanceMap.set(u.id, {
          user: u,
          netBalance: 0,
          owedToUser: 0,
          userOwes: 0,
          activeSplitsCount: 0,
        });
      }
      return balanceMap.get(u.id)!;
    };

    for (const split of activeSplits) {
      const payerId = split.paidBy || split.createdBy;
      const payerUser = split.payer || split.creator;

      if (payerId === userId) {
        // Current user paid: other unpaid participants owe current user
        for (const p of split.participants) {
          if (p.userId !== userId && !p.isPaid) {
            const entry = getOrCreateEntry(p.user);
            const amt = Number(p.amountOwed);
            entry.owedToUser += amt;
            entry.netBalance += amt;
            entry.activeSplitsCount++;
          }
        }
      } else {
        // Someone else paid: check if current user owes them
        const myPart = split.participants.find((p) => p.userId === userId);
        if (myPart && !myPart.isPaid && payerUser) {
          const entry = getOrCreateEntry(payerUser);
          const amt = Number(myPart.amountOwed);
          entry.userOwes += amt;
          entry.netBalance -= amt;
          entry.activeSplitsCount++;
        }
      }
    }

    // 2. Fetch settlements involving current user (ALL time, not just last 20)
    // These represent money that has already been exchanged outside of split records.
    // We APPLY them to netBalance so the UI shows remaining debt after settlements.
    const settlements = await this.prisma.expenseSettlement.findMany({
      where: {
        OR: [{ payerId: userId }, { receiverId: userId }],
      },
      include: {
        payer: { select: { id: true, displayName: true, phoneNumber: true, avatarUrl: true } },
        receiver: { select: { id: true, displayName: true, phoneNumber: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // Apply direct settlements to balance map so net balances reflect actual money owed
    // after any cash/UPI payments that happened outside of split records.
    for (const s of settlements) {
      const amt = Number(s.amount);
      if (s.payerId === userId) {
        // I paid someone — reduces what I owe them
        const otherUser = s.receiver;
        if (otherUser && balanceMap.has(otherUser.id)) {
          const entry = balanceMap.get(otherUser.id)!;
          entry.netBalance += amt; // was negative (I owe), now less negative
          entry.userOwes = Math.max(0, entry.userOwes - amt);
        }
      } else if (s.receiverId === userId) {
        // Someone paid me — reduces what they owe me
        const otherUser = s.payer;
        if (otherUser && balanceMap.has(otherUser.id)) {
          const entry = balanceMap.get(otherUser.id)!;
          entry.netBalance -= amt; // was positive (they owe), now less positive
          entry.owedToUser = Math.max(0, entry.owedToUser - amt);
        }
      }
    }

    // Recent settlements for display in the UI (last 20)
    const recentSettlements = settlements.slice(0, 20);

    // Format list of contact balances
    const balances = Array.from(balanceMap.values())
      .map((entry) => {
        const net = Number(entry.netBalance.toFixed(2));
        return {
          user: entry.user,
          netBalance: net,
          status: net > 0 ? 'OWES_YOU' : net < 0 ? 'YOU_OWE' : 'SETTLED',
          amount: Math.abs(net),
          owedToUser: Number(entry.owedToUser.toFixed(2)),
          userOwes: Number(entry.userOwes.toFixed(2)),
          activeSplitsCount: entry.activeSplitsCount,
        };
      })
      .filter((b) => b.amount > 0);

    let totalYouAreOwed = 0;
    let totalYouOwe = 0;

    for (const b of balances) {
      if (b.status === 'OWES_YOU') totalYouAreOwed += b.amount;
      if (b.status === 'YOU_OWE') totalYouOwe += b.amount;
    }

    const netTotal = Number((totalYouAreOwed - totalYouOwe).toFixed(2));

    return {
      balances,
      summary: {
        totalYouAreOwed: Number(totalYouAreOwed.toFixed(2)),
        totalYouOwe: Number(totalYouOwe.toFixed(2)),
        netTotal,
      },
      recentSettlements: recentSettlements,
    };
  }

  /**
   * Record a direct bilateral settlement with a specific contact ("Settle Up")
   * Clears unpaid participant records between the pair and broadcasts updates
   */
  async settleUpDirect(currentUserId: string, dto: SettleUpDto) {
    const payerId = (await this.resolveUserId(currentUserId)) || currentUserId;
    const receiverId = (await this.resolveUserId(dto.targetUserId)) || dto.targetUserId;

    if (payerId === receiverId) {
      throw new BadRequestException('Cannot settle up with yourself');
    }

    const receiverUser = await this.prisma.user.findUnique({
      where: { id: receiverId },
      select: { id: true, displayName: true, phoneNumber: true },
    });
    if (!receiverUser) {
      throw new NotFoundException('Receiver user not found');
    }

    const payerUser = await this.prisma.user.findUnique({
      where: { id: payerId },
      select: { id: true, displayName: true, phoneNumber: true },
    });

    const settleAmount = Number(dto.amount);
    if (isNaN(settleAmount) || settleAmount <= 0) {
      throw new BadRequestException('Valid settlement amount is required');
    }

    // 1. Create ExpenseSettlement record
    const settlement = await this.prisma.expenseSettlement.create({
      data: {
        payerId,
        receiverId,
        amount: new Prisma.Decimal(settleAmount),
        currency: dto.currency || 'INR',
        notes: dto.notes?.trim() || null,
      },
      include: {
        payer: { select: { id: true, displayName: true, phoneNumber: true, avatarUrl: true } },
        receiver: { select: { id: true, displayName: true, phoneNumber: true, avatarUrl: true } },
      },
    });

    // 2. Clear unpaid participant shares where receiver paid and payer owes
    let remainingToClear = settleAmount;
    const debtsToClear = await this.prisma.expenseSplit.findMany({
      where: {
        status: 'ACTIVE',
        paidBy: receiverId,
        participants: {
          some: {
            userId: payerId,
            isPaid: false,
          },
        },
      },
      include: {
        participants: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    for (const split of debtsToClear) {
      if (remainingToClear <= 0) break;
      const myPart = split.participants.find((p) => p.userId === payerId && !p.isPaid);
      if (!myPart) continue;

      const owed = Number(myPart.amountOwed);
      if (remainingToClear >= owed - 0.05) {
        // Mark fully paid
        await this.prisma.expenseParticipant.update({
          where: {
            expenseSplitId_userId: {
              expenseSplitId: split.id,
              userId: payerId,
            },
          },
          data: {
            isPaid: true,
            paidAt: new Date(),
          },
        });
        remainingToClear -= owed;

        // Check if all participants in this split are now paid
        const otherUnpaid = split.participants.filter((p) => p.userId !== payerId && !p.isPaid);
        if (otherUnpaid.length === 0) {
          const autoDeleteAt =
            !split.isOngoingGroup && split.splitGroupId
              ? new Date(Date.now() + 24 * 60 * 60 * 1000)
              : null;

          await this.prisma.expenseSplit.update({
            where: { id: split.id },
            data: {
              status: 'SETTLED',
              settledAt: new Date(),
              autoDeleteAt,
            },
          });
        }
      }
    }

    // 3. Post system message to direct conversation if one exists
    const directConv = await this.prisma.conversation.findFirst({
      where: {
        type: ConversationType.DIRECT,
        members: {
          every: {
            userId: { in: [payerId, receiverId] },
          },
        },
      },
    });

    const payerName = payerUser?.displayName || payerUser?.phoneNumber || 'Payer';
    const receiverName = receiverUser?.displayName || receiverUser?.phoneNumber || 'Receiver';
    const systemText = `🤝 ${payerName} settled ₹${settleAmount} with ${receiverName}`;

    if (directConv) {
      const serverMsgId = `sys_settle_${settlement.id}_${Date.now()}`;
      const senderDeviceId = await this.getOrCreateSenderDeviceId(payerId);
      await this.prisma.message
        .create({
          data: {
            id: serverMsgId,
            conversationId: directConv.id,
            senderId: payerId,
            senderDeviceId,
            type: MessageType.SYSTEM,
            status: DeliveryStatus.DELIVERED,
            ciphertexts: { system: true, text: systemText, settlementId: settlement.id } as any,
          },
        })
        .catch(() => {});

      this.chatGateway.broadcastToUsers([payerId, receiverId], EVT_MESSAGE_NEW, {
        id: serverMsgId,
        serverMessageId: serverMsgId,
        conversationId: directConv.id,
        senderId: payerId,
        type: 'SYSTEM',
        status: 'DELIVERED',
        text: systemText,
        createdAt: new Date().toISOString(),
      });
    }

    // Broadcast settlement event
    this.chatGateway.broadcastToUsers([payerId, receiverId], 'expense:settlement', {
      settlementId: settlement.id,
      payerId,
      receiverId,
      amount: settleAmount,
      currency: settlement.currency,
      payerName,
      receiverName,
    });

    return {
      success: true,
      settlement,
      message: systemText,
    };
  }

  /**
   * Get single expense details by ID
   */
  async getExpenseById(currentUserId: string, expenseId: string) {
    const userId = (await this.resolveUserId(currentUserId)) || currentUserId;

    const split = await this.prisma.expenseSplit.findUnique({
      where: { id: expenseId },
      include: {
        creator: {
          select: { id: true, displayName: true, phoneNumber: true, avatarUrl: true },
        },
        participants: {
          include: {
            user: {
              select: { id: true, displayName: true, phoneNumber: true, avatarUrl: true },
            },
          },
        },
        conversation: {
          select: { id: true, title: true, type: true },
        },
        splitGroup: {
          select: { id: true, title: true, type: true, isSplitGroup: true },
        },
      },
    });

    if (!split) {
      throw new NotFoundException('Expense split not found');
    }

    return split;
  }

  /**
   * Execute auto-deletion of settled split group conversation
   * Called by background cron when autoDeleteAt <= now()
   */
  async executeAutoDelete(splitId: string) {
    const split = await this.prisma.expenseSplit.findUnique({
      where: { id: splitId },
      include: {
        splitGroup: {
          include: { members: true },
        },
      },
    });

    if (!split) {
      return { skipped: true };
    }

    let splitGroupId = split.splitGroupId;
    let memberIds = split.splitGroup?.members.map((m) => m.userId) || [];

    // Also look up by splitExpenseId or conversationId if splitGroupId is not directly set
    if (!splitGroupId) {
      const conv = await this.prisma.conversation.findFirst({
        where: {
          isSplitGroup: true,
          OR: [{ splitExpenseId: splitId }, { id: split.conversationId || undefined }],
        },
        include: { members: true },
      });
      if (conv) {
        splitGroupId = conv.id;
        memberIds = conv.members.map((m) => m.userId);
      }
    }

    if (!splitGroupId) {
      return { skipped: true };
    }

    this.logger.log(
      `🗑️ Auto-deleting settled split group ${splitGroupId} for expense "${split.title}"`,
    );

    // 1. Unlink splitGroupId from ExpenseSplit so foreign key doesn't block cascade
    await this.prisma.expenseSplit.update({
      where: { id: split.id },
      data: {
        splitGroupId: null,
        ...(split.conversationId === splitGroupId ? { conversationId: null } : {}),
      },
    });

    // 2. Clear splitExpenseId on Conversation
    await this.prisma.conversation
      .update({
        where: { id: splitGroupId },
        data: { splitExpenseId: null },
      })
      .catch(() => {});

    // 3. Delete the temporary group conversation (cascades messages and members)
    await this.prisma.conversation.delete({
      where: { id: splitGroupId },
    });

    // 4. Emit conversation:deleted event to all members so mobile removes it from local SQLite
    this.chatGateway.broadcastToUsers(memberIds, 'conversation:deleted', {
      conversationId: splitGroupId,
      reason: 'SPLIT_SETTLED_AUTO_DELETED',
      expenseTitle: split.title,
    });

    return { success: true, deletedConversationId: splitGroupId };
  }
}
