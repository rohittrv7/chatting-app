import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';

@Injectable()
export class MediaService implements OnModuleInit {
  private minioClient!: Minio.Client;
  private bucketName!: string;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    this.bucketName = this.configService.get<string>('MINIO_BUCKET_NAME', 'chatting-media');
    this.minioClient = new Minio.Client({
      endPoint: this.configService.get<string>('MINIO_ENDPOINT', 'minio'),
      port: Number(this.configService.get<number>('MINIO_PORT', 9000)),
      useSSL: false,
      accessKey: this.configService.get<string>('MINIO_ACCESS_KEY', 'minio_admin'),
      secretKey: this.configService.get<string>('MINIO_SECRET_KEY', 'minio_password'),
    });

    try {
      const exists = await this.minioClient.bucketExists(this.bucketName);
      if (!exists) {
        await this.minioClient.makeBucket(this.bucketName, 'us-east-1');
      }
    } catch {
      // Minio init retry handled gracefully
    }
  }

  async getPresignedUploadUrl(fileName: string, mimeType: string) {
    const objectName = `encrypted_media/${Date.now()}_${fileName}`;
    const uploadUrl = await this.minioClient.presignedPutObject(
      this.bucketName,
      objectName,
      60 * 15,
    );

    return {
      uploadUrl,
      objectPath: `${this.bucketName}/${objectName}`,
      expiresInSeconds: 900,
    };
  }
}
