import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { PrometheusInterceptor } from './modules/observability/prometheus.interceptor';
import { PrismaService } from './database/prisma.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // Suppress default NestJS logger — pino (via nestjs-pino LoggerModule) takes over
    bufferLogs: true,
  });

  // Bind pino as the global NestJS logger (Requirement 23.6)
  app.useLogger(app.get(Logger));
  app.flushLogs();

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // PrometheusInterceptor tracks request count + duration (Requirement 23.3)
  app.useGlobalInterceptors(
    app.get(PrometheusInterceptor),
    new TransformInterceptor(),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  app.enableCors({ origin: '*' });

  const config = new DocumentBuilder()
    .setTitle('WhatsApp-Style Messaging & Calling API')
    .setDescription('Production-grade E2EE Chat, Calling, and Signaling Backend')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs/api', app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  const logger = app.get(Logger);
  logger.log(`Backend server running on http://localhost:${port}/api/v1`, 'Bootstrap');
  logger.log(`Swagger documentation available at http://localhost:${port}/docs/api`, 'Bootstrap');
  logger.log(`Prometheus metrics available at http://localhost:${port}/metrics`, 'Bootstrap');

  // Register graceful shutdown hooks — on SIGTERM/SIGINT, PrismaService will
  // call app.close() which triggers onModuleDestroy → $disconnect().
  // Satisfies Requirement 39.5.
  const prismaService = app.get(PrismaService);
  prismaService.enableShutdownHooks(app);
}

bootstrap();
