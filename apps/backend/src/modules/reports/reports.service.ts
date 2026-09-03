import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface CreateReportDto {
  messageId?: string;
  reportedUserId: string;
  messageContent: string;
  reason: string;
  contextMessages?: any[];
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async createReport(reporterId: string, dto: CreateReportDto) {
    if (!dto.reportedUserId || !dto.messageContent || !dto.reason) {
      throw new BadRequestException('reportedUserId, messageContent, and reason are required');
    }

    // Resolve reported user
    const cleanId = (dto.reportedUserId || '').replace(/^@+/, '');
    const clean10 = cleanId.replace(/\D/g, '').slice(-10);
    const targetUser = await this.prisma.user.findFirst({
      where: {
        OR: [
          { id: dto.reportedUserId },
          { username: { equals: cleanId, mode: 'insensitive' } },
          ...(clean10
            ? [
                { phoneNumber: clean10 },
                { phoneNumber: `+91${clean10}` },
                { phoneNumber: `+${clean10}` },
                { phoneNumber: `91${clean10}` },
              ]
            : []),
          { phoneNumber: cleanId },
        ],
      },
    });

    if (!targetUser) {
      throw new BadRequestException('Reported user not found');
    }

    const report = await this.prisma.report.create({
      data: {
        reporterId,
        reportedUserId: targetUser.id,
        messageId: dto.messageId,
        messageContent: dto.messageContent,
        reason: dto.reason,
        contextMessages: dto.contextMessages ? (dto.contextMessages as any) : undefined,
        status: 'pending',
      },
    });

    return {
      success: true,
      reportId: report.id,
      message: 'Report submitted successfully for moderation review',
    };
  }

  async listReports(limit = 50) {
    return this.prisma.report.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        reporter: {
          select: { id: true, displayName: true, username: true, phoneNumber: true },
        },
        reportedUser: {
          select: { id: true, displayName: true, username: true, phoneNumber: true },
        },
      },
    });
  }
}
