import { Controller, Get, Head } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from './common/decorators/public.decorator';

@ApiTags('Root')
@Controller()
export class AppController {
  @Get()
  @Public()
  @ApiOperation({ summary: 'Root service health and metadata' })
  getRoot() {
    return {
      status: 'ok',
      service: 'WhatsApp-Style E2EE Chat Backend',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      endpoints: {
        health: '/api/v1/health',
        ready: '/api/v1/health/ready',
        docs: '/docs/api',
        metrics: '/metrics',
      },
    };
  }

  @Head()
  @Public()
  @ApiOperation({ summary: 'Render & Load Balancer HEAD probe' })
  headRoot() {
    return;
  }
}
