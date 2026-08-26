import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { PrometheusInterceptor } from './modules/observability/prometheus.interceptor';
import { PrismaService } from './database/prisma.service';
import { SystemDiagnosticsService } from './common/services/system-diagnostics.service';
import Redis from 'ioredis';

import { ColorfulLogger } from './common/services/colorful-logger.service';
import * as express from 'express';
import * as path from 'path';
import * as fs from 'fs';

// Safely absorb unhandled ioredis error events (from BullMQ/ioredis) when local Redis is offline
const originalRedisEmit = Redis.prototype.emit;
Redis.prototype.emit = function (this: unknown, event: string | symbol, ...args: unknown[]) {
  if (
    event === 'error' &&
    (this as { listenerCount: (ev: string | symbol) => number }).listenerCount(event) === 0
  ) {
    // Suppress unhandled EventEmitter crash dump
    return false;
  }
  return originalRedisEmit.apply(this, [event, ...args]);
};

// Gracefully suppress unhandled ECONNREFUSED spam when optional local Redis is offline
process.on('unhandledRejection', (reason: unknown) => {
  const msg = (reason as Error)?.message || String(reason);
  if (msg.includes('ECONNREFUSED') || (reason as { code?: string })?.code === 'ECONNREFUSED') {
    return;
  }
  console.error('[UnhandledRejection]', reason);
});

process.on('uncaughtException', (err: Error) => {
  const msg = err?.message || String(err);
  if (
    msg.includes('ECONNREFUSED') ||
    (err as { code?: string })?.code === 'ECONNREFUSED' ||
    err?.name === 'AggregateError'
  ) {
    return;
  }
  console.error('[UncaughtException]', err);
});

async function bootstrap() {
  const colorfulLogger = new ColorfulLogger();
  const app = await NestFactory.create(AppModule, {
    logger: colorfulLogger,
    bufferLogs: true,
  });

  app.useLogger(colorfulLogger);
  app.flushLogs();

  app.setGlobalPrefix('api/v1', {
    exclude: ['metrics', 'metrics/(.*)', '', '/'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // PrometheusInterceptor tracks request count + duration (Requirement 23.3)
  app.useGlobalInterceptors(app.get(PrometheusInterceptor), new TransformInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());

  app.enableCors({ origin: '*' });

  // Ensure uploads directories exist for static media and avatars
  const uploadsDir = path.join(process.cwd(), 'uploads');
  const avatarsDir = path.join(uploadsDir, 'avatars');
  const imagesDir = path.join(uploadsDir, 'images');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });
  if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

  app.use('/uploads', express.static(uploadsDir));
  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ extended: true, limit: '25mb' }));

  const config = new DocumentBuilder()
    .setTitle('WhatsApp-Style Messaging & Calling API')
    .setDescription('Production-grade E2EE Chat, Calling, and Signaling Backend')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs/api', app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');

  // Print rich colorful dashboard banner and live infrastructure connectivity status
  const diagnosticsService = app.get(SystemDiagnosticsService);
  await diagnosticsService.printSystemBanner(port);

  // Register graceful shutdown hooks — on SIGTERM/SIGINT, PrismaService will
  // call app.close() which triggers onModuleDestroy → $disconnect().
  // Satisfies Requirement 39.5.
  const prismaService = app.get(PrismaService);
  prismaService.enableShutdownHooks(app);
}

bootstrap();
