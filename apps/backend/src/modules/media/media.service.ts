import { Injectable, Logger, OnModuleInit, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  RequestUploadUrlDto,
  MAX_MEDIA_FILE_SIZE_BYTES,
  ALLOWED_MIME_TYPES,
  BANNED_EXTENSIONS,
} from '@chat/shared-contracts';
import * as path from 'path';
import * as fs from 'fs';

import * as crypto from 'crypto';

@Injectable()
export class MediaService implements OnModuleInit {
  private readonly logger = new Logger(MediaService.name);
  private s3Client!: S3Client;
  private bucketName!: string;
  private region!: string;
  private endpoint!: string;

  private b2AuthToken: string | null = null;
  private b2ApiUrl: string | null = null;
  private b2DownloadUrl: string | null = null;
  private b2BucketId: string | null = null;
  private b2AccountId: string | null = null;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    this.bucketName = this.configService.get<string>('B2_BUCKET_NAME', 'chatting-indian-app');
    this.region = this.configService.get<string>('B2_REGION', 'us-east-005');

    // Auto-resolve S3 endpoint from region if not explicitly provided
    let endpoint = this.configService.get<string>('B2_ENDPOINT');
    if (!endpoint || endpoint.trim() === '') {
      endpoint = `https://s3.${this.region}.backblazeb2.com`;
    } else if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
      endpoint = `https://${endpoint}`;
    }
    this.endpoint = endpoint;

    const accessKeyId = this.configService.get<string>('B2_KEY_ID', '');
    const secretAccessKey = this.configService.get<string>('B2_APPLICATION_KEY', '');

    this.s3Client = new S3Client({
      endpoint: this.endpoint,
      region: this.region,
      credentials:
        accessKeyId && secretAccessKey
          ? {
              accessKeyId,
              secretAccessKey,
            }
          : undefined,
      forcePathStyle: true,
    });

    // Initialize native Backblaze B2 connection
    this.getB2Auth().catch((e) => {
      this.logger.warn(`Backblaze B2 initialization: ${e?.message}`);
    });
  }

  /**
   * Authorize with Backblaze B2 Native API and cache tokens & bucketId
   */
  private async getB2Auth(): Promise<{
    apiUrl: string;
    token: string;
    bucketId: string;
    downloadUrl: string;
  } | null> {
    const keyId = this.configService.get<string>('B2_KEY_ID', '595ef2c87205');
    const appKey = this.configService.get<string>(
      'B2_APPLICATION_KEY',
      '00529b271cf066977877a16a12a1e10e7d434a268d',
    );
    const bucketName = this.bucketName;

    try {
      const creds = Buffer.from(`${keyId}:${appKey}`).toString('base64');
      const authRes = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
        method: 'GET',
        headers: { Authorization: `Basic ${creds}` },
      });

      if (!authRes.ok) {
        this.logger.warn(`B2 auth failed: HTTP ${authRes.status}`);
        return null;
      }

      const authData = await authRes.json();
      this.b2ApiUrl = authData.apiUrl;
      this.b2AuthToken = authData.authorizationToken;
      this.b2DownloadUrl = authData.downloadUrl;
      this.b2AccountId = authData.accountId;

      // Find bucketId
      const listBucketsRes = await fetch(`${this.b2ApiUrl}/b2api/v2/b2_list_buckets`, {
        method: 'POST',
        headers: {
          Authorization: this.b2AuthToken!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ accountId: this.b2AccountId }),
      });

      if (listBucketsRes.ok) {
        const bucketsData = await listBucketsRes.json();
        const found =
          bucketsData.buckets?.find((b: any) => b.bucketName === bucketName) ||
          bucketsData.buckets?.[0];
        if (found) {
          this.b2BucketId = found.bucketId;
          this.logger.log(
            `Backblaze B2 Native Storage Active (Bucket: ${bucketName}, ID: ${this.b2BucketId})`,
          );
        }
      }

      return {
        apiUrl: this.b2ApiUrl!,
        token: this.b2AuthToken!,
        bucketId: this.b2BucketId || '7589554e4fb20c58a7020015',
        downloadUrl: this.b2DownloadUrl!,
      };
    } catch (err: any) {
      this.logger.warn(`Backblaze B2 Auth exception: ${err?.message}`);
      return null;
    }
  }

  /**
   * Validates file upload parameters (Max 10MB, MIME type, no malicious extensions)
   * and generates a presigned Backblaze B2 upload URL.
   */
  async getPresignedUploadUrl(dto: RequestUploadUrlDto) {
    if (dto.fileSize > MAX_MEDIA_FILE_SIZE_BYTES) {
      throw new BadRequestException({
        code: 'FILE_TOO_LARGE',
        message: `File size exceeds the maximum limit of 10 MB (${MAX_MEDIA_FILE_SIZE_BYTES} bytes). Provided size: ${dto.fileSize} bytes.`,
        maxSizeBytes: MAX_MEDIA_FILE_SIZE_BYTES,
      });
    }

    if (dto.fileSize <= 0) {
      throw new BadRequestException({
        code: 'INVALID_FILE_SIZE',
        message: 'File size must be greater than 0 bytes.',
      });
    }

    const ext = path.extname(dto.fileName).toLowerCase();
    if (BANNED_EXTENSIONS.includes(ext)) {
      throw new BadRequestException({
        code: 'FORBIDDEN_FILE_TYPE',
        message: `Executable and script files with extension '${ext}' are strictly prohibited for security.`,
      });
    }

    const isAllowedMime =
      ALLOWED_MIME_TYPES.includes(dto.mimeType as any) ||
      dto.mimeType.startsWith('image/') ||
      dto.mimeType.startsWith('video/') ||
      dto.mimeType.startsWith('audio/');

    if (!isAllowedMime) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_MIME_TYPE',
        message: `MIME type '${dto.mimeType}' is not supported. Allowed formats: Images, Videos, Audios, Documents (PDF, DOCX, etc.).`,
      });
    }

    const sanitizedFileName = path.basename(dto.fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
    const objectName = `encrypted_media/${Date.now()}_${sanitizedFileName}`;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: objectName,
      ContentType: dto.mimeType,
      ContentEncoding: dto.contentEncoding || undefined,
      Metadata: {
        'original-size': String(dto.originalSize || dto.fileSize),
        'content-encoding': dto.contentEncoding || 'identity',
        'quality-preservation': 'lossless-100-percent',
        ...(dto.width ? { width: String(dto.width) } : {}),
        ...(dto.height ? { height: String(dto.height) } : {}),
        ...(dto.durationSeconds ? { duration: String(dto.durationSeconds) } : {}),
      },
    });

    const uploadUrl = await getSignedUrl(this.s3Client, command, { expiresIn: 900 });

    return {
      uploadUrl,
      objectKey: objectName,
      objectPath: `${this.bucketName}/${objectName}`,
      maxSizeBytes: MAX_MEDIA_FILE_SIZE_BYTES,
      expiresInSeconds: 900,
      qualityPreservation: {
        mode: 'lossless-100-percent',
        originalSize: dto.originalSize || dto.fileSize,
        contentEncoding: dto.contentEncoding || 'identity',
        width: dto.width,
        height: dto.height,
      },
    };
  }

  /**
   * Generates a presigned GET URL for downloading encrypted media blobs.
   * Preserves exact original lossless stream bytes and resolution for recipient.
   */
  async getPresignedDownloadUrl(objectKey: string) {
    const cleanKey = objectKey.startsWith('/') ? objectKey.slice(1) : objectKey;
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: cleanKey,
    });

    const downloadUrl = await getSignedUrl(this.s3Client, command, { expiresIn: 3600 });
    return {
      downloadUrl,
      objectKey: cleanKey,
      expiresInSeconds: 3600,
    };
  }

  /**
   * Directly upload a buffer to Backblaze B2 bucket using native REST API
   */
  async uploadBuffer(buffer: Buffer, key: string, contentType = 'image/jpeg'): Promise<string> {
    try {
      const auth = await this.getB2Auth();
      if (auth) {
        // Request dedicated upload URL from Backblaze B2
        const getUploadUrlRes = await fetch(`${auth.apiUrl}/b2api/v2/b2_get_upload_url`, {
          method: 'POST',
          headers: {
            Authorization: auth.token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ bucketId: auth.bucketId }),
        });

        if (getUploadUrlRes.ok) {
          const uploadUrlData = await getUploadUrlRes.json();
          const sha1 = crypto.createHash('sha1').update(buffer).digest('hex');
          const cleanKey = key.startsWith('/') ? key.slice(1) : key;

          const uploadRes = await fetch(uploadUrlData.uploadUrl, {
            method: 'POST',
            headers: {
              Authorization: uploadUrlData.authorizationToken,
              'X-Bz-File-Name': encodeURIComponent(cleanKey),
              'Content-Type': contentType,
              'Content-Length': String(buffer.length),
              'X-Bz-Content-Sha1': sha1,
            },
            body: buffer as any,
          });

          if (uploadRes.ok) {
            const uploadData = await uploadRes.json();
            this.logger.log(
              `Backblaze B2 Upload SUCCESS: ${cleanKey} (fileId: ${uploadData.fileId})`,
            );
            return `${auth.downloadUrl}/file/${this.bucketName}/${cleanKey}`;
          } else {
            const errText = await uploadRes.text();
            this.logger.warn(`Backblaze B2 upload error HTTP ${uploadRes.status}: ${errText}`);
          }
        }
      }
    } catch (err: any) {
      this.logger.warn(`Backblaze B2 uploadBuffer exception: ${err?.message}`);
    }

    return '';
  }

  /**
   * Direct base64/buffer upload for fast local and cloud media sharing
   */
  async uploadDirectFile(dto: { base64Data: string; fileName?: string; mimeType?: string }) {
    if (!dto.base64Data) {
      throw new BadRequestException('base64Data is required');
    }
    const cleanBase64 = dto.base64Data.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    const ext = dto.mimeType ? dto.mimeType.split('/')[1] || 'jpg' : 'jpg';
    const filename = `img_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${ext}`;
    const uploadsDir = path.join(process.cwd(), 'uploads', 'images');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    const filePath = path.join(uploadsDir, filename);
    fs.writeFileSync(filePath, buffer);

    // Sync directly to Backblaze B2 Cloud Object Storage
    const b2Key = `media/${filename}`;
    const b2Url = await this.uploadBuffer(buffer, b2Key, dto.mimeType || 'image/jpeg');

    const relativeUrl = `/uploads/images/${filename}`;
    return {
      success: true,
      url: relativeUrl,
      b2Url: b2Url || undefined,
      fileName: filename,
      size: buffer.length,
    };
  }
}
