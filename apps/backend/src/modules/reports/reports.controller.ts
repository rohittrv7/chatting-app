import { Controller, Post, Get, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ReportsService, CreateReportDto } from './reports.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/user.decorator';

@ApiTags('Reports & Moderation')
@Controller('reports')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post()
  @ApiOperation({ summary: 'Submit a message report for content moderation' })
  async createReport(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateReportDto) {
    return this.reportsService.createReport(user.userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List submitted reports (for moderators)' })
  async listReports(@Query('limit') limit?: number) {
    return this.reportsService.listReports(limit ? Number(limit) : 50);
  }
}
