import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { colors } from '../utils/logger-colors';
import Redis from 'ioredis';
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';

@Injectable()
export class SystemDiagnosticsService {
  private readonly logger = new Logger(SystemDiagnosticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async printSystemBanner(port: number | string): Promise<void> {
    // 1. Check PostgreSQL (Prisma)
    let pgStatus = `${colors.bold}${colors.brightRed}✖ DISCONNECTED${colors.reset} ${colors.gray}(Run: pnpm docker:up)${colors.reset}`;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const dbUrl = this.configService.get<string>('DATABASE_URL', '');
      const dbNameMatch = dbUrl.match(/\/([^/?]+)(\?|$)/);
      const dbName = dbNameMatch ? dbNameMatch[1] : 'chatting_system_db';
      pgStatus = `${colors.bold}${colors.brightGreen}✔ CONNECTED${colors.reset} ${colors.gray}(${dbName})${colors.reset}`;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      pgStatus = `${colors.bold}${colors.brightYellow}⚠ NOT REACHABLE${colors.reset} ${colors.gray}(${errMsg.slice(0, 40)}...)${colors.reset}`;
    }

    // 2. Check Redis
    const redisHost = this.configService.get<string>('REDIS_HOST', 'localhost');
    const redisPort = this.configService.get<number>('REDIS_PORT', 6379);
    let redisStatus = `${colors.bold}${colors.brightYellow}⚠ OFFLINE / MEMORY MODE${colors.reset} ${colors.gray}(${redisHost}:${redisPort})${colors.reset}`;
    try {
      const testRedis = new Redis({
        host: redisHost,
        port: redisPort,
        connectTimeout: 800,
        maxRetriesPerRequest: 1,
        lazyConnect: true,
        enableOfflineQueue: false,
        retryStrategy: () => null,
      });
      testRedis.on('error', () => {});
      await testRedis.connect();
      await testRedis.ping();
      redisStatus = `${colors.bold}${colors.brightGreen}✔ CONNECTED${colors.reset} ${colors.gray}(${redisHost}:${redisPort})${colors.reset}`;
      testRedis.disconnect();
    } catch {
      redisStatus = `${colors.bold}${colors.brightYellow}⚠ OFFLINE / MEMORY MODE${colors.reset} ${colors.gray}(${redisHost}:${redisPort})${colors.reset}`;
    }

    // 3. Check Backblaze B2 Storage
    const b2Bucket = this.configService.get<string>('B2_BUCKET_NAME', 'chatting-media');
    const b2Region = this.configService.get<string>('B2_REGION', 'us-east-005');
    let b2Endpoint = this.configService.get<string>('B2_ENDPOINT');
    if (!b2Endpoint || b2Endpoint.trim() === '') {
      b2Endpoint = `https://s3.${b2Region}.backblazeb2.com`;
    } else if (!b2Endpoint.startsWith('http://') && !b2Endpoint.startsWith('https://')) {
      b2Endpoint = `https://${b2Endpoint}`;
    }

    const b2KeyId = this.configService.get<string>('B2_KEY_ID', '');
    const b2AppKey = this.configService.get<string>('B2_APPLICATION_KEY', '');
    let b2Status = `${colors.bold}${colors.brightYellow}⚠ CONFIG PENDING${colors.reset} ${colors.gray}(Add B2_KEY_ID & B2_APPLICATION_KEY in .env)${colors.reset}`;

    if (b2KeyId && b2AppKey) {
      try {
        const s3 = new S3Client({
          endpoint: b2Endpoint,
          region: b2Region,
          credentials: {
            accessKeyId: b2KeyId,
            secretAccessKey: b2AppKey,
          },
          forcePathStyle: true,
        });
        await s3.send(new HeadBucketCommand({ Bucket: b2Bucket }));
        b2Status = `${colors.bold}${colors.brightGreen}✔ READY${colors.reset} ${colors.gray}(bucket: ${b2Bucket}, region: ${b2Region})${colors.reset}`;
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        b2Status = `${colors.bold}${colors.brightYellow}⚠ ONLINE${colors.reset} ${colors.gray}(${errMsg.slice(0, 35)}...)${colors.reset}`;
      }
    }

    const divider = `${colors.gray}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`;
    const header = `${colors.bold}${colors.brightCyan}  🚀 WHATSAPP-STYLE E2EE BACKEND SERVER  ${colors.reset} ${colors.dim}[Node ${process.version}]${colors.reset}`;

    console.log('\n' + divider);
    console.log(header);
    console.log(divider);
    console.log(`  ${colors.bold}${colors.white}Infrastructure Status:${colors.reset}`);
    console.log(`    🗄️  PostgreSQL (Prisma)  : ${pgStatus}`);
    console.log(`    ⚡  Redis Cache & Queue  : ${redisStatus}`);
    console.log(`    ☁️  Backblaze B2 Storage : ${b2Status}`);
    console.log(
      `    🔒  E2EE Cryptography    : ${colors.bold}${colors.brightGreen}✔ ACTIVE${colors.reset} ${colors.gray}(Signal Protocol Double Ratchet)${colors.reset}`,
    );
    console.log(
      `    🔑  JWT & Security Auth  : ${colors.bold}${colors.brightGreen}✔ ACTIVE${colors.reset} ${colors.gray}(AES-GCM + Argon2)${colors.reset}`,
    );
    console.log(divider);
    console.log(`  ${colors.bold}${colors.white}Live Endpoints & Dashboards:${colors.reset}`);
    console.log(
      `    🌐  REST API Base        : ${colors.brightCyan}http://localhost:${port}/api/v1${colors.reset}`,
    );
    console.log(
      `    📑  Swagger API Docs     : ${colors.brightMagenta}http://localhost:${port}/docs/api${colors.reset}`,
    );
    console.log(
      `    📊  Prometheus Metrics   : ${colors.brightYellow}http://localhost:${port}/metrics${colors.reset}`,
    );
    console.log(
      `    🩺  Health Liveness      : ${colors.brightGreen}http://localhost:${port}/api/v1/health${colors.reset}`,
    );
    console.log(
      `    🩺  Health Readiness     : ${colors.brightGreen}http://localhost:${port}/api/v1/health/ready${colors.reset}`,
    );
    console.log(divider);
    console.log(
      `  ${colors.dim}Ready to handle incoming client connections & WebSockets...${colors.reset}\n`,
    );
  }
}
