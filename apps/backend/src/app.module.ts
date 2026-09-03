import { MiddlewareConsumer, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
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
  ],
  controllers: [AppController, HealthController, MetricsController],
  providers: [
    SystemDiagnosticsService,
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
