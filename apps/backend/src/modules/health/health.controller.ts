import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../../database/prisma.service';

@ApiTags('Health & Observability')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Liveness probe endpoint' })
  getLiveness() {
    return { status: 'up', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe checking database & service connectivity' })
  async getReadiness() {
    try {
      await this.prisma.ping();
      return {
        status: 'ready',
        checks: {
          database: 'healthy',
        },
        timestamp: new Date().toISOString(),
      };
    } catch {
      throw new ServiceUnavailableException('Database connectivity check failed');
    }
  }
}
