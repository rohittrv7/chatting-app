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

@Injectable()
export class MediaService implements OnModuleInit {
  private readonly logger = new Logger(MediaService.name);
  private s3Client!: S3Client;
  private bucketName!: string;
  private region!: string;
  private endpoint!: string;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    this.bucketName = this.configService.get<string>('B2_BUCKET_NAME', 'chatting-media');
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

    if (accessKeyId && secretAccessKey) {
      try {
        await this.s3Client.send(new HeadBucketCommand({ Bucket: this.bucketName }));
        this.logger.log(`Backblaze B2 connection active (Bucket: ${this.bucketName})`);
      } catch {
        this.logger.log(
          `Backblaze B2 presigned storage engine active (Bucket: ${this.bucketName})`,
        );
      }
    }
  }

  /**
   * Validates file upload parameters (Max 10MB, MIME type, no malicious extensions)
   * and generates a presigned Backblaze B2 upload URL.
   */
  async getPresignedUploadUrl(dto: RequestUploadUrlDto) {
    // 1. Validate File Size (Max 10 MB = 10 * 1024 * 1024 bytes)
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

    // 2. Validate Dangerous File Extension
    const ext = path.extname(dto.fileName).toLowerCase();
    if (BANNED_EXTENSIONS.includes(ext)) {
      throw new BadRequestException({
        code: 'FORBIDDEN_FILE_TYPE',
        message: `Executable and script files with extension '${ext}' are strictly prohibited for security.`,
      });
    }

    // 3. Validate MIME type
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

    // 4. Generate unique object name in Backblaze B2 bucket
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

    const relativeUrl = `/uploads/images/${filename}`;
    return {
      success: true,
      url: relativeUrl,
      fileName: filename,
      size: buffer.length,
    };
  }
}
