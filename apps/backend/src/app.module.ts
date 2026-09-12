import { MiddlewareConsumer, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AuthModule } from './modules/auth/auth.module';
import { KeyModule } from './modules/keys/key.module';
import { ConversationModule } from './modules/conversations/conversation.module';
import { MessageModule } from './modules/messages/message.module';
import { MediaModule } from './modules/media/media.module';
import { CallModule } from './modules/calls/call.module';
import { PresenceModule } from './modules/presence/presence.module';
import { SecurityModule } from './modules/security/security.module';
import { SecurityHeadersMiddleware } from './modules/security/security-headers.middleware';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { HttpLoggerMiddleware } from './common/middleware/http-logger.middleware';
import { SystemDiagnosticsService } from './common/services/system-diagnostics.service';
import { ObservabilityModule } from './modules/observability/observability.module';
import { ReportsModule } from './modules/reports/reports.module';
import { ExpenseModule } from './modules/expenses/expense.module';
import { PrismaModule } from './database/prisma.module';
import { AppController } from './app.controller';
import { HealthController } from './modules/health/health.controller';
import { MetricsController } from './modules/metrics/metrics.controller';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { LastActiveInterceptor } from './common/interceptors/last-active.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.example'],
    }),
    // FIX 3: ScheduleModule registers the NestJS task-scheduler that powers the
    // daily RefreshToken cleanup cron in TokenCleanupService (auth module).
    ScheduleModule.forRoot(),
    // FIX: ThrottlerModule registered globally so @Throttle() decorators work app-wide.
    // Auth-specific limits are applied via @Throttle() on individual controller methods.
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'otp',
          ttl: 10 * 60 * 1000, // 10 minutes
          limit: 10, // default; overridden per-endpoint with @Throttle()
        },
        {
          name: 'global',
          ttl: 60 * 1000, // 1 minute
          limit: 1000, // 1000 req/min for smooth dev experience without 429 rate limit errors
        },
      ],
    }),
    // ObservabilityModule is @Global() — exports OtelService and PrometheusInterceptor
    // to the entire application without additional imports.
    ObservabilityModule,
    PrismaModule,
    AuthModule,
    ReportsModule,
    KeyModule,
    ConversationModule,
    MessageModule,
    MediaModule,
    CallModule,
    PresenceModule,
    SecurityModule,
    ExpenseModule,
  ],
  controllers: [AppController, HealthController, MetricsController],
  providers: [
    SystemDiagnosticsService,
    // FIX: Global throttler guard — enforces rate limits defined in ThrottlerModule
    // and per-endpoint @Throttle() decorators across the entire application.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Global JWT guard — requires @Public() to bypass authentication
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Global interceptor — updates Device.lastActiveAt on authenticated requests
    { provide: APP_INTERCEPTOR, useClass: LastActiveInterceptor },
  ],
  exports: [SystemDiagnosticsService],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer): void {
    // RequestIdMiddleware must run first so every downstream handler,
    // filter, and interceptor can read req.requestId and the response header
    // is set before any other middleware writes to the response.
    consumer
      .apply(RequestIdMiddleware, HttpLoggerMiddleware, SecurityHeadersMiddleware)
      .forRoutes('*');
  }
}
