import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Min,
  Max,
  IsIn,
  Matches,
} from 'class-validator';

/** Max file size: 10 MB (10 * 1024 * 1024 bytes) */
export const MAX_MEDIA_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10,485,760 bytes

/** Allowed MIME type prefixes / exact types */
export const ALLOWED_MIME_TYPES = [
  // Images
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/svg+xml',
  // Audio & Voice notes
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'audio/wav',
  'audio/aac',
  'audio/m4a',
  'audio/webm',
  // Video
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
  'video/3gpp',
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
  'application/x-rar-compressed',
  'application/x-7z-compressed',
  'text/plain',
  'text/csv',
  // Encrypted binary media envelope
  'application/octet-stream',
] as const;

/** Dangerous / banned executable extensions */
export const BANNED_EXTENSIONS = [
  '.exe',
  '.bat',
  '.sh',
  '.cmd',
  '.vbs',
  '.msi',
  '.jar',
  '.apk',
  '.bin',
  '.elf',
  '.com',
  '.scr',
  '.pif',
  '.ps1',
];

export class RequestUploadUrlDto {
  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @IsString()
  @IsNotEmpty()
  mimeType!: string;

  /** File size in bytes (Max 10 MB = 10,485,760 bytes) */
  @IsNumber()
  @Min(1, { message: 'File size must be at least 1 byte' })
  @Max(MAX_MEDIA_FILE_SIZE_BYTES, {
    message: 'File size exceeds maximum allowed limit of 10 MB',
  })
  fileSize!: number;

  /** Lossless storage compression encoding used before upload */
  @IsString()
  @IsOptional()
  @IsIn(['gzip', 'deflate', 'identity', 'none'])
  contentEncoding?: string;

  /** Original uncompressed file size for quality preservation tracking */
  @IsNumber()
  @IsOptional()
  @Min(1)
  originalSize?: number;

  /** Image / video resolution width in pixels */
  @IsNumber()
  @IsOptional()
  width?: number;

  /** Image / video resolution height in pixels */
  @IsNumber()
  @IsOptional()
  height?: number;

  /** Audio / video duration in seconds */
  @IsNumber()
  @IsOptional()
  durationSeconds?: number;
}

export class DeleteMessageDto {
  @IsString()
  @IsIn(['EVERYONE', 'ME'], {
    message: 'deleteType must be either EVERYONE or ME',
  })
  deleteType!: 'EVERYONE' | 'ME';
}
